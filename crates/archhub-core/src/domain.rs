use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub repository: String,
    pub installed_version: Option<String>,
    pub update_available: bool,
    pub installed_size: f64,
    pub download_size: f64,
    pub url: Option<String>,
    pub licenses: Vec<String>,
    pub dependencies: Vec<String>,
    pub groups: Vec<String>,
    pub architecture: String,
    pub explicit: bool,
    pub signature: String,
    pub package_base: Option<String>,
    pub maintainer: Option<String>,
    pub votes: Option<f64>,
    pub out_of_date: bool,
    pub last_modified: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub name: String,
    pub package_count: usize,
    pub updated_at: Option<f64>,
    pub signature_policy: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub captured_at: f64,
    pub fingerprint: String,
    pub hostname: String,
    pub installed_count: usize,
    pub explicit_count: usize,
    pub foreign_count: usize,
    pub update_count: usize,
    pub installed_size: f64,
    pub repositories: Vec<Repository>,
    pub warnings: Vec<String>,
    pub locked: bool,
    pub omarchy: bool,
    pub signature_policy: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PackagePage {
    pub items: Vec<Package>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub captured_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PackageBatch {
    pub items: Vec<Package>,
    pub missing_ids: Vec<String>,
    pub fingerprint: String,
    pub captured_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignRecipeLookup {
    pub name: String,
    pub installed_version: String,
    pub fingerprint: String,
    pub checked_at: f64,
    pub aur: Option<AurRecipeMatch>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AurRecipeMatch {
    pub name: String,
    pub package_base: String,
    pub version: String,
    pub version_relation: String,
    pub maintainer: Option<String>,
    pub out_of_date: bool,
    pub last_modified: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceReport {
    pub captured_at: f64,
    pub fingerprint: String,
    pub orphans: Vec<Package>,
    pub largest: Vec<Package>,
    pub foreign: Vec<Package>,
    pub caches: Vec<CacheUsage>,
    pub checkupdates_available: bool,
    pub paccache_available: bool,
    pub aur_helper: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub path: String,
    pub bytes: f64,
    pub files: usize,
    pub complete: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemovalTarget {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovalBlocker {
    pub consumer: String,
    pub dependency: String,
    pub causing_package: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovalOptionalImpact {
    pub consumer: String,
    pub dependency: String,
    pub description: Option<String>,
    pub removed_providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovalPlan {
    pub captured_at: f64,
    pub fingerprint: String,
    pub targets: Vec<RemovalTarget>,
    pub packages: Vec<Package>,
    pub installed_size: f64,
    pub dependency_check_passed: bool,
    pub blockers: Vec<RemovalBlocker>,
    pub held_packages: Vec<String>,
    pub optional_impacts: Vec<RemovalOptionalImpact>,
    pub command: Option<String>,
    #[serde(default)]
    pub execution_digest: Option<String>,
    #[serde(default)]
    pub execution_unavailable_reason: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemovalApplyRequest {
    pub protocol: u32,
    pub targets: Vec<RemovalTarget>,
    pub fingerprint: String,
    pub execution_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovalOutcome {
    pub status: String,
    pub message: String,
    pub targets: Vec<RemovalTarget>,
    pub remaining: Vec<RemovalTarget>,
    pub finished_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovalTask {
    pub id: u64,
    pub request: RemovalApplyRequest,
    pub started_at: f64,
    pub finished_at: Option<f64>,
    pub status: String,
    pub outcome: Option<RemovalOutcome>,
    pub diagnostics: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovalTaskState {
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub task: Option<RemovalTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryUpdates {
    pub checked_at: f64,
    pub fingerprint: String,
    pub packages: Vec<VersionChange>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchNotice {
    pub title: String,
    pub url: String,
    pub published_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchNews {
    pub checked_at: f64,
    pub source_url: String,
    pub digest: String,
    pub published_at: Option<f64>,
    pub items: Vec<ArchNotice>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreparation {
    pub captured_at: f64,
    pub fingerprint: String,
    pub command: String,
    pub repositories: Option<RepositoryUpdates>,
    pub repository_error: Option<String>,
    pub news: Option<ArchNews>,
    pub news_error: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VersionChange {
    pub name: String,
    pub installed_version: String,
    pub available_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignUpdates {
    pub checked_at: f64,
    pub fingerprint: String,
    pub packages: Vec<ForeignVersionCheck>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignVersionCheck {
    pub name: String,
    pub installed_version: String,
    pub aur: Option<AurRecipeMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub package: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub installed_version: Option<String>,
    pub fixed_version: Option<String>,
    pub cves: Vec<String>,
    pub url: Option<String>,
    pub confidence: String,
    pub line: Option<usize>,
    #[serde(default)]
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    pub scanned_at: f64,
    pub source: String,
    pub source_url: String,
    pub checked_packages: usize,
    pub uncovered_packages: usize,
    pub findings: Vec<Finding>,
    pub limitations: Vec<String>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeScan {
    #[serde(default)]
    pub static_analyzer_version: Option<u32>,
    pub package_base: String,
    pub scanned_at: f64,
    pub digest: String,
    pub commit: String,
    pub files: Vec<RecipeFile>,
    pub complete: bool,
    pub warnings: Vec<String>,
    pub url: String,
    pub findings: Vec<Finding>,
    pub limitations: Vec<String>,
    #[serde(default)]
    pub source_evidence: Option<RecipeSourceEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSourceEvidence {
    pub analyzer_version: u32,
    pub metadata_digest: Option<String>,
    pub complete: bool,
    pub sources: Vec<RecipeSource>,
    pub signing_keys: Vec<RecipeSigningKey>,
    pub unassigned_checksums: Vec<RecipeChecksum>,
    pub warnings: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSource {
    pub declaration: String,
    pub architecture: Option<String>,
    pub line: usize,
    pub name: String,
    pub location: String,
    pub kind: String,
    pub transport: String,
    pub reference: Option<RecipeSourceReference>,
    pub signed_checkout: bool,
    pub signature_for: Vec<usize>,
    pub checksums: Vec<RecipeChecksum>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSourceReference {
    pub kind: String,
    pub value: String,
    pub full_commit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeChecksum {
    pub algorithm: String,
    pub architecture: Option<String>,
    pub value: String,
    pub line: usize,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSigningKey {
    pub value: String,
    pub line: usize,
    pub full_fingerprint: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeFile {
    pub path: String,
    pub role: String,
    pub content: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeReview {
    pub scan: RecipeScan,
    pub reviewed_at: f64,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeReviewSummary {
    #[serde(default)]
    pub static_analyzer_version: Option<u32>,
    pub package_base: String,
    pub commit: String,
    pub digest: String,
    pub scanned_at: f64,
    pub reviewed_at: f64,
    pub note: String,
    pub file_count: usize,
    pub finding_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeInspection {
    pub scan: RecipeScan,
    pub baseline: Option<RecipeReviewSummary>,
    pub status: String,
    pub changes: Vec<RecipeFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeFileChange {
    pub path: String,
    pub kind: String,
    pub diff: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub timestamp: String,
    pub action: String,
    pub package: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeclarationChange {
    pub kind: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub unchanged_count: usize,
    pub omitted_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PackageComparison {
    pub name: String,
    pub repository: String,
    pub installed_version: String,
    pub candidate_version: String,
    pub version_relation: String,
    pub installed_architecture: String,
    pub candidate_architecture: String,
    pub installed_validation: String,
    pub filename: Option<String>,
    pub declared_sha256: Option<String>,
    pub embedded_signature: bool,
    pub changes: Vec<DeclarationChange>,
    pub captured_at: f64,
    pub fingerprint: String,
    pub complete: bool,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlan {
    pub id: String,
    pub created_at: f64,
    pub fingerprint: String,
    pub packages: Vec<Package>,
    pub comparisons: Vec<PackageComparison>,
    pub comparisons_complete: bool,
    #[serde(default)]
    pub security: Option<PlanSecurity>,
    pub download_size: f64,
    pub command: String,
    pub preconditions: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanSecurity {
    pub audit: Option<Audit>,
    pub unavailable_reason: Option<String>,
    pub findings: Vec<PlanAdvisory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdvisory {
    pub finding: Finding,
    pub candidate_version: String,
    pub candidate_repository: String,
    pub listed_fix_status: ListedFixStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ListedFixStatus {
    ReachesListedFix,
    BelowListedFix,
    NoListedFix,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum Request {
    RemovalPlan {
        targets: Vec<RemovalTarget>,
        fingerprint: String,
    },
    Maintenance,
    UpdatePreparation {
        fingerprint: String,
    },
    RepositoryUpdates {
        fingerprint: String,
    },
    ForeignUpdates {
        fingerprint: String,
    },
    ForeignRecipe {
        name: String,
        version: String,
        fingerprint: String,
    },
    Comparison {
        name: String,
        fingerprint: String,
    },
    Dependencies {
        name: String,
        version: String,
    },
    Integrity {
        name: String,
        version: String,
    },
    Snapshot {
        refresh: bool,
    },
    Packages {
        query: String,
        scope: String,
        repository: String,
        offset: usize,
        limit: usize,
        sort: String,
    },
    Package {
        id: String,
    },
    PackagesByIds {
        ids: Vec<String>,
    },
    AurSearch {
        query: String,
    },
    Audit {
        refresh: bool,
    },
    Recipe {
        base: String,
    },
    RecipeReviews,
    RecipeReview {
        base: String,
    },
    RecordRecipeReview {
        #[serde(default, rename = "staticAnalyzerVersion")]
        static_analyzer_version: Option<u32>,
        base: String,
        digest: String,
        commit: String,
        note: String,
    },
    RemoveRecipeReview {
        base: String,
        digest: String,
        commit: String,
    },
    History,
    Plan {
        fingerprint: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub name: String,
    pub version: String,
    pub started_at: f64,
    pub finished_at: f64,
    pub command: String,
    pub metadata_digest: String,
    pub owned_files: usize,
    pub total_entries: Option<usize>,
    pub pacman_altered_files: Option<usize>,
    pub exit_code: Option<i32>,
    pub complete: bool,
    pub issues: Vec<IntegrityIssue>,
    pub warnings: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityIssue {
    pub path: String,
    pub kind: IntegrityKind,
    pub backup: bool,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum IntegrityKind {
    Changed,
    Configuration,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyPackage {
    pub name: String,
    pub version: String,
    pub repository: String,
    pub explicit: bool,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyRequirement {
    pub spec: String,
    pub description: Option<String>,
    pub providers: Vec<DependencyPackage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyPath {
    pub package: DependencyPackage,
    pub path: Vec<String>,
    pub requirements: Vec<String>,
    pub alternative_providers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyGap {
    pub package: String,
    pub requirement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyReport {
    pub root: DependencyPackage,
    pub captured_at: f64,
    pub fingerprint: String,
    pub direct: Vec<DependencyRequirement>,
    pub optional: Vec<DependencyRequirement>,
    pub requires: Vec<DependencyPath>,
    pub required_by: Vec<DependencyPath>,
    pub unresolved: Vec<DependencyGap>,
    pub requires_complete: bool,
    pub required_by_complete: bool,
    pub limitations: Vec<String>,
}
