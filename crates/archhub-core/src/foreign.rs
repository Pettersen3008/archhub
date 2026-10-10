use crate::{Error, domain::*, valid_name};

pub fn validate(
    snapshot: &Snapshot,
    packages: &[Package],
    name: &str,
    version: &str,
    fingerprint: &str,
) -> Result<(), Error> {
    if !valid_name(name) || version.is_empty() || version.len() > 512 {
        return Err(Error::Invalid("Invalid installed package identity.".into()));
    }
    if snapshot.fingerprint != fingerprint {
        return Err(Error::Invalid(
            "Package state changed. Refresh inventory before looking up a recipe.".into(),
        ));
    }
    if snapshot.locked {
        return Err(Error::Invalid(
            "Package database is locked. Wait for the updater and refresh.".into(),
        ));
    }
    if !packages.iter().any(|package| {
        package.name == name
            && package.repository == "local"
            && package.installed_version.as_deref() == Some(version)
    }) {
        return Err(Error::Invalid("This version is not an installed foreign package. Refresh inventory and reopen its details.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_current_unlocked_installed_foreign_identities_can_be_looked_up() {
        let mut snapshot: Snapshot = serde_json::from_value(serde_json::json!({"capturedAt":1,"fingerprint":"fixture","hostname":"fixture","installedCount":1,"explicitCount":1,"foreignCount":1,"updateCount":0,"installedSize":0,"repositories":[],"warnings":[],"locked":false,"omarchy":false,"signaturePolicy":[]})).unwrap();
        let mut package: Package = serde_json::from_value(serde_json::json!({"id":"local/example","name":"example","version":"1:1.0-1","description":"","repository":"local","installedVersion":"1:1.0-1","updateAvailable":false,"installedSize":0,"downloadSize":0,"url":null,"licenses":[],"dependencies":[],"groups":[],"architecture":"any","explicit":true,"signature":"unknown","packageBase":null,"maintainer":null,"votes":null,"outOfDate":false,"lastModified":null})).unwrap();
        assert!(
            validate(
                &snapshot,
                &[package.clone()],
                "example",
                "1:1.0-1",
                "fixture"
            )
            .is_ok()
        );
        for (name, version, fingerprint) in [
            ("../secret", "1:1.0-1", "fixture"),
            ("$(id)", "1:1.0-1", "fixture"),
            ("missing", "1:1.0-1", "fixture"),
            ("example", "stale", "fixture"),
            ("example", "1:1.0-1", "changed"),
        ] {
            assert!(validate(&snapshot, &[package.clone()], name, version, fingerprint).is_err());
        }
        snapshot.locked = true;
        assert!(
            validate(
                &snapshot,
                &[package.clone()],
                "example",
                "1:1.0-1",
                "fixture"
            )
            .is_err()
        );
        snapshot.locked = false;
        package.repository = "extra".into();
        assert!(
            validate(
                &snapshot,
                &[package.clone()],
                "example",
                "1:1.0-1",
                "fixture"
            )
            .is_err()
        );
        package.repository = "local".into();
        package.installed_version = None;
        assert!(validate(&snapshot, &[package], "example", "1:1.0-1", "fixture").is_err());
        assert!(validate(&snapshot, &[], "example", "1:1.0-1", "fixture").is_err());
    }
}
