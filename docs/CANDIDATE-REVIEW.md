# Repository candidate review

Goal: make package update review useful beyond version numbers while preserving
ArchHub's read-only boundary. The done predicate is a working local comparison,
reviewable update-plan exports, failure/staleness checks, responsive accessible UI,
and verified browser/private-preview/native paths.

- [x] Explore inventory, libalpm metadata, snapshot identity and update-plan contracts.
- [x] Design an owned comparison index captured before the libalpm handle closes.
- [x] Implement installed/preferred-candidate declaration diffs and artifact metadata.
- [x] Review the actual changes and failure paths.
- [x] Verify Rust/browser/native/private preview and refresh the optimized app.

The shared Rust index captures required and optional dependencies, provides,
conflicts and replacements, architecture, versions, recorded installation
validation, archive filename, declared SHA-256 and embedded-signature presence.
An embedded signature's digest participates in snapshot identity without exporting
its raw value. Deterministic JSON of all captured metadata participates in the
inventory fingerprint, so metadata changes with unchanged versions invalidate a
review. The existing configured repository order chooses the candidate.

`comparison { name, fingerprint }` reloads local metadata and rejects invalid,
missing/foreign, stale and locked requests. It never accepts file paths, URLs or
commands. `compare <name>` exposes the same contract through the CLI. Comparisons
work for equal and older versions as well as visible upgrades. Version ordering
uses libalpm rather than lexical or JavaScript semver comparison.

The Updates workspace shows added/removed declarations and unchanged counts.
Installed dependency paths remain a separate view. Advisory checks are explicit
and correlate the inventory fingerprint and exact installed version; failure,
staleness and coverage gaps remain unknown. Listed fixed versions are displayed
as context without assigning a safety or remediation verdict to the candidate.

Review plans retain every known version change and include the first 100 candidate
comparisons. Each category retains at most 500 added/removed declarations with an
omitted count. `comparisonsComplete` and each report's `complete` describe coverage.
Exports retain all captured declarations despite closed UI disclosure sections.

Accepted limits: no candidate archive download, binary/static-content scan,
signature or hash verification, dependency transaction resolution, repository
refresh, package mutation or recipe execution. Database declarations and historic
installation validation are different evidence. A complete metadata comparison
is not proof that the package is safe, current or compatible.

Verification on 2026-10-05: 42 Rust workspace tests and 58 Playwright tests pass.
The final full browser run needed no retries; earlier runs encountered Chromium
ERR_NETWORK_CHANGED while loading modules and one run was externally terminated.
Frontend types/lint/format/build and workspace Rustfmt/Clippy pass. Debug native
WebKit confirmed real comparison IPC/UI, stale rejection and review-plan fields;
existing integrity/dependency/AUR-source and denied-file-path checks also passed.
The optimized desktop build passed and the running desktop was refreshed.

The private Tailscale browser captured real pacman metadata, checked matching
installed-version advisory evidence, exported comparison/plan JSON and compared
the captured metadata with a separate CLI process. Foreign Origin/cross-site
requests returned 403 and stale comparisons returned 400. The observed candidate
had the same version as installed; no newer versions were present in these local
databases. Nonempty plans and declaration changes are covered by deterministic
fixtures without mutating host package state. Local database freshness remains
limited and no archive bytes were verified. See the [private browser evidence](../artifacts/tailscale-comparison-evidence.json),
[comparison capture](../artifacts/tailscale-comparison.png) and mobile/theme captures.
Three independent doctor processes captured the 1100-package inventory in
0.362, 0.339 and 0.325 seconds; these are observations, not performance guarantees.
