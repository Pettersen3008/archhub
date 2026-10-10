use crate::{
    Error,
    domain::*,
    inventory::{self, Inventory},
    maintenance, now, valid_name, valid_version,
};
use alpm::{Alpm, PrepareData, TransFlag};
use std::{collections::BTreeSet, path::Path};

const TARGET_LIMIT: usize = 100;
const IMPACT_LIMIT: usize = 5000;

fn unlocked(config: &pacmanconf::Config) -> Result<(), Error> {
    match std::fs::symlink_metadata(Path::new(&config.db_path).join("db.lck")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
        Ok(_) => Err(Error::Invalid(
            "Pacman's database is locked. Wait, refresh inventory and review again.".into(),
        )),
    }
}

pub(crate) fn validate_targets(targets: &[RemovalTarget]) -> Result<BTreeSet<String>, Error> {
    if targets.is_empty() || targets.len() > TARGET_LIMIT {
        return Err(Error::Invalid(
            "Select between 1 and 100 installed packages for removal review.".into(),
        ));
    }
    let mut names = BTreeSet::new();
    for target in targets {
        if !valid_name(&target.name)
            || !valid_version(&target.version)
            || !names.insert(target.name.clone())
        {
            return Err(Error::Invalid(
                "Removal targets must have unique, valid package names and installed versions."
                    .into(),
            ));
        }
    }
    Ok(names)
}

pub(crate) fn capture(
    targets: Vec<RemovalTarget>,
    fingerprint: &str,
) -> Result<RemovalPlan, Error> {
    validate_targets(&targets)?;
    let inventory = inventory::load()?;
    maintenance::validate(&inventory.snapshot, fingerprint)?;
    let plan = preview(&inventory, targets)?;
    let after = inventory::load()?;
    unlocked(&after.config)?;
    maintenance::validate(&after.snapshot, fingerprint)?;
    Ok(plan)
}

fn held_packages(rules: &[String], names: &BTreeSet<String>) -> Result<Vec<String>, Error> {
    let mut held = BTreeSet::new();
    for rule in rules {
        // These POSIX constructs differ from glob's grammar. Fail explicitly,
        // rather than claiming a held package is eligible for a command.
        if rule.contains('\\') || ["[:", "[.", "[=", "[^"].iter().any(|p| rule.contains(p)) {
            return Err(Error::Invalid("Cannot interpret this HoldPkg rule for removal review. Use pacman to inspect its policy.".into()));
        }
        // POSIX fnmatch treats repeated stars as ordinary stars, not glob's
        // recursive-directory operator. Package names cannot contain slashes.
        let mut normalized = String::new();
        for c in rule.chars() {
            if c != '*' || !normalized.ends_with('*') {
                normalized.push(c);
            }
        }
        let pattern = glob::Pattern::new(&normalized).map_err(|_| {
            Error::Invalid("Invalid HoldPkg pattern; removal policy is unknown.".into())
        })?;
        held.extend(names.iter().filter(|name| pattern.matches(name)).cloned());
    }
    Ok(held.into_iter().collect())
}

pub(crate) fn preview(
    inventory: &Inventory,
    mut targets: Vec<RemovalTarget>,
) -> Result<RemovalPlan, Error> {
    let names = validate_targets(&targets)?;
    unlocked(&inventory.config)?;
    if inventory.snapshot.locked {
        return Err(Error::Invalid("Pacman's database is locked.".into()));
    }
    targets.sort_by(|a, b| a.name.cmp(&b.name));
    let mut packages = Vec::with_capacity(targets.len());
    for target in &targets {
        let package = inventory.installed.iter().find(|p| p.name == target.name && p.installed_version.as_deref() == Some(target.version.as_str()))
            .ok_or_else(|| Error::Invalid(format!("{} is missing or its installed version changed. Refresh inventory and review again.", target.name)))?;
        packages.push(package.clone());
    }
    let held_packages = held_packages(&inventory.config.hold_pkg, &names)?;
    let optional_impacts = inventory.dependencies.removal_optional_impacts(&names);
    if optional_impacts.len() > IMPACT_LIMIT {
        return Err(Error::Invalid(
            "Optional removal impacts exceed the review limit. Narrow the selection.".into(),
        ));
    }
    let mut handle = Alpm::new(
        inventory.config.root_dir.as_str(),
        inventory.config.db_path.as_str(),
    )
    .map_err(|e| Error::Inventory(e.to_string()))?;
    handle
        .trans_init(TransFlag::NO_LOCK)
        .map_err(|e| Error::Inventory(e.to_string()))?;
    // Release on every Result path. Dropping this private handle also releases
    // its uncommitted transaction if unwinding occurs.
    let prepared = (|| {
        for target in &targets {
            let package = handle
                .localdb()
                .pkg(target.name.as_str())
                .map_err(|e| Error::Inventory(e.to_string()))?;
            if package.version().as_str() != target.version {
                return Err(Error::Invalid(
                    "Installed versions changed during removal review.".into(),
                ));
            }
            handle
                .trans_remove_pkg(package)
                .map_err(|e| Error::Inventory(e.to_string()))?;
        }
        let (passed, mut blockers) = match handle.trans_prepare() {
            Ok(()) => (true, Vec::new()),
            Err(error) => match error.data() {
                Some(PrepareData::UnsatisfiedDeps(deps)) => (
                    false,
                    deps.iter()
                        .map(|dep| RemovalBlocker {
                            consumer: dep.target().into(),
                            dependency: dep.depend().to_string(),
                            causing_package: dep.causing_pkg().map(str::to_owned),
                        })
                        .collect::<Vec<_>>(),
                ),
                _ => {
                    return Err(Error::Invalid(format!(
                        "Removal dependency check failed: {error}"
                    )));
                }
            },
        };
        if blockers.len() > IMPACT_LIMIT {
            return Err(Error::Invalid(
                "Removal blockers exceed the review limit. Narrow the selection.".into(),
            ));
        }
        blockers.sort_by(|a, b| {
            a.consumer
                .cmp(&b.consumer)
                .then(a.dependency.cmp(&b.dependency))
        });
        let selected: BTreeSet<_> = handle
            .trans_remove()
            .iter()
            .map(|p| p.name().to_owned())
            .collect();
        if passed && selected != names {
            return Err(Error::Invalid(
                "Prepared removal differs from the selected packages. No command was produced."
                    .into(),
            ));
        }
        Ok((passed, blockers))
    })();
    handle
        .trans_release()
        .map_err(|e| Error::Inventory(e.to_string()))?;
    let (dependency_check_passed, blockers) = prepared?;
    unlocked(&inventory.config)?;
    let command = (dependency_check_passed && held_packages.is_empty()).then(|| {
        format!(
            "sudo pacman -R -- {}",
            targets
                .iter()
                .map(|p| format!("'{}'", p.name))
                .collect::<Vec<_>>()
                .join(" ")
        )
    });
    let (execution_digest, execution_unavailable_reason) =
        match crate::execution::digest(inventory, &targets) {
            Ok(digest) => (Some(digest), None),
            Err(error) => (None, Some(error.to_string())),
        };
    Ok(RemovalPlan {
        captured_at: now(), fingerprint: inventory.snapshot.fingerprint.clone(), targets,
        installed_size: packages.iter().map(|p| p.installed_size).sum(), packages,
        dependency_check_passed, blockers, held_packages, optional_impacts, command, execution_digest, execution_unavailable_reason,
        limitations: vec![
            "Execution evidence binds selected installed scripts and hook definitions; programs and external data used by hooks are not frozen by review.".into(),
            "Libalpm prepared plain removal of exactly these installed versions without committing, taking a database lock or running hooks. Recursive/cascade removal is not selected.".into(),
            "Installed metadata size is not a reclaimable-space estimate. Backup-marked configuration may become .pacsave; package scripts and hooks can have other effects when pacman is run.".into(),
            "Optional impacts describe declarations losing all installed providers. Undeclared application use, services, login/boot requirements and existing dependency gaps are outside this check.".into(),
            "HoldPkg matches withhold the command in ArchHub; pacman can permit these removals after extra confirmation.".into(),
            "Observed locks or metadata changes invalidate the capture. This unlocked review is not atomic, does not authorize execution, and cannot bind a later terminal command to the reviewed state. Review pacman's final prompts.".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> (tempfile::TempDir, Inventory) {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("db");
        fs::create_dir_all(db.join("local")).unwrap();
        fs::write(db.join("local/ALPM_DB_VERSION"), "9\n").unwrap();
        for (name, extra) in [
            (
                "app",
                "%DEPENDS%\nvirtual-api>=2\n\n%OPTDEPENDS%\nextra-api>=1: extra feature\n\n",
            ),
            ("provider-a", "%PROVIDES%\nvirtual-api=2\n\n"),
            ("provider-b", "%PROVIDES%\nvirtual-api=3\n\n"),
            ("optional-a", "%PROVIDES%\nextra-api=1\n\n"),
            ("optional-b", "%PROVIDES%\nextra-api=2\n\n"),
            ("orphan", ""),
            ("held", ""),
        ] {
            let dir = db.join(format!("local/{name}-1-1"));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("desc"), format!("%NAME%\n{name}\n\n%VERSION%\n1-1\n\n%ARCH%\nx86_64\n\n%REASON%\n0\n\n%SIZE%\n123\n\n{extra}")).unwrap();
            fs::write(dir.join("files"), "%FILES%\n\n").unwrap();
        }
        let mut config = pacmanconf::Config::empty().unwrap();
        config.root_dir = temp.path().to_string_lossy().into_owned();
        config.db_path = db.to_string_lossy().into_owned();
        config.hold_pkg = vec!["he*".into()];
        let inventory = inventory::load_with(config).unwrap();
        (temp, inventory)
    }
    fn targets(names: &[&str]) -> Vec<RemovalTarget> {
        names
            .iter()
            .map(|n| RemovalTarget {
                name: (*n).into(),
                version: "1-1".into(),
            })
            .collect()
    }
    #[test]
    fn prepares_exact_selection_without_commit_or_database_lock() {
        let (temp, inventory) = fixture();
        let before = fs::read(temp.path().join("db/local/orphan-1-1/desc")).unwrap();
        let plan = preview(&inventory, targets(&["orphan"])).unwrap();
        assert!(plan.dependency_check_passed);
        assert_eq!(plan.command.as_deref(), Some("sudo pacman -R -- 'orphan'"));
        assert_eq!(plan.installed_size, 123.0);
        assert_eq!(plan.packages.len(), 1);
        assert!(!temp.path().join("db/db.lck").exists());
        assert_eq!(
            before,
            fs::read(temp.path().join("db/local/orphan-1-1/desc")).unwrap()
        );
        // Independently ask real pacman for its print-only removal on this root.
        let config = temp.path().join("pacman.conf");
        fs::write(&config, "[options]\n").unwrap();
        let output = std::process::Command::new("/usr/bin/pacman")
            .args([
                "--config",
                config.to_str().unwrap(),
                "--root",
                temp.path().to_str().unwrap(),
                "--dbpath",
                inventory.config.db_path.as_str(),
                "-R",
                "--print",
                "--print-format",
                "%n %v",
                "--",
                "orphan",
            ])
            .env("LC_ALL", "C")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "orphan 1-1");
        assert_eq!(
            before,
            fs::read(temp.path().join("db/local/orphan-1-1/desc")).unwrap()
        );
    }
    #[test]
    fn blockers_respect_versioned_alternative_providers_and_joint_removal() {
        let (_temp, inventory) = fixture();
        assert!(
            preview(&inventory, targets(&["provider-a"]))
                .unwrap()
                .dependency_check_passed
        );
        let blocked = preview(&inventory, targets(&["provider-a", "provider-b"])).unwrap();
        assert!(!blocked.dependency_check_passed);
        assert!(blocked.command.is_none());
        assert_eq!(blocked.blockers[0].consumer, "app");
        assert_eq!(blocked.blockers[0].dependency, "virtual-api>=2");
        assert!(
            preview(&inventory, targets(&["app", "provider-a", "provider-b"]))
                .unwrap()
                .dependency_check_passed
        );
    }
    #[test]
    fn optional_loss_excludes_remaining_providers_and_removed_consumers() {
        let (_temp, inventory) = fixture();
        assert!(
            preview(&inventory, targets(&["optional-a"]))
                .unwrap()
                .optional_impacts
                .is_empty()
        );
        let plan = preview(&inventory, targets(&["optional-a", "optional-b"])).unwrap();
        assert_eq!(plan.optional_impacts.len(), 1);
        assert_eq!(plan.optional_impacts[0].consumer, "app");
        assert_eq!(
            plan.optional_impacts[0].removed_providers,
            ["optional-a", "optional-b"]
        );
        assert!(
            preview(&inventory, targets(&["app", "optional-a", "optional-b"]))
                .unwrap()
                .optional_impacts
                .is_empty()
        );
    }
    #[test]
    fn held_packages_and_unsupported_policy_withhold_commands() {
        let (_temp, inventory) = fixture();
        let plan = preview(&inventory, targets(&["held"])).unwrap();
        assert_eq!(plan.held_packages, ["held"]);
        assert!(plan.dependency_check_passed && plan.command.is_none());
        let names = BTreeSet::from(["held".into(), "orphan".into()]);
        assert_eq!(
            held_packages(&["h**[e]l?".into()], &names).unwrap(),
            ["held"]
        );
        assert!(held_packages(&["[[:alpha:]]*".into()], &names).is_err());
        assert!(held_packages(&["[^x]*".into()], &names).is_err());
        assert!(held_packages(&["[".into()], &names).is_err());
    }
    #[test]
    fn stale_missing_duplicate_hostile_overlarge_and_locked_targets_fail() {
        let (temp, inventory) = fixture();
        for names in [
            vec![],
            vec!["missing"],
            vec!["orphan", "orphan"],
            vec!["x;id"],
            vec!["-flag"],
            vec!["../etc"],
            vec!["orphan"; 101],
        ] {
            assert!(preview(&inventory, targets(&names)).is_err());
        }
        assert!(
            preview(
                &inventory,
                vec![RemovalTarget {
                    name: "orphan".into(),
                    version: "2-1".into()
                }]
            )
            .is_err()
        );
        assert!(maintenance::validate(&inventory.snapshot, "changed").is_err());
        fs::write(temp.path().join("db/db.lck"), "").unwrap();
        assert!(preview(&inventory, targets(&["orphan"])).is_err());
        fs::remove_file(temp.path().join("db/db.lck")).unwrap();
        assert!(preview(&inventory, targets(&["orphan"])).is_ok());
    }
}
