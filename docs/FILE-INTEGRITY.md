# Installed-file integrity

Goal: an explicit, read-only check of one installed package, available in the browser, desktop and CLI. Done means real pacman evidence is visible and exportable, with modified configuration files and unavailable checks distinguished, plus fixtures and live UI verification.

## Design

`integrity { name, version }` accepts an installed package identity, never a path or command. The command also receives explicit `--root` and `--dbpath` arguments from resolved system configuration. A dedicated Rust module reads the current local libalpm metadata, validates the installed version and database lock, then launches the fixed `/usr/bin/pacman --query --check --check --color never -- <name>` command without a shell. The environment fixes the output language to C. This uses pacman's existing mtree, SHA-256, ownership, permission, file-type, symlink, size and timestamp checks. It does not refresh databases, execute hooks or elevate privileges.

One scan per service, a 90-second child-process deadline and a 2 MB cap per output stream bound resource use. Child processes are killed on timeout, oversized output or dropped requests. Before/after fingerprints of expanded configuration and local desc/files/mtree detect observed metadata changes; a lock or version change invalidates completeness. This is not an atomic filesystem snapshot.

The adapter retains per-path pacman messages, groups duplicate paths, identifies backup/configuration files from local metadata (ordinary backup content/time changes are configuration differences, while missing files and permission changes remain ordinary changes), and treats unreadable files/missing checksum data as unavailable checks. Unknown output, missing mtree/summary, truncated coverage or inconsistent exit status prevents a complete result. Pacman's altered count is retained separately: it includes unavailable checks and excludes some backup changes, so it is not a count of proven tampering. Metadata-entry counts are not counts of fully verified files.

The UI requires an explicit action, lets users select installed packages, filter/search/page evidence and export JSON. The package trust sheet links to the same workspace. No success badge implies a safe machine. Evidence stays in memory unless exported.

Alternative: parse mtree and hash files in a new engine. Rejected for this slice because it duplicates pacman's handling of backup files, symlinks, NoExtract and archive metadata. The tradeoff is a conservative parser for version-dependent CLI diagnostics; unfamiliar output becomes incomplete rather than silently successful.

## Limits

Local package metadata and the pacman binary are trusted references, not independently authenticated. No external signed artifact comparison, malware detection, file-content export or repair. Configuration differences may be intentional; timestamps alone do not establish compromise. NoExtract can suppress missing-file checks. Files may change during a scan. No elevated read access; permission failures remain visible. Unsupported pacman output remains unknown.

## Verification

- Unit fixtures: clean summary; missing files; SHA-256/type/symlink/permission changes; backup configuration; unavailable checks; unknown output; missing mtree; no summary; inconsistent exit; grouping and singular summaries.
- Isolated temporary local database/root: run real pacman against equal-size changed content, a missing file, modified backup file and changed symlink; prove classification and zero host mutations.
- Process fixtures: bounded output and deadlines terminate the child.
- Browser: real package selection/check/export, failure/retry and inventory refresh after installed-version changes, grouped filters and paging, light/dark WCAG and narrow-screen overflow.
- Checks: Rust tests/fmt/clippy, generated bindings, frontend checks/build, browser suite, real private Tailscale flow and native build.

## Completed evidence

All 24 workspace Rust tests and 34 Playwright tests pass. Frontend checks/build,
workspace Rustfmt/Clippy and the optimized native build pass. The real private
HTTPS flow and native IPC/rendering probe pass; screenshots and JSON reports are
listed in [implementation evidence](IMPLEMENTATION.md#installed-file-integrity).

Primary references used to choose the existing engine:
[pacman query/check manual](<https://man.archlinux.org/man/pacman.8.en#QUERY_OPTIONS_(APPLY_TO_-Q)>),
[pacman's check implementation](https://gitlab.archlinux.org/pacman/pacman/-/blob/master/src/pacman/check.c),
[mtree format](https://man.archlinux.org/man/mtree.5).
