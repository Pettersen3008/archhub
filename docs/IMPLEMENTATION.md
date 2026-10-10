# ArchHub first release

Scope: a functional local security-focused package dashboard and native desktop app. The current WORKSTATION-PLAN Phase 4 guides the scope. Package writes require a separately reviewed root helper and disposable VM verification; this release provides evidence and exportable plans.

- [x] Explore: greenfield repository; plans and actual libalpm/config/network interfaces inspected.
- [x] Design: shared Rust core, thin Tauri IPC and loopback browser adapter; generated Specta domain/request types.
- [x] Implement: real inventory, official/AUR search, detail, security advisory matching, static AUR scans, history, plans, settings.
- [x] Review: concurrency, untrusted identifiers/content, provenance claims, stale-data behavior, accessibility.
- [x] Verify: Rust tests/Clippy/format; frontend lint/type/build; real CLI/API; browser interaction, responsive screenshots, native build.

Data flow: pacman-conf resolves configuration once per snapshot; libalpm reads local and configured sync databases on a blocking worker. An owned index handles ranked, bounded package queries. Network reads use fixed AUR/Arch endpoints. Package operations remain read-only; personal review records and scoped exports are the only writes. Neither transport exposes a generic shell or package mutation request.

Alternative: a browser-only service would simplify builds but diverge from the planned desktop app. The shared core supports a browser preview without duplicating package logic. Specta generates contracts independently of Tauri so CLI, HTTP, and desktop remain aligned.

Design: graphite text, warm pale backgrounds, forest accent, amber for review, vermilion for findings. Manrope headings, DM Sans body, IBM Plex Mono evidence. Compact rows, large clear page headings, restrained radii, generous whitespace. Tailwind v4 tokens customize shadcn Radix primitives. No bitmap artwork is needed for a package/security workbench.

Failure paths: unavailable native DB, missing sync DB, package lock, stale plan fingerprint, remote timeout/challenge, malformed recipe names and oversized recipe files. Foreign installed packages remain local/unknown, never inferred to be AUR. Advisory freshness and incomplete ranges are explicitly unknown. Signature metadata records pacman's validation at install time, not a new verification of files. Static scanning is textual and reports limits.

## Review verdict

Confirmed defects fixed before completion: native exports originally used browser download behavior; scoped Save As exports now use the standard dialog/filesystem plugins. Mobile navigation could receive focus while off screen; it is now invisible until opened. Explicit-install filtering originally applied within a page; it now queries the entire Rust index. Advisory filter controls originally used tabs without panels; they now use pressed-state filter buttons. Secondary text contrast and local panel text inheritance were corrected in both themes. Update lists expose subsequent pages rather than silently stopping at the first 100. Stored preferences are validated. Vite ignores build/test artifacts to prevent spurious reloads during verification.

Resource/access review: remote JSON/build-file reads and local log tails are bounded. Redirects remain on the permitted metadata hosts. Development API rejects unapproved Host/Origin and cross-site fetch metadata. Recipe inputs reject path/shell syntax. Update plans reject stale fingerprints and package locks. No package-manager mutation or generic shell interface exists. Native writes require a selected file scope; an actual unselected-path write was denied during the debug smoke check.

Current accepted limits: advisory publication freshness/complete ranges are unknown; static scans are textual and exclude downloaded sources, patches and generated files. Captured recipes and declared install scripts are pinned to one commit. Installed-file checks compare with unauthenticated local metadata. Privileged package actions, repository sandboxing, language-dependency scanners and malware detection remain outside this release. No destructive transaction or VM test was run because no mutation path exists. Automated accessibility checks cover both themes but do not replace human assistive-technology testing.

## Verification evidence

- Frontend: strict typecheck, Oxlint, Oxfmt and Vite production build pass. Pages are loaded on demand; the initial JavaScript chunk is approximately 302 KB before compression.
- Rust: seven fixture-based unit tests pass, including version boundaries, foreign-package exclusion, uncertain tracker status, scanner line evidence, injection rejection and history redaction. Workspace Clippy runs with warnings denied and rustfmt passes.
- Browser: 19 Playwright tests pass, including eight automated WCAG A/AA checks across light/dark overview, security, package library and settings. Functional tests use live inventory, advisory and AUR endpoints; failure behavior is explicitly injected in a separate test.
- Native: debug and optimized desktop builds succeed. The WebKit app was opened and visually inspected. The opt-in smoke hook exercised real Tauri inventory/search IPC, malformed recipe rejection, a denied unselected write, and a successful scoped JSON evidence export. Native file-picker clicks are not automated.
- Live evidence on this workstation: 1,100 installed packages, 180 explicit packages, four foreign packages and 38 outside nominal official advisory coverage. Local sync databases include stale timestamps. A real visual-studio-code-bin scan flagged its separate installation script with line evidence. These are observations from 2026-10-05, not baked-in expected results.

Artifacts: overview-light.png, overview-dark.png, security-mobile.png and native-current.png in artifacts/. Native smoke evidence stays local and contains inventory metadata. Playwright HTML report and traces are generated in ignored directories.

## Commit-specific AUR review

The next security slice adds pinned recipe bundles, installation-script analysis,
saved personal review baselines and a dedicated Recipe reviews workspace. The
Rust core resolves one AUR commit and fetches all captured files at that commit;
React displays file/line findings, source pagination, bounded diffs and explicit
review notes. HTTP, CLI and native IPC use the same generated contracts and local
review store. Package state remains read-only.

Review defects corrected: incomplete fetches could be represented as file
deletions; full comparison is now unavailable until coverage is complete. Finding
allocation is capped during scanning, scans have a deadline and concurrency
limit, and source/finding views are paged. Repeated clicks on a finding jump back
to the correct source window. Shared header actions wrap on narrow screens.
Corrupt records and unsafe file references cannot become reviewed. Atomic writes
and a shared filesystem lock protect records across browser/native processes.

Verification: 18 fixture-based Rust tests and 26 Playwright tests pass, together
with workspace Clippy/Rustfmt, frontend types/lint/format and the optimized native
build. Browser coverage includes full review save/reload/export/removal, changed
commits, incomplete scripts, failed remote fetches, large paged evidence, and
WCAG checks of the review/source/diff views in both themes.

A real private HTTPS browser run fetched visual-studio-code-bin's pinned install
script, independently recomputed file/bundle SHA-256, saved a clearly labeled
automated test record, reloaded it, and read the same record through an independent
CLI process. Stale commit, untrusted Origin and cross-site requests were rejected.
The temporary automated record was removed; existing user records were preserved.
Evidence: artifacts/tailscale-recipe-evidence.json and
artifacts/tailscale-pinned-install-script.png. The native review workspace also
renders in WebKit and its typed review-list command reads shared workstation
state; the opt-in native hook still verifies malformed input and denied file scope.

Accepted limits: reviews are personal, editable records, not signed audit logs or
installation authorization. One latest baseline is retained per package base;
concurrent reviews of the same snapshot replace that baseline rather than merging
notes. Export prior evidence when retaining history matters. Upstream sources,
patches, generated/dynamic scripts and dependencies remain outside static coverage.
Installed-file integrity is completed in the next section; sandboxed language
dependency auditing remains a later roadmap slice. No privileged package actions or host configuration were added.

## Installed-file integrity

An explicit File integrity workspace now compares one installed package with
pacman's local mtree evidence, using its existing SHA-256, type, symlink,
ownership, permission, size and timestamp checks. The package trust sheet and
Security workspace link to it. Changed package paths, ordinary backup/config
changes, and unavailable checks are grouped separately, with filters, search,
100-path pages and full JSON export. Nothing is repaired or elevated.

The shared core validates the current installed version, checks observed database
locks, and fingerprints local desc/files/mtree and expanded configuration before
and after the check. It runs a fixed query command without a shell, permits one
check per service, caps each captured stream at 2 MB and stops the child after
90 seconds. Unknown diagnostics and inconsistent summaries remain incomplete.
Missing/permission-altered backup files stay ordinary changes rather than being
categorized as routine configuration differences. Failed attempts clear previous
UI evidence; scans are explicit again after reload. An explicit inventory refresh
recovers stale-version failures without a page reload.

Verification: 24 Rust tests and all 34 Playwright tests pass, together with
workspace Clippy/Rustfmt, frontend types/lint/format, production frontend build
and optimized native build. The new isolated root/database fixture uses real
pacman to detect equal-size changed content, missing files, a modified backup
file and changed symlink without touching host package state. Process tests prove
output/deadline bounds. Browser checks cover real selection/check/export, failures,
identity rejection, large evidence pagination, light/dark WCAG and mobile layout.
The responsive test waits for viewport layout to settle before checking overflow.

The real private HTTPS flow inspected filesystem: 127 mtree entries, two ordinary
changed paths, seven configuration-difference paths and six unavailable paths.
The result correctly remained incomplete. Untrusted Origin/cross-site requests
were rejected with 403. A debug-only native probe also rendered this workspace,
clicked its check action, received real evidence through IPC, rejected a stale
version, and retained the scoped-export check. Artifacts:
artifacts/tailscale-integrity-evidence.json, artifacts/tailscale-integrity.png,
artifacts/integrity-live.png, artifacts/integrity-light.png,
artifacts/integrity-dark.png and artifacts/native-smoke-evidence.json.

These checks use a local, unauthenticated reference and do not freeze the
filesystem. Pacman's entry/altered counts have different meanings and cannot
serve as a safe-machine score. See FILE-INTEGRITY.md and SECURITY.md.

## Installed dependency paths

The Dependency paths workspace inspects the installed version's local required
closure, possible reverse dependents and optional declarations. It records every
matching installed provider, including versioned virtual provides, rather than
using the available repository candidate's declarations. Paths are searchable,
filterable to direct edges, paged at 50 rows and navigable to another root.
Package details label candidate declarations and link separately to installed
paths. Full bounded evidence exports include snapshot identity and advisory state.

An owned index is captured with inventory on a blocking worker. Matching uses
libalpm's version comparator and canonical satisfier validation. Breadth-first
traversal handles cycles/diamonds, chooses one shortest path per package and caps
each direction at 1000 nodes and 12 edges. Missing required declarations are
capped at 5000 and mark coverage incomplete. Installed metadata, install reason
and validation bits join the inventory fingerprint. No extra CLI dependency,
unsafe libalpm access, package writes or remote inventory submission was added.

Review fixes: required missing-provider labels no longer depend on the selected
Optional tab. Failed forced advisory refreshes invalidate cached correlation.
Fingerprints and related findings' installed versions must both match before
correlation or export. Advisory cards include severity and source links; missing
and truncated evidence is visible. Core tests cover versioned providers,
alternatives, optional descriptions, cycles/diamonds, reverse paths, bounds and
stale/uninstalled/injected identities. Temporary dependency fixtures now use a
process-wide sequence plus exclusive directory creation to prevent parallel test
collisions; 20 repeated parallel dependency test runs passed after this fix.

Verification: all 29 Rust workspace tests and all 42 Playwright tests pass.
Workspace Clippy with warnings denied, Rustfmt, frontend types/lint/format and
production frontend build and optimized native build pass. The updated release
app is running. The first full browser run was interrupted by a
page reload during concurrent native building; a complete run with builds stopped
passed all 42 tests. Both themes and 390px layouts are covered. The debug native
probe rendered actual dependency evidence through WebKit/IPC, rejected a stale
version and retained the denied unselected-path export check.

A real private Tailscale HTTPS flow refreshed inventory and inspected pacman:
107 required paths, seven possible reverse dependents, 18 direct declarations,
two optional declarations, no captured missing providers, complete traversal and
matching advisory snapshot. These are workstation observations on 2026-10-05,
not expected constants. Exported graph fields and fingerprint matched an
independent CLI process. Reverse/optional navigation, explicit reinspection after
reload and JSON export worked; untrusted Origin/cross-site requests returned 403
and stale package versions returned 400. Evidence:
artifacts/tailscale-dependencies-evidence.json,
artifacts/tailscale-dependencies.png and artifacts/native-smoke-evidence.json.

Accepted limits: installed metadata is cached and capture is not atomic; short
transactions can go unobserved. Provider alternatives can overstate an actual
runtime choice. Paths do not prove vulnerable-code reachability or safe removal.
Build, bundled and language dependencies and optional expansions remain outside
coverage. Privileged package actions and repository sandboxing remain later work.
See DEPENDENCY-PATHS.md and SECURITY.md.

## AUR source declaration evidence

A Sources tab extends commit-specific recipe inspection with literal download/local
source declarations, architecture groups, ordered checksum values, VCS references,
signed-checkout requests, possible detached-signature associations and signing-key
fingerprints. Search and kind/review filters cover the whole capture; source,
key and unassigned-checksum lists use 25-row pages. Exact .SRCINFO line actions
return to and focus the numbered file view. Exports retain the full bounded
analysis and captured raw files despite display filters.

A pure shared Rust analyzer never executes a recipe or downloads its declared
upstream files. Checksums pair within the same architecture group and only when
array lengths agree. SKIP, legacy algorithms, malformed values, incompatible
sections and unsupported VCS transports/reference kinds are explicit. Full Git
commit references and key fingerprints remain declarations, with no authenticity
or verified-byte badge. Extraction completeness is separate from captured-file
coverage and personal review status. .SRCINFO may still disagree with PKGBUILD.

Old saved review JSON remains compatible. Reads validate captured bytes then
recompute versioned source evidence, preserving files, bundle/commit identity,
notes and original timestamps without rewriting records. Forged derived fields
are overwritten in the returned analysis. Failed current fetches retain explicit
unknown current state. Unsaved previous captures are now labeled separately from
saved baselines in the UI and exports.

Verification: 38 Rust workspace tests and all 50 Playwright tests pass, with
frontend type/lint/format/build and workspace Rustfmt/Clippy. New fixtures cover
architecture alignment, all supported checksum syntaxes, invalid/misaligned/SKIP
values, VCS reference/query forms, renamed and ambiguous signatures, section
contamination, old-record migration and bounds. Browser checks cover a real pinned
AUR capture/export/line jump, full-capture pagination/filter exports, key and
unaligned values, failed refreshes, missing/empty/partial evidence, both-theme WCAG
and 390px overflow. Fixture setups reset the document between same-route scenarios
so an open dialog cannot prevent the next scenario's selection.

The real private Tailscale browser flow inspected visual-studio-code-bin at commit
d58e44cf0847ddc5dc939fb5204847adfe53d5f1: four sources, one common local file and
three architecture-specific downloads with corresponding SHA-256 declarations.
Extraction was complete; source bytes remained unverified. The .SRCINFO digest and
all source/checksum line references were independently checked. Commit, bundle
identity and the entire derived evidence matched a separate CLI process. Browser
requests stayed on the preview origin, hostile Origin/cross-site requests returned
403 and malformed recipe identifiers returned 400. No review record was written.
Artifacts: artifacts/tailscale-source-evidence.json, artifacts/tailscale-sources.png,
artifacts/tailscale-sources-mobile.png and theme-specific recipe-sources mobile
captures. These are observations from 2026-10-05, not expected source counts.

The debug native WebKit probe also queried real recipe/source IPC and rendered the
Sources workspace with its unverified-byte status. Installed-file/dependency,
stale-identity and denied unselected-path export checks remained intact. The probe
was corrected to dispatch Radix's mouse activation event before programmatic tab
clicks. Updated evidence is in artifacts/native-smoke-evidence.json. Debug and
optimized desktop builds pass.

Accepted limits: source contents, detached signatures, signer identity/trust,
expiry/revocation and actual checkouts are not verified. Filename-based signature
associations can be ambiguous and build-time changes can invalidate declarations.
Metadata/recipe agreement is unknown without executing the recipe, so this is an
inspection tool rather than an enforced build policy. Repository tooling remains
deferred until its sandbox contract works. See SOURCE-EVIDENCE.md and SECURITY.md.

## Repository candidate review

Updates now compares installed metadata with the preferred configured repository
candidate, including required/optional/provides/conflicts/replaces declarations,
architecture, historic installation validation and declared artifact metadata.
Comparisons also work when versions are equal or older. Metadata-only and
embedded-signature declaration changes invalidate snapshot fingerprints. The
shared typed Rust request forces an inventory reload and rejects malformed,
foreign/missing, stale and locked requests; CLI compare uses the same path.

The interface keeps installed-version advisory checks separate. Exact snapshot
and version matching is required, and failed forced advisory or inventory
refreshes invalidate current correlation, including exports. No candidate safety
verdict is inferred from listed fixes or unchanged metadata. Plan exports retain
the full version inventory and up to 100 bounded candidate comparisons, with
explicit completeness/omitted counts. Package disclosures render their details
when opened to keep large plans practical.

Verification: 42 Rust tests, 58 Playwright tests, types/lint/format/build, workspace
Rustfmt/Clippy, native WebKit probe and optimized desktop build pass. All final
full-suite browser tests passed on their first attempt. The private Tailscale
comparison/plan flow matched CLI metadata and preserved same-origin boundaries.
The existing preview mapping was reused and its stopped loopback preview process
was restored. The optimized native window was refreshed. Artifacts and accepted
limits are documented in CANDIDATE-REVIEW.md; no package or host configuration
was changed. The preview remains temporary and private.

## Compact security workspace redesign

The user-selected light slate/navy palette now anchors a compact Tailwind and
shadcn/Radix interface. Five primary areas replace the crowded sidebar; local
package/security navigation preserves existing deep links. Overview prioritizes
actual review items, while Updates separates version changes and comparison.
Supporting metadata and interpretation notes use disclosures, with incomplete,
stale and unauthenticated evidence limits remaining visible beside results.
Package rows have one detail action and supported bookmarks. Existing appearance
preferences persist; new sessions start light and compact.

Comparison state survives tab changes, and a failed forced advisory refresh
invalidates current results and exports. Mobile navigation traps focus, closes on
Escape and restores the trigger. Full exports retain collapsed evidence.

Verification: all 64 browser tests and 42 Rust tests pass, alongside frontend
types/lint/format/build, Rustfmt/Clippy, the native WebKit probe and optimized
desktop build. The running desktop was refreshed, and real inventory/comparison/
scan/export workflows passed through the private Tailscale preview. Both-theme
accessibility checks and 390px layouts pass. See REDESIGN.md and DESIGN-SYSTEM.md
for the design decisions, evidence and remaining validation limits.

## Security evidence in update plans

Update plans now attempt a fresh installed-version advisory capture and compare
each configured candidate with the tracker-listed fixed version using libalpm.
This retains findings for packages without updates and distinguishes candidates
below a listed fix or findings with no listed fix. An unavailable feed produces
explicit unknown evidence while keeping local version/metadata review exportable.
Neither a listed fix nor zero matches establishes candidate safety.

Plan creation reloads and revalidates local package state after network work.
Failed forced audits clear backend success across clients; plan results update or
clear the browser's shared audit cache. The existing plan dialog renders 25
findings per page, supports package/advisory/CVE filtering for larger captures,
and exports every captured finding and the complete audit. Old plans without
security evidence remain explicitly unchecked. Open plans warn about changed or
unavailable inventory.

The native WebKit probe renders the new plan section and verifies matching IPC
evidence; prior source/comparison/file/dependency and denied-export checks pass.
The optimized desktop was rebuilt and refreshed. The private Tailscale browser
export matched independently captured CLI candidate context, kept all requests
on the same origin, and rejected hostile origins/cross-site requests (403) and
stale plans (400). Live evidence on 2026-10-05 contains zero matches across 1062
checked packages, with 38 outside coverage; these are observations, not fixtures
or a safe-machine score. See PLAN-SECURITY.md and
artifacts/tailscale-plan-security-evidence.json for verification and limits.

Final validation passes all 71 browser tests and 48 Rust tests, frontend
types/lint/format/build, workspace Rustfmt/Clippy, native WebKit and the optimized
desktop build. Both-theme plan accessibility and 390px layouts pass. The final
full suite needed no retries after adding explicit theme/font/data readiness to
the existing overview accessibility check.

## Foreign package recipe investigation

Installed foreign packages now have an explicit exact-name AUR lookup in Origin
& trust. It shows the returned recipe base, maintainer/out-of-date metadata and
libalpm version relation, then hands off to the existing pinned static workbench.
Split packages inspect their recipe base, not an inferred same-name base. No
match is a successful metadata observation; failed/malformed responses stay
unknown and clear previous lookup/scan state. Name/version agreement never proves
installed provenance. The lookup is near the top of the foreign trust view;
repeated generic origin/review instructions were removed there.

The core validates current foreign classification, version, fingerprint and
observed locks before and after remote work. Only the selected name is sent to
AUR. Metadata streams stop at 64 KB; malformed counts/types, duplicate/different
results, unsafe base identifiers, invalid versions and date bounds fail closed.
Lookup requests share the three recipe slots and existing 20-second timeout.
Hidden trust tabs retain state, and changed/unavailable inventory disables recipe
handoff. Lookup exports keep capture identity and current-state status; recipe
exports remain separate pinned evidence. No installed-origin record is persisted.

The private HTTPS browser looked up antigravity (installed 2.17.0-1, AUR metadata
2.19.1-1 on 2026-10-05), exported evidence matching an independent CLI process,
then captured a static scan of the matched antigravity recipe. The native WebKit
probe renders the lookup and recipe handoff and rejects stale versions, retaining
existing plan/source/comparison/file/dependency/scoped-export checks. Hostile
Origin/cross-site requests return 403; stale/injected identities return 400. Live
metadata is an observation, not a fixture or verified installation origin.
Artifacts: tailscale-foreign-recipes-evidence.json, native-smoke-evidence.json,
tailscale-foreign-recipes.png and theme/mobile captures under artifacts.
See FOREIGN-RECIPES.md for design, verification and limits.

Verification passes 52 Rust tests, frontend types/lint/format/build, Rustfmt/Clippy,
both-theme 390px/WCAG checks, the native probe and optimized build. All 79 browser
tests passed in the first full run. The final layout run passed 78, with one
existing live source scan interrupted by a page reload; its isolated rerun passed
after build/window activity stopped. The reload cause is unconfirmed and its
trace is retained; no test assertion was weakened. The new lookup flows all pass
on the final layout, including real service and private browser/CLI agreement.

## Advisory investigation

The compact advisory workspace now searches packages, advisory IDs, titles,
descriptions, CVEs and versions. It renders 25 findings per page and retains every
captured finding in the existing JSON export. Search/filter changes and successful
refreshes restart paging; smaller evidence captures cannot strand the view on an
empty page. Finding actions carry the selected package into the existing installed
and dependency workspaces. Query deep links are supported, complete CVE evidence
is visible, and missing tracker URLs no longer create no-op clickable rows.

The existing inventory/failure gate still controls findings, result counts,
inspection actions and exports. Filtered empty results are distinct from zero
captured matches. No IPC, persistence or host/package mutation was added.

All 86 browser tests, frontend checks and the optimized desktop build pass. The
existing native WebKit probe passes, and the updated desktop and private preview
are running. Real HTTPS evidence agrees with an independent CLI capture and
retains same-origin request boundaries. See ADVISORY-TRIAGE.md for design,
verification artifacts, live evidence and validation limits.

## Static finding inspection

Static findings now have local pattern/file/rule search, a high/critical filter
and 25-row pages. Display filters leave captured findings and exports intact.
Clicking a finding scrolls its exact line into view inside the existing source
window, focuses source context and describes the selected file/line. Repeated
jumps work after manual paging. Selection is tied to the captured commit/digest;
new captures clear prior line context and smaller finding captures clamp paging.
Missing/out-of-range locations cannot fall back to unrelated files. Legacy
findings without file metadata still use PKGBUILD when the line exists.

A regression first demonstrated the original issue: line 450 existed in the
correct source window but had viewport ratio zero. It now becomes visible. All
89 browser tests pass, with both-theme mobile/accessibility coverage, alongside
frontend checks, Rustfmt/Clippy and the optimized desktop build. The extended
native WebKit probe verifies focused, visible code for a real static finding.
The private preview matches independently captured CLI commit/digest/findings
and preserves full evidence after search. The updated desktop and private preview
are running. See RECIPE-REVIEW.md for artifacts, review decisions and limits.

## Versioned static rules

Checksum findings now recognize exact literal SKIP entries in supported PKGBUILD
checksum declarations, including multiline, appended and architecture arrays.
Benign skip descriptions, URLs and comments no longer trigger that rule; a
skipinteg comment cannot hide a genuine literal entry. Remote shell pipeline
detection requires an exact sh/bash/zsh basename, supporting absolute paths while
excluding sha256sum, shred and similarly named consumers. The bounded recognizer
leaves escaped/dynamic expressions uninterpreted and does not parse shell context.

Captures, exports and saved summaries carry the static ruleset version. Matching
files with differing or missing baseline versions require findings review again.
Legacy captures preserve their recorded findings, notes and original storage bytes
on read. Saving requires the displayed version to match the service's cached scan
alongside commit/digest, rejecting stale clients before writes. This identifies
analysis changes without authenticating the capture or creating a safety verdict.

All 91 browser tests and 59 Rust tests pass, alongside frontend checks,
Rustfmt/Clippy and optimized/debug desktop builds. The native WebKit probe renders
rules v1 and rejects missing/mismatched version saves with isolated empty state
storage. Real private HTTPS exports agree with CLI and independent API captures,
retain full evidence after filtering and show exact source context at 390px.
Origin boundaries remain enforced. Earlier Chromium network-change interruptions
are retained; the final fresh browser run has no failed requests. The rebuilt
desktop and private preview are running. See RECIPE-REVIEW.md for verification
artifacts and remaining heuristic limits.

## Changed-line source context

Recipe diffs now show reviewed/current line numbers that open full captured source
in the existing Changes tab. The single pane identifies side, file and commit;
its selected line is visible and focused, including later 400-line windows.
Return to diff restores keyboard focus. Added/removed files expose only their
captured side, and unavailable/malformed locations remain noninteractive.

The saved record must match the comparison baseline's identity before it can
supply reviewed context. Reload saved evidence recovers a mismatched cached
record; coordinates independently require exact captured text. Refreshed capture
identities reset source selection. Truncation warnings and complete JSON exports
remain intact. A failed recheck also distinguishes retained newer analysis from
an older saved capture when their files match. No core request, persistence format,
recipe execution or privileged package action was added.

Browser verification covers multiple hunks, late jumps, added/removed scripts,
out-of-range/malformed/text-mismatched previews, replaced baselines, keyboard return,
failed/incomplete captures, full exports and both themes at 390px. Native WebKit
opens exact reviewed/current lines using a synthetic baseline in isolated state;
its original record remains unchanged. Private HTTPS assets replay that Rust/native
comparison for UI verification; real AUR/current-capture requests separately agree
with native and CLI identities. The distinction is explicit in the artifacts.
See RECIPE-REVIEW.md for final checks, interruption evidence and fixture limits.

## Independent browser verification

The runner now accepts an explicit Chromium or Firefox selection. System Chromium
remains the default; `bun run test:firefox` uses Playwright's matching Firefox
revision without Chromium-specific paths/flags. Both engines collect the same 95
tests. Invalid selection fails immediately and engine failures do not fall back.
Application source, assertions, accessibility rules and screenshots are unchanged.

All 95 tests pass through the final Firefox command without retries/skips,
including the changed-line source workspace and both-theme mobile/WCAG checks.
Real private HTTPS static-scan/source/export evidence also matches an independent
CLI capture, with same-origin requests, rejected hostile origins and no browser
or network errors. Frontend checks pass; native/core builds and tests were not
repeated for this runner-only change. The existing desktop and preview remain
running. Chromium capture crashes and an earlier Firefox panel interruption
retain their evidence and unconfirmed causes. See BROWSER-VERIFICATION.md.

## Captured-file search

The shared source viewer now has case-insensitive literal search, matching-line
counts and next/previous navigation across every 400-line window. Enter and
Shift+Enter wrap through matches while preserving input focus. Repeated text in
one line counts once; regex punctuation remains literal. File/commit/bundle
changes reset search. Reviewed/current and offline saved source remain separate,
and exports retain complete bytes regardless of search or paging.

Review caught and fixed a selected-match clipping defect; the search section
and inner code viewport now scroll together while preserving input focus.
All 97 Firefox tests and both focused system-Chromium search flows pass. Native
WebKit verifies real source search plus reviewed/current contexts with an isolated
synthetic baseline whose bytes remain unchanged. The real private HTTPS capture
agrees with the CLI, retains same-origin boundaries and has no browser/network
errors. Debug/optimized builds and frontend/Rustfmt/Clippy checks pass. The latest
desktop and private packed preview are running.

An initial 96/97 run lost dependency inspection state to a development-page reload
after a README edit. A controlled WebSocket probe confirms that edit trigger;
the final full run passes with watched-file activity stopped. Earlier Firefox
panel-interruption traces also contain a second document load. Chromium's
Compositor screenshot crashes remain separate unresolved evidence. See
RECIPE-SOURCE-SEARCH.md for verification and preserved traces.

## Static finding comparison

Recipe Changes now compares newly reported, still reported and no longer reported
observations using matching versioned analyzers and exact saved-baseline identity.
Rule, file, exact line text and scanner metadata match independently of line
movement; duplicate occurrences consume one match each. Incomplete, unknown or
unmatchable evidence withholds counts. Search covers current and reviewed IDs,
25-item pages bound lists, and source actions inspect each captured snapshot with
keyboard focus return. IPC, persistence, exports and analyzer rules are unchanged.

All 105 Firefox tests pass with no retries/skips/flaky results. Both new flows pass
in system Chromium. Frontend checks, Rustfmt/Clippy, project debug/optimized builds,
native WebKit and real private HTTPS checks pass. The native comparison uses a
labeled synthetic review in temporary XDG state and leaves it unchanged; HTTPS
comparison replays that isolated Rust response while a separate live request
matches the native current capture. No personal review is written. The current
desktop and private packed preview are running. Full design, review findings,
regressions, artifacts and limits: RECIPE-FINDING-CHANGES.md.

## Saved-review rechecks

Goal: check one saved recipe directly in the existing review list and open its
comparison without an extra fetch. Done means requests are explicit, the row
shows a dated capture result, failed/pending/mismatched checks withhold conclusions,
and the saved review remains unchanged. Existing scanner, origin protections,
read-only package boundaries and full evidence exports remain authoritative.

- [x] Explore saved rows, shared query keys, scanner status and baseline identity.
- [x] Define row ownership, cache handoff and uncertainty gates.
- [x] Reproduce the missing action and implement row checks/comparison handoff.
- [x] Review failure, concurrent record replacement and request boundaries.
- [x] Verify browser/native/private preview, mobile/accessibility and exports.

A row subscribes to the existing recipe query with automatic fetching disabled.
Its explicit recheck shares that cache with RecipeWorkbench; a new optional
initialPanel selects Changes when opening a complete matching comparison. Row
results require the inspection's saved-baseline identity to match the list record.
The shared identity helper covers package, commit, digest, scan/review times
and analyzer version for both summaries and full saved records. Pending checks
and errors hide earlier conclusions. A replaced/removed baseline asks for Refresh
records; refresh reads saved records only. Timestamps describe captured evidence,
not continuous remote monitoring. No new persistent state or transport is added.

Alternative: automatically scan every saved record or add a bulk queue. Explicit
per-row checks keep network cost under the user's control and use existing scanner
capacity/failure handling, with fewer controls in the compact workspace.

Verification: deferred response proves pending behavior/no automatic request;
changed and matching snapshots, failed recheck/retry, incomplete coverage, legacy
analyzer, concurrent record replacement, direct Changes handoff without a second
fetch, full saved export equality and zero review writes. Both themes/390px WCAG,
full Firefox and focused Chromium flows, packaged native builds/WebKit and private
HTTPS evidence with isolated synthetic saved records complete verification.

Review corrected two confirmed freshness/presentation defects: the comparison
briefly called a pending saved-record read a mismatch, and RecipeWorkbench kept a
current label during a pending recheck of cached evidence. Pending record reads
now show neutral loading text; pending current captures show unknown status and
withhold comparison conclusions. Deferred-response regressions reproduce both
issues (review-row-loading-before.log / -trace.zip and
review-row-pending-before.log / -trace.zip). The missing row workflow is recorded
in review-row-before.log. No storage, analyzer or backend behavior changed.

The first expanded focused run passed 33/37. Two assertions were ambiguous because
the new row and open inspection both contain their status/error text; assertions
now target the active dialog. The two mobile width checks sampled the header
before resize layout settled. A controlled probe measures width 433 immediately
and 390 after two frames, locating the transient overflow in a header action.
The width/accessibility assertions remain intact after layout settles. Evidence:
review-row-layout.json, review-row-layout.png and review-row-mobile-resize-trace.zip.
The subsequent focused run passes all 37 tests, including both-theme WCAG, 390px
layout, source context and current/reviewed identities.

Final verification passes all 108 Firefox tests in 150 seconds with zero
retries, skips or flaky results (review-row-full.log and
review-row-full-results.json). The three new row flows also pass in system
Chromium. Frontend type/lint/format checks, Rustfmt/Clippy and the project packaged
debug/optimized builds pass. Core logic is unchanged; core unit tests are not
repeated. Automated WCAG checks do not replace assistive-technology testing.

Native WebKit verifies an explicit row recheck, pending/result states and direct
Changes handoff, alongside existing source/finding/diff checks. It uses the
existing labeled synthetic ffff… review in temporary XDG state, verifies the
record hash is unchanged and removes that state. Native flags
reviewRowWorkspaceRendered and the existing comparison/source flags are true.
Evidence: review-row-native-evidence.json, review-row-native-probe.log and
native-smoke-evidence.json. The final optimized desktop is running.

The private HTTPS row probe replays the isolated Rust/native saved list, record
and comparison, while shipped assets/inventory and a separate live recipe request
remain real. It observes zero automatic recipe fetches, one explicit fetch and
no extra fetch on comparison handoff or saved-record refresh. Saved exports are
identical, no review write is requested, current source is visible at 390px, and
the live capture matches native. Hostile Origin/cross-site requests return 403;
no browser/network errors occur. Evidence: tailscale-review-row-evidence.json,
tailscale-review-row.log and tailscale-review-row{,-mobile}.png. Synthetic row
coverage is distinct from real historical/personal review evidence.

A separate real HTTPS probe uses no replay and verifies current source search,
exports and independent CLI identity, with same-origin requests and no browser
or network errors (tailscale-review-row-live-evidence.json). The existing private
Serve mapping, loopback/HTTPS and assets all return 200 in
review-row-preview-status.json. Refresh the Mac page for the new packed assets.
This host verification does not establish the Mac's network connectivity.
Chromium's prior full-suite screenshot instability remains open.

## Shared advisory check state

Goal: an advisory attempt owns one pending/success/failure state across Overview,
Advisories, dependency evidence and candidate comparisons. Done means page changes
cannot revive old conclusions during a pending or failed attempt, explicit retries
recover all consumers, and metadata exports remain available with unknown advisory
evidence. Package operations and personal review records remain untouched.

- [x] Explore audit consumers, client query lifecycle and existing backend guards.
- [x] Define shared ownership and navigation/export regression flows.
- [x] Reproduce pending/failure resurrection and implement shared query checks.
- [x] Review cancellation, retry, identity and request deduplication boundaries.
- [x] Verify focused/full browsers, packaged native builds and private HTTPS.

The backend already discards its prior successful audit before a forced request.
The UI currently performs those requests through three local mutations, updating
the shared query only on success. Other pages therefore retain prior success.
Overview and dependency evidence also accept cached data during query fetching.

Keep one audit query key. Expose an explicit forced check from useAudit through
QueryClient.fetchQuery, so every subscriber sees the same query state. Read-only
audit requests complete across route unmounts; consuming cancellation would revert
the query to old success when its last observer leaves. Failed query mounts do
not automatically retry on navigation. Manual retry requests refresh:true and
success restores the shared capture. Existing fingerprint/version/coverage guards
remain independent conditions for each consumer. No data/schema migration.

Alternative: synchronize separate mutations through a second global attempt store.
That duplicates query lifecycle/error ownership and adds race handling. Using the
existing query provides pending/error propagation and in-flight deduplication.

Verification: deferred and failed responses with same-document route navigation,
a route with no audit subscriber, one request per explicit check, all four views,
unknown exports retaining full metadata, successful retry including zero matches,
legacy fingerprint/version tests and both-theme 390px accessibility. Native/live
HTTPS prove actual request/render/export behavior; isolated browser fixtures prove
controlled network failures without changing the real feed or saved reviews.

Review also reproduced an offline queued attempt leaving the old Export enabled
(advisory-state-offline-before.log/-trace.zip), and an in-flight plan leaving
Overview's previous result current (advisory-state-plan-before.log/-trace.zip).
The shared isChecking contract includes paused requests. checkPlan tracks the
plan's existing backend audit in the same query; it does not issue a second audit.
A plan with unavailable advisories remains reviewable/exportable while the shared
audit is failed. Its typed result remains an UpdatePlan. Concurrent checks prevent
starting a plan until the existing attempt completes.

The first 39-case run passed 38 checks and exposed queued manual intent changing
from refresh:true to a default read when query observers remounted before network
resume (advisory-state-paused-intent-trace.zip). Explicit checks now start against
the local service with networkMode:always; the service owns external connectivity
errors. Automatic background queries can still pause and withhold conclusions.
Separate regressions cover that pause/resume and real browser-offline local fetch
failure, preserving the exact forced retry and one attempt per action. The offline
HTTP request fails before the fixture service sees it; request events distinguish
attempted requests from received ones. Native IPC string errors normalize to Error
without losing rejection text or AbortError identity.

The final focused run passes all 41 checks in 50 seconds, including eleven new
state/transport flows plus existing triage, comparison, dependency and plan tests.
The initial six-case flow attempted to click a comparison Check button while the
shared query was busy; the UI correctly disables that action. The regression now
asserts that guard and unknown comparison export without forcing another check.
Both themes pass 390px width/WCAG checks, with screenshots inspected. Native IPC
error normalization is covered through a browser adapter preserving Rust's string
rejection shape, alongside an opt-in debug WebKit transport probe.

The first native fault-injection run failed to intercept an explicit request.
Installed Tauri scripts define invoke/ipc/postMessage as immutable properties;
assignment to invoke in the non-strict smoke script had no effect. The probe now
wraps the standard fetch function for the exact query IPC URL, returns a labeled
controlled IPC error response and restores fetch in finally. It does not change
Tauri globals, capabilities or real application authorization. Its live retry
uses the actual Rust service. Initial native probe failure remains in artifacts/
advisory-state-native-probe-before.log.

The first live HTTPS probe reached its final assertions with one NS_BINDING_ABORTED
request but lacked command context. An instrumented repeat with unchanged app/
assertions passes with zero failed requests; that does not establish the cause
of the earlier abort. It verifies real payloads, CLI agreement and plan/dependency/
comparison exports without evidence replay or review writes. The response delay
controls timing only. Logs retain both runs.

Native WebKit now passes pending navigation through Activity, propagated controlled
string failure, disabled old export and exactly one live forced retry. Existing
recipe/source/finding/row flows also pass, and the isolated review hash remains
unchanged. Optimized assets remain from the canonical release build; the subsequent
change affects only the opt-in debug verification hook.

The first focused Chromium run passed 10/11. Its fulfilled route bypassed offline
transport and produced the synthetic service error instead of a network error.
The explicit-offline test now continues that exact request to the browser network
layer while offline. Both engines must show an actual fetch failure, preserve
unknown status after reconnect and send refresh:true on manual retry. No app code
or browser flags changed for this test-fixture correction. Trace is retained as
advisory-state-chromium-offline-fixture-trace.zip.

Final verification passes all 119 Firefox tests in 170 seconds, with zero retries,
skips, unexpected or flaky results (advisory-state-full.log and
advisory-state-full-results.json). All eleven new flows pass in system Chromium
in 17 seconds (advisory-state-chromium-final.log). Frontend type/lint/format and
Rustfmt/Clippy pass. Canonical packaged debug and optimized desktop builds pass;
the final debug rebuild changes only the opt-in smoke probe. The Rust core and
review persistence were unchanged, so core unit tests were not repeated.

Native evidence is in advisory-state-native-evidence.json and
advisory-state-native-probe.log: controlled IPC failure plus actual forced retry,
pending navigation, and the existing static/review/source flows all pass. The
synthetic review's SHA-256 remains bcadf7b9e58ffa420e6ad5823393829e2c76ffdc86d3f758bf5362074b3250ee;
temporary XDG state was removed. Only the identified old desktop was stopped;
optimized desktop PID 2821927 is running through tracked session 54244.

The successful real HTTPS probe is tailscale-advisory-state-diagnostics.log and
tailscale-advisory-state-evidence.json. Initial and explicit audit requests are
refresh:false/true exactly once each. Pending evidence stays withheld through
Activity/Overview navigation. Exports match the actual response and independent
CLI, including nominal coverage and limitations. Dependency/comparison exports
reuse the capture, and a real review plan updates it without another standalone
audit request. No payload replay or review writes occur. Browser errors/failed
requests are zero, all requests remain same-origin, and hostile Origin/cross-site
requests return 403. Desktop/390px captures are retained.

The existing private slot remains https://omarchy.tail02990.ts.net:10007/ to
loopback 5176. The helper verifies loopback, HTTPS and shipped initial assets all
return 200 (advisory-state-preview-status.json). Refresh the Mac page for the packed
assets. Host checks do not establish connectivity from that Mac. Automated WCAG
and focused Chromium coverage do not establish assistive-technology usability or
resolve the earlier full-suite Chromium screenshot instability.

## Recipe scan lifecycle

Goal: explicit recipe scans own one state per package base across saved rows and
inspections. Done means navigation cannot cancel an attempt and revive previous
conclusions, offline attempts fail visibly through the local service, failure
remains unknown on reopening, and review acknowledgment cannot approve evidence
that is still being fetched. Saved files and full unknown exports remain readable;
no test changes personal reviews or executes recipes/packages.

- [x] Explore query observers, cancellation, review guards and backend scan limits.
- [x] Define per-base ownership, explicit requests and review identity boundaries.
- [x] Reproduce navigation/offline/reconnect/review-acknowledgment regressions.
- [x] Implement shared recipe query and inspect failure/cache/write boundaries.
- [x] Verify browser/native/private preview, mobile/accessibility and exports.

Rows and workbench currently share a query key but duplicate options and consume
an abort signal. Removing the last subscriber cancels and reverts cached query
state. Refetching while offline can pause; isFetching alone does not withhold old
conclusions or block recording them. Workbench also permits its acknowledgment
checkbox during pending reads and can automatically capture on reconnect.

Reuse the demonstrated query pattern: a dedicated useRecipeInspection hook owns
the per-base query options and explicit fetchQuery check, without an unmount abort
signal. Start intentional operations through local HTTP/IPC with networkMode:always;
the bounded Rust scanner owns external connectivity errors. Disable automatic
mount/reconnect/focus rechecks, preserve the intentional initial autoStart action
and gate all current-state/record controls on the shared attempt state. Backend
three-scan/45-second limits, identities and authoritative write validation remain
unchanged. A review acknowledgment applies only to a complete known capture's
base, commit, bundle digest and analyzer version.

Alternative: add a separate global scanner attempt store. The existing per-base
query already supplies ownership and deduplication, avoiding duplicated state.
No transport/schema/analyzer/persistence change or new dashboard controls.

Verification: controlled responses prove continuity through routes with no
observer and sheet reopen, matching/changed/failure states, explicit recovery and
request counts. Real browser offline transport tests ensure previous evidence
cannot become a current export or review. Reconnect does not auto-fetch. Pending
acknowledgment is disabled; current acknowledgment is tied to exact identity.
All tests keep saved records unchanged, with browser fixtures or temporary native
XDG state. Both themes/390px WCAG, focused Chromium, full Firefox, canonical native
builds and actual private HTTPS/CLI captures complete validation.

The before runs reproduce both last-observer cancellations, an offline recheck
retaining Matches saved snapshot, an unrequested reconnect capture, and an enabled
acknowledgment while a first current scan is pending. Logs are recipe-lifecycle-
before.log and -guards-before.log; per-case traces are retained.

The first six-case fix run passed navigation/reopen/reconnect checks. The offline
case expected saved-current-unknown without loading the saved record before
disconnection; without that proof, capture-current-unknown was the correct
classification. It now warms a matching saved finding comparison before going
offline. Unknown/current assertions remain intact. Both theme WCAG checks found
a real export-toast contrast failure: #008a2e on #ecfdf3 is 4.25:1 at 13px. A small
custom UI Toaster now uses existing popover/text/border tokens in both themes and
semantic icon colors. Toasts remain included in accessibility checks. No contrast
checks are suppressed and no notifications are hidden to obtain a passing result.

The focused Firefox run passed 49/51, including all six new lifecycle cases and
both theme/390px toast-inclusive accessibility checks. The two older tests tried
to check acknowledgment on incomplete/failed evidence; their assertions now
require the checkbox disabled, alongside the existing disabled Record action.
No current-unknown, completeness or export guard was relaxed.

Adversarial review: per-base fetchQuery requests deduplicate through the shared
query, intentional initial autoStart remains supported, and no signal is consumed
when its last observer closes. Current-state gates include every non-idle fetch
status, failed state and complete-capture acknowledgment identity. Store/cache
writes and authoritative Rust validation are unchanged. No additional confirmed
product defect found. The opt-in native probe uses the exact query IPC fetch URL
for a labeled controlled failure and restores fetch in finally; its live retry
calls the real Rust service. Release builds exclude the hook.

All eight focused Chromium cases pass in 12 seconds, including incomplete/failed
acknowledgment guards. Canonical debug and optimized builds pass; Rustfmt/Clippy
and frontend checks pass. Native WebKit verifies a held scan through Activity and
Reviews, unknown capture/disabled acknowledgment, controlled string IPC failure,
failure retained on reopening, and exactly one actual Rust/AUR retry. Existing
source/diff/finding/row flows also pass. Temporary XDG state was removed and the
synthetic review's hash stayed bcadf7b9e58ffa420e6ad5823393829e2c76ffdc86d3f758bf5362074b3250ee.
Native evidence/logs are recipe-lifecycle-native-evidence.json and -probe.log.

The first HTTPS timing probe failed to re-enter the AUR package after navigation:
the route's search field resets when leaving, so the probe must enter its package
name again. Its finally cleanup then attempted fulfillment of the already closed
route. The external harness now fills the search on re-entry; app state, scan
assertions and payloads are unchanged. Initial probe log remains available as
tailscale-recipe-lifecycle-probe.log. The probe delays delivery of an actual source
response only, with no capture replay or review writes.

Final verification: all 125 Firefox tests pass in 169 seconds, with zero retries,
skips, unexpected or flaky outcomes (recipe-lifecycle-full.log and
recipe-lifecycle-full-results.json). All eight focused Chromium tests pass in
12 seconds. Both-theme/390px WCAG checks include visible export notifications;
screenshots were inspected. The known full-suite Chromium capture instability
remains outside this focused-engine result.

The successful real HTTPS timing probe is tailscale-recipe-lifecycle-probe-final.log
and tailscale-recipe-lifecycle-evidence.json: exactly two explicit recipe reads,
a pending capture survives Activity and AUR re-entry without observers, previous
full bytes export with unknown status, acknowledgment stays disabled while pending
and unchecked after completion, and current exports match the actual response.
Commit, digest, analyzer, files, findings and derived source evidence match the
independent real CLI. No payload replay or review writes occur. Both hostile
Origin and cross-site metadata return 403. Browser errors/failed requests are zero;
all browser requests remain on the preview origin. Desktop/390px screenshots are
retained. The first harness failure and its cause remain documented above.

Canonical debug/optimized builds, type/lint/format, Rustfmt and Clippy pass. Core
scanner/schema/persistence behavior was unchanged, so Rust core unit tests were
not repeated. Only the identified old desktop PID 2821927 was stopped; optimized
desktop PID 3133604 is running through tracked session 68577. Existing private
Serve mapping remains https://omarchy.tail02990.ts.net:10007/ to loopback 5176;
helper checks for loopback, HTTPS and initial shipped assets return 200
(recipe-lifecycle-preview-status.json). Refresh the Mac page for rebuilt assets.
Host verification does not establish connectivity from that Mac, and automated
WCAG does not establish assistive-technology usability or recipe safety.

## Everyday Arch maintenance

Goal: make package evidence useful for daily maintenance on plain Arch and Omarchy.
Done means users can check configured mirrors without refreshing host indexes,
check all foreign names explicitly against AUR, inspect matching recipe bases,
review orphan candidates and disk/cache use, and copy validated terminal commands.
Direct transactions remain a later privileged-helper/VM milestone.

- [x] Explore local inventory, dependency/provider index, AUR RPC, UI and CLI.
- [x] Design three typed requests with before/after state validation and explicit network intent.
- [x] Implement Maintenance, online checks, recipe/inspection handoffs and terminal commands.
- [x] Review failure, cancellation, partial cache, identity, command injection and performance boundaries.
- [x] Verify full browser suite, native builds and live unchanged-host checks.

The shared Rust service owns a private checkupdates process/database and bounded
batch AUR RPC. The existing provider index identifies orphans without repeated
full-consumer scans. Browser/IPC use generated types; query state owns explicit
checks across navigation. Failure/pending results cannot supply current conclusions
or exports. No automatic retry sends names after reconnect. JSON exports preserve
all captured rows, including filtered/paged evidence, with capture status.

Alternative: refresh the host sync databases from the UI. Rejected because it
requires privilege and can encourage partial-upgrade workflows. Arch's supported
checkupdates utility already solves online inventory through a separate database;
it is optional, with a clear pacman-contrib installation handoff.

Verification covers real CLI captures and before/after host database hashes,
fixture tests for Arch epoch ordering, optional/virtual orphan providers, malformed
batch metadata, output/time/cancellation limits, browser pending/failure/navigation,
full exports, missing tools, command quoting, plain Arch/Omarchy handoffs and
390px light/dark WCAG checks.

Final verification: 65 Rust tests, all 138 Firefox browser tests and 13 focused
Chromium maintenance tests pass. Frontend type/lint/format, Rustfmt and Clippy
with warnings denied pass. Canonical debug and optimized desktop builds pass.
The native WebKit smoke exercises actual maintenance, repository and foreign
IPC, rejects stale fingerprints, and renders the maintenance checks and tabs.
Evidence: artifacts/maintenance-native-evidence.json,
artifacts/maintenance-full-firefox-final.log and artifacts/maintenance-chromium.log.

Real CLI checks found six configured-repository upgrades and three newer AUR
recipes among four installed foreign packages. Orphan candidates agree with
pacman; installed versions and every host sync-database hash stayed unchanged
(artifacts/maintenance-live/verification-final.json). The export preserves the
complete online captures. These version comparisons do not establish upstream
currency for VCS packages or recipe safety.

Review caught narrow mobile foreign-package metadata beside two action buttons;
the metadata now occupies its own full-width mobile row. Both-theme screenshots
were inspected and the browser tests require readable metadata width. It also
removed repeated orphan consumer scans by using the existing provider index.
An initial full-suite run lost its Vite process to SIGTERM and was interrupted;
the managed-server rerun passed all 138 cases. The precise external termination
cause was not established. Test readiness now waits for the Rust health endpoint
to prevent requests arriving while the API is still compiling.

## Removal planning

Goal: turn individual and orphan package choices into a dependency-checked
removal review. Done means exact installed name/version targets are validated,
libalpm prepares plain removal without committing, blockers/optional feature
loss/HoldPkg matches are visible, and only an unblocked current capture offers a
quoted terminal command. Selection/filter changes cannot reuse another plan.

- [x] Explore inventory/configuration, provider index, package actions and CLI/IPC.
- [x] Design bounded typed targets and a shared read-only libalpm preparation path.
- [x] Implement package and multi-orphan review, CLI, exports and state gates.
- [x] Review selection identity, concurrent changes, policy and failure boundaries.
- [x] Verify isolated libalpm/pacman agreement, browser flows and native IPC.

The Rust worker owns its libalpm handle and resolved pacman configuration; it
initializes a NO_LOCK transaction, adds only selected packages, prepares and
releases it. No commit API, cascade/recursive flags, hooks, shell or elevation
are used. Before/after inventory checks reject changed fingerprints and observed
locks. The provider index reports optional requirements losing all providers.
HoldPkg matches withhold the command even though pacman permits an extra prompt.
Unrepresentable HoldPkg glob rules fail explicitly. Targets are capped at 100;
duplicates, injection, missing packages and mismatched installed versions fail.

Alternative: implement direct removal now. Deferred to the roadmap's authenticated
root-owned helper and disposable-VM transaction milestone. This slice establishes
the selection/plan boundary without a workstation mutation path. The UI supports
explicit rechecks and exports complete captured evidence while pending/failed/
changed captures cannot supply actionable commands. Pacman's prompts remain the
authority when a copied command is run later.

Primary contracts: [libalpm transactions](https://man.archlinux.org/man/libalpm_trans.3.en),
[pacman removal](https://man.archlinux.org/man/pacman.8.en) and
[HoldPkg policy](https://man.archlinux.org/man/pacman.conf.5.en).

Verification: `cargo test --workspace` passes all 70 tests, including real
libalpm preparation on isolated local databases, alternate versioned providers,
joint consumer removal, optional losses, HoldPkg rules and unchanged metadata.
Real pacman print-only output independently agrees with the isolated successful
selection. Type/lint/format, Rustfmt and Clippy with warnings denied pass; canonical
debug and optimized desktop builds pass.

The complete Firefox suite passes 147 tests in 3.7 minutes
(artifacts/removal-full-firefox.log). Nine focused Chromium cases pass in 12.7
seconds (artifacts/removal-chromium.log). They cover selection across filters/pages,
the 100-target limit, full exports, pending/failed checks across inspection closure,
failed snapshot refresh, observed locks, changed fingerprints, malformed captures,
ASCII punctuation ordering and both-theme/390px WCAG checks. Mobile screenshots
were inspected; tests require full-width metadata above selection controls.

Review found and corrected mobile metadata squeezing, browser locale ordering
disagreeing with Rust's ASCII command order, and caret-negated HoldPkg brackets
differing from glob's grammar. Unsupported policy now fails explicitly. Inventory
refresh uses shared query failure state so a failed manual refresh cannot leave
old removal commands actionable. Existing direct-copy removal buttons now require
the dependency review; install/update handoffs retain their previous behavior.

Actual CLI and pacman print-only checks agree: helium-browser-bin has no required
blockers; glibc has 748 and pacman six, and both match HoldPkg and have no command.
The real browser export matches CLI targets, versions, fingerprint and command
with zero page errors (artifacts/removal-live/browser-verification.json).
Installed versions, all five host sync database hashes and 3352 local metadata
file hashes remain unchanged (artifacts/removal-live/host-verification.json).

Native WebKit verifies actual removal IPC, rejects stale fingerprint, stale
version and hostile-name requests, and renders the review from the Disk usage
package handoff (artifacts/removal-native-evidence.json). The first full native
smoke timed out waiting for an online repository result; its exact cause was not
established. A rerun passed all native flows. The debug harness now writes the
displayed state on failure for future diagnosis. Probe state was isolated and
removed. No privileged install/removal, hook-side-effect simulation or disposable
VM transaction/recovery test was performed because this slice has no commit path.

## Authenticated desktop removal

Goal: apply one reviewed plain-removal selection through a narrow, root-owned
helper and show actual outcomes across navigation. Done includes a buildable
helper/polkit package, native-only explicit confirmation/authentication, removal
state invalidation, and actual transaction/failure/recovery evidence in a disposable
Arch VM. No workstation package removal or helper activation is part of verification.

- [x] Explore libalpm, removal review, native IPC and available offline VM tools.
- [x] Design a native-only task boundary and root-owned one-shot helper protocol.
- [x] Implement helper, execution digest, native tasks, confirmation and packaging.
- [x] Review input, ownership, locks, changed plans, process loss and partial outcomes.
- [x] Verify isolated guest transactions, browser/native flows and unchanged host.

Read-only HTTP/CLI requests retain their boundary. A separate native task command
accepts only validated target/version identities, inventory fingerprint and an
execution digest. The digest captures selected installed metadata, hook definitions,
resolved configuration and relevant tool bytes. The helper takes the actual alpm
lock, revalidates the exact selection and digest, prepares without cascade/recursive
flags, and commits once. HoldPkg and unsupported configuration withhold direct
application. Fixed pkexec/helper paths are checked for root ownership and absence
of group/other write access. Policy requires active administrator authentication,
with no retained authorization, GUI inheritance, arbitrary arguments or shell API.

Tasks remain owned by the native backend while an inspection closes; failures and
lost process outcomes cannot report success. No cancellation or automatic retry
can interrupt/replay a commit. Helper outcomes contain remaining installed versions
and distinguish rejected requests, committed removal and possible partial failure.
The desktop refreshes inventory after a finished attempt and invalidates review
queries. A missing helper leaves the existing terminal handoff available.

Alternative: run a user-writable executable through sudo, or execute commands via
HTTP. Rejected because both cross the roadmap's privilege boundary. System install
is a separate deployment step after the package and VM evidence are reviewable.
Primary contracts: [libalpm transaction API](https://man.archlinux.org/man/libalpm_trans.3.en)
and [pkexec authentication/argument boundary](https://man.archlinux.org/man/pkexec.1.en).

The task boundary now also retains the latest record in the desktop's local data
directory. It writes and fsyncs an atomic record before authentication and on
completion; a prior running record becomes unknown on restart. Normal window close
is blocked during an active task, with a visible explanation. Native-owned polling
continues across routes, and frontend completion synchronization runs once per task
so reopening a view cannot clear a newly reviewed plan.

Review corrected disappearing outcome observers, repeated invalidation on remount,
inherited diagnostic pipes retaining a finished process, error writes panicking on
closed pipes, untrusted/dangling log paths, unbounded directory enumeration,
post-commit database validity, and overly narrow installed-version characters.
The [PKGBUILD version contract](https://man.archlinux.org/man/PKGBUILD.5.en) permits
more than alphanumerics; traversal/control/whitespace are rejected without excluding
valid tilde versions. The optional package declares the libalpm 16 ABI dependency.
External programs/data used by hooks remain outside the execution digest, explicitly
stated in capture limitations and security documentation. Root-admin concurrency
and atomic reversal of script effects remain outside the guarantee.

Verification commands: `cargo test --workspace` with TMPDIR set to
`target/verification-tmp` passes 72 core and seven native tests, including persistence,
restart/corrupt records, close prevention, bounded drainage and inherited pipes.
Rustfmt, Clippy with warnings denied and `bun run check` pass. Canonical debug and
optimized Tauri builds and release helper/core builds pass. An earlier Rust run hit
the host's per-user /tmp quota; no assertion behavior was changed, and the disk-backed
temporary-directory rerun passed.

The full Firefox suite passes all 155 tests in 3.6 minutes
(`artifacts/apply-full-firefox-final.log`). Seventeen focused Chromium tests pass in
25.7 seconds (`artifacts/apply-chromium-clean.log`), including exact confirmation,
acknowledgment, unavailable helper, failed preflight/snapshot, navigation, success,
rejection, partial/unknown outcomes, no retries and light/dark mobile accessibility.
The mobile confirmation screenshot was inspected. An initial full Firefox run timed
out in an existing recipe-baseline test; that test passed in isolation and the full
rerun passed. An initial Chromium run produced a blank page in the existing light
mobile review test; the focused rerun passed. Their exact causes were not established.

Actual WebKit/native IPC verifies capability absence and invalid/held request
rejection before authentication, restores a synthetic unfinished record as unknown,
and renders that recovery outcome in Activity, alongside existing native flows
(`artifacts/apply-native-evidence.json`). The probe uses isolated local data/state;
no personal task or review record is modified.

The disposable Arch guest passes 22 real cases (`artifacts/transaction-vm-evidence.json`):
root-owned installed package/policy and real pkexec transport, normal/joint/tilde
version removals, independent pacman/file/log evidence, required-dependency and
HoldPkg blocks, stale fingerprints/versions/digests, lock contention, changed hook
and installation-script bytes, malformed/oversized/unknown-field input, denied
unprivileged and unauthenticated callers, fixed-path/writable-install rejection,
failed pre/post hooks, closed diagnostic pipes, and interruption/manual recovery.
Reboot changes the boot ID; removals remain absent, retained packages remain
installed, and the interrupted fixture is restored from its original offline archive.
The helper package checksum matches the tested archive. The owned VM is stopped;
other VM labs remain untouched. The destructive guest script requires the private
harness hostname, root and the exact randomly assigned virtual-machine UUID.

The cached cloud image is checksum-pinned. The guest has no host mounts or external
network, with loopback SSH forwarding only. Missing polkit/duktape dependencies are
staged as Arch packages/signatures through SSH and installed inside the guest.
Successful interactive session password authentication is deliberately not automated;
actual policy loading, privileged pkexec transport and unauthenticated denial are
verified separately. Host helper activation is deliberately skipped: the built
optional package and [activation instructions](../README.md#enable-desktop-removal)
are the handoff. Host installed versions and all 3,357 local/sync metadata hashes
remain unchanged; the helper and policy remain absent
(`artifacts/apply-host-verification.json`).

## Guided full-system update preparation

Goal: a usable Updates workflow that captures online configured-repository changes
and official Arch notices together, keeps incomplete/pending/failed captures unknown,
and offers only the supported full updater after explicit news/recovery review.
Done includes browser/native/CLI behavior, stale-command prevention, bounded feed
handling, exports and evidence of unchanged host package databases. Package mutation
is outside this preparation slice; authenticated full upgrades require a separately
resolved/signed-artifact transaction and Omarchy lifecycle contract.

- [x] Explore the local planner, online checks, command handoffs and upstream notices.
- [x] Design bounded news ingestion, fingerprint-bound preparation and explicit review.
- [x] Implement core/CLI, Updates preparation, exports and stale-plan protection.
- [x] Review malformed feeds, redirects, concurrent checks, state changes and failures.
- [x] Verify logic, real service/native/browser flow, accessibility and unchanged host.

The existing planner describes local candidates; preparation separately reports
online availability through checkupdates in its private temporary database. A new
read-only request captures repositories and the fixed official RSS feed in parallel,
with independent failure evidence and a final fresh fingerprint/lock/version check.
It shares the repository semaphore with Maintenance, so online checks cannot stack.
News is limited by bytes, XML depth, field length and item count; DTDs, malformed or
incomplete feeds, unsafe/nonofficial links, invalid dates and duplicate identities
fail explicitly. Only title/date/official article links are displayed; article HTML
and instructions are not rendered or executed. Feed window/publication limits stay
visible, and notices are not automatically judged applicable or resolved.

The client keeps explicit query state across navigation without mount/focus/reconnect
rechecks. A failed attempt cannot revive an old command. News/recovery acknowledgments
bind to one successful capture; new checks reset them. The handoff requires a matching,
unlocked, nonfailed/nonpending snapshot and a recent capture (15 minutes), with a
fixed Arch/Omarchy command selected from the current snapshot. It remains a terminal
handoff, not a transaction authorization or a general safety verdict. The existing
local review-plan copy button also loses actionability after refresh failure, locks
or changed state. Complete historical/partial captures remain exportable with status.

Alternative: elevate a wrapper around the existing updater now. Deferred because
repository metadata is not a resolved signed-artifact transaction and Omarchy's
snapshot/keyring/migration/AUR/toolchain lifecycle needs its own tested contract.
This slice completes the review/handoff experience without expanding the root helper.
Primary sources: [Arch notices](https://archlinux.org/news/),
[Omarchy update lifecycle](https://omarchy.org/manual/updates/) and
[Chrono RFC2822 date parsing](https://docs.rs/chrono/latest/chrono/struct.DateTime.html#method.parse_from_rfc2822).

Review: [findings and corrections](UPDATE-PREPARATION-REVIEW.md). The prepared
handoff and exported actionability both recheck time at the action boundary.
Tailwind now scans `src/` explicitly; a controlled Markdown fixture edit reproduces
loss of the current document/review before this correction and preserves both after
it. The fixture is restored after each run. This also closes the development reload
that interrupted earlier unrelated inspection tests. Source/binding/build work is
finished before the final browser suite; browser runners use separate output paths
and run sequentially to avoid trace-directory collisions.

Verification completed:

- `cargo test --workspace`: 85 tests pass (78 core, 7 native task tests).
  `cargo clippy --workspace --all-targets -- -D warnings` and Rust formatting pass.
- `bun run check` passes TypeScript, lint and formatting. Canonical debug and
  optimized desktop builds pass with embedded frontend assets.
- The final full Firefox run passes 172/173 cases. Its only failure is the new
  clock harness pausing before the browser's current mocked time. Pausing relative
  to that browser clock fixes it; all 18 preparation cases then pass in Firefox,
  including clock jumps/expiry, partial captures, navigation, stale plans, official
  links, full exports, watcher stability and actual light/dark mobile accessibility.
  Earlier full-suite interruptions were reproduced as development document reloads
  and corrected by the source-scan restriction. A separate parallel-browser attempt
  collided in shared trace directories; the sequential isolated rerun avoids this.
- All 26 focused Chromium cases pass, including the 18 preparation cases and the
  eight foreign-package cases. Mobile screenshots were visually inspected. Logs:
  `artifacts/update-preparation-complete-firefox.log`,
  `artifacts/update-preparation-final-focused-firefox.log`,
  `artifacts/update-preparation-complete-chromium.log`. The clock-harness correction
  changes tests only; production code is covered by the full run and focused reruns.
- The actual CLI `prepare-update` captures six configured-repository changes and
  ten official notices on this workstation (`artifacts/update-preparation-live.json`).
  Real WebKit/native IPC verifies stale-request rejection, live notice rendering,
  two acknowledgments, actual clipboard handoff and reset on recheck
  (`artifacts/update-preparation-native-evidence.json`). The debug hook is explicit
  and isolated from personal data/state. Its owned windows are stopped.
- Installed versions and all 3,357 local/sync metadata hashes remain unchanged;
  the optional removal helper/policy remain absent
  (`artifacts/update-preparation-host-verification.json`). No updater is executed.
  The rebuilt optimized desktop replaces only the previously owned desktop process
  (`artifacts/update-preparation-desktop-launch.json`).

Final review verdict: confirmed implementation and development-watch findings are
corrected and verified. The remaining deliberate boundary is terminal execution:
this capture does not resolve, authorize or run a privileged full upgrade. Disposable
VM mutation tests are skipped because this slice introduces no privileged operation
and leaves the helper protocol unchanged. Saved native exports continue through the
existing Save As adapter; this slice verifies browser export contents and native IPC,
without automating the Save As dialog again.
