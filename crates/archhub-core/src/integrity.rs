use crate::{Error, domain::*, now, valid_name, valid_version};
use alpm::Alpm;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    io::Read,
    path::Path,
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};

const OUTPUT_LIMIT: usize = 2_000_000;
const DEADLINE: Duration = Duration::from_secs(90);

struct Metadata {
    config: pacmanconf::Config,
    digest: String,
    owned_files: usize,
    backups: HashSet<String>,
}

fn metadata(name: &str, version: &str) -> Result<Metadata, Error> {
    let config = pacmanconf::Config::with_opts(Some("/usr/bin/pacman-conf"), None, None)
        .map_err(|e| Error::Inventory(e.to_string()))?;
    metadata_with(name, version, config)
}

fn metadata_with(name: &str, version: &str, config: pacmanconf::Config) -> Result<Metadata, Error> {
    if !valid_name(name) || !valid_version(version) {
        return Err(Error::Invalid("Invalid installed package identity.".into()));
    }
    let db = Path::new(&config.db_path);
    if db.join("db.lck").exists() {
        return Err(Error::Invalid(
            "Pacman's database is locked. Wait for the package operation to finish.".into(),
        ));
    }
    let handle = Alpm::new(config.root_dir.as_str(), config.db_path.as_str())
        .map_err(|e| Error::Inventory(e.to_string()))?;
    let pkg = handle.localdb().pkg(name).map_err(|_| {
        Error::Invalid("Package is no longer installed. Refresh the inventory.".into())
    })?;
    if pkg.version().as_str() != version {
        return Err(Error::Invalid(
            "The installed version changed. Refresh the inventory before checking files.".into(),
        ));
    }
    let package_dir = db.join("local").join(format!("{name}-{version}"));
    let mut hash = Sha256::new();
    hash.update(b"archhub-installed-metadata-v1\0");
    hash.update(format!("{config:?}"));
    for filename in ["desc", "files", "mtree"] {
        hash.update(filename);
        let path = package_dir.join(filename);
        match std::fs::File::open(&path) {
            Ok(file) => {
                if !file.metadata()?.is_file() {
                    return Err(Error::Invalid(
                        "Local package metadata is not a regular file.".into(),
                    ));
                }
                let mut bytes = Vec::new();
                file.take(16_000_001).read_to_end(&mut bytes)?;
                if bytes.len() > 16_000_000 {
                    return Err(Error::Invalid(
                        "Local package metadata exceeds the 16 MB file limit.".into(),
                    ));
                }
                hash.update((bytes.len() as u64).to_be_bytes());
                hash.update(bytes);
            }
            Err(e) if filename == "mtree" && e.kind() == std::io::ErrorKind::NotFound => {
                hash.update(b"missing")
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(Metadata {
        digest: format!("{:x}", hash.finalize()),
        owned_files: pkg.files().files().len(),
        backups: pkg
            .backup()
            .iter()
            .map(|b| {
                Path::new(&config.root_dir)
                    .join(b.name())
                    .to_string_lossy()
                    .into_owned()
            })
            .collect(),
        config,
    })
}

async fn bounded_read(
    reader: impl tokio::io::AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() > limit {
        return Err(Error::Invalid(
            "File-check output exceeded its limit. Coverage is unknown; choose a smaller package."
                .into(),
        ));
    }
    Ok(bytes)
}

async fn capture(
    mut command: Command,
    limit: usize,
    deadline: Duration,
) -> Result<(Option<i32>, String, String), Error> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::Invalid("Cannot capture pacman output.".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Invalid("Cannot capture pacman diagnostics.".into()))?;
    let result = tokio::time::timeout(deadline, async {
        let (status, out, err) = tokio::try_join!(
            async { child.wait().await.map_err(Error::from) },
            bounded_read(stdout, limit),
            bounded_read(stderr, limit)
        )?;
        Ok::<_, Error>((
            status.code(),
            String::from_utf8(out).map_err(|_| {
                Error::Invalid("Pacman output is not valid UTF-8. Coverage is unknown.".into())
            })?,
            String::from_utf8(err).map_err(|_| {
                Error::Invalid(
                    "Pacman diagnostics are not valid UTF-8. Coverage is unknown.".into(),
                )
            })?,
        ))
    })
    .await;
    match result {
        Ok(Ok(value)) => Ok(value),
        other => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            match other {
                Ok(Err(error)) => Err(error),
                _ => Err(Error::Invalid("File check exceeded its 90-second deadline and was stopped. Coverage is unknown.".into())),
            }
        }
    }
}

fn pacman_command(name: &str, config: &pacmanconf::Config) -> Command {
    let mut command = Command::new("/usr/bin/pacman");
    command.env("LC_ALL", "C").env("LANGUAGE", "C").args([
        "--query",
        "--check",
        "--check",
        "--color",
        "never",
        "--root",
        &config.root_dir,
        "--dbpath",
        &config.db_path,
        "--",
        name,
    ]);
    command
}

pub async fn check(name: String, version: String) -> Result<IntegrityReport, Error> {
    let started_at = now();
    let before_name = name.clone();
    let before_version = version.clone();
    let before =
        tokio::task::spawn_blocking(move || metadata(&before_name, &before_version)).await??;
    let (exit_code, stdout, stderr) = capture(
        pacman_command(&name, &before.config),
        OUTPUT_LIMIT,
        DEADLINE,
    )
    .await?;
    let mut report = parse(
        &name, &version, started_at, &before, exit_code, &stdout, &stderr,
    );
    let after_name = name.clone();
    let after_version = version.clone();
    let after = tokio::task::spawn_blocking(move || metadata(&after_name, &after_version)).await?;
    if !after.is_ok_and(|after| after.digest == before.digest) {
        report.warnings.push("Installed metadata, configuration or database lock changed during the check. Refresh and check again.".into());
        report.complete = false;
    }
    report.finished_at = now();
    Ok(report)
}

fn summary(line: &str, name: &str) -> Option<(usize, usize)> {
    let line = line.strip_prefix(&format!("{name}: "))?;
    let (total, altered) = line.split_once(", ")?;
    let (count, noun) = total.split_once(' ')?;
    if !["total file", "total files"].contains(&noun) {
        return None;
    }
    let (changes, noun) = altered.split_once(' ')?;
    if !["altered file", "altered files"].contains(&noun) {
        return None;
    }
    Some((count.parse().ok()?, changes.parse().ok()?))
}

fn parse(
    name: &str,
    version: &str,
    started_at: f64,
    metadata: &Metadata,
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> IntegrityReport {
    let mut report = IntegrityReport {
        name: name.into(), version: version.into(), started_at, finished_at: now(),
        command: format!("/usr/bin/pacman --query --check --check --color never -- {name}"),
        metadata_digest: metadata.digest.clone(), owned_files: metadata.owned_files,
        total_entries: None, pacman_altered_files: None, exit_code, complete: true,
        issues: Vec::new(), warnings: Vec::new(),
        limitations: vec![
            "Compared with local pacman mtree metadata. The metadata and pacman binary are not independently authenticated.".into(),
            "Pacman checks SHA-256 for regular files, type, ownership, permissions, size, timestamps and symlink targets where metadata is available. Directories and symlinks do not receive content hashes.".into(),
            "Metadata entries are not a count of fully verified files. Pacman's altered count includes failed checks and excludes some backup-file changes. NoExtract can suppress missing-file checks.".into(),
            "Configuration and timestamp differences may be intentional. A mismatch does not establish malware; no differences does not establish a safe machine.".into(),
            "This is not an atomic filesystem snapshot. Files can change during or after the check, and unreadable files remain unknown. No files are repaired or elevated access requested.".into(),
        ],
    };
    let mut paths = BTreeMap::<String, IntegrityIssue>::new();
    let mut warning_paths = HashSet::new();
    let mut unknown_count = 0;
    for line in stdout
        .lines()
        .chain(stderr.lines())
        .filter(|line| !line.is_empty())
    {
        if let Some((total, altered)) = summary(line, name) {
            if report.total_entries.replace(total).is_some() {
                report.complete = false;
            }
            report.pacman_altered_files = Some(altered);
            continue;
        }
        let backup_message = line.starts_with("backup file: ");
        let warning_message = line.starts_with("warning: ");
        let content = line
            .strip_prefix("backup file: ")
            .or_else(|| line.strip_prefix("warning: "));
        let parsed = content
            .and_then(|line| line.strip_prefix(&format!("{name}: ")))
            .and_then(|line| line.strip_suffix(')'))
            .and_then(|line| line.rsplit_once(" ("));
        if let Some((path, message)) = parsed.filter(|(path, _)| path.starts_with('/')) {
            let backup = metadata.backups.contains(path);
            // Pacman's backup-only stdout must agree with the local backup declaration.
            let known_change = [
                "File type mismatch",
                "UID mismatch",
                "GID mismatch",
                "Permissions mismatch",
                "Modification time mismatch",
                "Symlink path mismatch",
                "Size mismatch",
                "SHA256 checksum mismatch",
                "No such file or directory",
            ]
            .contains(&message);
            let unavailable = !known_change || (backup_message && !backup);
            if unavailable {
                report.complete = false;
            }
            if warning_message {
                warning_paths.insert(path.to_owned());
            }
            let kind = if unavailable {
                IntegrityKind::Unavailable
            } else if backup && backup_message {
                IntegrityKind::Configuration
            } else {
                IntegrityKind::Changed
            };
            let issue = paths.entry(path.into()).or_insert_with(|| IntegrityIssue {
                path: path.into(),
                kind: kind.clone(),
                backup,
                messages: vec![],
            });
            if kind == IntegrityKind::Unavailable
                || (kind == IntegrityKind::Changed && issue.kind == IntegrityKind::Configuration)
            {
                issue.kind = kind;
            }
            if !issue.messages.iter().any(|value| value == message) {
                issue.messages.push(message.into());
            }
            continue;
        }
        report.complete = false;
        unknown_count += 1;
        if report.warnings.len() < 50 {
            report.warnings.push(format!(
                "Pacman diagnostic: {}",
                line.chars().take(1024).collect::<String>()
            ));
        }
    }
    if unknown_count > 50 {
        report.warnings.push(format!(
            "{} additional diagnostics omitted.",
            unknown_count - 50
        ));
    }
    if report.total_entries.is_none() {
        report
            .warnings
            .push("No detailed mtree summary was produced. File-check coverage is unknown.".into());
        report.complete = false;
    }
    if report
        .total_entries
        .is_some_and(|count| count < metadata.owned_files)
    {
        report.warnings.push("Pacman's mtree entry count is smaller than the installed file manifest. Coverage may be incomplete.".into());
        report.complete = false;
    }
    if !metadata.config.no_extract.is_empty() {
        report.warnings.push(
            "NoExtract rules are configured. Pacman may omit missing files covered by those rules."
                .into(),
        );
        report.complete = false;
    }
    if !matches!(
        (exit_code, report.pacman_altered_files),
        (Some(0), Some(0)) | (Some(1), Some(1..))
    ) || report
        .pacman_altered_files
        .is_some_and(|count| count != warning_paths.len())
    {
        report.warnings.push("Exit status or altered-file count does not agree with the captured diagnostics. Coverage is unknown.".into());
        report.complete = false;
    }
    report.issues = paths.into_values().collect();
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture_metadata() -> Metadata {
        let mut config = pacmanconf::Config::empty().unwrap();
        config.root_dir = "/".into();
        Metadata {
            config,
            digest: "fixture".into(),
            owned_files: 2,
            backups: HashSet::from(["/etc/fixture.conf".into()]),
        }
    }

    #[test]
    fn distinguishes_changes_backup_files_and_unknown_checks() {
        let stdout = "backup file: fixture: /etc/fixture.conf (SHA256 checksum mismatch)\nbackup file: fixture: /etc/fixture.conf (Size mismatch)\nfixture: 5 total files, 3 altered files\n";
        let stderr = "warning: fixture: /usr/bin/tool (SHA256 checksum mismatch)\nwarning: fixture: /usr/bin/tool (Size mismatch)\nwarning: fixture: /usr/lib/gone (No such file or directory)\nwarning: fixture: /etc/shadow (failed to calculate SHA256 checksum)\n";
        let report = parse(
            "fixture",
            "1-1",
            0.0,
            &fixture_metadata(),
            Some(1),
            stdout,
            stderr,
        );
        assert!(!report.complete);
        assert_eq!(report.issues.len(), 4);
        assert_eq!(report.issues[0].kind, IntegrityKind::Configuration);
        assert_eq!(report.issues[0].messages.len(), 2);
        assert_eq!(report.issues[1].kind, IntegrityKind::Unavailable);
        assert_eq!(report.issues[2].kind, IntegrityKind::Changed);
        assert!(report.warnings.is_empty());
    }

    #[test]
    fn handles_clean_and_singular_summaries_conservatively() {
        let mut meta = fixture_metadata();
        meta.owned_files = 1;
        let clean = parse(
            "fixture",
            "1",
            0.0,
            &meta,
            Some(0),
            "fixture: 1 total file, 0 altered files\n",
            "",
        );
        assert!(clean.complete);
        assert_eq!(clean.total_entries, Some(1));
        assert!(clean.issues.is_empty());
        for (out, err, code) in [
            ("fixture: no mtree file\n", "", Some(0)),
            (
                "fixture: 1 total file, 0 altered files\n",
                "warning: unfamiliar output\n",
                Some(0),
            ),
            ("fixture: 1 total file, 0 altered files\n", "", Some(1)),
            ("fixture: 1 total file, 1 altered file\n", "", Some(0)),
            ("", "", None),
            ("fixture: 0 total files, 0 altered files\n", "", Some(0)),
            (
                "fixture: 1 total file, 0 altered files\nfixture: 1 total file, 0 altered files\n",
                "",
                Some(0),
            ),
            (
                "fixture: 1 total file, 0 altered files\n",
                "warning: fixture: /file (SHA256 checksum mismatch)\n",
                Some(0),
            ),
        ] {
            assert!(!parse("fixture", "1", 0.0, &meta, code, out, err).complete);
        }
        meta.config.no_extract.push("usr/share/*".into());
        assert!(
            !parse(
                "fixture",
                "1",
                0.0,
                &meta,
                Some(0),
                "fixture: 1 total file, 0 altered files\n",
                ""
            )
            .complete
        );
    }

    #[test]
    fn does_not_trust_backup_labels_or_unrecognized_path_diagnostics() {
        let report = parse(
            "fixture",
            "1",
            0.0,
            &fixture_metadata(),
            Some(0),
            "backup file: fixture: /etc/not-backup (SHA256 checksum mismatch)\nfixture: 2 total files, 0 altered files\n",
            "warning: fixture: /etc/fixture.conf (new unsupported check)\n",
        );
        assert!(!report.complete);
        assert!(
            report
                .issues
                .iter()
                .all(|i| i.kind == IntegrityKind::Unavailable)
        );
    }

    #[test]
    fn backup_permission_and_missing_files_still_need_review() {
        for message in ["Permissions mismatch", "No such file or directory"] {
            let report = parse(
                "fixture",
                "1",
                0.0,
                &fixture_metadata(),
                Some(1),
                "backup file: fixture: /etc/fixture.conf (SHA256 checksum mismatch)\nfixture: 2 total files, 1 altered file\n",
                &format!("warning: fixture: /etc/fixture.conf ({message})\n"),
            );
            assert!(report.complete);
            assert_eq!(report.issues[0].kind, IntegrityKind::Changed);
            assert!(report.issues[0].backup);
        }
    }

    #[tokio::test]
    async fn process_capture_enforces_output_and_time_limits() {
        let mut command = Command::new("/usr/bin/head");
        command.args(["-c", "4096", "/dev/zero"]);
        assert!(
            capture(command, 128, Duration::from_secs(2))
                .await
                .unwrap_err()
                .to_string()
                .contains("exceeded its limit")
        );
        let mut command = Command::new("/usr/bin/sleep");
        command.arg("30");
        let start = std::time::Instant::now();
        assert!(
            capture(command, 128, Duration::from_millis(40))
                .await
                .unwrap_err()
                .to_string()
                .contains("was stopped")
        );
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn prerelease_versions_work_in_an_isolated_database() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("root");
        let db = directory.path().join("db");
        let pkg = db.join("local/fixture-1:1.0~rc1-1");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&pkg).unwrap();
        fs::write(db.join("local/ALPM_DB_VERSION"), "9\n").unwrap();
        fs::write(
            pkg.join("desc"),
            "%NAME%\nfixture\n\n%VERSION%\n1:1.0~rc1-1\n\n",
        )
        .unwrap();
        fs::write(pkg.join("files"), "%FILES%\n\n").unwrap();
        let mut config = pacmanconf::Config::empty().unwrap();
        config.root_dir = root.to_string_lossy().into_owned();
        config.db_path = db.to_string_lossy().into_owned();
        assert!(metadata_with("fixture", "1:1.0~rc1-1", config.clone()).is_ok());
        for version in ["../fixture", "1/2", "1\n2", "1 2", ""] {
            assert!(metadata_with("fixture", version, config.clone()).is_err());
        }
    }

    #[tokio::test]
    async fn real_pacman_checks_an_isolated_database_and_changed_files() {
        let fixture = Fixture(std::env::temp_dir().join(format!(
            "archhub-integrity-{}-{}",
            std::process::id(),
            now().to_bits()
        )));
        let root = fixture.0.join("root");
        let db = fixture.0.join("db");
        let pkg = db.join("local/archhub-fixture-1-1");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&pkg).unwrap();
        fs::write(db.join("local/ALPM_DB_VERSION"), "9\n").unwrap();
        fs::write(
            pkg.join("desc"),
            "%NAME%\narchhub-fixture\n\n%VERSION%\n1-1\n\n%ARCH%\nx86_64\n\n",
        )
        .unwrap();
        fs::write(
            pkg.join("files"),
            "%FILES%\nchanged\nconfig\ngone\nlink\n\n%BACKUP%\nconfig\t0\n\n",
        )
        .unwrap();
        // Same-size changed bytes prove the check includes content hashes.
        fs::write(root.join("changed"), "evil").unwrap();
        fs::write(root.join("config"), "user").unwrap();
        std::os::unix::fs::symlink("changed", root.join("link")).unwrap();
        let digest = format!("{:x}", Sha256::digest(b"good"));
        use std::os::unix::fs::MetadataExt;
        let stat = fs::metadata(root.join("changed")).unwrap();
        let common = format!(
            "uid={} gid={} time={}",
            stat.uid(),
            stat.gid(),
            stat.mtime()
        );
        let mode = stat.mode() & 0o7777;
        fs::write(pkg.join("mtree"), format!("#mtree\n./changed type=file {common} mode={mode:o} size=4 sha256digest={digest}\n./config type=file {common} mode={mode:o} size=4 sha256digest={digest}\n./gone type=file {common} mode={mode:o} size=4 sha256digest={digest}\n./link type=link {common} mode=777 link=gone\n")).unwrap();
        let mut config = pacmanconf::Config::empty().unwrap();
        config.root_dir = root.to_string_lossy().into_owned();
        config.db_path = db.to_string_lossy().into_owned();
        let before = metadata_with("archhub-fixture", "1-1", config.clone()).unwrap();
        let mut command = Command::new("/usr/bin/pacman");
        // Keep fixture options before the end-of-options marker. No host database is used.
        command.env("LC_ALL", "C").env("LANGUAGE", "C").args([
            "--query",
            "--check",
            "--check",
            "--color",
            "never",
            "--config",
            "/dev/null",
            "--root",
            &config.root_dir,
            "--dbpath",
            &config.db_path,
            "--",
            "archhub-fixture",
        ]);
        let (code, stdout, stderr) = capture(command, OUTPUT_LIMIT, DEADLINE).await.unwrap();
        let report = parse(
            "archhub-fixture",
            "1-1",
            0.0,
            &before,
            code,
            &stdout,
            &stderr,
        );
        assert!(
            report.complete,
            "{report:?} stdout={stdout} stderr={stderr}"
        );
        assert_eq!(report.issues.len(), 4);
        let changed = report
            .issues
            .iter()
            .find(|i| i.path.ends_with("/changed"))
            .unwrap();
        assert!(
            changed
                .messages
                .contains(&"SHA256 checksum mismatch".into())
        );
        assert!(!changed.messages.contains(&"Size mismatch".into()));
        assert_eq!(
            report
                .issues
                .iter()
                .find(|i| i.path.ends_with("/config"))
                .unwrap()
                .kind,
            IntegrityKind::Configuration
        );
        assert!(
            report
                .issues
                .iter()
                .find(|i| i.path.ends_with("/gone"))
                .unwrap()
                .messages
                .contains(&"No such file or directory".into())
        );
        assert!(
            report
                .issues
                .iter()
                .find(|i| i.path.ends_with("/link"))
                .unwrap()
                .messages
                .contains(&"Symlink path mismatch".into())
        );
        assert!(metadata_with("archhub-fixture", "2-1", config.clone()).is_err());
        assert_eq!(
            before.digest,
            metadata_with("archhub-fixture", "1-1", config.clone())
                .unwrap()
                .digest
        );
        fs::write(
            pkg.join("desc"),
            "%NAME%\narchhub-fixture\n\n%VERSION%\n1-1\n\n%DESC%\nchanged metadata\n\n",
        )
        .unwrap();
        assert_ne!(
            before.digest,
            metadata_with("archhub-fixture", "1-1", config.clone())
                .unwrap()
                .digest
        );
        fs::write(db.join("db.lck"), "").unwrap();
        assert!(metadata_with("archhub-fixture", "1-1", config).is_err());
    }
}
