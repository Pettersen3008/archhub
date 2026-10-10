//! Declaration-only evidence: no source download, shell evaluation or cryptographic verification.
use crate::domain::*;
use std::collections::BTreeMap;

const SOURCE_LIMIT: usize = 200;
const KEY_LIMIT: usize = 100;
const ENTRY_LIMIT: usize = 2000;
const BYTE_LIMIT: usize = 512_000;
const ALGORITHMS: [(&str, usize); 8] = [
    ("cksums", 0),
    ("md5sums", 32),
    ("sha1sums", 40),
    ("sha224sums", 56),
    ("sha256sums", 64),
    ("sha384sums", 96),
    ("sha512sums", 128),
    ("b2sums", 128),
];
#[derive(Default)]
struct Group {
    sources: Vec<(usize, String)>,
    checksums: BTreeMap<String, Vec<(usize, String)>>,
}
fn warn(report: &mut RecipeSourceEvidence, message: impl Into<String>) {
    report.complete = false;
    if report.warnings.len() < 50 {
        report.warnings.push(message.into());
    } else if report.warnings.len() == 50 {
        report.warnings.push(
            "Additional metadata warnings are omitted. Raw captured files remain exportable."
                .into(),
        );
    }
}
fn field(key: &str) -> Option<(&str, Option<&str>)> {
    for name in std::iter::once("source").chain(ALGORITHMS.iter().map(|(name, _)| *name)) {
        if key == name {
            return Some((name, None));
        }
        if let Some(arch) = key
            .strip_prefix(name)
            .and_then(|tail| tail.strip_prefix('_'))
        {
            return Some((name, Some(arch)));
        }
    }
    None
}
fn checksum(
    algorithm: &str,
    architecture: &Option<String>,
    line: usize,
    value: &str,
    aligned: bool,
) -> RecipeChecksum {
    let length = ALGORITHMS
        .iter()
        .find(|(name, _)| *name == algorithm)
        .unwrap()
        .1;
    let valid = if length == 0 {
        value.parse::<u32>().is_ok() && value.bytes().all(|c| c.is_ascii_digit())
    } else {
        value.len() == length && value.bytes().all(|c| c.is_ascii_hexdigit())
    };
    let state = if !aligned {
        "unaligned"
    } else if value == "SKIP" {
        "skipped"
    } else if valid {
        "declared"
    } else {
        "invalid"
    };
    RecipeChecksum {
        algorithm: algorithm.into(),
        architecture: architecture.clone(),
        value: value.into(),
        line,
        state: state.into(),
    }
}
fn source(line: usize, declaration: String, architecture: Option<String>) -> RecipeSource {
    let (rename, location) = declaration
        .split_once("::")
        .map_or((None, declaration.as_str()), |(name, location)| {
            (Some(name), location)
        });
    let mut row = RecipeSource {
        declaration: declaration.clone(),
        architecture,
        line,
        name: rename.unwrap_or(location).into(),
        location: location.into(),
        kind: "unknown".into(),
        transport: "unknown".into(),
        reference: None,
        signed_checkout: false,
        signature_for: vec![],
        checksums: vec![],
        notes: vec![],
    };
    if declaration.is_empty()
        || declaration
            .chars()
            .any(|c| c.is_control() || c == '$' || c == '`')
        || rename.is_some_and(|name| name.is_empty() || name.contains('/') || name.contains('\\'))
    {
        row.notes
            .push("Empty, dynamic or unsupported source declaration; it was not evaluated.".into());
        return row;
    }
    let (vcs, address) = ["git", "hg", "svn", "bzr", "fossil"]
        .iter()
        .find_map(|vcs| {
            location
                .strip_prefix(&format!("{vcs}+"))
                .map(|address| (*vcs, address))
        })
        .map_or((None, location), |(vcs, address)| (Some(vcs), address));
    let parsed = reqwest::Url::parse(address);
    let vcs = vcs.or_else(|| {
        parsed.as_ref().ok().and_then(|u| match u.scheme() {
            "git" => Some("git"),
            "svn" => Some("svn"),
            _ => None,
        })
    });
    match parsed {
        Ok(url) => {
            row.transport = url.scheme().into();
            row.kind = if !address.contains("://") || url.host_str().is_none() {
                "unknown"
            } else if vcs.is_some()
                && ["https", "http", "ssh", "git", "svn", "ftp"].contains(&url.scheme())
            {
                "vcs"
            } else if ["https", "http", "ftp"].contains(&url.scheme()) {
                "download"
            } else {
                "unknown"
            }
            .into();
            if rename.is_none() {
                row.name = url
                    .path()
                    .rsplit('/')
                    .find(|p| !p.is_empty())
                    .unwrap_or(location)
                    .into();
            }
            if !url.username().is_empty() || url.password().is_some() {
                row.notes.push("Credentials are embedded in the source URL. Review the declaration; no connection was made.".into());
            }
            if ["http", "ftp", "git"].contains(&url.scheme()) {
                row.notes.push(
                    "This transport does not authenticate or encrypt the source download.".into(),
                );
            }
            if let Some(vcs) = vcs.filter(|_| row.kind == "vcs") {
                // makepkg accepts ?signed both before and after the VCS fragment.
                let fragment = url.fragment().unwrap_or("");
                let (fragment, fragment_query) = fragment.split_once('?').unwrap_or((fragment, ""));
                row.signed_checkout =
                    vcs == "git" && (url.query() == Some("signed") || fragment_query == "signed");
                if let Some((kind, value)) = fragment.split_once('=') {
                    let supported = match vcs {
                        "git" | "fossil" => ["commit", "tag", "branch"].contains(&kind),
                        "hg" => ["revision", "tag", "branch"].contains(&kind),
                        "svn" | "bzr" => kind == "revision",
                        _ => false,
                    };
                    if supported && !value.is_empty() {
                        row.reference = Some(RecipeSourceReference {
                            kind: kind.into(),
                            value: value.into(),
                            full_commit: vcs == "git"
                                && kind == "commit"
                                && [40, 64].contains(&value.len())
                                && value.bytes().all(|c| c.is_ascii_hexdigit()),
                        });
                    } else {
                        row.kind = "unknown".into();
                        row.notes.push("Unsupported or empty VCS reference; its effective checkout is unknown.".into());
                    }
                } else if !fragment.is_empty() {
                    row.kind = "unknown".into();
                    row.notes.push(
                        "Unsupported VCS fragment; its effective checkout is unknown.".into(),
                    );
                }
                if let Some(reference) = &row.reference {
                    if !reference.full_commit {
                        row.notes.push("This tag, branch, revision or abbreviated reference can move or be ambiguous. No checkout was verified.".into());
                    }
                } else {
                    row.notes.push(
                        "No supported VCS reference is declared; the checkout may move.".into(),
                    );
                }
            }
        }
        Err(_) if !location.contains("://") && !location.contains(':') => {
            row.kind = "local".into();
            row.transport = "local".into();
            if rename.is_none() {
                row.name = location.rsplit('/').next().unwrap_or(location).into();
            }
            row.notes
                .push("Local source contents are not fetched or inspected by this scan.".into());
            if location.starts_with('/') || location.split('/').any(|p| p == "..") {
                row.kind = "unknown".into();
                row.notes
                    .push("Absolute or traversing local source path; it was not accessed.".into());
            }
        }
        _ => row
            .notes
            .push("Unsupported source URL or transport; it was not accessed.".into()),
    }
    if row.kind != "vcs"
        && [".sig", ".sign", ".asc"]
            .iter()
            .any(|suffix| row.name.ends_with(suffix))
        && row.kind != "unknown"
    {
        row.kind = "signature".into();
    }
    row
}

pub fn analyze(base: &str, files: &[RecipeFile]) -> RecipeSourceEvidence {
    let metadata = files.iter().find(|file| file.path == ".SRCINFO");
    let mut report = RecipeSourceEvidence {
        analyzer_version: 1, metadata_digest: metadata.map(|f| f.digest.clone()), complete: true,
        sources: vec![], signing_keys: vec![], unassigned_checksums: vec![], warnings: vec![],
        limitations: vec![
            "Declarations from captured .SRCINFO only. PKGBUILD is not evaluated; same-commit metadata can still be stale or disagree with the executable recipe.".into(),
            "No upstream source, signature or key was downloaded. No checksum, signature, signer identity or VCS checkout was verified.".into(),
            "Checksums pair by order within the same architecture group. A checksum declaration does not authenticate its author or establish safe source contents.".into(),
            "Signature associations use declared filenames and compatible architecture groups. Missing files, renames and build-time changes may affect actual verification.".into(),
            "Sources are limited to 200, key declarations to 100, recognized entries to 2000 and metadata to 512 KB. Raw captured files remain in the full scan export.".into(),
        ],
    };
    let Some(metadata) = metadata else {
        warn(
            &mut report,
            "No captured .SRCINFO file is available. Source evidence is unknown.",
        );
        return report;
    };
    if metadata.content.len() > BYTE_LIMIT {
        warn(
            &mut report,
            "Captured .SRCINFO exceeds the 512 KB analysis limit. Source evidence is unknown.",
        );
        return report;
    }
    let mut groups: BTreeMap<Option<String>, Group> = BTreeMap::new();
    let mut base_count = 0;
    let mut package_count = 0;
    let mut in_base = false;
    let mut source_count = 0;
    let mut entry_count = 0;
    for (index, raw) in metadata.content.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            warn(
                &mut report,
                format!("Line {} is not a metadata assignment.", index + 1),
            );
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        if key == "pkgbase" {
            base_count += 1;
            in_base = package_count == 0 && base_count == 1 && value == base;
            if !in_base {
                warn(
                    &mut report,
                    format!(
                        "Line {} has a conflicting or misplaced pkgbase section.",
                        index + 1
                    ),
                );
            }
            continue;
        }
        if key == "pkgname" {
            package_count += 1;
            in_base = false;
            if base_count != 1 || !crate::valid_name(value) {
                warn(
                    &mut report,
                    format!("Line {} has an invalid pkgname section.", index + 1),
                );
            }
            continue;
        }
        let recognized = field(key);
        if recognized.is_none() && key != "validpgpkeys" {
            continue;
        }
        entry_count += 1;
        if entry_count > ENTRY_LIMIT {
            warn(
                &mut report,
                "The 2000-entry metadata limit was reached. Additional declarations are unknown.",
            );
            break;
        }
        if !in_base {
            warn(
                &mut report,
                format!(
                    "Line {} declares source integrity outside the pkgbase section; it was not associated.",
                    index + 1
                ),
            );
            continue;
        }
        if key == "validpgpkeys" {
            if report.signing_keys.len() >= KEY_LIMIT {
                warn(&mut report, "The 100-key declaration limit was reached.");
                continue;
            }
            let full = [40, 64].contains(&value.len())
                && value.bytes().all(|c| c.is_ascii_hexdigit())
                && value == value.to_ascii_uppercase();
            if !full {
                warn(
                    &mut report,
                    format!(
                        "Line {} does not declare a full uppercase signing-key fingerprint accepted by makepkg.",
                        index + 1
                    ),
                );
            }
            report.signing_keys.push(RecipeSigningKey {
                value: value.into(),
                line: index + 1,
                full_fingerprint: full,
            });
            continue;
        }
        let (name, arch) = recognized.unwrap();
        if arch.is_some_and(|a| {
            a.is_empty() || a == "any" || !a.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        }) {
            warn(
                &mut report,
                format!("Line {} has an unsupported architecture suffix.", index + 1),
            );
            continue;
        }
        let group = groups.entry(arch.map(str::to_owned)).or_default();
        if name == "source" {
            if source_count >= SOURCE_LIMIT {
                warn(
                    &mut report,
                    "The 200-source declaration limit was reached. Additional sources are unknown.",
                );
                continue;
            }
            source_count += 1;
            group.sources.push((index + 1, value.into()));
        } else {
            group
                .checksums
                .entry(name.into())
                .or_default()
                .push((index + 1, value.into()));
        }
    }
    if base_count != 1 || package_count == 0 {
        warn(
            &mut report,
            "Metadata must declare one matching pkgbase and at least one pkgname section.",
        );
    }
    for (arch, group) in groups {
        let mut rows: Vec<_> = group
            .sources
            .into_iter()
            .map(|(line, value)| source(line, value, arch.clone()))
            .collect();
        for (algorithm, values) in group.checksums {
            let aligned = values.len() == rows.len();
            if !aligned {
                warn(
                    &mut report,
                    format!(
                        "{algorithm}{} has {} values for {} sources. Associations are unknown.",
                        arch.as_ref().map(|a| format!("_{a}")).unwrap_or_default(),
                        values.len(),
                        rows.len()
                    ),
                );
            }
            for (index, (line, value)) in values.into_iter().enumerate() {
                let check = checksum(&algorithm, &arch, line, &value, aligned);
                if check.state == "invalid" {
                    warn(
                        &mut report,
                        format!("Line {line} has an invalid {algorithm} value."),
                    );
                }
                if let Some(row) = rows.get_mut(index) {
                    row.checksums.push(check);
                } else {
                    report.unassigned_checksums.push(check);
                }
            }
        }
        for row in &mut rows {
            if row.kind == "unknown" {
                warn(
                    &mut report,
                    format!(
                        "Source line {} has an unsupported declaration; interpretation is unknown.",
                        row.line
                    ),
                );
            }
            if row.checksums.is_empty() {
                row.notes
                    .push("No checksum array is declared for this source group.".into());
            }
            if row.checksums.iter().any(|c| c.state == "skipped") {
                row.notes.push("At least one checksum is SKIP. Review other checksum and signature declarations.".into());
            }
            if row.checksums.iter().any(|c| {
                c.state == "declared"
                    && ["cksums", "md5sums", "sha1sums"].contains(&c.algorithm.as_str())
            }) && !row.checksums.iter().any(|c| {
                c.state == "declared"
                    && !["cksums", "md5sums", "sha1sums"].contains(&c.algorithm.as_str())
            }) {
                row.notes.push("Only legacy checksum algorithms are declared; review stronger integrity evidence.".into());
            }
        }
        report.sources.extend(rows);
    }
    report.sources.sort_by_key(|row| row.line);
    for index in 0..report.sources.len() {
        if report.sources[index].kind != "signature" {
            continue;
        }
        let signature = &report.sources[index];
        let stem = signature.name.rsplit_once('.').unwrap().0;
        let targets: Vec<_> = report
            .sources
            .iter()
            .filter(|candidate| {
                candidate.kind != "signature"
                    && candidate.kind != "unknown"
                    && candidate.kind != "vcs"
                    && (candidate.architecture == signature.architecture
                        || candidate.architecture.is_none()
                        || signature.architecture.is_none())
                    && ["", ".gz", ".bz2", ".xz", ".lrz", ".lzo", ".Z", ".zst"]
                        .iter()
                        .any(|ext| candidate.name == format!("{stem}{ext}"))
            })
            .map(|candidate| candidate.line)
            .collect();
        if targets.is_empty() {
            report.sources[index].notes.push(
                "No matching declared source filename was found for this detached signature."
                    .into(),
            );
        }
        if targets.len() > 1 {
            report.sources[index].notes.push("Multiple declared sources match this signature filename; association is ambiguous.".into());
        }
        report.sources[index].signature_for = targets;
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    fn metadata(body: &str) -> RecipeSourceEvidence {
        let file = crate::evidence::file(
            ".SRCINFO",
            "metadata",
            format!("pkgbase = fixture\n{body}\npkgname = fixture\n"),
        );
        analyze("fixture", &[file])
    }
    #[test]
    fn checksum_order_is_scoped_to_each_architecture() {
        let report = metadata(&format!(
            "source = shared.patch\nsource_x86_64 = app-x86::https://example.test/app\nsource_aarch64 = https://example.test/arm\nsha256sums = {}\nsha256sums_aarch64 = {}\nsha256sums_x86_64 = {}",
            "a".repeat(64),
            "b".repeat(64),
            "c".repeat(64)
        ));
        assert!(report.complete);
        assert_eq!(
            report.sources.iter().map(|s| s.line).collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert_eq!(report.sources[0].checksums[0].value, "a".repeat(64));
        assert_eq!(report.sources[1].checksums[0].value, "c".repeat(64));
        assert_eq!(report.sources[2].checksums[0].value, "b".repeat(64));
        assert_eq!(report.sources[1].name, "app-x86");
        assert_eq!(report.sources[1].architecture.as_deref(), Some("x86_64"));
    }
    #[test]
    fn malformed_checksum_arrays_never_become_aligned_integrity_evidence() {
        let report = metadata(&format!(
            "source = a\nsource = b\nsha256sums = {}\nsha512sums = {}\nsha512sums = {}\nsha512sums = {}\nmd5sums = wrong\nmd5sums = SKIP\nsha1sums_aarch64 = {}",
            "a".repeat(64),
            "b".repeat(128),
            "c".repeat(128),
            "d".repeat(128),
            "e".repeat(40)
        ));
        assert!(!report.complete);
        assert!(
            report.sources[0]
                .checksums
                .iter()
                .filter(|c| c.algorithm.starts_with("sha"))
                .all(|c| c.state == "unaligned")
        );
        assert!(
            report.sources[0]
                .checksums
                .iter()
                .any(|c| c.state == "invalid")
        );
        assert!(
            report.sources[1]
                .checksums
                .iter()
                .any(|c| c.state == "skipped")
        );
        assert_eq!(report.unassigned_checksums.len(), 2);
        assert!(
            report
                .unassigned_checksums
                .iter()
                .all(|c| c.state == "unaligned")
        );
    }
    #[test]
    fn skip_and_legacy_checksums_are_declarations_without_clean_verdicts() {
        let report = metadata(&format!(
            "source = https://example.test/a\nsource = http://example.test/b\nsha1sums = {}\nsha1sums = SKIP\ncksums = 4294967295\ncksums = 4294967296",
            "a".repeat(40)
        ));
        assert!(!report.complete); // Invalid CRC value, not the valid but legacy SHA-1.
        assert!(report.sources[0].notes.iter().any(|n| n.contains("legacy")));
        assert!(report.sources[1].notes.iter().any(|n| n.contains("SKIP")));
        assert!(
            report.sources[1]
                .notes
                .iter()
                .any(|n| n.contains("transport"))
        );
        for (algorithm, len) in ALGORITHMS.into_iter().filter(|(_, len)| *len > 0) {
            let valid = metadata(&format!("source = a\n{algorithm} = {}", "a".repeat(len)));
            assert!(valid.complete, "{algorithm}");
            assert_eq!(valid.sources[0].checksums[0].state, "declared");
        }
    }
    #[test]
    fn vcs_references_and_signed_requests_are_never_checkout_verification() {
        let report = metadata(&format!(
            "source = git+https://example.test/a#commit={}\nsource = git+https://example.test/b#tag=v1?signed\nsource = git+https://example.test/c?signed#branch=main\nsource = git://example.test/d#commit=abc123\nsource = git+https://example.test/e\nsource = svn+https://example.test/f#revision=17",
            "a".repeat(40)
        ));
        assert!(report.complete);
        assert!(report.sources[0].reference.as_ref().unwrap().full_commit);
        assert!(report.sources[1].signed_checkout && report.sources[2].signed_checkout);
        assert!(!report.sources[1].reference.as_ref().unwrap().full_commit);
        assert!(!report.sources[3].reference.as_ref().unwrap().full_commit);
        assert!(report.sources[4].reference.is_none());
        assert_eq!(
            report.sources[5].reference.as_ref().unwrap().kind,
            "revision"
        );
        assert!(report.limitations.iter().any(|n| n.contains("No checksum")));
    }
    #[test]
    fn renamed_detached_signatures_use_filename_and_architecture_evidence() {
        let report = metadata(&format!(
            "source = release.tar.xz::https://example.test/download\nsource = release.tar.sig::https://example.test/signature\nsource_x86_64 = arm-only.sig::https://example.test/a.sig\nsource_aarch64 = arm-only::https://example.test/arm\nsource = orphan.asc\nvalidpgpkeys = {}",
            "A".repeat(40)
        ));
        assert!(report.complete);
        assert_eq!(report.sources[1].kind, "signature");
        assert_eq!(report.sources[1].signature_for, vec![2]);
        assert!(report.sources[2].signature_for.is_empty());
        assert!(report.sources[4].signature_for.is_empty());
        assert!(report.signing_keys[0].full_fingerprint);
        let ambiguous = metadata(
            "source = release.tar.xz\nsource_x86_64 = release.tar.xz\nsource = release.tar.sig",
        );
        assert_eq!(ambiguous.sources[2].signature_for, vec![2, 3]);
        assert!(
            ambiguous.sources[2]
                .notes
                .iter()
                .any(|note| note.contains("ambiguous"))
        );
    }
    #[test]
    fn unsupported_values_and_split_section_contamination_remain_unknown() {
        let file = crate::evidence::file(
            ".SRCINFO",
            "metadata",
            format!(
                "pkgbase = fixture\nsource = $(touch /tmp/never-run)\nsource = file:///etc/passwd\nsource = ../secret\nsource = javascript:alert(1)\nsource_any = https://example.test/a\nvalidpgpkeys = {}\npkgname = first\nsource = https://example.test/contamination\nsha256sums = {}\npkgbase = fixture\nsource = https://example.test/second-base\n",
                "a".repeat(40),
                "b".repeat(64)
            ),
        );
        let report = analyze("fixture", &[file]);
        assert!(!report.complete);
        assert_eq!(report.sources.len(), 4);
        assert!(report.sources.iter().all(|s| s.kind == "unknown"));
        assert!(report.sources.iter().all(|s| s.checksums.is_empty()));
        assert!(!report.signing_keys[0].full_fingerprint);
        assert!(report.warnings.iter().any(|w| w.contains("outside")));
        for value in [
            "git+javascript:alert(1)",
            "git+file:///etc/passwd",
            "git+https://example.test/a#revision=17",
            "svn+https://example.test/a#tag=v1",
            "https:example.test/a",
        ] {
            let report = metadata(&format!("source = {value}"));
            assert!(!report.complete, "{value}");
            assert_eq!(report.sources[0].kind, "unknown", "{value}");
        }
    }
    #[test]
    fn missing_invalid_and_empty_metadata_have_distinct_scope() {
        assert!(!analyze("fixture", &[]).complete);
        assert!(analyze("fixture", &[]).metadata_digest.is_none());
        let empty = metadata("");
        assert!(empty.complete && empty.sources.is_empty()); // No declared sources, not a verified-source result.
        let bad = crate::evidence::file(
            ".SRCINFO",
            "metadata",
            "pkgbase = other\nsource = https://example.test/a\npkgname = other".into(),
        );
        let report = analyze("fixture", &[bad]);
        assert!(!report.complete && report.sources.is_empty());
        assert!(!metadata("not an assignment").complete);
    }
    #[test]
    fn metadata_resource_bounds_are_visible_and_keep_captured_raw_bytes_untouched() {
        let report = metadata(&"source = https://example.test/a\n".repeat(201));
        assert!(!report.complete);
        assert_eq!(report.sources.len(), 200);
        let keys = metadata(&format!("validpgpkeys = {}\n", "A".repeat(40)).repeat(101));
        assert!(!keys.complete && keys.signing_keys.len() == 100);
        let entries = metadata(&"sha256sums = SKIP\n".repeat(2100));
        assert!(!entries.complete && entries.unassigned_checksums.len() == 2000);
        let oversized = crate::evidence::file(".SRCINFO", "metadata", "x".repeat(BYTE_LIMIT + 1));
        let digest = oversized.digest.clone();
        let report = analyze("fixture", std::slice::from_ref(&oversized));
        assert!(!report.complete && report.sources.is_empty());
        assert_eq!(report.metadata_digest.as_deref(), Some(digest.as_str()));
        assert_eq!(oversized.content.len(), BYTE_LIMIT + 1);
        assert_eq!(
            metadata(&"source = $invalid\n".repeat(200)).warnings.len(),
            51
        );
    }
}
