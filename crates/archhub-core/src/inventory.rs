use crate::comparison::ComparisonIndex;
use crate::dependencies::DependencyIndex;
use crate::domain::{Package, Repository, Snapshot};
use crate::{Error, now};
use alpm::{Alpm, PackageReason, PackageValidation, SigLevel};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;

pub struct Inventory {
    pub snapshot: Snapshot,
    pub packages: Vec<Package>,
    pub log_file: String,
    pub(crate) dependencies: Arc<DependencyIndex>,
    pub(crate) comparisons: ComparisonIndex,
    pub(crate) installed: Vec<Package>,
    pub(crate) orphan_names: Vec<String>,
    pub(crate) cache_dirs: Vec<String>,
    pub(crate) config: pacmanconf::Config,
}

fn package(pkg: &alpm::Package, repository: &str, local: Option<&alpm::Package>) -> Package {
    let signed = local.is_some_and(|p| p.validation().contains(PackageValidation::SIGNATURE));
    Package {
        id: format!("{repository}/{}", pkg.name()),
        name: pkg.name().to_owned(),
        version: pkg.version().to_string(),
        description: pkg.desc().unwrap_or("No description provided.").to_owned(),
        repository: repository.to_owned(),
        installed_version: local.map(|p| p.version().to_string()),
        update_available: local.is_some_and(|p| pkg.version() > p.version()),
        installed_size: local.unwrap_or(pkg).isize().max(0) as f64,
        download_size: pkg.size().max(0) as f64,
        url: pkg.url().map(str::to_owned),
        licenses: pkg.licenses().iter().map(str::to_owned).collect(),
        dependencies: pkg.depends().iter().map(ToString::to_string).collect(),
        groups: pkg.groups().iter().map(str::to_owned).collect(),
        architecture: pkg.arch().unwrap_or("any").to_owned(),
        explicit: local.is_some_and(|p| p.reason() == PackageReason::Explicit),
        signature: if signed {
            "verified-at-install"
        } else {
            "unknown"
        }
        .to_owned(),
        package_base: None,
        maintainer: None,
        votes: None,
        out_of_date: false,
        last_modified: None,
    }
}

pub fn load() -> Result<Inventory, Error> {
    // Resolve pacman includes/defaults with the fixed system binary; metadata reads use libalpm.
    let config = pacmanconf::Config::with_opts(Some("/usr/bin/pacman-conf"), None, None)
        .map_err(|e| Error::Inventory(e.to_string()))?;
    load_with(config)
}

pub(crate) fn load_with(config: pacmanconf::Config) -> Result<Inventory, Error> {
    let handle = Alpm::new(config.root_dir.as_str(), config.db_path.as_str())
        .map_err(|e| Error::Inventory(e.to_string()))?;
    let mut repositories = Vec::new();
    let mut warnings = Vec::new();
    let local: HashMap<_, _> = handle
        .localdb()
        .pkgs()
        .iter()
        .map(|p| (p.name(), p))
        .collect();
    let mut packages = Vec::new();
    let mut comparisons = ComparisonIndex::default();
    let mut matched = std::collections::HashSet::new();
    let mut digest = Sha256::new();
    digest.update(format!("{config:?}"));
    for repo in &config.repos {
        digest.update(&repo.name);
        digest.update(serde_json::to_vec(&repo.sig_level)?);
        let db = handle
            .register_syncdb(repo.name.as_str(), SigLevel::USE_DEFAULT)
            .map_err(|e| Error::Inventory(format!("{}: {e}", repo.name)))?;
        let path = format!(
            "{}/sync/{}.db",
            config.db_path.trim_end_matches('/'),
            repo.name
        );
        let updated_at = fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|t| t.as_secs_f64());
        if updated_at.is_none() {
            warnings.push(format!(
                "{} database is unavailable. Refresh with your system updater.",
                repo.name
            ));
        }
        let db_packages = db.pkgs();
        for pkg in db_packages.iter() {
            // Configured repository order determines the preferred candidate, as in pacman.
            if matched.insert(pkg.name().to_owned()) {
                if let Some(installed) = local.get(pkg.name()) {
                    comparisons.capture(installed, pkg, &repo.name);
                }
                packages.push(package(pkg, &repo.name, local.get(pkg.name()).copied()));
            }
            digest.update(format!("{}/{}={}\n", repo.name, pkg.name(), pkg.version()));
        }
        repositories.push(Repository {
            name: repo.name.clone(),
            package_count: db_packages.len(),
            updated_at,
            signature_policy: if repo.sig_level.is_empty() {
                config.sig_level.clone()
            } else {
                repo.sig_level.clone()
            },
        });
    }
    let mut local_sorted: Vec<_> = local.values().copied().collect();
    local_sorted.sort_by_key(|p| p.name());
    for pkg in &local_sorted {
        digest.update(format!("local/{}={}\n", pkg.name(), pkg.version()));
        if !matched.contains(pkg.name()) {
            packages.push(package(pkg, "local", Some(pkg)));
        }
    }
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    let origins: HashMap<_, _> = packages
        .iter()
        .map(|p| (p.name.as_str(), p.repository.as_str()))
        .collect();
    let installed = local_sorted
        .iter()
        .map(|pkg| {
            package(
                pkg,
                origins.get(pkg.name()).copied().unwrap_or("local"),
                Some(pkg),
            )
        })
        .collect();
    let dependencies = Arc::new(DependencyIndex::from_alpm(
        handle.localdb().pkgs(),
        &packages,
    )?);
    // Reuse validated provider matching instead of scanning every consumer again.
    let orphan_names = dependencies.orphan_names();
    digest.update(&dependencies.metadata_digest);
    digest.update(comparisons.digest()?);
    let snapshot = Snapshot {
        captured_at: now(),
        fingerprint: format!("{:x}", digest.finalize()),
        hostname: fs::read_to_string("/etc/hostname")
            .unwrap_or_else(|_| "Arch Linux".to_owned())
            .trim()
            .to_owned(),
        installed_count: local.len(),
        explicit_count: local
            .values()
            .filter(|p| p.reason() == PackageReason::Explicit)
            .count(),
        foreign_count: packages.iter().filter(|p| p.repository == "local").count(),
        update_count: packages.iter().filter(|p| p.update_available).count(),
        installed_size: local.values().map(|p| p.isize().max(0) as f64).sum(),
        repositories,
        warnings,
        locked: fs::exists(format!("{}/db.lck", config.db_path.trim_end_matches('/')))
            .unwrap_or(false),
        omarchy: fs::exists("/usr/share/omarchy").unwrap_or(false),
        signature_policy: config.sig_level.clone(),
    };
    Ok(Inventory {
        snapshot,
        packages,
        log_file: config.log_file.clone(),
        dependencies,
        comparisons,
        installed,
        orphan_names,
        cache_dirs: config.cache_dir.clone(),
        config,
    })
}

pub fn rank(package: &Package, query: &str) -> u8 {
    let name = package.name.to_lowercase();
    if name == query {
        0
    } else if name.starts_with(query) {
        1
    } else if name.contains(query) {
        2
    } else {
        3
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn orphans_exclude_explicit_optional_and_virtual_consumers() {
        let fixture = tempfile::tempdir().unwrap();
        let db = fixture.path().join("db");
        let root = fixture.path().join("root");
        fs::create_dir_all(db.join("local")).unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(db.join("local/ALPM_DB_VERSION"), "9\n").unwrap();
        for (name, reason, extra) in [
            ("orphan", 1, ""),
            ("explicit", 0, ""),
            ("optional", 1, ""),
            ("provider", 1, "%PROVIDES%\nvirtual-api=2\n\n"),
            (
                "consumer",
                0,
                "%DEPENDS%\nvirtual-api>=1\n\n%OPTDEPENDS%\noptional: useful extra\n\n",
            ),
        ] {
            let dir = db.join(format!("local/{name}-1-1"));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("desc"), format!("%NAME%\n{name}\n\n%VERSION%\n1-1\n\n%ARCH%\nx86_64\n\n%REASON%\n{reason}\n\n%SIZE%\n123\n\n{extra}")).unwrap();
            fs::write(dir.join("files"), "%FILES%\n\n").unwrap();
        }
        let mut config = pacmanconf::Config::empty().unwrap();
        config.root_dir = root.to_string_lossy().into_owned();
        config.db_path = db.to_string_lossy().into_owned();
        let inventory = load_with(config).unwrap();
        assert_eq!(inventory.orphan_names, ["orphan"]);
        let report = crate::maintenance::report(&inventory);
        assert_eq!(report.orphans[0].installed_size, 123.0);
        assert_eq!(report.largest.len(), 5);
    }
    #[test]
    fn uses_arch_version_ordering() {
        assert!(alpm::vercmp("1:1.0-1", "9.0-1").is_gt());
        assert!(alpm::vercmp("2.0-10", "2.0-9").is_gt());
    }
}
