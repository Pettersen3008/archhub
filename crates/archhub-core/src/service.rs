use crate::{
    Error,
    domain::*,
    evidence::{self, ReviewStore},
    foreign, integrity,
    inventory::{self, Inventory},
    maintenance, network, now, plan_security, removal, update_preparation,
};
use reqwest::Client;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    sync::Arc,
};
use tokio::sync::{Mutex, RwLock, Semaphore};

#[derive(Clone)]
pub struct Service {
    inventory: Arc<RwLock<Inventory>>,
    refresh_lock: Arc<Mutex<()>>,
    audit_lock: Arc<Mutex<Option<Audit>>>,
    client: Client,
    recipe_state: Arc<Mutex<RecipeState>>,
    recipe_slots: Arc<Semaphore>,
    integrity_slots: Arc<Semaphore>,
    repository_update_slots: Arc<Semaphore>,
    foreign_update_slots: Arc<Semaphore>,
    removal_slots: Arc<Semaphore>,
}

struct RecipeState {
    scans: HashMap<String, RecipeScan>,
    store: ReviewStore,
}

impl Service {
    pub async fn new() -> Result<Self, Error> {
        let inventory = tokio::task::spawn_blocking(inventory::load).await??;
        Ok(Self {
            inventory: Arc::new(RwLock::new(inventory)),
            refresh_lock: Arc::new(Mutex::new(())),
            audit_lock: Arc::new(Mutex::new(None)),
            recipe_state: Arc::new(Mutex::new(RecipeState {
                scans: HashMap::new(),
                store: ReviewStore::discover()?,
            })),
            recipe_slots: Arc::new(Semaphore::new(3)),
            integrity_slots: Arc::new(Semaphore::new(1)),
            repository_update_slots: Arc::new(Semaphore::new(1)),
            foreign_update_slots: Arc::new(Semaphore::new(1)),
            removal_slots: Arc::new(Semaphore::new(1)),
            client: Client::builder()
                .user_agent("ArchHub/0.1 (read-only package security dashboard)")
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() < 5
                        && attempt.url().scheme() == "https"
                        && matches!(
                            attempt.url().host_str(),
                            Some("aur.archlinux.org" | "security.archlinux.org")
                        )
                    {
                        attempt.follow()
                    } else {
                        attempt.error("Redirect is outside the permitted metadata hosts")
                    }
                }))
                .timeout(std::time::Duration::from_secs(20))
                .build()?,
        })
    }

    async fn refresh(&self, force: bool) -> Result<(), Error> {
        let _lock = self.refresh_lock.lock().await;
        if !force && now() - self.inventory.read().await.snapshot.captured_at < 60.0 {
            return Ok(());
        }
        let inventory = tokio::task::spawn_blocking(inventory::load).await??;
        *self.inventory.write().await = inventory;
        Ok(())
    }

    async fn audit(
        &self,
        snapshot: &Snapshot,
        packages: &[Package],
        refresh: bool,
    ) -> Result<Audit, Error> {
        let mut cache = self.audit_lock.lock().await;
        if !refresh
            && let Some(audit) = cache.as_ref()
            && now() - audit.scanned_at < 300.0
            && audit.fingerprint == snapshot.fingerprint
        {
            return Ok(audit.clone());
        }
        // A failed attempt must not leave prior success reusable by another client.
        *cache = None;
        let result = network::audit(&self.client, snapshot, packages).await?;
        *cache = Some(result.clone());
        Ok(result)
    }

    pub async fn execute(&self, request: Request) -> Result<Value, Error> {
        if !matches!(
            request,
            Request::Recipe { .. }
                | Request::RecipeReviews
                | Request::RecipeReview { .. }
                | Request::RecordRecipeReview { .. }
                | Request::RemoveRecipeReview { .. }
                | Request::History
        ) {
            self.refresh(false).await?;
        }
        match request {
            Request::RemovalPlan {
                targets,
                fingerprint,
            } => {
                let permit = self
                    .removal_slots
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| {
                        Error::Invalid(
                            "A removal review is already running. Wait for it to finish.".into(),
                        )
                    })?;
                // The worker retains its permit even if the caller disconnects.
                let report = tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    removal::capture(targets, &fingerprint)
                })
                .await??;
                self.refresh(true).await?;
                maintenance::validate(&self.inventory.read().await.snapshot, &report.fingerprint)?;
                Ok(serde_json::to_value(report)?)
            }
            Request::Maintenance => {
                self.refresh(true).await?;
                let (mut report, dirs) = {
                    let inventory = self.inventory.read().await;
                    (
                        maintenance::report(&inventory),
                        inventory.cache_dirs.clone(),
                    )
                };
                report.caches = tokio::task::spawn_blocking(move || {
                    let mut paths = std::collections::BTreeSet::new();
                    dirs.into_iter()
                        .filter(|path| paths.insert(path.clone()))
                        .map(|path| maintenance::cache_usage(&path))
                        .collect()
                })
                .await?;
                Ok(serde_json::to_value(report)?)
            }
            Request::UpdatePreparation { fingerprint } => {
                let _permit = self.repository_update_slots.try_acquire().map_err(|_| {
                    Error::Invalid(
                        "An online repository check is already running. Wait for it to finish."
                            .into(),
                    )
                })?;
                self.refresh(true).await?;
                maintenance::validate(&self.inventory.read().await.snapshot, &fingerprint)?;
                let (repositories, news) = tokio::join!(
                    maintenance::repository_updates(fingerprint.clone()),
                    update_preparation::news()
                );
                self.refresh(true).await?;
                let inventory = self.inventory.read().await;
                maintenance::validate(&inventory.snapshot, &fingerprint)?;
                if let Ok(report) = &repositories
                    && report.packages.iter().any(|change| {
                        !inventory.installed.iter().any(|p| {
                            p.name == change.name
                                && p.installed_version.as_deref() == Some(&change.installed_version)
                        })
                    })
                {
                    return Err(Error::Invalid("Installed versions no longer match the online check. Refresh inventory and check again.".into()));
                }
                Ok(serde_json::to_value(update_preparation::capture(
                    &inventory.snapshot,
                    repositories,
                    news,
                ))?)
            }
            Request::RepositoryUpdates { fingerprint } => {
                let _permit = self.repository_update_slots.try_acquire().map_err(|_| {
                    Error::Invalid(
                        "An online repository check is already running. Wait for it to finish."
                            .into(),
                    )
                })?;
                self.refresh(true).await?;
                maintenance::validate(&self.inventory.read().await.snapshot, &fingerprint)?;
                let report = maintenance::repository_updates(fingerprint.clone()).await?;
                self.refresh(true).await?;
                let inventory = self.inventory.read().await;
                maintenance::validate(&inventory.snapshot, &fingerprint)?;
                if report.packages.iter().any(|change| {
                    !inventory.installed.iter().any(|p| {
                        p.name == change.name
                            && p.installed_version.as_deref() == Some(&change.installed_version)
                    })
                }) {
                    return Err(Error::Invalid("Installed versions no longer match the online check. Refresh inventory and check again.".into()));
                }
                Ok(serde_json::to_value(report)?)
            }
            Request::ForeignUpdates { fingerprint } => {
                let _permit = self.foreign_update_slots.try_acquire().map_err(|_| {
                    Error::Invalid(
                        "An AUR version check is already running. Wait for it to finish.".into(),
                    )
                })?;
                self.refresh(true).await?;
                let packages = {
                    let inventory = self.inventory.read().await;
                    maintenance::validate(&inventory.snapshot, &fingerprint)?;
                    inventory
                        .installed
                        .iter()
                        .filter(|p| p.repository == "local")
                        .filter_map(|p| {
                            p.installed_version
                                .as_ref()
                                .map(|v| (p.name.clone(), v.clone()))
                        })
                        .collect::<Vec<_>>()
                };
                let packages = tokio::time::timeout(std::time::Duration::from_secs(45), network::foreign_updates(&self.client, &packages)).await.map_err(|_| Error::Invalid("AUR version check exceeded its 45-second deadline. Availability is unknown.".into()))??;
                self.refresh(true).await?;
                maintenance::validate(&self.inventory.read().await.snapshot, &fingerprint)?;
                Ok(serde_json::to_value(ForeignUpdates {
                    checked_at: now(), fingerprint, packages,
                    limitations: vec![
                        "The explicit check sends installed foreign package names to AUR. An exact name/version match does not prove installation origin or artifact safety.".into(),
                        "Missing matches may be local/private builds, removed repository packages or deleted/renamed recipes. They are not failed requests or verified up-to-date packages.".into(),
                        "VCS recipe versions can lag upstream commits. Version equality does not establish that a development package is current.".into(),
                        "No recipe, source archive or installed package was executed or changed. Review matching recipes before using your chosen updater.".into(),
                    ],
                })?)
            }
            Request::ForeignRecipe {
                name,
                version,
                fingerprint,
            } => {
                let _permit = self.recipe_slots.try_acquire().map_err(|_| {
                    Error::Invalid(
                        "Recipe inspection is busy. Retry when a current lookup or scan finishes."
                            .into(),
                    )
                })?;
                self.refresh(true).await?;
                {
                    let inventory = self.inventory.read().await;
                    foreign::validate(
                        &inventory.snapshot,
                        &inventory.packages,
                        &name,
                        &version,
                        &fingerprint,
                    )?;
                }
                let aur = network::aur_info(&self.client, &name, &version).await?;
                self.refresh(true).await?;
                let inventory = self.inventory.read().await;
                foreign::validate(
                    &inventory.snapshot,
                    &inventory.packages,
                    &name,
                    &version,
                    &fingerprint,
                )?;
                Ok(serde_json::to_value(ForeignRecipeLookup {
                    name, installed_version: version, fingerprint, checked_at: now(), aur,
                    limitations: vec![
                        "An exact AUR name or version match does not prove this installed package was built from that recipe. Installation origin and installed bytes remain unverified.".into(),
                        "No match can mean a local/private build, a removed repository, or an AUR recipe that was deleted or renamed. It does not establish safety.".into(),
                        "RPC metadata is not pinned to a commit and can change. A later static scan captures a separate pinned recipe snapshot; neither verifies this installed artifact.".into(),
                        "Only the explicitly selected package name is sent to AUR. No package state is changed and no recipe is executed.".into(),
                    ],
                })?)
            }
            Request::Comparison { name, fingerprint } => {
                self.refresh(true).await?;
                let inventory = self.inventory.read().await;
                Ok(serde_json::to_value(inventory.comparisons.report(
                    &name,
                    &fingerprint,
                    &inventory.snapshot,
                )?)?)
            }
            Request::Dependencies { name, version } => {
                let (index, snapshot) = {
                    let inventory = self.inventory.read().await;
                    (inventory.dependencies.clone(), inventory.snapshot.clone())
                };
                Ok(serde_json::to_value(
                    tokio::task::spawn_blocking(move || index.report(&name, &version, &snapshot))
                        .await??,
                )?)
            }
            Request::Integrity { name, version } => {
                let _permit = self.integrity_slots.try_acquire().map_err(|_| {
                    Error::Invalid(
                        "A file check is already running. Retry when it finishes.".into(),
                    )
                })?;
                Ok(serde_json::to_value(
                    integrity::check(name, version).await?,
                )?)
            }
            Request::Snapshot { refresh } => {
                if refresh {
                    self.refresh(true).await?;
                }
                Ok(serde_json::to_value(&self.inventory.read().await.snapshot)?)
            }
            Request::Packages {
                query,
                scope,
                repository,
                offset,
                limit,
                sort,
            } => {
                if query.len() > 200
                    || !["all", "installed", "explicit", "updates", "foreign"]
                        .contains(&scope.as_str())
                    || !["name", "size", "repository"].contains(&sort.as_str())
                {
                    return Err(Error::Invalid("Invalid package filter.".into()));
                }
                let limit = limit.clamp(1, 200);
                let q = query.trim().to_lowercase();
                let index = self.inventory.read().await;
                let mut results: Vec<_> = index
                    .packages
                    .iter()
                    .filter(|p| {
                        (match scope.as_str() {
                            "installed" => p.installed_version.is_some(),
                            "explicit" => p.installed_version.is_some() && p.explicit,
                            "updates" => p.update_available,
                            "foreign" => p.repository == "local",
                            _ => true,
                        }) && (repository == "all" || repository == p.repository)
                            && (q.is_empty()
                                || p.name.to_lowercase().contains(&q)
                                || p.description.to_lowercase().contains(&q))
                    })
                    .collect();
                results.sort_by(|a, b| {
                    let ordering = match sort.as_str() {
                        "size" => b.installed_size.total_cmp(&a.installed_size),
                        "repository" => a.repository.cmp(&b.repository),
                        _ => std::cmp::Ordering::Equal,
                    };
                    if q.is_empty() {
                        ordering.then(a.name.cmp(&b.name))
                    } else {
                        inventory::rank(a, &q)
                            .cmp(&inventory::rank(b, &q))
                            .then(ordering)
                            .then(a.name.cmp(&b.name))
                    }
                });
                let total = results.len();
                Ok(serde_json::to_value(PackagePage {
                    items: results
                        .into_iter()
                        .skip(offset)
                        .take(limit)
                        .cloned()
                        .collect(),
                    total,
                    offset,
                    limit,
                    captured_at: index.snapshot.captured_at,
                })?)
            }
            Request::Package { id } => {
                let index = self.inventory.read().await;
                let pkg = index.package_by_id(&id).ok_or_else(|| {
                    Error::Invalid(
                        "Package is no longer in the index. Refresh and try again.".into(),
                    )
                })?;
                Ok(serde_json::to_value(pkg)?)
            }
            Request::PackagesByIds { ids } => {
                // 32 identities of at most 399 bytes fit inside the HTTP body
                // limit. Matching is local: these strings never become paths.
                if ids.len() > 32
                    || ids.iter().any(|id| id.is_empty() || id.len() >= 400)
                    || serde_json::to_vec(&ids)?.len() > 15_000
                {
                    return Err(Error::Invalid(
                        "Request up to 32 bounded package identities.".into(),
                    ));
                }
                let index = self.inventory.read().await;
                let mut items = Vec::new();
                let mut missing_ids = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for id in ids {
                    if !seen.insert(id.clone()) {
                        continue;
                    }
                    if let Some(package) = index.package_by_id(&id) {
                        items.push(package.clone());
                    } else {
                        missing_ids.push(id);
                    }
                }
                Ok(serde_json::to_value(PackageBatch {
                    items,
                    missing_ids,
                    fingerprint: index.snapshot.fingerprint.clone(),
                    captured_at: index.snapshot.captured_at,
                })?)
            }
            Request::AurSearch { query } => {
                let installed: HashMap<_, _> = self
                    .inventory
                    .read()
                    .await
                    .packages
                    .iter()
                    .filter_map(|p| {
                        p.installed_version
                            .as_ref()
                            .map(|v| (p.name.clone(), v.clone()))
                    })
                    .collect();
                Ok(serde_json::to_value(
                    network::aur_search(&self.client, &query, &installed).await?,
                )?)
            }
            Request::Audit { refresh } => {
                let (snapshot, packages) = {
                    let index = self.inventory.read().await;
                    (index.snapshot.clone(), index.packages.clone())
                };
                Ok(serde_json::to_value(
                    self.audit(&snapshot, &packages, refresh).await?,
                )?)
            }
            Request::Recipe { base } => {
                let _permit = self.recipe_slots.try_acquire().map_err(|_| {
                    Error::Invalid(
                        "Three recipe scans are already running. Retry when one finishes.".into(),
                    )
                })?;
                let scan = tokio::time::timeout(std::time::Duration::from_secs(45), network::recipe(&self.client, &base)).await
                    .map_err(|_| Error::Invalid("Recipe scan exceeded its 45-second deadline. Retry when the source is available.".into()))??;
                let mut state = self.recipe_state.lock().await;
                state.scans.insert(base.clone(), scan.clone());
                while state.scans.len() > 24
                    || state
                        .scans
                        .values()
                        .flat_map(|scan| &scan.files)
                        .map(|file| file.content.len())
                        .sum::<usize>()
                        > 16_000_000
                {
                    let oldest = state
                        .scans
                        .iter()
                        .filter(|(key, _)| *key != &base)
                        .min_by(|(_, a), (_, b)| a.scanned_at.total_cmp(&b.scanned_at))
                        .map(|(key, _)| key.clone());
                    if let Some(key) = oldest {
                        state.scans.remove(&key);
                    } else {
                        break;
                    }
                }
                let store = state.store.clone();
                let result =
                    tokio::task::spawn_blocking(move || -> Result<RecipeInspection, Error> {
                        let review = store.load(&base)?;
                        Ok(evidence::inspect(scan, review))
                    })
                    .await??;
                Ok(serde_json::to_value(result)?)
            }
            Request::RecipeReviews => {
                let state = self.recipe_state.lock().await;
                let store = state.store.clone();
                Ok(serde_json::to_value(
                    tokio::task::spawn_blocking(move || store.list()).await??,
                )?)
            }
            Request::RecipeReview { base } => {
                let state = self.recipe_state.lock().await;
                let store = state.store.clone();
                Ok(serde_json::to_value(
                    tokio::task::spawn_blocking(move || store.load(&base)).await??,
                )?)
            }
            Request::RecordRecipeReview {
                static_analyzer_version,
                base,
                digest,
                commit,
                note,
            } => {
                let state = self.recipe_state.lock().await;
                let scan = state.scans.get(&base).filter(|scan| scan.digest == digest && scan.commit == commit && scan.static_analyzer_version == static_analyzer_version)
                    .ok_or_else(|| Error::Invalid("The scan or analyzer version is missing or changed. Fetch the current recipe before saving a review.".into()))?.clone();
                let review = RecipeReview {
                    scan,
                    reviewed_at: now(),
                    note: note.trim().into(),
                };
                let store = state.store.clone();
                let result =
                    tokio::task::spawn_blocking(move || -> Result<RecipeInspection, Error> {
                        store.save(&review)?;
                        Ok(evidence::inspect(review.scan.clone(), Some(review)))
                    })
                    .await??;
                Ok(serde_json::to_value(result)?)
            }
            Request::RemoveRecipeReview {
                base,
                digest,
                commit,
            } => {
                let state = self.recipe_state.lock().await;
                let store = state.store.clone();
                tokio::task::spawn_blocking(move || store.remove(&base, &digest, &commit))
                    .await??;
                Ok(Value::Null)
            }
            Request::History => {
                let path = self.inventory.read().await.log_file.clone();
                let history = tokio::task::spawn_blocking(move || read_history(&path)).await??;
                Ok(serde_json::to_value(history)?)
            }
            Request::Plan { fingerprint } => {
                self.refresh(true).await?;
                let (snapshot, inventory_packages) = {
                    let index = self.inventory.read().await;
                    validate_plan_snapshot(&index.snapshot, &fingerprint)?;
                    (index.snapshot.clone(), index.packages.clone())
                };
                let security = plan_security::capture(
                    &snapshot,
                    &inventory_packages,
                    self.audit(&snapshot, &inventory_packages, true).await,
                );
                // Network work can take time; reject intervening package/configuration changes.
                self.refresh(true).await?;
                let index = self.inventory.read().await;
                validate_plan_snapshot(&index.snapshot, &fingerprint)?;
                let packages: Vec<_> = index
                    .packages
                    .iter()
                    .filter(|p| p.update_available)
                    .cloned()
                    .collect();
                let comparisons = packages
                    .iter()
                    .take(100)
                    .map(|package| {
                        index
                            .comparisons
                            .report(&package.name, &fingerprint, &index.snapshot)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let comparisons_complete =
                    packages.len() <= 100 && comparisons.iter().all(|report| report.complete);
                let download_size = packages.iter().map(|p| p.download_size).sum();
                Ok(serde_json::to_value(UpdatePlan {
                    id: format!("plan-{}-{}", now() as u64, &fingerprint[..12]), created_at: now(), fingerprint,
                    packages, comparisons, comparisons_complete, security: Some(security), download_size, command: if index.snapshot.omarchy { "omarchy update" } else { "sudo pacman -Syu" }.into(),
                    preconditions: vec!["Back up important data and verify the recovery path.".into(),
                        "Refresh package databases using the supported full system update workflow.".into(),
                        "Review security findings, AUR recipe changes and restart requirements.".into(),
                        "Revalidate this plan if package state, recipes or policies change.".into()],
                    limitations: vec!["This is a read-only version-change inventory, not a dependency-resolved transaction or an authorization to apply changes.".into(),
                        "Versions reflect local sync databases. No remote database refresh is performed.".into(),
                        "Metadata comparisons cover at most 100 packages and 500 added or removed declarations per category. Check comparisonsComplete and individual omittedCount values; the package list remains complete.".into(),
                        "AUR and toolchain upgrades are not included. The system updater may select additional changes.".into(),
                        "Advisories describe installed versions. A candidate reaching a tracker-listed fix is version context, not a candidate audit or a security verdict. Feed publication freshness and affected-range completeness remain unknown.".into(),
                        "ArchHub does not execute updates. Export this plan and use the supported updater after review.".into()],
                })?)
            }
        }
    }
}

fn validate_plan_snapshot(snapshot: &Snapshot, fingerprint: &str) -> Result<(), Error> {
    if snapshot.fingerprint != fingerprint {
        return Err(Error::Invalid(
            "Package state has changed. Refresh the dashboard before creating a new plan.".into(),
        ));
    }
    if snapshot.locked {
        return Err(Error::Invalid(
            "The package database is locked by another process. Wait for it to finish and refresh."
                .into(),
        ));
    }
    Ok(())
}

fn read_history(path: &str) -> Result<Vec<HistoryEntry>, Error> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(2_000_000);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(2_000_000).read_to_end(&mut bytes)?;
    let mut entries = parse_history(&String::from_utf8_lossy(&bytes));
    entries.truncate(300);
    Ok(entries)
}

fn parse_history(text: &str) -> Vec<HistoryEntry> {
    text.lines()
        .rev()
        .filter_map(|line| {
            let (timestamp, rest) = line.strip_prefix('[')?.split_once("] [ALPM] ")?;
            let (action, detail) = rest.split_once(' ')?;
            if ![
                "installed",
                "upgraded",
                "removed",
                "downgraded",
                "reinstalled",
            ]
            .contains(&action)
            {
                return None;
            }
            let (package, detail) = detail.split_once(' ')?;
            Some(HistoryEntry {
                timestamp: timestamp.to_owned(),
                action: action.to_owned(),
                package: package.to_owned(),
                detail: detail.to_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_service(store: ReviewStore, scan: Option<RecipeScan>) -> Service {
        let snapshot = serde_json::from_value(serde_json::json!({"capturedAt":1,"fingerprint":"fixture","hostname":"fixture","installedCount":0,"explicitCount":0,"foreignCount":0,"updateCount":0,"installedSize":0,"repositories":[],"warnings":[],"locked":false,"omarchy":false,"signaturePolicy":[]})).expect("snapshot fixture");
        Service {
            inventory: Arc::new(RwLock::new(Inventory {
                snapshot,
                packages: vec![],
                log_file: "unused".into(),
                dependencies: Arc::new(crate::dependencies::DependencyIndex::default()),
                comparisons: crate::comparison::ComparisonIndex::default(),
                installed: Vec::new(),
                orphan_names: Vec::new(),
                cache_dirs: Vec::new(),
                config: pacmanconf::Config::default(),
            })),
            refresh_lock: Arc::new(Mutex::new(())),
            audit_lock: Arc::new(Mutex::new(None)),
            client: Client::new(),
            recipe_state: Arc::new(Mutex::new(RecipeState {
                scans: scan
                    .into_iter()
                    .map(|scan| (scan.package_base.clone(), scan))
                    .collect(),
                store,
            })),
            recipe_slots: Arc::new(Semaphore::new(3)),
            integrity_slots: Arc::new(Semaphore::new(1)),
            repository_update_slots: Arc::new(Semaphore::new(1)),
            foreign_update_slots: Arc::new(Semaphore::new(1)),
            removal_slots: Arc::new(Semaphore::new(1)),
        }
    }
    #[tokio::test]
    async fn saved_batches_distinguish_missing_ids_and_bound_input() {
        let directory = tempfile::tempdir().unwrap();
        let service = fixture_service(ReviewStore::at(directory.path().join("reviews")), None);
        {
            let mut inventory = service.inventory.write().await;
            inventory.snapshot.captured_at = now();
            inventory.packages.push(
                serde_json::from_value(serde_json::json!({
                    "id":"core/fixture", "name":"fixture", "version":"1-1", "description":"fixture",
                    "repository":"core", "installedVersion":null, "updateAvailable":false,
                    "installedSize":0, "downloadSize":0, "url":null, "licenses":[],
                    "dependencies":[], "groups":[], "architecture":"x86_64", "explicit":false,
                    "signature":"unknown", "packageBase":null, "maintainer":null, "votes":null,
                    "outOfDate":false, "lastModified":null
                }))
                .unwrap(),
            );
            let mut provider = inventory.packages[0].clone();
            provider.id = "extra/provider".into();
            provider.name = "provider".into();
            inventory.packages.push(provider);
        }
        let result = service
            .execute(Request::PackagesByIds {
                ids: vec![
                    "extra/provider".into(),
                    "core/fixture".into(),
                    "old/fixture".into(),
                    "core/fixture".into(),
                ],
            })
            .await
            .unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 2);
        assert_eq!(result["items"][0]["id"], "extra/provider");
        assert_eq!(result["items"][1]["id"], "core/fixture");
        assert_eq!(result["missingIds"], serde_json::json!(["old/fixture"]));
        assert_eq!(result["fingerprint"], "fixture");
        for ids in [
            vec!["x".into(); 33],
            vec![String::new()],
            vec!["x".repeat(400)],
            vec!["\n".repeat(399); 32],
        ] {
            assert!(
                service
                    .execute(Request::PackagesByIds { ids })
                    .await
                    .is_err()
            );
        }
        let empty = service
            .execute(Request::PackagesByIds { ids: vec![] })
            .await
            .unwrap();
        assert_eq!(empty["items"], serde_json::json!([]));
        assert_eq!(empty["missingIds"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn preparation_and_maintenance_share_repository_capacity() {
        let directory = tempfile::tempdir().unwrap();
        let service = fixture_service(ReviewStore::at(directory.path().join("reviews")), None);
        service.inventory.write().await.snapshot.captured_at = now();
        let _permit = service.repository_update_slots.acquire().await.unwrap();
        for request in [
            Request::UpdatePreparation {
                fingerprint: "fixture".into(),
            },
            Request::RepositoryUpdates {
                fingerprint: "fixture".into(),
            },
        ] {
            let error = service.execute(request).await.unwrap_err().to_string();
            assert!(error.contains("already running"));
        }
    }
    fn fixture_scan() -> RecipeScan {
        let files = vec![
            evidence::file("PKGBUILD", "build", "pkgname=fixture\npkgver=1\n".into()),
            evidence::file(".SRCINFO", "metadata", "pkgbase = fixture\n".into()),
        ];
        RecipeScan {
            static_analyzer_version: Some(crate::scanner::RULESET_VERSION),
            source_evidence: None,
            package_base: "fixture".into(),
            scanned_at: 1.0,
            digest: evidence::bundle_digest(&files),
            commit: "a".repeat(40),
            files,
            complete: true,
            warnings: vec![],
            url: "https://aur.archlinux.org/".into(),
            findings: vec![],
            limitations: vec![],
        }
    }
    #[tokio::test]
    async fn failed_forced_audit_discards_success_for_other_clients() {
        let mut service = fixture_service(
            ReviewStore::at(std::env::temp_dir().join("archhub-unused-audit-test")),
            None,
        );
        // An unaccepted loopback connection times out without contacting the feed.
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = socket.local_addr().unwrap();
        service.client = Client::builder()
            .proxy(reqwest::Proxy::all(format!("http://{address}")).unwrap())
            .timeout(std::time::Duration::from_millis(100))
            .build()
            .unwrap();
        let snapshot = service.inventory.read().await.snapshot.clone();
        let audit = Audit {
            scanned_at: now(),
            source: "fixture".into(),
            source_url: "fixture".into(),
            checked_packages: 0,
            uncovered_packages: 0,
            findings: vec![],
            limitations: vec![],
            fingerprint: snapshot.fingerprint.clone(),
        };
        *service.audit_lock.lock().await = Some(audit);
        assert!(service.audit(&snapshot, &[], false).await.is_ok());
        assert!(service.audit(&snapshot, &[], true).await.is_err());
        assert!(service.audit_lock.lock().await.is_none());
        assert!(service.audit(&snapshot, &[], false).await.is_err());
    }
    #[test]
    fn plan_revalidation_rejects_changed_state_and_locks() {
        let mut snapshot: Snapshot = serde_json::from_value(serde_json::json!({"capturedAt":1,"fingerprint":"fixture","hostname":"fixture","installedCount":0,"explicitCount":0,"foreignCount":0,"updateCount":0,"installedSize":0,"repositories":[],"warnings":[],"locked":false,"omarchy":false,"signaturePolicy":[]})).unwrap();
        assert!(validate_plan_snapshot(&snapshot, "fixture").is_ok());
        assert!(validate_plan_snapshot(&snapshot, "changed").is_err());
        snapshot.locked = true;
        assert!(validate_plan_snapshot(&snapshot, "fixture").is_err());
    }
    #[tokio::test]
    async fn review_commands_persist_shared_evidence_and_reject_stale_or_incomplete_scans() {
        let root = std::env::temp_dir().join(format!(
            "archhub-service-fixture-{}-{}",
            std::process::id(),
            now().to_bits()
        ));
        let store = ReviewStore::at(root.clone());
        let scan = fixture_scan();
        let api = fixture_service(store.clone(), Some(scan.clone()));
        let note = "Automated fixture verification, not a human safety review.";
        for (digest, commit, note) in [
            ("forged".into(), scan.commit.clone(), note),
            (scan.digest.clone(), "b".repeat(40), note),
            (scan.digest.clone(), scan.commit.clone(), "short"),
        ] {
            assert!(
                api.execute(Request::RecordRecipeReview {
                    static_analyzer_version: Some(crate::scanner::RULESET_VERSION),
                    base: "fixture".into(),
                    digest,
                    commit,
                    note: note.into()
                })
                .await
                .is_err()
            );
        }
        assert!(!root.exists());
        for version in [None, Some(999)] {
            let request = Request::RecordRecipeReview {
                static_analyzer_version: version,
                base: "fixture".into(),
                digest: scan.digest.clone(),
                commit: scan.commit.clone(),
                note: note.into(),
            };
            assert!(api.execute(request).await.is_err());
            assert!(!root.exists(), "A stale analyzer must not write a review");
        }
        let result = api
            .execute(Request::RecordRecipeReview {
                static_analyzer_version: Some(crate::scanner::RULESET_VERSION),
                base: "fixture".into(),
                digest: scan.digest.clone(),
                commit: scan.commit.clone(),
                note: note.into(),
            })
            .await
            .expect("record");
        assert_eq!(result["status"], "reviewed");
        let desktop = fixture_service(store, None);
        assert_eq!(
            desktop
                .execute(Request::RecipeReview {
                    base: "fixture".into()
                })
                .await
                .expect("shared record")["note"],
            note
        );
        assert_eq!(
            desktop
                .execute(Request::RecipeReviews)
                .await
                .expect("records")
                .as_array()
                .expect("array")
                .len(),
            1
        );
        assert!(
            desktop
                .execute(Request::RecordRecipeReview {
                    static_analyzer_version: Some(crate::scanner::RULESET_VERSION),
                    base: "fixture".into(),
                    digest: scan.digest.clone(),
                    commit: scan.commit.clone(),
                    note: note.into()
                })
                .await
                .is_err()
        );
        assert!(
            desktop
                .execute(Request::RemoveRecipeReview {
                    base: "fixture".into(),
                    digest: scan.digest.clone(),
                    commit: "b".repeat(40)
                })
                .await
                .is_err()
        );
        desktop
            .execute(Request::RemoveRecipeReview {
                base: "fixture".into(),
                digest: scan.digest.clone(),
                commit: scan.commit.clone(),
            })
            .await
            .expect("remove");
        assert!(
            api.execute(Request::RecipeReview {
                base: "fixture".into()
            })
            .await
            .expect("gone")
            .is_null()
        );
        {
            let mut state = api.recipe_state.lock().await;
            state.scans.get_mut("fixture").expect("scan").complete = false;
        }
        assert!(
            api.execute(Request::RecordRecipeReview {
                static_analyzer_version: Some(crate::scanner::RULESET_VERSION),
                base: "fixture".into(),
                digest: scan.digest,
                commit: scan.commit,
                note: note.into()
            })
            .await
            .is_err()
        );
        std::fs::remove_dir_all(root).expect("cleanup");
    }
    #[test]
    fn history_ignores_commands_and_keeps_recent_package_events() {
        let entries = parse_history(
            "[2026-01-01T00:00:00+0000] [PACMAN] Running command containing secret\n[2026-01-01T00:00:01+0000] [ALPM] installed firefox (1.0-1)\n[2026-01-02T00:00:01+0000] [ALPM] upgraded firefox (1.0-1 -> 2.0-1)\n",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].action, "upgraded");
        assert_eq!(entries[1].package, "firefox");
    }
}
