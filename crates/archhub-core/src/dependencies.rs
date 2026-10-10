use crate::{Error, domain::*, valid_name};
use alpm::{AlpmList, DepMod, DepModVer, PackageReason, PackageValidation};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

const NODE_LIMIT: usize = 1000;
const DEPTH_LIMIT: usize = 12;
const GAP_LIMIT: usize = 5000;

#[derive(Default)]
pub(crate) struct DependencyIndex {
    nodes: BTreeMap<String, DependencyPackage>,
    required: BTreeMap<String, Vec<DependencyRequirement>>,
    optional: BTreeMap<String, Vec<DependencyRequirement>>,
    forward: BTreeMap<String, Vec<Edge>>,
    reverse: BTreeMap<String, Vec<Edge>>,
    pub metadata_digest: String,
}

#[derive(Clone)]
struct Edge {
    target: String,
    spec: String,
    alternatives: bool,
}

fn version_matches(constraint: DepModVer<'_>, actual: Option<&alpm::Ver>) -> bool {
    use DepModVer::*;
    match constraint {
        Any => true,
        Eq(expected) => actual.is_some_and(|v| v == expected),
        Ge(expected) => actual.is_some_and(|v| v >= expected),
        Le(expected) => actual.is_some_and(|v| v <= expected),
        Gt(expected) => actual.is_some_and(|v| v > expected),
        Lt(expected) => actual.is_some_and(|v| v < expected),
    }
}

impl DependencyIndex {
    pub fn removal_optional_impacts(
        &self,
        removed: &BTreeSet<String>,
    ) -> Vec<RemovalOptionalImpact> {
        self.optional
            .iter()
            .filter(|(consumer, _)| !removed.contains(*consumer))
            .flat_map(|(consumer, requirements)| {
                requirements.iter().filter_map(|requirement| {
                    if requirement.providers.is_empty()
                        || requirement
                            .providers
                            .iter()
                            .any(|p| !removed.contains(&p.name))
                    {
                        return None;
                    }
                    Some(RemovalOptionalImpact {
                        consumer: consumer.clone(),
                        dependency: requirement.spec.clone(),
                        description: requirement.description.clone(),
                        removed_providers: requirement
                            .providers
                            .iter()
                            .map(|p| p.name.clone())
                            .collect(),
                    })
                })
            })
            .collect()
    }

    pub fn orphan_names(&self) -> Vec<String> {
        let optional_consumers: BTreeSet<_> = self
            .optional
            .values()
            .flatten()
            .flat_map(|requirement| &requirement.providers)
            .map(|provider| provider.name.as_str())
            .collect();
        self.nodes
            .values()
            .filter(|package| {
                !package.explicit
                    && self.reverse.get(&package.name).is_none_or(Vec::is_empty)
                    && !optional_consumers.contains(package.name.as_str())
            })
            .map(|package| package.name.clone())
            .collect()
    }

    pub fn from_alpm(
        local: AlpmList<'_, &alpm::Package>,
        candidates: &[Package],
    ) -> Result<Self, Error> {
        let mut result = Self::default();
        let sources: HashMap<_, _> = candidates
            .iter()
            .map(|p| (p.name.as_str(), p.repository.as_str()))
            .collect();
        let mut providers = BTreeMap::<String, BTreeMap<String, &alpm::Package>>::new();
        let mut metadata = Vec::new();
        let mut sorted: Vec<_> = local.iter().collect();
        sorted.sort_by_key(|p| p.name());
        for pkg in &sorted {
            result.nodes.insert(
                pkg.name().into(),
                DependencyPackage {
                    name: pkg.name().into(),
                    version: pkg.version().to_string(),
                    repository: sources.get(pkg.name()).unwrap_or(&"local").to_string(),
                    explicit: pkg.reason() == PackageReason::Explicit,
                    signature: if pkg.validation().contains(PackageValidation::SIGNATURE) {
                        "verified-at-install"
                    } else {
                        "unknown"
                    }
                    .into(),
                },
            );
            providers
                .entry(pkg.name().into())
                .or_default()
                .insert(pkg.name().into(), pkg);
            for provision in pkg.provides() {
                providers
                    .entry(provision.name().into())
                    .or_default()
                    .insert(pkg.name().into(), pkg);
            }
            metadata.push((
                pkg.name(),
                pkg.version().as_str(),
                pkg.reason() == PackageReason::Explicit,
                pkg.validation().bits(),
                pkg.depends()
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
                pkg.optdepends()
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
                pkg.provides()
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
            ));
        }
        result.metadata_digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&metadata)?));
        let resolve = |dep: &alpm::Dep| -> Result<DependencyRequirement, Error> {
            // Optional descriptions are not part of the dependency expression passed to libalpm.
            let printed = dep.to_string();
            let spec = if dep.desc().is_some() {
                printed
                    .split_once(": ")
                    .map_or(printed.as_str(), |(spec, _)| spec)
            } else {
                &printed
            };
            let matches: Vec<DependencyPackage> = providers
                .get(dep.name())
                .into_iter()
                .flat_map(|map| map.values())
                .filter_map(|pkg| {
                    let literal = pkg.name() == dep.name()
                        && version_matches(dep.depmodver(), Some(pkg.version()));
                    let provision = pkg.provides().iter().any(|provided| {
                        provided.name() == dep.name()
                            && (dep.depmod() == DepMod::Any || provided.depmod() == DepMod::Eq)
                            && version_matches(dep.depmodver(), provided.version())
                    });
                    (literal || provision)
                        .then(|| result.nodes.get(pkg.name()).cloned())
                        .flatten()
                })
                .collect();
            // The binding's singleton-list borrow is Pkg rather than Package. Use
            // parsed constraints + libalpm version comparison, and validate its canonical match.
            let canonical = local.find_satisfier(spec).map(|p| p.name());
            if match canonical {
                Some(name) => !matches.iter().any(|p| p.name == name),
                None => !matches.is_empty(),
            } {
                return Err(Error::Inventory(
                    "Dependency provider matching disagrees with libalpm.".into(),
                ));
            }
            Ok(DependencyRequirement {
                spec: spec.into(),
                description: dep.desc().map(str::to_owned),
                providers: matches,
            })
        };
        for pkg in &sorted {
            let mut required: Vec<_> = pkg
                .depends()
                .iter()
                .map(resolve)
                .collect::<Result<_, _>>()?;
            let mut optional: Vec<_> = pkg
                .optdepends()
                .iter()
                .map(resolve)
                .collect::<Result<_, _>>()?;
            for list in [&mut required, &mut optional] {
                list.sort_by(|a, b| a.spec.cmp(&b.spec).then(a.description.cmp(&b.description)));
                list.dedup_by(|a, b| a.spec == b.spec && a.description == b.description);
            }
            result.required.insert(pkg.name().into(), required);
            result.optional.insert(pkg.name().into(), optional);
        }
        result.build_edges();
        Ok(result)
    }

    fn build_edges(&mut self) {
        self.forward.clear();
        self.reverse.clear();
        for (consumer, requirements) in &self.required {
            for requirement in requirements {
                for provider in &requirement.providers {
                    let alternatives = requirement.providers.len() > 1;
                    self.forward
                        .entry(consumer.clone())
                        .or_default()
                        .push(Edge {
                            target: provider.name.clone(),
                            spec: requirement.spec.clone(),
                            alternatives,
                        });
                    self.reverse
                        .entry(provider.name.clone())
                        .or_default()
                        .push(Edge {
                            target: consumer.clone(),
                            spec: requirement.spec.clone(),
                            alternatives,
                        });
                }
            }
        }
        for edges in self.forward.values_mut().chain(self.reverse.values_mut()) {
            edges.sort_by(|a, b| a.target.cmp(&b.target).then(a.spec.cmp(&b.spec)));
        }
    }

    fn walk(
        &self,
        root: &str,
        reverse: bool,
        node_limit: usize,
        depth_limit: usize,
    ) -> (Vec<DependencyPath>, bool) {
        let edges = if reverse {
            &self.reverse
        } else {
            &self.forward
        };
        let mut seen = BTreeSet::from([root.to_owned()]);
        let mut queue = VecDeque::from([(
            root.to_owned(),
            vec![root.to_owned()],
            Vec::<String>::new(),
            false,
        )]);
        let mut paths = Vec::new();
        let mut complete = true;
        while let Some((name, path, requirements, alternatives)) = queue.pop_front() {
            for edge in edges.get(&name).into_iter().flatten() {
                if seen.contains(&edge.target) {
                    continue;
                }
                if paths.len() >= node_limit || requirements.len() >= depth_limit {
                    complete = false;
                    continue;
                }
                let Some(package) = self.nodes.get(&edge.target) else {
                    complete = false;
                    continue;
                };
                seen.insert(edge.target.clone());
                let mut next_path = path.clone();
                next_path.push(edge.target.clone());
                let mut next_requirements = requirements.clone();
                next_requirements.push(edge.spec.clone());
                let alternatives = alternatives || edge.alternatives;
                paths.push(DependencyPath {
                    package: package.clone(),
                    path: next_path.clone(),
                    requirements: next_requirements.clone(),
                    alternative_providers: alternatives,
                });
                queue.push_back((
                    edge.target.clone(),
                    next_path,
                    next_requirements,
                    alternatives,
                ));
            }
        }
        (paths, complete)
    }

    pub fn report(
        &self,
        name: &str,
        version: &str,
        snapshot: &Snapshot,
    ) -> Result<DependencyReport, Error> {
        if !valid_name(name) || version.is_empty() || version.len() > 200 {
            return Err(Error::Invalid("Invalid installed package identity.".into()));
        }
        if snapshot.locked {
            return Err(Error::Invalid("The captured package database is locked. Refresh the inventory when the operation finishes.".into()));
        }
        let root = self.nodes.get(name).ok_or_else(|| {
            Error::Invalid(
                "Package is not installed in this snapshot. Refresh the inventory.".into(),
            )
        })?;
        if root.version != version {
            return Err(Error::Invalid("The installed version changed. Refresh the inventory before inspecting dependencies.".into()));
        }
        let (requires, mut requires_complete) = self.walk(name, false, NODE_LIMIT, DEPTH_LIMIT);
        let (required_by, required_by_complete) = self.walk(name, true, NODE_LIMIT, DEPTH_LIMIT);
        let mut unresolved = Vec::new();
        for package in std::iter::once(name).chain(requires.iter().map(|p| p.package.name.as_str()))
        {
            for requirement in self
                .required
                .get(package)
                .into_iter()
                .flatten()
                .filter(|r| r.providers.is_empty())
            {
                if unresolved.len() >= GAP_LIMIT {
                    requires_complete = false;
                    break;
                }
                unresolved.push(DependencyGap {
                    package: package.into(),
                    requirement: requirement.spec.clone(),
                });
            }
        }
        if !unresolved.is_empty() {
            requires_complete = false;
        }
        Ok(DependencyReport {
            root: root.clone(), captured_at: snapshot.captured_at, fingerprint: snapshot.fingerprint.clone(),
            direct: self.required.get(name).cloned().unwrap_or_default(), optional: self.optional.get(name).cloned().unwrap_or_default(),
            requires, required_by, unresolved, requires_complete, required_by_complete,
            limitations: vec![
                "Installed runtime declarations from a captured local database snapshot. Capture does not lock or freeze the package database; short-lived operations can go unobserved. Refresh the inventory to inspect newer metadata.".into(),
                "All matching installed providers are included. Edges describe possible satisfaction, not which library a program loads or which provider a transaction would select.".into(),
                "One shortest representative path per package, up to 1000 packages and 12 edges per direction, and 5000 missing declarations. Cycles are deduplicated. Additional paths are not enumerated.".into(),
                "Required by shows potential dependency relationships, not a removal-safety or vulnerability-reachability verdict. Alternative providers may remain available.".into(),
                "Optional declarations are shown separately and are not expanded. Build dependencies, bundled libraries, language dependencies and runtime symbol reachability are outside this view.".into(),
                "Repository labels identify current package-name availability, not authenticated installation provenance. Advisory matches need affected-range review; uncovered packages remain unknown.".into(),
            ],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alpm::Alpm;
    use std::fs;
    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    impl Fixture {
        fn new() -> Self {
            static NEXT_FIXTURE: std::sync::atomic::AtomicU64 =
                std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "archhub-dependencies-{}-{}-{}",
                std::process::id(),
                crate::now().to_bits(),
                NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            fs::create_dir_all(path.join("local")).unwrap();
            fs::write(path.join("local/ALPM_DB_VERSION"), "9\n").unwrap();
            Self(path)
        }
        fn package(
            &self,
            name: &str,
            version: &str,
            depends: &[&str],
            optional: &[&str],
            provides: &[&str],
        ) {
            let dir = self.0.join("local").join(format!("{name}-{version}"));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("desc"), format!("%NAME%\n{name}\n\n%VERSION%\n{version}\n\n%ARCH%\nx86_64\n\n%REASON%\n0\n\n%DEPENDS%\n{}\n\n%OPTDEPENDS%\n{}\n\n%PROVIDES%\n{}\n\n", depends.join("\n"), optional.join("\n"), provides.join("\n"))).unwrap();
            fs::write(dir.join("files"), "%FILES%\n\n").unwrap();
        }
        fn index(&self) -> DependencyIndex {
            let handle = Alpm::new("/", self.0.to_str().unwrap()).unwrap();
            DependencyIndex::from_alpm(handle.localdb().pkgs(), &[]).unwrap()
        }
    }
    fn snapshot() -> Snapshot {
        serde_json::from_value(serde_json::json!({"capturedAt":1,"fingerprint":"fixture","hostname":"fixture","installedCount":0,"explicitCount":0,"foreignCount":0,"updateCount":0,"installedSize":0,"repositories":[],"warnings":[],"locked":false,"omarchy":false,"signaturePolicy":[]})).unwrap()
    }

    #[test]
    fn real_libalpm_metadata_handles_versioned_virtual_and_optional_providers() {
        let db = Fixture::new();
        db.package(
            "root",
            "1-1",
            &[
                "foo>=2",
                "virtual>=2",
                "libfoo.so=4-64",
                "missing>=3",
                "epoch>=1:2.0",
            ],
            &["addon: enables a feature", "epoch>=1:2.0: epoch feature"],
            &[],
        );
        db.package("foo", "2-1", &[], &[], &[]);
        db.package("provider-a", "1-1", &[], &[], &["virtual=2"]);
        db.package("provider-b", "9-1", &[], &[], &["virtual=3"]);
        db.package("unversioned", "99-1", &[], &[], &["virtual"]);
        db.package("old-provider", "99-1", &[], &[], &["virtual=1"]);
        db.package("invalid-provider", "99-1", &[], &[], &["virtual>=3"]);
        db.package("library", "3-1", &[], &[], &["libfoo.so=4-64"]);
        db.package("addon", "1-1", &["optional-child"], &[], &[]);
        db.package("optional-child", "1-1", &[], &[], &[]);
        db.package("epoch", "1:2.0-1", &[], &[], &[]);
        let index = db.index();
        let report = index.report("root", "1-1", &snapshot()).unwrap();
        let virtual_dep = report
            .direct
            .iter()
            .find(|r| r.spec == "virtual>=2")
            .unwrap();
        assert_eq!(
            virtual_dep
                .providers
                .iter()
                .map(|p| p.name.as_str())
                .collect::<Vec<_>>(),
            vec!["provider-a", "provider-b"]
        );
        assert!(
            report
                .requires
                .iter()
                .find(|p| p.package.name == "provider-a")
                .unwrap()
                .alternative_providers
        );
        assert!(report.requires.iter().any(|p| p.package.name == "library"));
        assert!(
            !report
                .requires
                .iter()
                .any(|p| p.package.name == "addon" || p.package.name == "optional-child")
        );
        assert_eq!(
            report.optional[0].description.as_deref(),
            Some("enables a feature")
        );
        assert_eq!(report.optional[1].spec, "epoch>=1:2.0");
        assert_eq!(
            report.optional[1].description.as_deref(),
            Some("epoch feature")
        );
        assert_eq!(report.optional[1].providers[0].name, "epoch");
        assert_eq!(report.unresolved.len(), 1);
        assert_eq!(report.unresolved[0].requirement, "missing>=3");
        assert!(!report.requires_complete);
    }

    #[test]
    fn cycles_diamonds_and_reverse_paths_are_deterministic_and_unique() {
        let db = Fixture::new();
        db.package("root", "1-1", &["left", "right"], &[], &[]);
        db.package("left", "1-1", &["shared"], &[], &[]);
        db.package("right", "1-1", &["shared"], &[], &[]);
        db.package("shared", "1-1", &["root"], &[], &[]);
        let index = db.index();
        let report = index.report("root", "1-1", &snapshot()).unwrap();
        assert_eq!(report.requires.len(), 3);
        assert_eq!(report.requires[2].path, vec!["root", "left", "shared"]);
        assert_eq!(report.requires[2].requirements, vec!["left", "shared"]);
        assert_eq!(report.required_by[0].path, vec!["root", "shared"]);
        assert!(report.requires_complete && report.required_by_complete);
        let (paths, complete) = index.walk("root", false, 2, 12);
        assert_eq!(paths.len(), 2);
        assert!(!complete);
        let (paths, complete) = index.walk("root", false, 1000, 1);
        assert_eq!(paths.len(), 2);
        assert!(!complete);
        let (_, complete) = index.walk("root", false, 3, 2);
        assert!(complete); // The cycle only points to an already visited node.
    }

    #[test]
    fn metadata_only_changes_invalidate_the_dependency_identity() {
        let db = Fixture::new();
        db.package("root", "1-1", &["first"], &[], &[]);
        db.package("first", "1-1", &[], &[], &[]);
        let first = db.index().metadata_digest;
        db.package(
            "root",
            "1-1",
            &["second"],
            &["optional: new feature"],
            &["virtual=2"],
        );
        assert_ne!(first, db.index().metadata_digest);
        assert_eq!(
            db.index()
                .report("root", "1-1", &snapshot())
                .unwrap()
                .unresolved[0]
                .requirement,
            "second"
        );
    }

    #[test]
    fn rejects_stale_uninstalled_injected_and_locked_requests() {
        let db = Fixture::new();
        db.package("root", "1-1", &[], &[], &[]);
        let index = db.index();
        for (name, version) in [
            ("root", "2"),
            ("missing", "1-1"),
            ("../etc/passwd", "1-1"),
            ("root;id", "1-1"),
            ("root", ""),
        ] {
            assert!(index.report(name, version, &snapshot()).is_err());
        }
        let mut locked = snapshot();
        locked.locked = true;
        assert!(index.report("root", "1-1", &locked).is_err());
        let empty = index.report("root", "1-1", &snapshot()).unwrap();
        assert!(
            empty.requires.is_empty() && empty.required_by.is_empty() && empty.optional.is_empty()
        );
        assert!(empty.requires_complete && empty.required_by_complete);
    }
    #[test]
    fn real_traversal_bounds_report_incomplete_without_dropping_the_limit_marker() {
        let mut index = DependencyIndex::default();
        let node = |name: String| DependencyPackage {
            name,
            version: "1-1".into(),
            repository: "local".into(),
            explicit: false,
            signature: "unknown".into(),
        };
        index.nodes.insert("root".into(), node("root".into()));
        let mut requirements = Vec::new();
        for number in 0..1201 {
            let name = format!("leaf-{number:04}");
            let pkg = node(name.clone());
            requirements.push(DependencyRequirement {
                spec: name.clone(),
                description: None,
                providers: vec![pkg.clone()],
            });
            index.nodes.insert(name, pkg);
        }
        index.required.insert("root".into(), requirements);
        index.build_edges();
        let report = index.report("root", "1-1", &snapshot()).unwrap();
        assert_eq!(report.requires.len(), NODE_LIMIT);
        assert!(!report.requires_complete);
        assert_eq!(report.requires.last().unwrap().package.name, "leaf-0999");
        let mut chain = DependencyIndex::default();
        for number in 0..=14 {
            let name = format!("chain-{number:02}");
            chain.nodes.insert(name.clone(), node(name.clone()));
            if number < 14 {
                let next = format!("chain-{:02}", number + 1);
                chain.required.insert(
                    name,
                    vec![DependencyRequirement {
                        spec: next.clone(),
                        description: None,
                        providers: vec![node(next)],
                    }],
                );
            }
        }
        chain.build_edges();
        let report = chain.report("chain-00", "1-1", &snapshot()).unwrap();
        assert_eq!(report.requires.len(), DEPTH_LIMIT);
        assert!(!report.requires_complete);
        assert_eq!(
            report.requires.last().unwrap().requirements.len(),
            DEPTH_LIMIT
        );
    }
}
