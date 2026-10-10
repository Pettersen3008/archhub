mod comparison;
mod dependencies;
pub mod domain;
mod evidence;
pub mod execution;
mod foreign;
mod integrity;
pub mod inventory;
mod maintenance;
mod network;
mod plan_security;
mod removal;
pub mod scanner;
mod service;
mod sources;
mod update_preparation;
pub use service::Service;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Cannot read the package inventory: {0}")]
    Inventory(String),
    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Background task failed: {0}")]
    Task(#[from] tokio::task::JoinError),
}

pub fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

pub fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"@._+-".contains(&c))
}

// Installed versions are compared literally and used in a single database path
// component, never interpolated into shell commands. Accept Arch prereleases
// and epochs while excluding separators, whitespace and control characters.
pub fn valid_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.bytes().all(|c| c.is_ascii_graphic() && c != b'/')
}

pub fn export_bindings(path: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut collection = specta::TypeCollection::default();
    let types = collection
        .register::<domain::Request>()
        .register::<domain::Snapshot>()
        .register::<domain::PackagePage>()
        .register::<domain::PackageBatch>()
        .register::<domain::ForeignRecipeLookup>()
        .register::<domain::MaintenanceReport>()
        .register::<domain::RemovalPlan>()
        .register::<domain::RemovalApplyRequest>()
        .register::<domain::RemovalOutcome>()
        .register::<domain::RemovalTaskState>()
        .register::<domain::RepositoryUpdates>()
        .register::<domain::UpdatePreparation>()
        .register::<domain::ForeignUpdates>()
        .register::<domain::Audit>()
        .register::<domain::IntegrityReport>()
        .register::<domain::DependencyReport>()
        .register::<domain::PackageComparison>()
        .register::<domain::RecipeScan>()
        .register::<domain::RecipeInspection>()
        .register::<domain::RecipeReview>()
        .register::<domain::RecipeReviewSummary>()
        .register::<domain::HistoryEntry>()
        .register::<domain::UpdatePlan>();
    specta_typescript::Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .header("// Generated from Rust with Specta. Run bun run bindings; do not edit.")
        .export_to(path, types)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_path_and_command_injection_in_recipe_identifiers() {
        for value in [
            "",
            "../etc/passwd",
            "a/b",
            "x;id",
            "$(id)",
            "-flag",
            "a\nfoo",
        ] {
            assert!(!valid_name(value));
        }
        for value in ["firefox", "visual-studio-code-bin", "libc++", "python.foo"] {
            assert!(valid_name(value));
        }
    }
}
