# ArchHub

A local, security-focused package dashboard for Arch Linux and Omarchy. React 19, TypeScript, Tailwind CSS v4 and customized shadcn/ui components sit over a shared Rust/libalpm core. The Tauri desktop application and browser workspace use the same inventory and security logic.

**Early public preview.** ArchHub currently targets Arch Linux x86_64 with libalpm
16, including Omarchy. Security evidence stays central: package discovery,
advisories, installed-file checks and static AUR review share one local workspace.
Install and upgrade commands are reviewed terminal handoffs; native authenticated
removal uses an optional separate helper. There is no published AUR package yet.

Source: [Pettersen3008/archhub](https://github.com/Pettersen3008/archhub).
See [contributing](CONTRIBUTING.md), [security policy and known dependency risks](SECURITY.md),
and the [Arch packaging/release checklist](docs/RELEASE.md).

## Run

Requirements: Arch Linux, libalpm 16, `pacman-conf`, GTK3, WebKitGTK 4.1, Rust and Bun. These were available on the development workstation. No system packages need to be changed to run this repository there.

```bash
bun install --frozen-lockfile
bun run dev
```

Open **http://127.0.0.1:1420**. The development script starts Vite and the Rust read-only API on loopback; Ctrl+C stops both. The first run compiles the Rust core. Neither port is exposed publicly.

For the native desktop app:

```bash
# Stop bun run dev first: both development modes use port 1420.
bun run dev:desktop
# Production binary with embedded frontend assets:
bun run build:desktop
./target/release/archhub-desktop
```

The desktop application talks directly to Rust through IPC and needs no HTTP server. A debug desktop binary is also available after `bunx tauri build --debug --no-bundle` at `target/debug/archhub-desktop`.

## Arch packages

Build standard pacman packages from a committed checkout as a regular user:

```bash
bun run release:prepare
cd artifacts/release
CARGO_BUILD_JOBS=2 makepkg --cleanbuild
```

This creates `archhub` (desktop app, CLI, launcher and icon) and the optional
`archhub-helper`. It does not install them. The generated recipe pins its source
checksum. Use a disposable Arch VM for installation/removal verification; see
[build requirements and release gates](docs/RELEASE.md). The optional helper-only
local build below remains available for the existing transaction test harness.

## Workspace

Six main areas keep the dashboard focused: Overview, Packages, Security, Updates,
Maintenance and Activity. Package scopes and security tools live in local tabs. The light
slate/navy design uses compact lists and progressive disclosure; inspection
results and exports retain their complete captured evidence. Existing light/dark
and density preferences are preserved. See [design system](docs/DESIGN-SYSTEM.md).

## What works

- Guided full-system update preparation: capture current repository changes and official Arch notices, review manual interventions and recovery, then copy the supported Arch/Omarchy updater command. Partial, expired, pending, failed or mismatched captures withhold the handoff; complete evidence remains exportable. Upgrades run in your terminal.
- Everyday Maintenance workspace for plain Arch and Omarchy: explicit online repository checks through `checkupdates` in a private temporary database, batch exact-name AUR version checks for installed foreign packages, direct recipe-review handoffs, searchable/paged orphan packages matching `pacman -Qdt`, largest installed packages, configured cache sizes and a copyable `paccache` cleanup preview. Full JSON exports retain capture status; failed/pending checks remain unknown across navigation.
- Removal planning in package details and the orphan list: select up to 100 exact installed versions across filters/pages, prepare plain removal through libalpm, inspect required-dependency blockers, optional feature losses and HoldPkg matches, and export the complete review. Only an unblocked current capture offers a removal command. Pending/failed checks retain unknown state across inspection closure; changed inventory or selection invalidates the command.
- Optional native authenticated removal: confirm exact reviewed versions, authenticate through polkit, and apply once through a root-owned helper. Outcomes remain visible in Activity across navigation and restarts; stale evidence, held packages and required dependencies block application. Install the separate helper package to enable it.
- Copyable install and full-update commands in package details and Maintenance, with removal commands after dependency review. Plain Arch uses coordinated full upgrades; Omarchy keeps its supported update lifecycle. Detected yay/paru helpers provide AUR handoffs. Install/update/cache commands are displayed/copied for the user's terminal. Direct removal uses the optional authenticated desktop helper.
- Real local/sync package inventory, repository priority, installed versions, explicit/dependency state and package sizes through libalpm.
- Ranked package search, repository filters, global explicit-install filtering, bounded pages and virtualized package rows.
- Live AUR search with debouncing, cancellation of stale browser requests, maintained/out-of-date metadata and installed-name matches.
- Package details with dependencies, origin evidence, recorded signature validation and links to upstream/package sources.
- Installed dependency paths with versioned/virtual providers, required and potential reverse paths, optional declarations, missing-provider evidence and snapshot-matched advisories. Search, pagination and full captured JSON exports work in browser, native IPC and CLI.
- On-demand installed-file integrity checks using pacman’s local mtree evidence, including SHA-256, missing files, symlinks and permissions. Configuration differences and unavailable checks stay distinct, with path filters, pagination and JSON exports.
- Advisory checks against the public Arch Security Tracker feed, using libalpm version comparison and explicit coverage, freshness and affected-range limitations. Search packages/advisories/CVEs, page through findings, and carry affected packages into installed or dependency inspection; exports retain the full capture. Pending and failed checks remain unknown across workspaces, including checks started by review-plan creation; successful retries restore the shared evidence.
- Commit-specific, versioned static analysis of PKGBUILD, .SRCINFO and declared installation scripts. Findings identify files and lines for remote shell execution, skipped checksums, dynamic evaluation, privilege escalation, unpinned sources, persistence paths and service activation. Search patterns/files/rules, filter severity and jump to exact captured source lines. No recipe runs.
- AUR source-declaration evidence: per-architecture URLs and ordered checksums, SKIP/legacy/unaligned entries, VCS references, detached-signature associations and signing-key fingerprints. The Sources tab supports search, filters, 25-row pages and exact metadata-line jumps. Source bytes and signatures are not downloaded or verified.
- Saved recipe review notes and complete captured files, shared by the browser and desktop app on this workstation. New commits, file changes or analyzer versions require another review; numbered diffs open exact reviewed/current source context against the saved baseline. Changes also compare newly reported, still reported and no longer reported static findings when analyzer versions match, with captured source links. Literal captured-file search and keyboard match navigation work across source pages in current, reviewed and offline files. Missing scripts and truncated scans cannot be recorded as reviewed.
- Explicit exact-name AUR lookups for installed foreign packages, including split-package recipe bases, version/maintainer evidence and a static-review handoff. Name/version matches remain unverified provenance clues; missing matches and failed lookups are distinct.
- A Recipe reviews workspace with search, offline saved evidence, exports and explicit baseline removal. Explicit row checks show a dated current capture, changed-file/pattern counts and a direct comparison handoff; failed/pending checks stay unknown. Saved reviews are personal inspection records, not install permissions or safety verdicts.
- Installed/repository candidate comparisons with dependency, optional, provides, conflict and replacement changes; declared artifact hashes/signatures; separate installed-version advisories and JSON export.
- Read-only update review plans with package-state revalidation, candidate comparisons, fresh installed-version advisory evidence and listed-fix version context, recovery preconditions and complete JSON export. Failed feeds remain explicitly unknown.
- Recent pacman package history, saved repository packages, keyboard search, local preferences, light/dark/system appearance, compact rows and responsive layouts.
- JSON evidence exports in the browser and native Save As exports in Tauri. Native write permission is scoped to the file selected in the save dialog.

The browser and CLI remain read-only for package operations. The desktop optionally applies reviewed plain removal through the separate system helper; installation and upgrades remain terminal handoffs. Actual removal, failure and recovery paths are tested in a disposable Arch VM. Repository sandboxes and language dependency scanners from the larger workstation roadmap are not implemented here.

Online repository checks and cache cleanup previews optionally use `pacman-contrib`
(`checkupdates` and `paccache`). Missing tools are shown with an installation
command; the inventory/security workspaces remain available. Cache totals are file
lengths, not reclaimable-space estimates. Orphans may still be used directly.

## Enable desktop removal

Build the optional helper package locally; these commands do not install it:

```bash
cargo build --release -p archhub-helper
python3 scripts/package-helper.py
```

The resulting `artifacts/archhub-helper-0.1.0-1-x86_64.pkg.tar.zst` contains only the
helper and its polkit policy. To enable direct removal on a machine where you
intend to use it, install the package deliberately with:

```bash
sudo pacman -U artifacts/archhub-helper-0.1.0-1-x86_64.pkg.tar.zst
```

Then reopen ArchHub, review a package or orphan selection, and choose **Remove
reviewed packages…**. Every attempt requires administrator authentication; no
password is handled by ArchHub. Without a working session authentication agent,
the attempt is rejected. The desktop prevents normal window closure during a task;
Activity shows the latest result and exports its evidence. An interrupted app
session restores an unknown outcome and never retries. The local record lives at
`$XDG_DATA_HOME/dev.archhub.desktop/removal-task.json` (normally
`~/.local/share/dev.archhub.desktop/removal-task.json`); it is personal UI evidence,
not a signed transaction log. Pacman's log and refreshed inventory remain the
system evidence.

Direct removal currently supports the default root, database and log paths, with
root-owned selected metadata and hook definitions. Scripts/hooks may have additional
or partially completed effects, and external executables/data they consult are not
frozen by the review. ArchHub does not automatically remove stale locks or undo
script effects. See [security boundaries](docs/SECURITY.md) and the reproducible
[transaction VM harness](scripts/transaction-vm.py).

## CLI

```bash
bun run cli doctor                 # machine/package metadata, JSON
bun run cli maintenance            # orphans, largest packages, cache sizes, available tools
bun run cli removal-plan firefox   # read-only dependency-checked removal; multiple names accepted
bun run cli prepare-update         # repository changes + official Arch notices; no upgrade
bun run cli check-updates          # online configured-repository versions; isolated database
bun run cli check-aur              # explicit batch AUR name/version lookup for foreign packages
bun run cli packages pacman        # installed matches, first 200
bun run cli search firefox         # all repository matches, first 100
bun run cli audit                  # real advisory evidence
bun run cli foreign-recipe antigravity # explicit lookup; requires installed foreign package
bun run cli compare pacman         # installed versus preferred repository metadata
bun run cli dependencies pacman    # installed requirements and potential consumers
bun run cli integrity pacman       # installed files versus local metadata
bun run cli recipe visual-studio-code-bin
bun run cli reviews                # saved review summaries
bun run cli review visual-studio-code-bin # complete saved evidence, if present
bun run cli history                # last 300 package events
bun run cli updates                # complete read-only version-change plan
```

A zero-finding advisory check does not establish that a system is secure. Packages absent from configured repositories are **foreign / unknown origin**, not automatically AUR. Signature evidence records pacman's installation-time metadata. A separate explicit File integrity check compares installed files with local metadata; it does not authenticate that reference or establish safety. Package updates reflect local databases, whose timestamps remain visible. Dependency paths describe installed metadata and possible providers; they do not establish runtime reachability or removal safety. Static scans are textual heuristics, not complete shell analysis or malware detection.

Recipe reviews are stored in `$XDG_STATE_HOME/archhub/recipe-reviews-v1` (normally `~/.local/state/archhub/recipe-reviews-v1`), with private directories/files, atomic writes and a shared file lock. Up to 40 latest baselines are retained; saving a new review for a package replaces its previous baseline. Export a baseline before replacing it if you need a longer history. Explicit scans finish across route changes and inspection closure. Failed or pending checks leave current state unknown; reconnecting does not start another scan. Review acknowledgment is available only for a complete current capture and applies to its exact commit, digest and analyzer version. Scanning alone does not save a review. The scanner limits each file to 512 KB, each bundle to 2 MB, install references to six, findings to 2000 and overall scan time to 45 seconds. See [recipe review design and verification](docs/RECIPE-REVIEW.md).

## Verify

```bash
bun run check
bun run build
bun run test
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
bun run bindings
```

Playwright defaults to `/usr/bin/chromium` on this workstation. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for another Chromium installation. Run the same suite in Playwright's bundled Firefox with `bun run test:firefox` (install its matching browser first with `bunx playwright install firefox`). `PLAYWRIGHT_BROWSER` accepts `chromium` or `firefox`; Firefox ignores Chromium-specific flags and paths. Each command tests the selected engine without automatic fallback. See [browser verification](docs/BROWSER-VERIFICATION.md) for the local Chromium capture investigation and independent results.

The suite covers real API/browser flows, hostile inputs, network-failure UI, persistence, exports, keyboard navigation, responsive screenshots and automated WCAG checks in both themes. When reusing the development server, stop source/document edits and builds during tests: watched-file changes can reload a page and clear its inspection state. Live AUR/advisory tests require those services to be reachable. Rust tests use fixtures, including a real pacman check against an isolated temporary root and database; the host package state is unchanged.

Native debug verification:

```bash
bunx tauri build --debug --no-bundle
archhub_smoke_state=$(mktemp -d)
XDG_STATE_HOME="$archhub_smoke_state" ARCHHUB_SMOKE_TEST=1 ./target/debug/archhub-desktop
# After closing the probe, remove its empty temporary state directory.
rmdir "$archhub_smoke_state"
```

The opt-in debug hook verifies actual WebKit rendering and native IPC, rejects a malformed recipe identifier, checks installed-file evidence and the File integrity workspace, inspects installed dependency paths and their workspace, rejects stale dependency versions, fetches real pinned AUR source evidence and renders its Sources tab, verifies captured-file search with retained input focus, verifies the static rules version and rejects stale analyzer review requests, checks that an unselected filesystem path is denied, and exports sample evidence to `artifacts/native-smoke-evidence.json`. Use isolated state for those negative review-write probes. Optional `ARCHHUB_SMOKE_CHANGES=1` verifies saved-row rechecks and direct comparison handoff, static finding comparison, reviewed/current source links with focus return, diff jumps and source search against an explicitly seeded synthetic baseline in that isolated directory; see [recipe verification](docs/RECIPE-REVIEW.md). Optional `ARCHHUB_SMOKE_RECIPE_LIFECYCLE=1` with `ARCHHUB_SMOKE_CHANGES=1` verifies pending scans across navigation, controlled IPC failure, disabled acknowledgment, failure on reopening and an explicit real-source retry in that isolated state. The evidence file is written only after all checks pass. The source probe requires AUR connectivity. The hook is excluded from release builds. The native file-picker UI itself is not automated.

See [design system](docs/DESIGN-SYSTEM.md), [captured-file search](docs/RECIPE-SOURCE-SEARCH.md), [finding comparison](docs/RECIPE-FINDING-CHANGES.md), [security boundaries](docs/SECURITY.md), and [implementation evidence](docs/IMPLEMENTATION.md).

For repeatable local CI checks without live AUR/advisory feeds, run
`bun run test:release`. The full Firefox suite and native/transaction probes are
additional release checks. `bun audit` and `cargo audit` report language dependency
advisories; current upstream GTK warnings are documented in [SECURITY.md](SECURITY.md).

Licensed under [GPL-3.0-only](LICENSE). Bundled font notices are retained in
[third-party licenses](LICENSES/README.md).

Browser suites share development services. Run them sequentially, or give concurrent
runs separate `--output` directories and reporters. Finish source edits and binding
exports before verification. Tailwind scans only `src/`; Markdown/Rust edits do not
invalidate the running frontend.
