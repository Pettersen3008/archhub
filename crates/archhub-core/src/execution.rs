//! Narrow removal execution. Not exposed by Service's read-only request API.
use crate::{
    Error,
    domain::*,
    inventory::{self, Inventory},
    maintenance, now, removal,
};
use alpm::{Alpm, LogLevel, TransFlag};
use sha2::{Digest, Sha256};
use std::{
    cell::Cell,
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
    rc::Rc,
};

pub const HELPER_PATH: &str = "/usr/lib/archhub/archhub-helper";
pub const POLICY_PATH: &str = "/usr/share/polkit-1/actions/dev.archhub.remove.policy";

/// Every existing component must be root-owned, non-symlink and not writable by
/// group/other. In particular, source-tree executables can never be elevated.
pub fn trusted_path(path: &Path) -> Result<(), Error> {
    if !path.is_absolute() {
        return Err(Error::Invalid("A system path must be absolute.".into()));
    }
    let mut current = PathBuf::from("/");
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(part) => current.push(part),
            _ => return Err(Error::Invalid("Invalid system path component.".into())),
        }
        let m = fs::symlink_metadata(&current)?;
        if m.uid() != 0 || m.mode() & 0o022 != 0 || m.file_type().is_symlink() {
            return Err(Error::Invalid("The system component must be root-owned, with no writable or symlink path components.".into()));
        }
    }
    Ok(())
}

fn hash_file(hash: &mut Sha256, path: &Path, optional: bool, total: &mut u64) -> Result<(), Error> {
    hash.update(path.as_os_str().as_encoded_bytes());
    match fs::symlink_metadata(path) {
        Err(e) if optional && e.kind() == std::io::ErrorKind::NotFound => {
            trusted_path(
                path.parent()
                    .ok_or_else(|| Error::Invalid("Missing metadata parent.".into()))?,
            )?;
            hash.update(b"missing\0");
            return Ok(());
        }
        Err(e) => return Err(e.into()),
        Ok(m) if m.file_type().is_symlink() => {
            trusted_path(
                path.parent()
                    .ok_or_else(|| Error::Invalid("Missing link parent.".into()))?,
            )?;
            if m.uid() != 0 {
                return Err(Error::Invalid("Untrusted metadata link.".into()));
            }
            let link = fs::read_link(path)?;
            hash.update(link.as_os_str().as_encoded_bytes());
            let resolved = path.canonicalize()?;
            if resolved == Path::new("/dev/null") {
                hash.update(b"masked\0");
                return Ok(());
            }
            trusted_path(&resolved)?;
        }
        Ok(_) => trusted_path(path)?,
    }
    let file = fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(Error::Invalid(
            "Execution metadata must be a regular file.".into(),
        ));
    }
    let mut bytes = Vec::new();
    file.take(16_000_001).read_to_end(&mut bytes)?;
    *total += bytes.len() as u64;
    if bytes.len() > 16_000_000 || *total > 64_000_000 {
        return Err(Error::Invalid(
            "Execution metadata exceeds the review limit.".into(),
        ));
    }
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    Ok(())
}

pub(crate) fn digest(inventory: &Inventory, targets: &[RemovalTarget]) -> Result<String, Error> {
    removal::validate_targets(targets)?;
    let config = &inventory.config;
    if Path::new(&config.root_dir) != Path::new("/")
        || Path::new(&config.db_path) != Path::new("/var/lib/pacman")
        || Path::new(&config.log_file) != Path::new("/var/log/pacman.log")
    {
        return Err(Error::Invalid(
            "Direct removal currently supports the default system root, database and log paths."
                .into(),
        ));
    }
    trusted_path(Path::new("/etc/pacman.conf"))?;
    trusted_path(Path::new(&config.db_path))?;
    trusted_path(Path::new("/var/log"))?;
    if fs::symlink_metadata(&config.log_file).is_ok() {
        trusted_path(Path::new(&config.log_file))?;
    }
    let mut hash = Sha256::new();
    hash.update(b"archhub-removal-execution-v1\0");
    hash.update(format!("{config:?}"));
    hash.update(&inventory.snapshot.fingerprint);
    let mut total = 0;
    for path in ["/usr/bin/pacman-conf", "/usr/lib/libalpm.so.16"] {
        hash_file(&mut hash, Path::new(path), false, &mut total)?;
    }
    let mut ordered = targets.to_vec();
    ordered.sort_by(|a, b| a.name.cmp(&b.name));
    for target in ordered {
        if !inventory.installed.iter().any(|p| {
            p.name == target.name && p.installed_version.as_deref() == Some(target.version.as_str())
        }) {
            return Err(Error::Invalid("Selected installed version changed.".into()));
        }
        let dir = Path::new(&config.db_path)
            .join("local")
            .join(format!("{}-{}", target.name, target.version));
        for name in ["desc", "files", "mtree", "install"] {
            hash_file(
                &mut hash,
                &dir.join(name),
                matches!(name, "mtree" | "install"),
                &mut total,
            )?;
        }
    }
    let dirs: BTreeSet<_> = std::iter::once("/usr/share/libalpm/hooks".to_owned())
        .chain(config.hook_dir.iter().cloned())
        .collect();
    let mut hooks = 0;
    for dir in dirs {
        let path = Path::new(&dir);
        hash.update(dir.as_bytes());
        match fs::read_dir(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                trusted_path(
                    path.parent()
                        .ok_or_else(|| Error::Invalid("Invalid hook directory.".into()))?,
                )?;
                hash.update(b"absent\0");
            }
            Err(e) => return Err(e.into()),
            Ok(entries) => {
                trusted_path(path)?;
                let mut files = Vec::new();
                for entry in entries {
                    let entry = entry?;
                    hooks += 1;
                    if entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "hook")
                    {
                        files.push(entry.path());
                    }
                    if hooks > 5000 {
                        return Err(Error::Invalid(
                            "Too many hooks for direct removal review.".into(),
                        ));
                    }
                }
                files.sort();
                for file in files {
                    hash_file(&mut hash, &file, false, &mut total)?;
                }
            }
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn validate_request(request: &RemovalApplyRequest) -> Result<(), Error> {
    removal::validate_targets(&request.targets)?;
    if request.protocol != 1
        || [&request.fingerprint, &request.execution_digest]
            .iter()
            .any(|v| {
                v.len() != 64
                    || !v
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
    {
        return Err(Error::Invalid(
            "Unsupported or malformed removal request.".into(),
        ));
    }
    Ok(())
}

pub fn apply_removal(request: RemovalApplyRequest) -> Result<RemovalOutcome, Error> {
    validate_request(&request)?;
    if !nix::unistd::Uid::effective().is_root() {
        return Err(Error::Invalid(
            "Administrator authentication is required.".into(),
        ));
    }
    trusted_path(Path::new("/usr/bin/pacman-conf"))?;
    trusted_path(Path::new("/etc/pacman.conf"))?;
    let inventory = inventory::load()?;
    maintenance::validate(&inventory.snapshot, &request.fingerprint)?;
    let plan = removal::preview(&inventory, request.targets.clone())?;
    if !plan.dependency_check_passed || !plan.held_packages.is_empty() || plan.command.is_none() {
        return Err(Error::Invalid(
            "Removal is blocked by dependencies or HoldPkg policy.".into(),
        ));
    }
    if plan.execution_digest.as_deref() != Some(&request.execution_digest) {
        return Err(Error::Invalid(
            "Removal execution evidence changed or is unavailable. Review again.".into(),
        ));
    }
    let mut handle = Alpm::new(
        inventory.config.root_dir.as_str(),
        inventory.config.db_path.as_str(),
    )
    .map_err(|e| Error::Inventory(e.to_string()))?;
    handle
        .set_logfile(inventory.config.log_file.as_str())
        .map_err(|e| Error::Inventory(e.to_string()))?;
    for dir in &inventory.config.hook_dir {
        handle
            .add_hookdir(dir.as_str())
            .map_err(|e| Error::Inventory(e.to_string()))?;
    }
    let logged_error = Rc::new(Cell::new(false));
    handle.set_log_cb(logged_error.clone(), |level, message, flag| {
        if level.contains(LogLevel::ERROR) {
            flag.set(true);
        }
        if level.intersects(LogLevel::ERROR | LogLevel::WARNING) {
            let _ = write!(std::io::stderr().lock(), "{message}");
        }
    });
    handle
        .trans_init(TransFlag::NONE)
        .map_err(|e| Error::Invalid(format!("Cannot lock pacman's database: {e}")))?;
    let preparation = (|| {
        let locked = inventory::load()?;
        // This transaction owns the lock. Every other validation remains active.
        if locked.snapshot.fingerprint != request.fingerprint
            || digest(&locked, &request.targets)? != request.execution_digest
        {
            return Err(Error::Invalid(
                "Package state or execution evidence changed before removal. Review again.".into(),
            ));
        }
        for target in &request.targets {
            let package = handle
                .localdb()
                .pkg(target.name.as_str())
                .map_err(|e| Error::Inventory(e.to_string()))?;
            if package.version().as_str() != target.version {
                return Err(Error::Invalid("Installed versions changed.".into()));
            }
            handle
                .trans_remove_pkg(package)
                .map_err(|e| Error::Inventory(e.to_string()))?;
        }
        handle
            .trans_prepare()
            .map_err(|e| Error::Invalid(format!("Removal is blocked: {e}")))?;
        let actual: BTreeSet<_> = handle
            .trans_remove()
            .iter()
            .map(|p| p.name().to_owned())
            .collect();
        if actual != removal::validate_targets(&request.targets)? {
            return Err(Error::Invalid(
                "Prepared selection differs from the review.".into(),
            ));
        }
        let current = inventory::load()?;
        if current.snapshot.fingerprint != request.fingerprint
            || digest(&current, &request.targets)? != request.execution_digest
        {
            return Err(Error::Invalid(
                "Removal evidence changed during preparation.".into(),
            ));
        }
        Ok::<_, Error>(())
    })();
    if let Err(error) = preparation {
        let _ = handle.trans_release();
        return Err(error);
    }
    // Past this point every failure is an attempted/possibly partial operation.
    let committed = handle.trans_commit().map_err(|e| e.to_string());
    let released = handle.trans_release().map_err(|e| e.to_string());
    let fresh = Alpm::new(
        inventory.config.root_dir.as_str(),
        inventory.config.db_path.as_str(),
    )
    .map_err(|e| e.to_string())
    .and_then(|fresh| {
        fresh.localdb().is_valid().map_err(|e| e.to_string())?;
        Ok(fresh)
    });
    let mut remaining = Vec::new();
    if let Ok(fresh) = &fresh {
        for target in &request.targets {
            if let Ok(p) = fresh.localdb().pkg(target.name.as_str()) {
                remaining.push(RemovalTarget {
                    name: target.name.clone(),
                    version: p.version().to_string(),
                });
            }
        }
    }
    let removed = committed.is_ok()
        && released.is_ok()
        && fresh.is_ok()
        && remaining.is_empty()
        && !logged_error.get();
    let message = if removed {
        "Selected packages were removed. Pacman scripts and hooks ran under system policy.".into()
    } else {
        format!(
            "Removal requires attention; scripts/hooks or package changes may have partially completed. Commit: {:?}; release: {:?}; inventory: {:?}. Refresh inventory and inspect pacman's log before another attempt.",
            committed.err(),
            released.err(),
            fresh.err()
        )
    };
    Ok(RemovalOutcome {
        status: if removed { "removed" } else { "partial" }.into(),
        message,
        targets: request.targets,
        remaining,
        finished_at: now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_hostile_versions_protocols_and_unprivileged_commit() {
        let mut request = RemovalApplyRequest {
            protocol: 1,
            targets: vec![RemovalTarget {
                name: "fixture".into(),
                version: "1-1".into(),
            }],
            fingerprint: "a".repeat(64),
            execution_digest: "b".repeat(64),
        };
        assert!(validate_request(&request).is_ok());
        if !nix::unistd::Uid::effective().is_root() {
            assert!(
                apply_removal(request.clone())
                    .unwrap_err()
                    .to_string()
                    .contains("authentication")
            );
        }
        request.targets[0].version = "1~rc1-1".into();
        assert!(validate_request(&request).is_ok());
        request.protocol = 2;
        assert!(validate_request(&request).is_err());
        request.protocol = 1;
        request.targets[0].version = "../../tmp".into();
        assert!(validate_request(&request).is_err());
        request.targets[0].version = "1-1".into();
        request.execution_digest = "B".repeat(64);
        assert!(validate_request(&request).is_err());
    }
    #[test]
    fn writable_and_symlink_paths_cannot_be_elevated() {
        assert!(trusted_path(Path::new("/usr/bin/pacman-conf")).is_ok());
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("helper");
        fs::write(&file, "test").unwrap();
        assert!(trusted_path(&file).is_err());
        let link = temp.path().join("link");
        std::os::unix::fs::symlink("/usr/bin/pacman-conf", &link).unwrap();
        assert!(trusted_path(&link).is_err());
        assert!(trusted_path(Path::new("/usr/bin/../bin/pacman-conf")).is_err());
    }
}
