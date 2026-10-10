# Installed dependency paths

Goal: inspect an installed package's required dependency closure, potential reverse dependents, optional declarations, missing providers and advisory coverage. Done means real local data is navigable/exportable in browser, CLI and native IPC, with bounded traversal and fixture/runtime verification.

## Grounding and design

Existing package DTOs list the preferred repository candidate's dependencies, even when an older version is installed. Inventory loading already owns a blocking-worker libalpm handle and a snapshot fingerprint; advisory matching is separate, cached and explicitly limited. Add an owned dependency index to that same inventory snapshot, built solely from local installed metadata. No handles cross threads. Required/optional/provides/reason metadata joins the fingerprint so metadata-only changes invalidate correlation.

Index provider names, parse constraints/provisions with libalpm and apply its version comparator to literal names and versioned provides. Validate the resulting set against libalpm's canonical `find_satisfier` for every declaration. The Rust binding converts singleton borrowed lists to a different Pkg type without this method, so individual singleton matching would require unsafe code; the owned constraint matcher avoids that. Fixtures compare versioned and unversioned provider behavior with real libalpm. Report all matching installed providers. Edges express possible satisfaction, not a recorded choice of runtime library or a removal transaction. Required and optional edges remain separate. Build reverse edges only for required declarations.

The typed `dependencies { name, version }` request requires a valid installed identity and returns snapshot capture time/fingerprint, direct declarations with providers, optional declarations, forward/reverse paths, missing required providers and traversal completeness. Breadth-first traversal chooses one shortest deterministic representative path per package, breaks cycles, and caps each direction at 1000 nodes and 12 edges. Multiple-provider paths are labeled; bounds and unresolved declarations remain visible. Graph work runs in a blocking worker over an owned index.

The workspace uses an explicit Inspect action, installed-package selection, inventory refresh, Requires / Required by / Optional tabs, direct/transitive filtering, path/package search and 50-row pages. Rows show interactive paths and provider requirements. Advisory evidence loads separately and only correlates when snapshot fingerprints and installed versions match. A failed/stale feed stays unknown while local paths remain usable. Exports include the bounded graph and the matching advisory evidence, or an explicit unknown reason.

Alternative: run and parse `pactree`. Rejected because the installed libalpm interface can match dependencies without another CLI dependency or ambiguous tree text. A full interactive node diagram is deferred; a navigable path list preserves constraints, alternatives and readable mobile evidence.

## Boundaries and verification

No package writes, shell, repository code execution, remote submission of installed dependency names, or removal-safety verdict. Optional dependencies are not expanded. Build/dev dependencies, bundled libraries, language dependencies and actual symbol reachability are outside installed runtime metadata. Repository-name matches are current availability evidence, not installation provenance. Snapshot data can be up to 60 seconds old; refresh explicitly. Capture is not atomic: observed locks reject inspection, but short transactions may go unobserved. Missing-required evidence is capped at 5000 declarations.

- Isolated libalpm database fixtures: versioned virtual providers, unversioned provides against versioned requirements, alternatives, missing providers, optional descriptions, cycles, diamonds, reverse paths, depth/node caps and stale identities.
- Browser: real installed paths and export, reverse navigation, missing/ambiguous evidence, stale/unavailable advisories, pagination, refresh/retry, both-theme WCAG and mobile overflow.
- Project checks: Rust tests/fmt/clippy, generated bindings, frontend check/build, browser suite, actual private HTTPS flow, native IPC/rendering and release build.

Reference: [official libalpm dependency API](https://man.archlinux.org/man/libalpm_depends.3.en).

- [x] Explore and design
- [x] Implement
- [x] Review
- [x] Verify

## Review outcome

Required and optional missing-provider labels are explicit per declaration, so
changing tabs cannot relabel a required gap as optional. Failed forced advisory
refreshes invalidate prior correlation; matching fingerprints alone are also
insufficient when a finding names a different installed version. Search and
pagination preserve all bounded export evidence. The matcher follows versioned
provides semantics and checks each declaration with canonical libalpm lookup.

## Verification evidence

29 Rust workspace tests and all 42 browser tests pass, including real installed
paths/export, both-theme WCAG, mobile overflow, injected gaps/alternatives,
failed/stale advisory refresh and version mismatch. Frontend check/build and
workspace Rustfmt/Clippy pass. The actual private HTTPS flow verified selection,
explicit refresh/inspection, reverse/optional tabs, full JSON export, reload,
403 origin/cross-site boundaries and 400 stale identity rejection. Exported graph
fields matched an independent CLI process. The optimized native build passes. Native WebKit rendered this workspace,
queried real dependency IPC, rejected stale versions and exported scoped evidence.

On this workstation, pacman captured 107 required paths and seven possible reverse
dependents, with 18 direct declarations, two optional declarations, no unresolved
required providers and complete traversal. The advisory snapshot matched. These
are observations, not assertions about runtime safety. Artifacts are local:
`artifacts/tailscale-dependencies-evidence.json`,
`artifacts/tailscale-dependencies.png` and `artifacts/native-smoke-evidence.json`.
