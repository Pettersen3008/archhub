use crate::{
    Error,
    domain::{DeclarationChange, PackageComparison, Snapshot},
    valid_name,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct ComparisonIndex {
    pairs: BTreeMap<String, Pair>,
}

#[derive(Serialize)]
struct Pair {
    name: String,
    repository: String,
    installed: Metadata,
    candidate: Metadata,
}

#[derive(Default, Serialize)]
struct Metadata {
    version: String,
    architecture: String,
    validation: String,
    filename: Option<String>,
    sha256: Option<String>,
    signature_digest: Option<String>,
    declarations: BTreeMap<String, BTreeSet<String>>,
}

impl Metadata {
    fn capture(package: &alpm::Package) -> Self {
        Self {
            version: package.version().to_string(),
            architecture: package.arch().unwrap_or("any").into(),
            validation: format!("{:?}", package.validation()),
            filename: package.filename().map(str::to_owned),
            sha256: package.sha256sum().map(str::to_owned),
            signature_digest: package
                .base64_sig()
                .filter(|value| !value.is_empty())
                .map(|value| format!("{:x}", Sha256::digest(value.as_bytes()))),
            declarations: [
                ("Required dependencies", package.depends()),
                ("Optional dependencies", package.optdepends()),
                ("Provides", package.provides()),
                ("Conflicts", package.conflicts()),
                ("Replaces", package.replaces()),
            ]
            .into_iter()
            .map(|(name, dependencies)| {
                (
                    name.into(),
                    dependencies.iter().map(ToString::to_string).collect(),
                )
            })
            .collect(),
        }
    }
}

impl ComparisonIndex {
    pub(crate) fn capture(
        &mut self,
        installed: &alpm::Package,
        candidate: &alpm::Package,
        repository: &str,
    ) {
        self.pairs.insert(
            installed.name().into(),
            Pair {
                name: installed.name().into(),
                repository: repository.into(),
                installed: Metadata::capture(installed),
                candidate: Metadata::capture(candidate),
            },
        );
    }

    pub(crate) fn digest(&self) -> Result<Vec<u8>, Error> {
        Ok(Sha256::digest(serde_json::to_vec(&self.pairs)?).to_vec())
    }

    pub(crate) fn report(
        &self,
        name: &str,
        fingerprint: &str,
        snapshot: &Snapshot,
    ) -> Result<PackageComparison, Error> {
        if !valid_name(name) {
            return Err(Error::Invalid("Invalid package name.".into()));
        }
        if fingerprint != snapshot.fingerprint {
            return Err(Error::Invalid(
                "Package state has changed. Refresh the inventory before comparing again.".into(),
            ));
        }
        if snapshot.locked {
            return Err(Error::Invalid(
                "The package database is locked. Wait for the updater to finish and refresh."
                    .into(),
            ));
        }
        let pair = self.pairs.get(name).ok_or_else(|| Error::Invalid("This installed package has no candidate in the configured repository databases. AUR recipes require a separate review.".into()))?;
        let changes: Vec<_> = pair
            .installed
            .declarations
            .iter()
            .map(|(kind, installed)| {
                let empty = BTreeSet::new();
                let candidate = pair.candidate.declarations.get(kind).unwrap_or(&empty);
                declaration_change(kind, installed, candidate)
            })
            .collect();
        Ok(PackageComparison {
            name: pair.name.clone(), repository: pair.repository.clone(),
            installed_version: pair.installed.version.clone(), candidate_version: pair.candidate.version.clone(),
            version_relation: match alpm::vercmp(pair.candidate.version.as_str(), pair.installed.version.as_str()) {
                std::cmp::Ordering::Greater => "newer", std::cmp::Ordering::Equal => "same", std::cmp::Ordering::Less => "older",
            }.into(),
            installed_architecture: pair.installed.architecture.clone(), candidate_architecture: pair.candidate.architecture.clone(),
            installed_validation: pair.installed.validation.clone(), filename: pair.candidate.filename.clone(),
            declared_sha256: pair.candidate.sha256.clone(), embedded_signature: pair.candidate.signature_digest.is_some(),
            captured_at: snapshot.captured_at, fingerprint: snapshot.fingerprint.clone(),
            complete: changes.iter().all(|change| change.omitted_count == 0), changes,
            limitations: vec![
                "These declarations come from installed and preferred configured repository metadata. Local databases may be stale; the updater may select a different candidate.".into(),
                "This is not a dependency-resolved transaction. Added requirements, conflicts and replacements require review by the full system updater.".into(),
                "The candidate archive is not downloaded or scanned. The SHA-256 and embedded signature are database declarations, not artifact verification. Installed validation records describe the original installation.".into(),
                "Advisories cover installed versions separately; neither unchanged metadata nor a listed fixed version proves a candidate is safe.".into(),
            ],
        })
    }
}

fn declaration_change(
    kind: &str,
    installed: &BTreeSet<String>,
    candidate: &BTreeSet<String>,
) -> DeclarationChange {
    let added: Vec<_> = candidate.difference(installed).cloned().collect();
    let removed: Vec<_> = installed.difference(candidate).cloned().collect();
    let omitted_count = (added.len() + removed.len()).saturating_sub(500);
    let keep_added = added.len().min(500);
    DeclarationChange {
        kind: kind.into(),
        added: added.into_iter().take(keep_added).collect(),
        removed: removed.into_iter().take(500 - keep_added).collect(),
        unchanged_count: installed.intersection(candidate).count(),
        omitted_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Snapshot {
        serde_json::from_value(serde_json::json!({"capturedAt":1,"fingerprint":"fixture","hostname":"fixture","installedCount":1,"explicitCount":1,"foreignCount":0,"updateCount":1,"installedSize":0,"repositories":[],"warnings":[],"locked":false,"omarchy":false,"signaturePolicy":[]})).unwrap()
    }
    fn index() -> ComparisonIndex {
        let metadata = |version: &str, declarations: &[&str]| Metadata {
            version: version.into(),
            declarations: BTreeMap::from([(
                "Required dependencies".into(),
                declarations.iter().map(|s| s.to_string()).collect(),
            )]),
            ..Default::default()
        };
        ComparisonIndex {
            pairs: BTreeMap::from([(
                "fixture".into(),
                Pair {
                    name: "fixture".into(),
                    repository: "extra".into(),
                    installed: metadata("9.0-1", &["keep", "old"]),
                    candidate: metadata("1:1.0-1", &["keep", "new>=2"]),
                },
            )]),
        }
    }
    #[test]
    fn compares_declarations_and_arch_epochs_without_safety_verdict() {
        let report = index().report("fixture", "fixture", &snapshot()).unwrap();
        assert_eq!(report.version_relation, "newer");
        assert_eq!(report.changes[0].added, ["new>=2"]);
        assert_eq!(report.changes[0].removed, ["old"]);
        assert_eq!(report.changes[0].unchanged_count, 1);
        assert!(!report.embedded_signature);
        assert!(report.declared_sha256.is_none());
        assert!(report.complete);
    }
    #[test]
    fn rejects_stale_locked_missing_and_malformed_requests() {
        let index = index();
        let mut snapshot = snapshot();
        assert!(index.report("fixture", "stale", &snapshot).is_err());
        assert!(index.report("../etc/passwd", "fixture", &snapshot).is_err());
        assert!(index.report("missing", "fixture", &snapshot).is_err());
        snapshot.locked = true;
        assert!(index.report("fixture", "fixture", &snapshot).is_err());
    }
    #[test]
    fn bounds_large_changes_and_reports_omissions() {
        let candidate = (0..510).map(|i| format!("dependency-{i:04}")).collect();
        let removed = BTreeSet::from(["removed".into()]);
        let change = declaration_change("Required dependencies", &removed, &candidate);
        assert_eq!(change.added.len() + change.removed.len(), 500);
        assert_eq!(change.omitted_count, 11);
    }
    #[test]
    fn metadata_only_and_signature_changes_invalidate_snapshot_digest() {
        let mut index = index();
        let before = index.digest().unwrap();
        index.pairs.get_mut("fixture").unwrap().candidate.sha256 = Some("a".repeat(64));
        let after = index.digest().unwrap();
        assert_ne!(before, after);
        index
            .pairs
            .get_mut("fixture")
            .unwrap()
            .candidate
            .signature_digest = Some("b".repeat(64));
        assert_ne!(after, index.digest().unwrap());
    }
}
