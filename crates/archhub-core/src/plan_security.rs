use crate::{Error, domain::*};
use std::collections::HashMap;

pub fn capture(
    snapshot: &Snapshot,
    packages: &[Package],
    result: Result<Audit, Error>,
) -> PlanSecurity {
    let candidates: HashMap<_, _> = packages
        .iter()
        .filter(|package| {
            package.installed_version.is_some()
                && ["core", "extra", "multilib"].contains(&package.repository.as_str())
        })
        .map(|package| (package.name.as_str(), package))
        .collect();
    let audit = match result {
        Ok(audit)
            if audit.fingerprint == snapshot.fingerprint
                && audit.findings.iter().all(|finding| {
                    candidates
                        .get(finding.package.as_str())
                        .is_some_and(|package| {
                            package.installed_version == finding.installed_version
                        })
                }) =>
        {
            audit
        }
        Ok(_) => {
            return unavailable("Advisory evidence does not match the captured inventory.".into());
        }
        Err(error) => return unavailable(error.to_string()),
    };
    let findings = audit
        .findings
        .iter()
        .map(|finding| {
            let candidate = candidates[finding.package.as_str()]; // Validated above, including installed identity.
            let listed_fix_status = match finding
                .fixed_version
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                None => ListedFixStatus::NoListedFix,
                Some(fixed) if alpm::vercmp(candidate.version.as_str(), fixed).is_lt() => {
                    ListedFixStatus::BelowListedFix
                }
                _ => ListedFixStatus::ReachesListedFix,
            };
            PlanAdvisory {
                finding: finding.clone(),
                candidate_version: candidate.version.clone(),
                candidate_repository: candidate.repository.clone(),
                listed_fix_status,
            }
        })
        .collect();
    PlanSecurity {
        audit: Some(audit),
        unavailable_reason: None,
        findings,
    }
}

fn unavailable(reason: String) -> PlanSecurity {
    PlanSecurity {
        audit: None,
        unavailable_reason: Some(reason),
        findings: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixtures() -> (Snapshot, Package, Audit) {
        let snapshot = serde_json::from_value(serde_json::json!({"capturedAt":1,"fingerprint":"fixture","hostname":"fixture","installedCount":1,"explicitCount":1,"foreignCount":0,"updateCount":1,"installedSize":0,"repositories":[],"warnings":[],"locked":false,"omarchy":false,"signaturePolicy":[]})).unwrap();
        let package = serde_json::from_value(serde_json::json!({"id":"extra/example","name":"example","version":"2.0-1","description":"","repository":"extra","installedVersion":"1.0-1","updateAvailable":true,"installedSize":0,"downloadSize":0,"url":null,"licenses":[],"dependencies":[],"groups":[],"architecture":"any","explicit":true,"signature":"unknown","packageBase":null,"maintainer":null,"votes":null,"outOfDate":false,"lastModified":null})).unwrap();
        let audit = serde_json::from_value(serde_json::json!({"scannedAt":2,"source":"fixture","sourceUrl":"https://security.archlinux.org/all.json","checkedPackages":1,"uncoveredPackages":0,"fingerprint":"fixture","limitations":["Publication freshness unknown"],"findings":[{"id":"AVG-fixture:example","package":"example","severity":"high","title":"Fixture","description":"Affected ranges require review","installedVersion":"1.0-1","fixedVersion":"2.0-1","cves":["CVE-fixture"],"url":null,"confidence":"needs-review","line":null}]})).unwrap();
        (snapshot, package, audit)
    }
    #[test]
    fn candidate_fix_context_uses_arch_epochs_revisions_and_preserves_uncertainty() {
        let (snapshot, mut package, mut audit) = fixtures();
        for (candidate, fixed, expected) in [
            ("2.0-1", "2.0-1", ListedFixStatus::ReachesListedFix),
            ("2.0-2", "2.0-1", ListedFixStatus::ReachesListedFix),
            ("2.0-1", "2.0-2", ListedFixStatus::BelowListedFix),
            ("1:1.0-1", "9.0-1", ListedFixStatus::ReachesListedFix),
            ("9.0-1", "1:1.0-1", ListedFixStatus::BelowListedFix),
        ] {
            package.version = candidate.into();
            audit.findings[0].fixed_version = Some(fixed.into());
            let evidence = capture(&snapshot, &[package.clone()], Ok(audit.clone()));
            assert_eq!(evidence.findings[0].listed_fix_status, expected);
            assert_eq!(evidence.findings[0].candidate_version, candidate);
            assert_eq!(evidence.findings[0].finding.confidence, "needs-review");
            assert_eq!(evidence.audit.unwrap().limitations, audit.limitations);
        }
    }
    #[test]
    fn findings_without_an_update_or_listed_fix_remain_visible() {
        let (snapshot, mut package, mut audit) = fixtures();
        package.update_available = false;
        package.version = "1.0-1".into();
        assert_eq!(
            capture(&snapshot, &[package.clone()], Ok(audit.clone())).findings[0].listed_fix_status,
            ListedFixStatus::BelowListedFix
        );
        for fixed in [None, Some("".into()), Some(" ".into())] {
            audit.findings[0].fixed_version = fixed;
            assert_eq!(
                capture(&snapshot, &[package.clone()], Ok(audit.clone())).findings[0]
                    .listed_fix_status,
                ListedFixStatus::NoListedFix
            );
        }
    }
    #[test]
    fn failed_mismatched_and_uncovered_evidence_is_unknown_not_empty_success() {
        let (snapshot, mut package, audit) = fixtures();
        let mut mismatched = audit.clone();
        mismatched.fingerprint = "changed".into();
        let mut wrong_version = audit.clone();
        wrong_version.findings[0].installed_version = Some("stale".into());
        for result in [
            Err(Error::Invalid("Feed unavailable".into())),
            Ok(mismatched),
            Ok(wrong_version),
        ] {
            let evidence = capture(&snapshot, &[package.clone()], result);
            assert!(evidence.audit.is_none());
            assert!(evidence.unavailable_reason.is_some());
            assert!(evidence.findings.is_empty());
        }
        package.repository = "custom".into();
        assert!(capture(&snapshot, &[package], Ok(audit)).audit.is_none());
    }
    #[test]
    fn zero_matches_preserve_coverage_and_do_not_claim_safety() {
        let (snapshot, package, mut audit) = fixtures();
        audit.findings.clear();
        let evidence = capture(&snapshot, &[package], Ok(audit));
        assert!(evidence.unavailable_reason.is_none());
        assert!(evidence.findings.is_empty());
        assert_eq!(evidence.audit.unwrap().checked_packages, 1);
    }
}
