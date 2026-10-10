use crate::{Error, domain::*, inventory::Inventory, now, valid_name};
use nix::{
    sys::signal::{Signal, killpg},
    unistd::Pid,
};
use std::{collections::HashSet, path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

pub fn validate(snapshot: &Snapshot, fingerprint: &str) -> Result<(), Error> {
    if snapshot.locked {
        return Err(Error::Invalid(
            "Package database is locked. Wait for the updater and refresh inventory.".into(),
        ));
    }
    if snapshot.fingerprint != fingerprint {
        return Err(Error::Invalid(
            "Package state changed. Refresh inventory and run the check again.".into(),
        ));
    }
    Ok(())
}

pub fn report(inventory: &Inventory) -> MaintenanceReport {
    let names: HashSet<_> = inventory.orphan_names.iter().collect();
    let orphans = inventory
        .installed
        .iter()
        .filter(|p| names.contains(&p.name))
        .cloned()
        .collect();
    let mut largest = inventory.installed.clone();
    largest.sort_by(|a, b| {
        b.installed_size
            .total_cmp(&a.installed_size)
            .then(a.name.cmp(&b.name))
    });
    largest.truncate(20);
    MaintenanceReport {
        captured_at: inventory.snapshot.captured_at,
        fingerprint: inventory.snapshot.fingerprint.clone(),
        orphans,
        largest,
        foreign: inventory.installed.iter().filter(|p| p.repository == "local").cloned().collect(),
        caches: Vec::new(),
        checkupdates_available: Path::new("/usr/bin/checkupdates").is_file(),
        paccache_available: Path::new("/usr/bin/paccache").is_file(),
        aur_helper: ["paru", "yay"].into_iter().find(|name| Path::new(&format!("/usr/bin/{name}")).is_file()).map(str::to_owned),
        limitations: vec![
            "Orphans match pacman -Qdt: dependency installs with no required or optional installed consumers. This does not prove a package is unused; inspect before removing.".into(),
            "Largest packages use installed metadata sizes. Cache totals sum regular-file lengths, not allocated disk blocks or reclaimable space; subdirectories and symlinks are excluded.".into(),
            "Repository updates use local databases unless an explicit online check succeeds. Foreign does not prove AUR origin. No installed package or host sync database is changed.".into(),
        ],
    }
}

pub fn cache_usage(path: &str) -> CacheUsage {
    let mut result = CacheUsage {
        path: path.into(),
        bytes: 0.0,
        files: 0,
        complete: true,
        warnings: Vec::new(),
    };
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            result.complete = false;
            result
                .warnings
                .push(format!("Cannot read this cache directory: {error}"));
            return result;
        }
    };
    for (index, entry) in entries.enumerate() {
        if index >= 50_000 {
            result.complete = false;
            result
                .warnings
                .push("Directory exceeds the 50,000-entry limit; totals are partial.".into());
            break;
        }
        let metadata = entry.and_then(|entry| std::fs::symlink_metadata(entry.path()));
        match metadata {
            Ok(metadata) if metadata.is_file() => {
                result.bytes += metadata.len() as f64;
                result.files += 1;
            }
            Ok(_) => {}
            Err(_) => result.complete = false,
        }
    }
    if !result.complete && result.warnings.is_empty() {
        result
            .warnings
            .push("Some entries could not be read; totals are partial.".into());
    }
    result
}

// checkupdates launches fakeroot/pacman descendants. Kill the whole private
// process group on timeout/cancellation, before its temporary database is removed.
struct ProcessGroup(Option<Pid>);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            let _ = killpg(pid, Signal::SIGKILL);
        }
    }
}

async fn read_bounded(reader: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    reader.take(1_000_001).read_to_end(&mut bytes).await?;
    if bytes.len() > 1_000_000 {
        return Err(Error::Invalid(
            "Update-check output exceeded its limit. Availability is unknown.".into(),
        ));
    }
    Ok(bytes)
}

async fn capture(
    mut command: Command,
    deadline: Duration,
) -> Result<(Option<i32>, String, String), Error> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()?;
    let mut group = ProcessGroup(Some(Pid::from_raw(
        i32::try_from(
            child
                .id()
                .ok_or_else(|| Error::Invalid("Cannot identify update-check process.".into()))?,
        )
        .map_err(|_| Error::Invalid("Invalid process identifier.".into()))?,
    )));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::Invalid("Cannot read update-check output.".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Invalid("Cannot read update-check diagnostics.".into()))?;
    let result = tokio::time::timeout(deadline, async {
        let (status, out, err) = tokio::try_join!(
            async { child.wait().await.map_err(Error::from) },
            read_bounded(stdout),
            read_bounded(stderr)
        )?;
        Ok::<_, Error>((
            status.code(),
            String::from_utf8(out)
                .map_err(|_| Error::Invalid("Invalid update-check output.".into()))?,
            String::from_utf8(err)
                .map_err(|_| Error::Invalid("Invalid update-check diagnostics.".into()))?,
        ))
    })
    .await;
    match result {
        Ok(Ok(value)) => {
            // The leader has been reaped and both pipes reached EOF. Avoid a
            // signal to a process-group ID that could subsequently be reused.
            group.0 = None;
            Ok(value)
        }
        other => {
            drop(group);
            let _ = child.kill().await;
            let _ = child.wait().await;
            match other {
                Ok(Err(error)) => Err(error),
                _ => Err(Error::Invalid("Online update check exceeded its 90-second deadline and was stopped. Availability is unknown.".into())),
            }
        }
    }
}

fn parse_updates(
    code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> Result<Vec<VersionChange>, Error> {
    if !matches!(code, Some(0 | 2)) || !stderr.trim().is_empty() {
        return Err(Error::Invalid(format!(
            "Online update check failed. Availability is unknown. {}",
            stderr.trim().chars().take(1000).collect::<String>()
        )));
    }
    let mut packages = Vec::new();
    let mut names = HashSet::new();
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 4
            || fields[2] != "->"
            || !valid_name(fields[0])
            || fields[1].len() > 512
            || fields[3].len() > 512
            || fields[1].chars().any(char::is_control)
            || fields[3].chars().any(char::is_control)
            || !names.insert(fields[0])
            || !alpm::vercmp(fields[3], fields[1]).is_gt()
        {
            return Err(Error::Invalid("Online update check returned malformed or inconsistent versions. Availability is unknown.".into()));
        }
        packages.push(VersionChange {
            name: fields[0].into(),
            installed_version: fields[1].into(),
            available_version: fields[3].into(),
        });
    }
    if (code == Some(2)) != packages.is_empty() {
        return Err(Error::Invalid(
            "Online update check returned an inconsistent exit status. Availability is unknown."
                .into(),
        ));
    }
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

pub async fn repository_updates(fingerprint: String) -> Result<RepositoryUpdates, Error> {
    if !Path::new("/usr/bin/checkupdates").is_file() {
        return Err(Error::Invalid("Online repository checks require pacman-contrib (checkupdates). Install it through your system package manager.".into()));
    }
    let temporary = tempfile::Builder::new()
        .prefix("archhub-checkupdates-")
        .tempdir()?;
    let mut command = Command::new("/usr/bin/checkupdates");
    command
        .arg("--nocolor")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .env("LANGUAGE", "C")
        .env("CHECKUPDATES_DB", temporary.path().join("db"))
        .env("TMPDIR", temporary.path());
    let (code, stdout, stderr) = capture(command, Duration::from_secs(90)).await?;
    Ok(RepositoryUpdates {
        checked_at: now(), fingerprint, packages: parse_updates(code, &stdout, &stderr)?,
        limitations: vec![
            "checkupdates refreshed a private temporary database using configured mirrors; installed packages and host sync databases were not changed.".into(),
            "Version changes are not a resolved transaction or an artifact/security audit. IgnorePkg/replacements and updater policy can affect the eventual transaction.".into(),
            "AUR packages and language toolchains are outside this repository check. Local candidate comparisons still use host sync databases.".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_empty_success_failure_and_arch_version_ordering() {
        assert!(parse_updates(Some(2), "", "").unwrap().is_empty());
        let result = parse_updates(Some(0), "example 9.0-1 -> 1:1.0-2\n", "").unwrap();
        assert_eq!(result[0].available_version, "1:1.0-2");
        for (code, out, err) in [
            (Some(1), "", "mirror unavailable"),
            (None, "", ""),
            (Some(0), "", ""),
            (Some(2), "example 1 -> 2", ""),
            (Some(0), "example 2 -> 1", ""),
            (Some(0), "../bad 1 -> 2", ""),
            (Some(0), "example 1 -> 2\nexample 1 -> 3", ""),
            (Some(0), "unexpected output", ""),
            (Some(2), "", "warning"),
        ] {
            assert!(parse_updates(code, out, err).is_err(), "{out}");
        }
    }
    #[test]
    fn cache_counts_regular_files_without_following_links_or_nested_directories() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.pkg.tar.zst"), [0; 37]).unwrap();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        std::fs::write(dir.path().join("nested/ignored"), [0; 10]).unwrap();
        std::os::unix::fs::symlink(
            dir.path().join("package.pkg.tar.zst"),
            dir.path().join("link"),
        )
        .unwrap();
        let report = cache_usage(dir.path().to_str().unwrap());
        assert!(report.complete);
        assert_eq!(report.files, 1);
        assert_eq!(report.bytes, 37.0);
        assert!(!cache_usage(dir.path().join("missing").to_str().unwrap()).complete);
    }
    #[tokio::test]
    async fn timeout_stops_descendants_before_they_can_write() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("marker");
        let mut command = Command::new("/usr/bin/bash");
        command
            .args([
                "-c",
                "(sleep 0.3; printf survived > \"$1\") & wait",
                "probe",
            ])
            .arg(&marker);
        assert!(capture(command, Duration::from_millis(30)).await.is_err());
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(!marker.exists());
    }
    #[tokio::test]
    async fn cancellation_stops_the_process_group_and_output_is_bounded() {
        let mut command = Command::new("/usr/bin/head");
        command.args(["-c", "1000001", "/dev/zero"]);
        assert!(
            capture(command, Duration::from_secs(2))
                .await
                .unwrap_err()
                .to_string()
                .contains("exceeded its limit")
        );
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("marker");
        let ready = dir.path().join("ready");
        let mut command = Command::new("/usr/bin/bash");
        command
            .args([
                "-c",
                "printf ready > \"$2\"; (sleep 0.3; printf survived > \"$1\") & wait",
                "probe",
            ])
            .arg(&marker)
            .arg(&ready);
        let task = tokio::spawn(capture(command, Duration::from_secs(2)));
        for _ in 0..100 {
            if ready.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(ready.exists());
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(!marker.exists());
    }
}
