use crate::{Error, domain::*, valid_name};
use sha2::{Digest, Sha256};
use similar::TextDiff;
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const MAX_BUNDLE_BYTES: usize = 2_000_000;
const MAX_RECORD_BYTES: u64 = 8_000_000;
const MAX_REVIEWS: usize = 40;

pub fn valid_commit(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn valid_file(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.split('/').count() <= 4
        && value.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.starts_with('-')
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"@._+-".contains(&c))
        })
}

pub fn file(path: &str, role: &str, content: String) -> RecipeFile {
    RecipeFile {
        path: path.into(),
        role: role.into(),
        digest: format!("{:x}", Sha256::digest(content.as_bytes())),
        content,
    }
}

pub fn bundle_digest(files: &[RecipeFile]) -> String {
    let mut ordered: Vec<_> = files.iter().collect();
    ordered.sort_by(|a, b| a.path.cmp(&b.path));
    let mut hash = Sha256::new();
    hash.update(b"archhub-recipe-bundle-v2\0");
    for file in ordered {
        hash.update((file.path.len() as u64).to_be_bytes());
        hash.update(file.path.as_bytes());
        hash.update((file.content.len() as u64).to_be_bytes());
        hash.update(file.content.as_bytes());
    }
    format!("{hash:x}", hash = hash.finalize())
}

pub fn summary(review: &RecipeReview) -> RecipeReviewSummary {
    RecipeReviewSummary {
        static_analyzer_version: review.scan.static_analyzer_version,
        package_base: review.scan.package_base.clone(),
        commit: review.scan.commit.clone(),
        digest: review.scan.digest.clone(),
        scanned_at: review.scan.scanned_at,
        reviewed_at: review.reviewed_at,
        note: review.note.clone(),
        file_count: review.scan.files.len(),
        finding_count: review.scan.findings.len(),
    }
}

pub fn inspect(scan: RecipeScan, review: Option<RecipeReview>) -> RecipeInspection {
    let status = if !scan.complete {
        "incomplete"
    } else {
        match review.as_ref() {
            None => "unreviewed",
            Some(review)
                if review.scan.digest == scan.digest && review.scan.commit == scan.commit =>
            {
                if review.scan.static_analyzer_version == scan.static_analyzer_version {
                    "reviewed"
                } else {
                    "analysis-changed"
                }
            }
            Some(_) => "changed",
        }
    }
    .into();
    let changes = if scan.complete {
        review
            .as_ref()
            .map(|review| changes(&review.scan.files, &scan.files))
            .unwrap_or_default()
    } else {
        vec![]
    };
    RecipeInspection {
        scan,
        baseline: review.as_ref().map(summary),
        status,
        changes,
    }
}

pub fn changes(old: &[RecipeFile], new: &[RecipeFile]) -> Vec<RecipeFileChange> {
    let paths: BTreeSet<_> = old
        .iter()
        .chain(new)
        .map(|file| file.path.as_str())
        .collect();
    paths
        .into_iter()
        .filter_map(|path| {
            let before = old.iter().find(|file| file.path == path);
            let after = new.iter().find(|file| file.path == path);
            if before.map(|file| &file.content) == after.map(|file| &file.content) {
                return None;
            }
            let kind = match (before, after) {
                (None, _) => "added",
                (_, None) => "removed",
                _ => "modified",
            };
            let diff = TextDiff::configure()
                .timeout(Duration::from_millis(150))
                .diff_lines(
                    before.map(|file| file.content.as_str()).unwrap_or(""),
                    after.map(|file| file.content.as_str()).unwrap_or(""),
                );
            let mut output = String::new();
            let mut truncated = false;
            for hunk in diff.unified_diff().context_radius(3).iter_hunks() {
                for line in hunk.to_string().split_inclusive('\n') {
                    if output.len() + line.len() > 64_000 || output.lines().count() >= 300 {
                        truncated = true;
                        break;
                    }
                    output.push_str(line);
                }
                if truncated {
                    break;
                }
            }
            Some(RecipeFileChange {
                path: path.into(),
                kind: kind.into(),
                diff: output,
                truncated,
            })
        })
        .collect()
}

#[derive(Clone)]
pub struct ReviewStore {
    root: PathBuf,
}

impl ReviewStore {
    #[cfg(test)]
    pub(crate) fn at(root: PathBuf) -> Self {
        Self { root }
    }
    pub fn discover() -> Result<Self, Error> {
        let state = match std::env::var_os("XDG_STATE_HOME") {
            Some(value) if !value.is_empty() && PathBuf::from(&value).is_absolute() => {
                PathBuf::from(value)
            }
            _ => PathBuf::from(std::env::var_os("HOME").ok_or_else(|| {
                Error::Invalid("Home directory is unavailable for review storage.".into())
            })?)
            .join(".local/state"),
        };
        Ok(Self {
            root: state.join("archhub/recipe-reviews-v1"),
        })
    }

    fn path(&self, base: &str) -> Result<PathBuf, Error> {
        if !valid_name(base) {
            return Err(Error::Invalid("Invalid package base.".into()));
        }
        Ok(self
            .root
            .join(format!("{:x}.json", Sha256::digest(base.as_bytes()))))
    }

    fn load_path(&self, path: &std::path::Path) -> Result<RecipeReview, Error> {
        self.check_root()?;
        if fs::symlink_metadata(path)?.file_type().is_symlink() {
            return Err(Error::Invalid(
                "Review storage contains a symbolic link. No evidence was loaded.".into(),
            ));
        }
        let input = File::open(path)?;
        if input.metadata()?.len() > MAX_RECORD_BYTES {
            return Err(Error::Invalid(
                "Saved review exceeds the evidence size limit.".into(),
            ));
        }
        let mut bytes = Vec::new();
        input.take(MAX_RECORD_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(Error::Invalid(
                "Saved review exceeds the evidence size limit.".into(),
            ));
        }
        let mut review: RecipeReview = serde_json::from_slice(&bytes)?;
        validate_review(&review)?;
        if self.path(&review.scan.package_base)? != path {
            return Err(Error::Invalid(
                "Saved review does not match its package identity.".into(),
            ));
        }
        // Derived declarations are recomputed from validated captured bytes, including old records.
        review.scan.source_evidence = Some(crate::sources::analyze(
            &review.scan.package_base,
            &review.scan.files,
        ));
        Ok(review)
    }

    pub fn load(&self, base: &str) -> Result<Option<RecipeReview>, Error> {
        let path = self.path(base)?;
        match self.load_path(&path) {
            Ok(review) => Ok(Some(review)),
            Err(Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn list(&self) -> Result<Vec<RecipeReviewSummary>, Error> {
        match self.check_root() {
            Err(Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(vec![]);
            }
            Err(error) => return Err(error),
            Ok(()) => (),
        }
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        let mut reviews = Vec::new();
        for (index, entry) in entries.enumerate() {
            if index >= MAX_REVIEWS * 2 {
                return Err(Error::Invalid(
                    "Review directory contains too many entries.".into(),
                ));
            }
            let path = entry?.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if reviews.len() >= MAX_REVIEWS {
                    return Err(Error::Invalid(
                        "Review store exceeds its 40-record limit.".into(),
                    ));
                }
                reviews.push(summary(&self.load_path(&path)?));
            }
        }
        reviews.sort_by(|a, b| b.reviewed_at.total_cmp(&a.reviewed_at));
        Ok(reviews)
    }

    fn check_root(&self) -> Result<(), Error> {
        let metadata = fs::symlink_metadata(&self.root)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(Error::Invalid(
                "Review directory must be a regular directory, not a symbolic link.".into(),
            ));
        }
        Ok(())
    }

    pub fn save(&self, review: &RecipeReview) -> Result<(), Error> {
        validate_review(review)?;
        let path = self.path(&review.scan.package_base)?;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.root)?;
        self.check_root()?;
        let lock_path = self.root.join(".store.lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(Error::Invalid(
                "Review storage lock must not be a symbolic link.".into(),
            ));
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(lock_path)?;
        lock.lock()?;
        let records = self.list()?;
        if records.len() >= MAX_REVIEWS
            && !records
                .iter()
                .any(|record| record.package_base == review.scan.package_base)
        {
            return Err(Error::Invalid(
                "The 40-review limit is reached. Remove an old baseline before saving another."
                    .into(),
            ));
        }
        let bytes = serde_json::to_vec(review)?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(Error::Invalid(
                "Review exceeds the evidence size limit.".into(),
            ));
        }
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = self
            .root
            .join(format!(".{}-{suffix}.tmp", std::process::id()));
        let result = (|| -> Result<(), Error> {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            output.write_all(&bytes)?;
            output.sync_all()?;
            fs::rename(&temporary, &path)?;
            File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub fn remove(&self, base: &str, digest: &str, commit: &str) -> Result<(), Error> {
        self.check_root()?;
        let lock_path = self.root.join(".store.lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(Error::Invalid(
                "Review storage lock must not be a symbolic link.".into(),
            ));
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(lock_path)?;
        lock.lock()?;
        let review = self
            .load(base)?
            .ok_or_else(|| Error::Invalid("No saved review exists for this package.".into()))?;
        if review.scan.digest != digest || review.scan.commit != commit {
            return Err(Error::Invalid(
                "Saved review changed. Reload before removing it.".into(),
            ));
        }
        fs::remove_file(self.path(base)?)?;
        Ok(())
    }
}

pub fn validate_review(review: &RecipeReview) -> Result<(), Error> {
    let scan = &review.scan;
    let names: BTreeSet<_> = scan.files.iter().map(|file| file.path.as_str()).collect();
    if !valid_name(&scan.package_base)
        || !valid_commit(&scan.commit)
        || !scan.complete
        || scan.static_analyzer_version == Some(0)
        || !scan.warnings.is_empty()
        || !review.reviewed_at.is_finite()
        || review.reviewed_at <= 0.0
        || !scan.scanned_at.is_finite()
        || scan.scanned_at <= 0.0
        || review.note.trim().chars().count() < 8
        || review.note.chars().count() > 1000
        || scan.files.len() > 8
        || names.len() != scan.files.len()
        || !names.contains("PKGBUILD")
        || !names.contains(".SRCINFO")
        || scan
            .files
            .iter()
            .map(|file| file.content.len())
            .sum::<usize>()
            > MAX_BUNDLE_BYTES
        || scan.files.iter().any(|file| {
            !valid_file(&file.path)
                || (file.path == "PKGBUILD" && file.role != "build")
                || (file.path == ".SRCINFO" && file.role != "metadata")
                || (!["PKGBUILD", ".SRCINFO"].contains(&file.path.as_str())
                    && file.role != "install")
                || file.content.len() > 512_000
                || file.digest != format!("{:x}", Sha256::digest(file.content.as_bytes()))
        })
        || scan.digest != bundle_digest(&scan.files)
    {
        return Err(Error::Invalid("Review evidence is invalid or incomplete. Fetch the files again and add a review note of 8–1000 characters.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scan(commit: char, content: &str) -> RecipeScan {
        let files = vec![
            file("PKGBUILD", "build", content.into()),
            file(".SRCINFO", "metadata", "pkgbase = fixture".into()),
        ];
        RecipeScan {
            static_analyzer_version: Some(crate::scanner::RULESET_VERSION),
            source_evidence: None,
            package_base: "fixture".into(),
            scanned_at: 1.0,
            digest: bundle_digest(&files),
            commit: commit.to_string().repeat(40),
            files,
            complete: true,
            warnings: vec![],
            url: "https://aur.archlinux.org/".into(),
            findings: vec![],
            limitations: vec![],
        }
    }
    fn review() -> RecipeReview {
        RecipeReview {
            scan: scan('a', "pkgver=1\n"),
            reviewed_at: 2.0,
            note: "Reviewed upstream files.".into(),
        }
    }
    fn store() -> ReviewStore {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        ReviewStore {
            root: std::env::temp_dir()
                .join(format!("archhub-evidence-{}-{unique}", std::process::id())),
        }
    }
    #[test]
    fn review_is_invalidated_by_commit_and_file_changes() {
        assert_eq!(
            inspect(scan('a', "pkgver=1\n"), Some(review())).status,
            "reviewed"
        );
        let commit_only = inspect(scan('b', "pkgver=1\n"), Some(review()));
        assert_eq!(commit_only.status, "changed");
        assert!(commit_only.changes.is_empty());
        let changed = inspect(scan('a', "pkgver=2\n"), Some(review()));
        assert_eq!(changed.status, "changed");
        assert_eq!(changed.changes.len(), 1);
        assert!(changed.changes[0].diff.contains("-pkgver=1"));
        assert!(changed.changes[0].diff.contains("+pkgver=2"));
        let mut incomplete = scan('a', "pkgver=1\n");
        incomplete.complete = false;
        incomplete.files.pop();
        incomplete.digest = bundle_digest(&incomplete.files);
        let uncertain = inspect(incomplete, Some(review()));
        assert_eq!(uncertain.status, "incomplete");
        assert!(
            uncertain.changes.is_empty(),
            "Missing fetches must not become confirmed file deletions"
        );
    }
    #[test]
    fn matching_files_require_another_review_when_ruleset_changes_or_is_unknown() {
        for old_version in [None, Some(999)] {
            let mut saved = review();
            saved.scan.static_analyzer_version = old_version;
            let inspected = inspect(scan('a', "pkgver=1\n"), Some(saved));
            assert_eq!(inspected.status, "analysis-changed");
            assert!(inspected.changes.is_empty());
            assert_eq!(
                inspected.baseline.unwrap().static_analyzer_version,
                old_version
            );
        }
    }
    #[test]
    fn unversioned_saved_findings_are_preserved_without_rewriting_records() {
        let store = store();
        let mut original = review();
        original.scan = scan('a', "pkgdesc='A tool that skips duplicate files'\n");
        original.scan.findings = crate::scanner::scan("fixture", "sha256sums=('SKIP')");
        store.save(&original).unwrap();
        let path = store.path("fixture").unwrap();
        let mut old_json = serde_json::to_value(&original).unwrap();
        old_json["scan"]
            .as_object_mut()
            .unwrap()
            .remove("staticAnalyzerVersion");
        fs::write(&path, serde_json::to_vec(&old_json).unwrap()).unwrap();
        let before = fs::read(&path).unwrap();
        let loaded = store.load("fixture").unwrap().unwrap();
        assert_eq!(loaded.scan.static_analyzer_version, None);
        assert_eq!(
            serde_json::to_value(&loaded.scan.findings).unwrap(),
            serde_json::to_value(&original.scan.findings).unwrap()
        );
        assert_eq!(loaded.note, original.note);
        assert_eq!(loaded.scan.digest, original.scan.digest);
        assert_eq!(fs::read(&path).unwrap(), before);
        old_json["scan"]["staticAnalyzerVersion"] = serde_json::json!(0);
        fs::write(&path, serde_json::to_vec(&old_json).unwrap()).unwrap();
        assert!(
            store.load("fixture").is_err(),
            "Zero is not an identified ruleset version"
        );
        fs::remove_dir_all(&store.root).unwrap();
    }
    #[test]
    fn diffs_keep_added_removed_and_modified_files() {
        let old = vec![
            file("old.install", "install", "old\n".into()),
            file("PKGBUILD", "build", "pkgver=1\n".into()),
        ];
        let new = vec![
            file("new.install", "install", "new\n".into()),
            file("PKGBUILD", "build", "pkgver=2\n".into()),
        ];
        let changes = changes(&old, &new);
        assert_eq!(
            changes
                .iter()
                .map(|change| change.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["modified", "added", "removed"]
        );
        assert!(!self::changes(&old, &new)[0].diff.is_empty());
        let large = vec![file("PKGBUILD", "build", "long line\n".repeat(400))];
        assert!(self::changes(&[], &large)[0].truncated);
    }
    #[test]
    fn paths_and_digests_cannot_alias_other_files() {
        for path in [
            "../secret",
            "/etc/passwd",
            "a//b",
            "a/./b",
            "x?foo=1",
            "x#y",
            "$(id)",
            "x\\y",
            "",
        ] {
            assert!(!valid_file(path), "{path}");
        }
        assert!(valid_file("packaging/fixture.install"));
        let a = vec![file("a", "build", "bc".into())];
        let b = vec![file("ab", "build", "c".into())];
        assert_ne!(bundle_digest(&a), bundle_digest(&b));
        let mut invalid = review();
        invalid.scan.files[0].content = "tampered".into();
        assert!(validate_review(&invalid).is_err());
    }
    #[test]
    fn persistence_roundtrip_survives_reload_and_rejects_corruption() {
        let store = store();
        assert!(store.load("fixture").expect("empty").is_none());
        assert!(store.list().expect("empty list").is_empty());
        store.save(&review()).expect("save");
        let reopened = ReviewStore {
            root: store.root.clone(),
        };
        assert_eq!(
            reopened
                .load("fixture")
                .expect("reload")
                .expect("record")
                .note,
            review().note
        );
        assert_eq!(reopened.list().expect("list").len(), 1);
        assert!(
            store
                .remove("fixture", "stale", &review().scan.commit)
                .is_err()
        );
        fs::write(store.path("fixture").expect("path"), b"{broken").expect("corrupt");
        assert!(store.load("fixture").is_err());
        fs::remove_dir_all(&store.root).expect("cleanup");
    }
    #[test]
    fn old_reviews_recompute_source_declarations_without_rewriting_captured_identity() {
        let store = store();
        let original = review();
        store.save(&original).unwrap();
        let path = store.path("fixture").unwrap();
        let mut json = serde_json::to_value(&original).unwrap();
        json["scan"]
            .as_object_mut()
            .unwrap()
            .remove("sourceEvidence");
        fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
        let old_bytes = fs::read(&path).unwrap();
        let loaded = store.load("fixture").unwrap().unwrap();
        assert_eq!(loaded.scan.digest, original.scan.digest);
        assert_eq!(loaded.scan.commit, original.scan.commit);
        assert_eq!(loaded.note, original.note);
        assert_eq!(loaded.reviewed_at, original.reviewed_at);
        assert_eq!(loaded.scan.scanned_at, original.scan.scanned_at);
        assert_eq!(fs::read(&path).unwrap(), old_bytes);
        assert!(!loaded.scan.source_evidence.unwrap().complete); // Old fixture lacks a pkgname section.
        let mut forged = serde_json::to_value(store.load("fixture").unwrap().unwrap()).unwrap();
        forged["scan"]["sourceEvidence"]["complete"] = serde_json::json!(true);
        forged["scan"]["sourceEvidence"]["analyzerVersion"] = serde_json::json!(999);
        fs::write(&path, serde_json::to_vec(&forged).unwrap()).unwrap();
        let recomputed = store
            .load("fixture")
            .unwrap()
            .unwrap()
            .scan
            .source_evidence
            .unwrap();
        assert!(!recomputed.complete);
        assert_eq!(recomputed.analyzer_version, 1);
        fs::remove_dir_all(&store.root).unwrap();
    }
    #[test]
    fn incomplete_reviews_and_symlink_targets_are_rejected() {
        let store = store();
        let mut incomplete = review();
        incomplete.scan.complete = false;
        assert!(store.save(&incomplete).is_err());
        assert!(!store.root.exists());
        store.save(&review()).expect("save");
        store
            .remove("fixture", &review().scan.digest, &review().scan.commit)
            .expect("remove");
        let target = store.root.join("target");
        fs::write(&target, "private").expect("target");
        std::os::unix::fs::symlink(&target, store.path("fixture").expect("path")).expect("link");
        assert!(store.load("fixture").is_err());
        assert_eq!(fs::read_to_string(&target).expect("read"), "private");
        fs::remove_dir_all(&store.root).expect("cleanup");
    }
    #[test]
    fn separate_clients_serialize_atomic_review_writes() {
        let store = store();
        let handles: Vec<_> = (0..6)
            .map(|index| {
                let store = store.clone();
                std::thread::spawn(move || {
                    let mut review = review();
                    review.scan.package_base = format!("fixture-{index}");
                    store.save(&review).expect("concurrent save");
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread");
        }
        assert_eq!(store.list().expect("all records").len(), 6);
        fs::remove_dir_all(&store.root).expect("cleanup");
    }
}
