use archhub_core::{Service, domain::Request};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};

async fn execute(
    State(service): State<Service>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let host = headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if ![
        "127.0.0.1:4318",
        "localhost:4318",
        "127.0.0.1:1420",
        "localhost:1420",
    ]
    .contains(&host)
        || headers
            .get("sec-fetch-site")
            .is_some_and(|value| value == "cross-site")
    {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"Only local same-origin requests are permitted."})),
        ));
    }
    // Same-origin Vite proxy only. No CORS permission for remote websites.
    if let Some(origin) = headers.get("origin") {
        let origin = origin.to_str().unwrap_or("");
        if !["http://127.0.0.1:1420", "http://localhost:1420"].contains(&origin) {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error":"Origin is not permitted."})),
            ));
        }
    }
    service.execute(request).await.map(Json).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":error.to_string()})),
        )
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "bindings") {
        return archhub_core::export_bindings(std::path::Path::new("src/lib/ipc/bindings.ts"));
    }
    let service = Service::new().await?;
    if args.first().is_some_and(|a| a == "serve") {
        let router = Router::new()
            .route("/api/query", post(execute))
            .route(
                "/api/health",
                get(|| async { Json(serde_json::json!({"status":"ok","mode":"read-only"})) }),
            )
            .layer(axum::extract::DefaultBodyLimit::max(16_384))
            .with_state(service);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:4318").await?;
        eprintln!("ArchHub read-only API listening on http://127.0.0.1:4318");
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        return Ok(());
    }
    let request = match args.first().map(String::as_str) {
        Some("doctor") | None => Request::Snapshot { refresh: false },
        Some("packages") => Request::Packages { query: args.get(1).cloned().unwrap_or_default(), scope: "installed".into(), repository: "all".into(), offset: 0, limit: 200, sort: "name".into() },
        Some("search") => Request::Packages { query: args.get(1).cloned().unwrap_or_default(), scope: "all".into(), repository: "all".into(), offset: 0, limit: 100, sort: "name".into() },
        Some("audit") => Request::Audit { refresh: true },
        Some("maintenance") => Request::Maintenance,
        Some("removal-plan") => {
            if args.len() < 2 || args.len() > 101 { return Err("Usage: archhub-core removal-plan <installed-package> [package ...] (up to 100)".into()); }
            let snapshot = service.execute(Request::Snapshot { refresh: true }).await?;
            let fingerprint = snapshot["fingerprint"].as_str().ok_or("Missing snapshot fingerprint")?.into();
            let mut targets = Vec::new();
            for name in &args[1..] {
                if !archhub_core::valid_name(name) { return Err("Invalid installed package name".into()); }
                let page = service.execute(Request::Packages { query: name.clone(), scope: "installed".into(), repository: "all".into(), offset: 0, limit: 200, sort: "name".into() }).await?;
                let pkg = page["items"].as_array().and_then(|items| items.iter().find(|p| p["name"] == *name)).ok_or("Package is not installed")?;
                targets.push(archhub_core::domain::RemovalTarget { name: name.clone(), version: pkg["installedVersion"].as_str().ok_or("Missing installed version")?.into() });
            }
            Request::RemovalPlan { targets, fingerprint }
        },
        Some("check-updates") | Some("check-aur") | Some("prepare-update") => {
            let snapshot = service.execute(Request::Snapshot { refresh: true }).await?;
            let fingerprint = snapshot["fingerprint"].as_str().ok_or("Missing snapshot fingerprint")?.into();
            if args[0] == "prepare-update" { Request::UpdatePreparation { fingerprint } } else if args[0] == "check-updates" { Request::RepositoryUpdates { fingerprint } } else { Request::ForeignUpdates { fingerprint } }
        },
        Some("foreign-recipe") => {
            let name = args.get(1).ok_or("Usage: archhub-core foreign-recipe <installed-foreign-package>")?.clone();
            let snapshot = service.execute(Request::Snapshot { refresh: false }).await?;
            let packages = service.execute(Request::Packages { query: name.clone(), scope: "foreign".into(), repository: "all".into(), offset: 0, limit: 200, sort: "name".into() }).await?;
            let package = packages["items"].as_array().and_then(|items| items.iter().find(|package| package["name"] == name)).ok_or("Package is not installed as foreign.")?;
            Request::ForeignRecipe { name, version: package["installedVersion"].as_str().ok_or("Missing installed version")?.into(), fingerprint: snapshot["fingerprint"].as_str().ok_or("Missing snapshot fingerprint")?.into() }
        },
        Some("compare") => {
            let name = args.get(1).ok_or("Usage: archhub-core compare <installed-package>")?.clone();
            let snapshot = service.execute(Request::Snapshot { refresh: false }).await?;
            Request::Comparison { name, fingerprint: snapshot["fingerprint"].as_str().ok_or("Missing snapshot fingerprint")?.into() }
        },
        Some("dependencies") => {
            let name = args.get(1).ok_or("Usage: archhub-core dependencies <installed-package>")?.clone();
            let packages = service.execute(Request::Packages { query: name.clone(), scope: "installed".into(), repository: "all".into(), offset: 0, limit: 200, sort: "name".into() }).await?;
            let package = packages["items"].as_array().and_then(|items| items.iter().find(|p| p["name"] == name)).ok_or("Package is not installed.")?;
            Request::Dependencies { name, version: package["installedVersion"].as_str().ok_or("Missing installed version")?.into() }
        },
        Some("integrity") => {
            let name = args.get(1).ok_or("Usage: archhub-core integrity <installed-package>")?.clone();
            let packages = service.execute(Request::Packages { query: name.clone(), scope: "installed".into(), repository: "all".into(), offset: 0, limit: 200, sort: "name".into() }).await?;
            let package = packages["items"].as_array().and_then(|items| items.iter().find(|p| p["name"] == name)).ok_or("Package is not installed.")?;
            Request::Integrity { name, version: package["installedVersion"].as_str().ok_or("Missing installed version")?.into() }
        },
        Some("recipe") => Request::Recipe { base: args.get(1).ok_or("Usage: archhub-core recipe <package-base>")?.clone() },
        Some("reviews") => Request::RecipeReviews,
        Some("review") => Request::RecipeReview { base: args.get(1).ok_or("Usage: archhub-core review <package-base>")?.clone() },
        Some("history") => Request::History,
        Some("updates") => { let snapshot = service.execute(Request::Snapshot { refresh: false }).await?;
            Request::Plan { fingerprint: snapshot["fingerprint"].as_str().ok_or("Missing snapshot fingerprint")?.into() } },
        _ => return Err("Commands: doctor, maintenance, prepare-update, check-updates, check-aur, packages [query], search [query], audit, foreign-recipe <name>, compare <name>, dependencies <name>, integrity <name>, recipe <base>, reviews, review <base>, history, updates, serve, bindings".into()),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&service.execute(request).await?)?
    );
    Ok(())
}
