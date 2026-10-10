use crate::evidence;
use crate::{Error, domain::*, now, scanner, valid_name};
use quick_xml::{Reader, events::Event};
use reqwest::Client;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::collections::HashMap;

#[derive(Deserialize)]
struct AurResponse {
    #[serde(default)]
    results: Vec<AurPackage>,
    #[serde(default)]
    error: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AurPackage {
    name: String,
    version: String,
    description: Option<String>,
    package_base: String,
    maintainer: Option<String>,
    num_votes: f64,
    out_of_date: Option<f64>,
    last_modified: f64,
    #[serde(rename = "URL")]
    url: Option<String>,
}

#[derive(Deserialize)]
struct AurInfoResponse {
    version: u32,
    #[serde(rename = "type")]
    kind: String,
    resultcount: usize,
    results: Vec<AurPackage>,
    #[serde(default)]
    error: Option<String>,
}

pub async fn aur_info(
    client: &Client,
    name: &str,
    installed_version: &str,
) -> Result<Option<AurRecipeMatch>, Error> {
    let mut url = reqwest::Url::parse("https://aur.archlinux.org/rpc/v5/info")
        .map_err(|error| Error::Invalid(error.to_string()))?;
    url.query_pairs_mut().append_pair("arg[]", name);
    let response = bounded_json(client, url, 64_000).await?;
    match_aur_info(response, name, installed_version)
}

pub async fn foreign_updates(
    client: &Client,
    packages: &[(String, String)],
) -> Result<Vec<ForeignVersionCheck>, Error> {
    if packages.len() > 1000 || packages.iter().any(|(name, _)| !valid_name(name)) {
        return Err(Error::Invalid(
            "AUR version checks accept at most 1,000 installed foreign packages.".into(),
        ));
    }
    let mut results = Vec::new();
    for chunk in packages.chunks(100) {
        let mut url = reqwest::Url::parse("https://aur.archlinux.org/rpc/v5/info")
            .map_err(|e| Error::Invalid(e.to_string()))?;
        for (name, _) in chunk {
            url.query_pairs_mut().append_pair("arg[]", name);
        }
        let response = bounded_json(client, url, 2_000_000).await?;
        results.extend(match_foreign_updates(response, chunk)?);
    }
    Ok(results)
}

fn match_foreign_updates(
    response: AurInfoResponse,
    packages: &[(String, String)],
) -> Result<Vec<ForeignVersionCheck>, Error> {
    let names: BTreeSet<_> = packages.iter().map(|(name, _)| name.as_str()).collect();
    if response.error.is_some()
        || response.version != 5
        || response.kind != "multiinfo"
        || response.resultcount != response.results.len()
        || names.len() != packages.len()
    {
        return Err(Error::Invalid(
            "AUR returned invalid batch metadata. Version availability is unknown.".into(),
        ));
    }
    let mut matches = HashMap::new();
    for package in response.results {
        if !names.contains(package.name.as_str())
            || matches.insert(package.name.clone(), package).is_some()
        {
            return Err(Error::Invalid("AUR returned unexpected or duplicate package names. Version availability is unknown.".into()));
        }
    }
    packages
        .iter()
        .map(|(name, version)| {
            let results: Vec<_> = matches.remove(name).into_iter().collect();
            let aur = match_aur_info(
                AurInfoResponse {
                    version: 5,
                    kind: "multiinfo".into(),
                    resultcount: results.len(),
                    results,
                    error: None,
                },
                name,
                version,
            )?;
            Ok(ForeignVersionCheck {
                name: name.clone(),
                installed_version: version.clone(),
                aur,
            })
        })
        .collect()
}

fn match_aur_info(
    response: AurInfoResponse,
    name: &str,
    installed_version: &str,
) -> Result<Option<AurRecipeMatch>, Error> {
    if response.error.is_some()
        || response.version != 5
        || response.kind != "multiinfo"
        || response.resultcount != response.results.len()
        || response.results.len() > 1
    {
        return Err(Error::Invalid(
            "AUR returned invalid exact-name metadata. No recipe association was made.".into(),
        ));
    }
    let Some(package) = response.results.into_iter().next() else {
        return Ok(None);
    };
    if package.name != name
        || !valid_name(&package.package_base)
        || package.version.is_empty()
        || package.version.len() > 512
        || package
            .version
            .chars()
            .any(|value| value.is_control() || value.is_whitespace())
        || !package.last_modified.is_finite()
        || package.last_modified < 0.0
        || package.last_modified > 253_402_300_799.0
        || package.maintainer.as_ref().is_some_and(|value| {
            value.is_empty() || value.len() > 200 || value.chars().any(char::is_control)
        })
    {
        return Err(Error::Invalid("AUR returned a mismatched or invalid package identity. No recipe association was made.".into()));
    }
    Ok(Some(AurRecipeMatch {
        name: package.name,
        package_base: package.package_base,
        version_relation: match alpm::vercmp(package.version.as_str(), installed_version) {
            std::cmp::Ordering::Greater => "newer",
            std::cmp::Ordering::Equal => "same",
            std::cmp::Ordering::Less => "older",
        }
        .into(),
        version: package.version,
        maintainer: package.maintainer,
        out_of_date: package.out_of_date.is_some(),
        last_modified: package.last_modified,
    }))
}

async fn bounded_json<T: serde::de::DeserializeOwned>(
    client: &Client,
    url: impl reqwest::IntoUrl,
    limit: usize,
) -> Result<T, Error> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            return Err(Error::Invalid(format!(
                "Remote metadata exceeds the {limit} byte response limit."
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

pub async fn aur_search(
    client: &Client,
    query: &str,
    installed: &HashMap<String, String>,
) -> Result<PackagePage, Error> {
    let query = query.trim();
    if query.chars().count() < 2 || query.len() > 100 {
        return Err(Error::Invalid(
            "Search AUR with between 2 and 100 characters.".into(),
        ));
    }
    let mut url = reqwest::Url::parse("https://aur.archlinux.org/rpc/v5/search/")
        .map_err(|e| Error::Invalid(e.to_string()))?;
    url.path_segments_mut()
        .map_err(|_| Error::Invalid("Invalid AUR endpoint".into()))?
        .push(query);
    let result: AurResponse = bounded_json(client, url, 8_000_000).await?;
    if let Some(error) = result.error {
        return Err(Error::Invalid(error));
    }
    let total = result.results.len();
    let mut items: Vec<_> = result
        .results
        .into_iter()
        .map(|p| {
            let local = installed.get(&p.name).cloned();
            Package {
                id: format!("aur/{}", p.name),
                update_available: local
                    .as_ref()
                    .is_some_and(|v| alpm::vercmp(p.version.as_str(), v.as_str()).is_gt()),
                installed_version: local,
                name: p.name,
                version: p.version,
                description: p.description.unwrap_or_default(),
                repository: "aur".into(),
                installed_size: 0.0,
                download_size: 0.0,
                url: p.url,
                licenses: vec![],
                dependencies: vec![],
                groups: vec![],
                architecture: "See build files".into(),
                explicit: false,
                signature: "community-recipe".into(),
                package_base: Some(p.package_base),
                maintainer: p.maintainer,
                votes: Some(p.num_votes),
                out_of_date: p.out_of_date.is_some(),
                last_modified: Some(p.last_modified),
            }
        })
        .collect();
    let q = query.to_lowercase();
    items.sort_by(|a, b| {
        crate::inventory::rank(a, &q)
            .cmp(&crate::inventory::rank(b, &q))
            .then_with(|| {
                b.votes
                    .unwrap_or_default()
                    .total_cmp(&a.votes.unwrap_or_default())
            })
            .then(a.name.cmp(&b.name))
    });
    items.truncate(300);
    Ok(PackagePage {
        items,
        total,
        offset: 0,
        limit: 300,
        captured_at: now(),
    })
}

#[derive(Deserialize)]
pub(crate) struct Advisory {
    pub name: String,
    pub packages: Vec<String>,
    pub severity: String,
    pub status: String,
    pub affected: String,
    pub fixed: Option<String>,
    pub issues: Vec<String>,
    #[serde(rename = "type")]
    pub kind: String,
}

pub(crate) fn match_advisories(advisories: &[Advisory], packages: &[Package]) -> Vec<Finding> {
    let mut findings = Vec::new();
    let installed: HashMap<_, _> = packages
        .iter()
        .filter(|p| ["core", "extra", "multilib"].contains(&p.repository.as_str()))
        .filter_map(|p| p.installed_version.as_ref().map(|v| (p.name.as_str(), v)))
        .collect();
    for advisory in advisories {
        for name in &advisory.packages {
            let Some(version) = installed.get(name.as_str()) else {
                continue;
            };
            let potentially_affected = if let Some(fixed) = &advisory.fixed {
                alpm::vercmp(version.as_str(), fixed.as_str()).is_lt()
            } else {
                alpm::vercmp(version.as_str(), advisory.affected.as_str()).is_le()
            };
            if !potentially_affected {
                continue;
            }
            let confirmed = matches!(advisory.status.as_str(), "Vulnerable" | "Fixed");
            findings.push(Finding { id: format!("{}:{name}", advisory.name), package: name.clone(),
                severity: advisory.severity.to_lowercase(), title: format!("{} in {name}", advisory.kind),
                description: format!("{} lists {name} {} as affected. Tracker status: {}. Version-range applicability requires review.", advisory.name, advisory.affected, advisory.status),
                installed_version: Some((*version).clone()), fixed_version: advisory.fixed.clone(), cves: advisory.issues.clone(),
                url: Some(format!("https://security.archlinux.org/{}", advisory.name)),
                confidence: if confirmed { "version-match" } else { "needs-review" }.into(), line: None, file: None });
        }
    }
    let priority = |s: &str| match s {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    };
    findings.sort_by_key(|f| priority(&f.severity));
    findings
}

pub async fn audit(
    client: &Client,
    snapshot: &Snapshot,
    packages: &[Package],
) -> Result<Audit, Error> {
    let url = "https://security.archlinux.org/all.json";
    let advisories: Vec<Advisory> = bounded_json(client, url, 8_000_000).await?;
    let checked = packages
        .iter()
        .filter(|p| {
            p.installed_version.is_some()
                && ["core", "extra", "multilib"].contains(&p.repository.as_str())
        })
        .count();
    Ok(Audit { scanned_at: now(), source: "Arch Security Tracker".into(), source_url: url.into(),
        checked_packages: checked, uncovered_packages: snapshot.installed_count.saturating_sub(checked),
        findings: match_advisories(&advisories, packages), fingerprint: snapshot.fingerprint.clone(),
        limitations: vec![
            "Coverage is limited to packages matching official Arch repositories. AUR, local and third-party packages are not covered.".into(),
            "Fetch time is recorded; the feed does not provide a publication timestamp. Its freshness and completeness are unknown.".into(),
            "Matches use Arch version comparisons and tracker affected/fixed versions. The feed does not provide complete affected ranges; findings require review.".into(),
            "This is an advisory check, not a malware scan or verification of installed files.".into(),
        ] })
}

async fn bounded_text(client: &Client, url: reqwest::Url) -> Result<String, Error> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 512_000 {
            return Err(Error::Invalid(
                "Build metadata exceeds the 512 KB file limit.".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let result = String::from_utf8(bytes)
        .map_err(|_| Error::Invalid("Build metadata is not UTF-8 text.".into()))?;
    let start = result.trim_start().to_ascii_lowercase();
    if start.starts_with("<!doctype html") || start.starts_with("<html") {
        return Err(Error::Invalid("AUR returned a web challenge instead of build metadata. Try again later or inspect the recipe in your browser.".into()));
    }
    Ok(result)
}

pub(crate) fn commit_from_atom(content: &str) -> Result<String, Error> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);
    let mut path = Vec::new();
    let mut entries = 0;
    let mut commit = None;
    loop {
        match reader
            .read_event()
            .map_err(|_| Error::Invalid("AUR commit metadata is malformed.".into()))?
        {
            Event::Start(event) => {
                path.push(event.local_name().as_ref().as_bytes().to_vec());
                if path.len() > 32 {
                    return Err(Error::Invalid(
                        "AUR commit metadata is too deeply nested.".into(),
                    ));
                }
                if path.len() == 2 && path[0] == b"feed" && path[1] == b"entry" {
                    entries += 1;
                }
            }
            Event::Text(event)
                if entries == 1
                    && path.len() == 3
                    && path[0] == b"feed"
                    && path[1] == b"entry"
                    && path[2] == b"id" =>
            {
                let value = event.as_ref();
                let id = value
                    .strip_prefix("urn:sha1:")
                    .filter(|id| evidence::valid_commit(id))
                    .ok_or_else(|| {
                        Error::Invalid("AUR did not provide a valid full commit identifier.".into())
                    })?;
                if commit.is_some() {
                    return Err(Error::Invalid(
                        "AUR returned conflicting commit identifiers.".into(),
                    ));
                }
                commit = Some(id.to_ascii_lowercase());
            }
            Event::End(_) => {
                path.pop();
            }
            Event::DocType(_) => {
                return Err(Error::Invalid(
                    "AUR commit metadata must not contain a document type declaration.".into(),
                ));
            }
            Event::Eof => {
                if !path.is_empty() {
                    return Err(Error::Invalid("AUR commit metadata is incomplete.".into()));
                }
                break;
            }
            _ => (),
        }
    }
    commit.ok_or_else(|| {
        Error::Invalid("AUR did not return a recipe commit. No files were scanned.".into())
    })
}

fn install_files(srcinfo: &str) -> (BTreeSet<String>, Vec<String>) {
    let mut files = BTreeSet::new();
    let mut warnings = Vec::new();
    for line in srcinfo.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        if key.trim() != "install" {
            continue;
        }
        let value = value.trim();
        if !evidence::valid_file(value) || ["PKGBUILD", ".SRCINFO"].contains(&value) {
            warnings.push(format!("Unsupported install-file reference in .SRCINFO: {value}. It was not fetched or evaluated."));
        } else {
            files.insert(value.into());
        }
    }
    if warnings.len() > 32 {
        warnings.truncate(32);
        warnings.push("Additional unsupported install references were omitted from this warning preview. Coverage is incomplete.".into());
    }
    (files, warnings)
}

fn plain_url(base: &str, commit: &str, file: &str) -> Result<reqwest::Url, Error> {
    if !valid_name(base) || !evidence::valid_commit(commit) || !evidence::valid_file(file) {
        return Err(Error::Invalid(
            "Invalid pinned build-file reference.".into(),
        ));
    }
    let mut url = reqwest::Url::parse("https://aur.archlinux.org/cgit/aur.git/plain/")
        .map_err(|e| Error::Invalid(e.to_string()))?;
    url.path_segments_mut()
        .map_err(|_| Error::Invalid("Invalid AUR file endpoint.".into()))?
        .pop_if_empty()
        .extend(file.split('/'));
    url.query_pairs_mut()
        .append_pair("h", base)
        .append_pair("id", commit);
    Ok(url)
}

pub async fn recipe(client: &Client, base: &str) -> Result<RecipeScan, Error> {
    if !valid_name(base) {
        return Err(Error::Invalid("Invalid package base.".into()));
    }
    let mut atom = reqwest::Url::parse("https://aur.archlinux.org/cgit/aur.git/atom/")
        .map_err(|e| Error::Invalid(e.to_string()))?;
    atom.query_pairs_mut().append_pair("h", base);
    let commit = commit_from_atom(&bounded_text(client, atom).await?)?;
    let (content, srcinfo) = tokio::try_join!(
        bounded_text(client, plain_url(base, &commit, "PKGBUILD")?),
        bounded_text(client, plain_url(base, &commit, ".SRCINFO")?)
    )?;
    if !srcinfo.lines().any(|line| {
        line.trim()
            .split_once('=')
            .is_some_and(|(key, value)| key.trim() == "pkgbase" && value.trim() == base)
    }) {
        return Err(Error::Invalid(
            "Pinned .SRCINFO does not identify the requested package base.".into(),
        ));
    }
    let (install, mut warnings) = install_files(&srcinfo);
    let mut references = install.clone();
    for line in content.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        if key.trim() == "install" {
            let literal = value.trim().trim_matches(['\'', '"']);
            if evidence::valid_file(literal) && !["PKGBUILD", ".SRCINFO"].contains(&literal) {
                if !install.contains(literal) {
                    references.insert(literal.into());
                    warnings.push(format!("PKGBUILD declares {literal}, but .SRCINFO does not. The metadata needs review."));
                }
            } else if install.is_empty() {
                warnings.push("PKGBUILD declares a dynamic or unsupported install script without a resolved .SRCINFO reference. It was not evaluated.".into());
            }
        }
    }
    let mut files = vec![
        evidence::file("PKGBUILD", "build", content),
        evidence::file(".SRCINFO", "metadata", srcinfo),
    ];
    if references.len() > 6 {
        warnings.push("More than six installation scripts are declared. Coverage is incomplete; additional references were not fetched.".into());
    }
    for path in references.into_iter().take(6) {
        match bounded_text(client, plain_url(base, &commit, &path)?).await {
            Ok(content)
                if files.iter().map(|file| file.content.len()).sum::<usize>() + content.len()
                    <= evidence::MAX_BUNDLE_BYTES =>
            {
                files.push(evidence::file(&path, "install", content))
            }
            Ok(_) => warnings.push(format!(
                "{path} would exceed the 2 MB bundle limit and was not scanned."
            )),
            Err(error) => warnings.push(format!(
                "Installation script {path} could not be scanned: {error}"
            )),
        }
    }
    let mut findings: Vec<_> = files
        .iter()
        .filter(|file| file.role != "metadata")
        .flat_map(|file| scanner::scan_file(base, &file.path, &file.content))
        .collect();
    if findings.len() > 2000 {
        findings.truncate(2000);
        warnings.push("The 2000-finding limit was reached. Findings are truncated and coverage is incomplete.".into());
    }
    let digest = evidence::bundle_digest(&files);
    let source_evidence = Some(crate::sources::analyze(base, &files));
    Ok(RecipeScan {
        static_analyzer_version: Some(scanner::RULESET_VERSION),
        package_base: base.into(), scanned_at: now(), digest, commit: commit.clone(), files,
        complete: warnings.is_empty(), warnings, findings, source_evidence,
        url: format!("https://aur.archlinux.org/cgit/aur.git/tree/?h={base}&id={commit}"),
        limitations: vec![
            "Text heuristics do not parse full shell context and can miss indirect, multiline or obfuscated commands. Checksum patterns recognize supported literal declarations; dynamic expressions and escaped values remain uninterpreted. False positives remain possible.".into(),
            "PKGBUILD, .SRCINFO and literal installation-script references are fetched at one AUR commit. Patches, source archives, dependencies and generated files are not scanned.".into(),
            "Install references use .SRCINFO metadata and simple literal PKGBUILD declarations. Bash is not evaluated; stale metadata and dynamic declarations can hide additional files.".into(),
            "The commit pins the retrieved recipe snapshot. It does not authenticate the maintainer or verify downloaded sources, built artifacts or installed bytes.".into(),
            "No files were executed. Saving a personal review does not establish safety or authorize installation.".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn info_fixture() -> serde_json::Value {
        serde_json::json!({"version":5,"type":"multiinfo","resultcount":1,"results":[{"Name":"example-cli","PackageBase":"example-suite","Version":"1:1.0-2","Description":"Fixture","Maintainer":null,"NumVotes":1,"OutOfDate":1,"LastModified":1,"URL":null}]})
    }
    #[test]
    fn batch_info_preserves_missing_matches_and_rejects_partial_invalid_metadata() {
        let packages = vec![
            ("example-cli".into(), "9.0-1".into()),
            ("local-only".into(), "1".into()),
        ];
        let results =
            match_foreign_updates(serde_json::from_value(info_fixture()).unwrap(), &packages)
                .unwrap();
        assert_eq!(
            results[0].aur.as_ref().unwrap().package_base,
            "example-suite"
        );
        assert_eq!(results[0].aur.as_ref().unwrap().version_relation, "newer");
        assert!(results[1].aur.is_none());
        for change in [
            "duplicate",
            "unexpected",
            "invalid-version",
            "count",
            "error",
        ] {
            let mut value = info_fixture();
            match change {
                "duplicate" => {
                    let duplicate = value["results"][0].clone();
                    value["results"].as_array_mut().unwrap().push(duplicate);
                    value["resultcount"] = 2.into();
                }
                "unexpected" => value["results"][0]["Name"] = "unexpected".into(),
                "invalid-version" => value["results"][0]["Version"] = "bad version".into(),
                "count" => value["resultcount"] = 2.into(),
                _ => value["error"] = "service unavailable".into(),
            }
            assert!(
                match_foreign_updates(serde_json::from_value(value).unwrap(), &packages).is_err(),
                "{change}"
            );
        }
    }
    #[test]
    fn exact_info_uses_split_base_arch_ordering_and_retains_unmaintained_flags() {
        let match_ = match_aur_info(
            serde_json::from_value(info_fixture()).unwrap(),
            "example-cli",
            "9.0-1",
        )
        .unwrap()
        .unwrap();
        assert_eq!(match_.package_base, "example-suite");
        assert_eq!(match_.version_relation, "newer");
        assert!(match_.maintainer.is_none());
        assert!(match_.out_of_date);
        assert_eq!(
            match_aur_info(
                serde_json::from_value(info_fixture()).unwrap(),
                "example-cli",
                "1:1.0-2"
            )
            .unwrap()
            .unwrap()
            .version_relation,
            "same"
        );
        assert_eq!(
            match_aur_info(
                serde_json::from_value(info_fixture()).unwrap(),
                "example-cli",
                "1:1.0-3"
            )
            .unwrap()
            .unwrap()
            .version_relation,
            "older"
        );
    }
    #[test]
    fn empty_info_is_distinct_from_malformed_error_duplicate_or_mismatched_metadata() {
        let empty =
            serde_json::json!({"version":5,"type":"multiinfo","resultcount":0,"results":[]});
        assert!(
            match_aur_info(serde_json::from_value(empty).unwrap(), "example-cli", "1")
                .unwrap()
                .is_none()
        );
        for field in [
            "type",
            "version",
            "resultcount",
            "error",
            "duplicate",
            "Name",
            "PackageBase",
            "Version",
            "Maintainer",
            "LastModified",
        ] {
            let mut value = info_fixture();
            match field {
                "type" => value["type"] = "search".into(),
                "version" => value["version"] = 4.into(),
                "resultcount" => value["resultcount"] = 0.into(),
                "error" => value["error"] = "Unavailable".into(),
                "duplicate" => {
                    let row = value["results"][0].clone();
                    value["results"].as_array_mut().unwrap().push(row);
                    value["resultcount"] = 2.into();
                }
                "Name" => value["results"][0][field] = "different-package".into(),
                "PackageBase" => value["results"][0][field] = "../../secret".into(),
                "Version" => value["results"][0][field] = "\u{0}".into(),
                "Maintainer" => value["results"][0][field] = "x".repeat(201).into(),
                "LastModified" => value["results"][0][field] = (-1).into(),
                _ => unreachable!(),
            }
            assert!(
                match_aur_info(serde_json::from_value(value).unwrap(), "example-cli", "1").is_err(),
                "{field}"
            );
        }
        for malformed in [
            serde_json::json!({}),
            serde_json::json!({"version":5,"type":"error","resultcount":0,"error":"Unavailable"}),
        ] {
            assert!(serde_json::from_value::<AurInfoResponse>(malformed).is_err());
        }
        for invalid in [serde_json::json!(1e20), serde_json::json!(-1)] {
            let mut value = info_fixture();
            value["results"][0]["LastModified"] = invalid;
            assert!(
                match_aur_info(serde_json::from_value(value).unwrap(), "example-cli", "1").is_err()
            );
        }
        let mut value = info_fixture();
        value["results"][0]["Version"] = " ".into();
        assert!(
            match_aur_info(serde_json::from_value(value).unwrap(), "example-cli", "1").is_err()
        );
    }
    #[tokio::test]
    async fn single_package_metadata_enforces_streamed_response_bounds() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap();
        for size in [64_000, 64_001] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                assert!(socket.read(&mut request).await.unwrap() > 0);
                let body = format!("\"{}\"", "x".repeat(size - 2));
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n"
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                let _ = socket.write_all(body.as_bytes()).await;
            });
            let result =
                bounded_json::<serde_json::Value>(&client, format!("http://{address}"), 64_000)
                    .await;
            server.await.unwrap();
            if size == 64_000 {
                assert_eq!(result.unwrap().as_str().unwrap().len(), size - 2);
            } else {
                assert!(
                    result
                        .unwrap_err()
                        .to_string()
                        .contains("64000 byte response limit")
                );
            }
        }
    }
    #[test]
    fn atom_uses_the_newest_entry_and_rejects_malformed_identifiers() {
        let first = "a".repeat(40);
        let second = "b".repeat(40);
        let atom = format!(
            "<feed><id>self</id><entry><id>urn:sha1:{first}</id></entry><entry><id>urn:sha1:{second}</id></entry></feed>"
        );
        assert_eq!(commit_from_atom(&atom).expect("commit"), first);
        for invalid in [
            "<feed/>",
            "<html>challenge</html>",
            "<feed><entry><id>urn:sha1:short</id></entry></feed>",
            "<!DOCTYPE feed SYSTEM 'file:///etc/passwd'><feed/>",
            "<feed><entry><id>urn:sha1:../../secret</id></entry></feed>",
        ] {
            assert!(commit_from_atom(invalid).is_err());
        }
    }
    #[test]
    fn install_metadata_supports_split_packages_without_interpreting_paths() {
        let (files, warnings) = install_files(
            "pkgbase = fixture\ninstall = shared.install\npkgname = first\ninstall = shared.install\npkgname = second\ninstall = packaging/second.install\ninstall = ../secret\ninstall = $(id)\ninstall = https://example.org/remote\n",
        );
        assert_eq!(files.len(), 2);
        assert_eq!(warnings.len(), 3);
        let url = plain_url("fixture", &"a".repeat(40), "packaging/second.install").expect("url");
        assert!(url.path().ends_with("/plain/packaging/second.install"));
        assert!(url.query().expect("query").contains("id=aaaaaaaa"));
        assert!(plain_url("fixture", &"a".repeat(40), "../secret").is_err());
    }
    #[test]
    fn excludes_fixed_versions_and_third_party_packages() {
        let mut advisory = Advisory {
            name: "AVG-test".into(),
            packages: vec!["example".into()],
            severity: "High".into(),
            status: "Fixed".into(),
            affected: "1.0-1".into(),
            fixed: Some("2.0-1".into()),
            issues: vec![],
            kind: "code execution".into(),
        };
        let mut pkg: Package = serde_json::from_value(serde_json::json!({"id":"extra/example","name":"example","version":"2.0-1","description":"","repository":"extra","installedVersion":"2.0-1","updateAvailable":false,"installedSize":0,"downloadSize":0,"url":null,"licenses":[],"dependencies":[],"groups":[],"architecture":"any","explicit":true,"signature":"unknown","packageBase":null,"maintainer":null,"votes":null,"outOfDate":false,"lastModified":null})).expect("fixture");
        assert!(
            match_advisories(std::slice::from_ref(&advisory), std::slice::from_ref(&pkg))
                .is_empty()
        );
        pkg.installed_version = Some("1.0-1".into());
        pkg.repository = "omarchy".into();
        assert!(
            match_advisories(std::slice::from_ref(&advisory), std::slice::from_ref(&pkg))
                .is_empty()
        );
        pkg.repository = "extra".into();
        let matched = match_advisories(std::slice::from_ref(&advisory), std::slice::from_ref(&pkg));
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].confidence, "version-match");
        advisory.status = "Unknown".into();
        let uncertain = match_advisories(&[advisory], &[pkg]);
        assert_eq!(uncertain[0].confidence, "needs-review");
    }
}
