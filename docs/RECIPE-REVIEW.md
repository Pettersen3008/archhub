# Commit-specific recipe review

Goal: extend the existing security dashboard with pinned AUR file inspection,
installation-script findings, and durable human review baselines. Done means the
CLI, native transport, and Tailscale browser agree on commit/file evidence; changed
recipes cannot inherit a saved review; malformed references and incomplete scans
cannot become reviewed; realistic browser flows and fixture tests pass.

- [x] Explore: shared Rust network/scanner/service, generated contracts, package
      sheet, exact-origin browser proxy, and existing live/fixture tests inspected.
- [x] Design: resolve the newest AUR commit from the fixed cgit Atom endpoint;
      fetch PKGBUILD, .SRCINFO, and bounded literal install references at that commit.
      Never evaluate Bash or follow arbitrary source URLs.
- [x] Implement: file-aware findings, bounded diffs, local review store, review
      workspace, and typed requests shared by HTTP/native/CLI.
- [x] Review: freshness labels, filename validation, digest identity, storage
      errors, concurrency, limits, and accessibility.
- [x] Verify: Rust fixtures, frontend checks, browser workflows, native build,
      and real HTTPS package/recipe requests.

The network module owns pinned reads. The scanner owns pure text heuristics.
The evidence module owns snapshot validation, local atomic JSON records and
bounded line diffs. Service owns recent scan caches and serializes review writes.
React renders generated types and never interprets recipes. Notes/review files
are application data; package state and system configuration remain untouched.

One latest review baseline per package base is saved only by an explicit user
action. It includes exact file bytes, hashes, commit, scan time and review note.
The store is shared by native and browser clients on this workstation, bounded
to 40 records, and not a signed audit log or install authorization. New scans
compare commit and bundle digest to the baseline. Failed fetches are unknown,
and missing/unsupported required files prevent recording a review.

Alternative: clone each AUR repository and run Git to read files. The fixed cgit
interface avoids invoking external repository tooling and keeps response limits
and HTTPS endpoint restrictions inside the existing Rust client. Patches, source
archives, generated/dynamic install references, and dependency recipes remain
outside this scanner's coverage and are called out in the interface.

Diff computation runs on a blocking worker with a deadline and a capped output.
Reports can be exported in full even when the on-screen diff is truncated.
Fixture verification covers changed/added/removed files, commit-only changes,
split-package install references, invalid paths, corrupt storage, stale review
requests, and incomplete coverage. Browser verification covers noting a review,
reloading it, offline saved evidence, invalidation, deletion, and both themes.

Completed evidence: 18 Rust fixture tests, 26 browser tests, frontend checks,
workspace Clippy/Rustfmt, optimized native build, and native WebKit/IPC smoke.
Private HTTPS verification fetched a real pinned install script, independently
recomputed file and bundle hashes, saved/reloaded a temporary automated record,
read it from the CLI, rejected stale/cross-site requests, and removed that record.
Incomplete captures block full diffs as well as review recording: a failed fetch
cannot be represented as a confirmed upstream deletion.

Screenshots and runtime reports are in artifacts/, including
tailscale-recipe-evidence.json, tailscale-pinned-install-script.png,
recipe-changes.png, recipe-review-light-mobile.png and native-smoke-evidence.json.
Privileged package actions and sandboxed dependency auditing are deliberately
outside this slice; no host package/configuration changes were made.

Protocol references checked: [cgit Atom implementation](https://kernel.googlesource.com/pub/scm/linux/kernel/git/zx2c4/cgit/+/refs/heads/jd/zx2c4-deployment/ui-atom.c),
[SRCINFO format](https://man.archlinux.org/man/SRCINFO.5.en), and
[Similar diff API](https://docs.rs/similar/2.7.0/similar/struct.TextDiff.html).

## Static finding inspection

Goal: find a pattern in a large capture and bring its exact captured source line
into view. The existing workbench owns local search, severity filters and 25-row
pages; the source view owns scrolling inside its 400-line window. Existing scan,
saved-review and export contracts remain unchanged. Search covers finding title,
description, rule ID and file; it never hides findings from exported evidence.
Missing/out-of-range locations must not jump to a different captured file.

Alternative: separate finding and source dialogs. That adds navigation and splits
capture context. The existing source pane can provide the same inspection with
one targeted scroll and an accessible selected-location description.

Done means a late flagged line is visible and focus reaches source context,
repeated clicks work after manual scrolling, search/paging/export preserve the
whole capture, and both themes fit a narrow viewport. Source-declaration jumps
share this viewer and must keep working. No analyzer rules or backend API change.

- [x] Explore capture, saved evidence, source windows and callers.
- [x] Reproduce a late-line jump that leaves the flagged code clipped (ratio 0).
- [x] Implement bounded finding investigation and precise source scrolling.
- [x] Review missing locations, refreshed captures and offline evidence.
- [x] Verify browser regressions, real preview and updated desktop build.

Review found that prior selected-line state could carry into a different capture;
selection now applies only to its commit and bundle digest. Missing/invalid source
locations cannot silently fall back to another file. Legacy findings without a
file retain PKGBUILD behavior when their line exists. Selected paths can wrap.

The focused suite initially lost its initial page load to Chromium
ERR_NETWORK_CHANGED (fonts, styles and React module loads); the trace is retained
as artifacts/static-findings-network-interruption-trace.zip. After the final
state change, all 18 focused tests passed without assertion changes or retries.

Final verification on 2026-10-06 passes all 89 browser tests, frontend
type/lint/format checks, Rustfmt/Clippy and the optimized desktop build. New
coverage includes a late line that was previously clipped, repeated jumps,
shrinking captures, file/rule searches, severity filters, unchanged full exports,
unavailable locations and legacy file-less findings. Both-theme 390px WCAG checks
include the new controls and selected source context. Rust core logic tests were
not rerun because analyzer/API/storage behavior is unchanged; the additional
debug-only desktop probe executes the native UI rather than mirroring UI logic.

The native WebKit probe now clicks a live static finding and checks focus plus
vertical visibility within the code viewport, retaining prior inspection/IPC
checks. Its fresh artifact reports staticFindingWorkspaceRendered=true. The
rebuilt optimized desktop replaces the debug probe window.

The private HTTPS browser inspected visual-studio-code-bin, searched its one
captured finding and opened PKGBUILD:16. The exact line was visible on desktop and
390px; filtered exports retained the capture and agreed with an independent CLI
process on commit, bundle digest and findings. No review record was saved and no
recipe was executed. Requests remained on the preview origin; hostile origins
and cross-site metadata returned 403. Live remote recipes can change; fixture
coverage supplies large/invalid captures that this current recipe does not have.
See artifacts/tailscale-static-findings-evidence.json, native-smoke-evidence.json,
tailscale-static-findings*.png and static-findings-{light,dark}-mobile.png.
Automated checks do not replace assistive-technology or usability sessions.

## Versioned static rules

Goal: eliminate demonstrated checksum/shell-name substring errors and identify
the ruleset that produced each capture. The pure Rust scanner will recognize
literal SKIP words in supported checksum declarations, including multiline and
architecture arrays, and require an exact downstream shell name. It remains a
bounded text heuristic: no shell parser, expansion, execution or source fetching.

New scans and review summaries carry an optional staticAnalyzerVersion. Existing
records without it remain unversioned; their captured findings, times, files and
notes are preserved on read. Matching files/commits with a different analyzer
version produce analysis-changed, which asks for findings review rather than
inheriting Reviewed snapshot. Saving a review records the current version.
Version metadata does not authenticate the scanner or saved record.

Recording a review also requires the displayed analyzer version to match the
service's captured scan, alongside commit/digest. Older clients omit that version
and cannot accidentally record a newer ruleset they did not inspect. Review
found this race during implementation; service fixtures verify rejection before
storage writes. Record reads remain compatible with missing version metadata.

Alternative: introduce a complete Bash parser or invoke ShellCheck. This slice
can correct specific heuristics without an external execution/parser dependency;
unsupported dynamic syntax and command context remain explicit limitations.

Done: benign skip strings and non-shell pipeline consumers no longer trigger
these rules, supported literal checksum declarations retain exact lines, versions
survive exports/storage, older records stay readable without rewrites, and changed
analysis cannot silently inherit reviewed status. Verify Rust boundary/regression
cases, fixture UI, real CLI/private preview, native WebKit and desktop builds.

- [x] Explore scanner, scan construction, saved review comparison and UI.
- [x] Define rule scope, backward compatibility and review invalidation.
- [x] Reproduce errors and implement bounded rules/versioned captures.
- [x] Review lexical boundaries, saved data, truncation and changed analysis.
- [x] Verify service, UI, CLI, private preview and desktop behavior.

Primary references: [Arch checksum declarations](https://man.archlinux.org/man/extra/alpm-docs/alpm-package-source-checksum.7.en)
and [Bash comments](https://www.gnu.org/software/bash/manual/html_node/Comments.html).

The lexical recognizer uses bounded word storage and a 2001-line truncation
sentinel. It supports direct scalar/array assignments, appended and architecture
arrays, quoted/concatenated literal words, comments and standalone continuations.
It leaves escaped words and nested/dynamic expressions uninterpreted. Detection
does not establish a declaration's execution context or which source bytes it
would affect; source declaration evidence remains separate. Existing raw-text
rules can still produce contextual false positives. Stored version zero is
invalid; missing versions stay readable, and positive future versions are
preserved for comparison. Future rule behavior changes must increment the
ruleset constant.

Final verification on 2026-10-06 passes 59 Rust tests and all 91 browser tests,
frontend types/lint/format, workspace Rustfmt/Clippy and the optimized desktop
build. Regression fixtures cover all eight checksum families, architecture and
multiline declarations, benign skip strings, comment/quote/continuation boundaries,
dynamic values, bounded finding output and shell names versus similarly named
commands. Storage tests retain legacy findings and original JSON bytes without
rewrites. Browser tests require another review for matching captures with missing
or differing rules versions, preserve notes and export the newly reviewed version.

The native WebKit probe displays rules v1 and rejects review requests with missing
and mismatched analyzer versions. It runs with a command-scoped, empty temporary
XDG state directory, which remains empty after completion. Its fresh artifact
reports analyzerStaleRejected=true and rulesetWorkspaceRendered=true alongside
all prior native evidence checks. The rebuilt optimized desktop is running.

The real private HTTPS browser displays rules v1 for visual-studio-code-bin,
filters its finding and opens the exact PKGBUILD:16 source line on desktop and
390px mobile. Filtered exports retain the complete capture and match an independent
CLI process on commit, bundle digest, rules version and findings. A separate HTTPS
API request also agrees. Hostile Origin/cross-site requests return 403; the passing
browser run has no errors, failed requests or external-origin requests. No personal
review is saved by the private browser probe.

Earlier private-browser attempts encountered Chromium ERR_NETWORK_CHANGED; the
failure UI remained explicit and interruption output/screenshots are retained.
The final fresh run passed without a retry or request failure. The cause of the
earlier local network notifications is not established. See
artifacts/tailscale-static-ruleset-evidence.json, tailscale-static-ruleset*.png,
tailscale-static-ruleset-interruptions.log and native-smoke-evidence.json.
Live recipe observations do not cover every fixture boundary or establish safety.

## Changed-line source context

Goal: inspect changed recipe/install behavior in full file context without losing
the reviewed/current distinction. Existing Changes renders bounded unified text
only; saved file bytes are already loaded through the validated recipe_review
query. The workbench owns current-state gating and exports. No core/API/storage
change is needed.

Design: show reviewed/current line gutters in the existing bounded diff preview.
Clickable line numbers open one focused source pane below the changes, explicitly
labeled with side, path and captured commit. Reuse the paged source viewer. Match
the loaded saved record to the comparison baseline's commit, digest, review time
and analyzer version before permitting reviewed-source jumps. Validate each parsed
line against its captured file text and hunk bounds; malformed/out-of-range or
unavailable locations remain plain text. Added/removed files have only their
available side. Truncation stays visible and full exports remain unchanged.

Alternative: a separate side-by-side diff modal. That adds navigation and doubles
the source display on a narrow screen. A single source context within Changes
retains review identity and uses the established keyboard/scroll behavior.

Done means additions/deletions/context and multiple hunks open exact source lines,
including lines beyond the first 400; mismatched/missing saved data cannot open an
unrelated reviewed file; refreshed captures clear selection; incomplete/failed
fetch gates still apply; exports retain full evidence; mobile/themes/native work.

- [x] Explore diff construction, loaded baselines, source viewer and callers.
- [x] Define snapshot matching, bounded parsing and verification.
- [x] Implement numbered diffs and focused snapshot source context.
- [x] Review malformed/stale/truncated inputs and accessibility.
- [x] Verify focused browser flows, native/shared viewer and private preview; document results.
- [x] Obtain a clean final full-suite run in independent Firefox; see BROWSER-VERIFICATION.md.
- [ ] Resolve local Chromium capture instability; independent coverage does not prove a fix.

Review identified repeated full-file splitting for each line gutter; the renderer
now splits each captured file once per changed-file render. Review also identified
that mismatched cached saved data lacked a recovery action. Reload saved evidence
now fetches the validated record explicitly; jumps remain unavailable when its
identity differs from the comparison. Exact text matching independently prevents
stale/malformed diff rows from pointing at unrelated code. Return to diff restores
focus to the originating line action. Source selections reset with capture and
baseline identity, including recorded times.

Final review also found that a failed recheck could label retained newer analysis
as saved evidence when files/commit matched an older analyzer's record. Saved
capture identity now requires analyzer-version equality as well. A regression
checks the unknown-current label and exported capture status while retaining the
original baseline. This does not rewrite older saved findings.

Verification on 2026-10-06 passes frontend types/lint/format, Rustfmt/Clippy,
debug/optimized desktop builds and all 16 focused recipe-review tests after the
final saved-capture identity fix. The first full suite passed 93 of 94 tests;
the remaining integrity screenshot failed in Page.captureScreenshot after its
accessibility assertions passed, and its unchanged isolated rerun passed. The
final 95-test full run passed 88 and encountered seven interruptions: renderer/
browser crashes during capture plus two source-fixture page-load timeouts.
An installed Playwright Chrome-for-Testing run also passed 88/95, with capture,
renderer and load interruptions. No assertion was weakened or capture removed.

Read-only crash diagnosis confirms system Chromium renderer Compositor SIGTRAP
and subsequent browser SIGSEGV events during screenshot work. Frames remain
unsymbolized; the cause is not established. Memory/storage checks show available
capacity; cgroup memory events and the inspected kernel journal show no OOM kill.
Command-scoped alternate browser, software rendering, alternate capture flag and
headless-shell probes did not resolve the capture failures. No browser packages,
desktop/GPU settings or system configuration were changed; no core was extracted.
Those Chromium runs remain a verification gap for that engine rather than a
product pass. The independent Firefox step is now complete: all 95 unchanged
tests pass through the explicit repository runner, with no retries or skips.
The local Chromium cause remains unconfirmed; see BROWSER-VERIFICATION.md for
controlled probes, the retained earlier Firefox interruption and final evidence.
Logs/traces are retained as artifacts/recipe-context-*.log and *.zip, including
recipe-context-browser-interruptions.json and the initial integrity interruption.

The native WebKit hook runs with a synthetic ffff… baseline in an isolated
temporary XDG state directory, opens exact reviewed/current PKGBUILD lines,
checks viewport visibility and keyboard focus return, and passes all prior native
checks. Its fresh artifact has changedLineSourceWorkspaceRendered=true. The
fixture record's bytes remain unchanged and its temporary directory is removed.
Artifacts native-changes-synthetic-review.json and native-changes-fixture-identity.json
explicitly identify the synthetic baseline; this is not historical AUR evidence
or a personal review. Native-smoke-evidence.json retains the current real capture.

Private HTTPS verification uses the rebuilt assets, actual inventory/AUR search
and a separate real current-recipe request matching native/CLI capture identity.
It replays the isolated Rust/native comparison to test both snapshot sides without
writing host review records; the transport/fixture distinction is explicit in
tailscale-recipe-changes-evidence.json. Source lines are focused and visible on
desktop/390px, focus returns to diff, full exports remain unchanged, and that run
has no failed requests, browser errors or external-origin requests. The real
unintercepted scan probe also passes with CLI agreement and rejected hostile
origins. The final label correction is covered by focused browser fixtures;
the latest rebuilt desktop is running and HTTPS serves the final assets. No
core logic changed, so existing Rust unit tests were not rerun. Automated checks
do not establish recipe safety or replace assistive-technology usability testing.

Recipe scans now retain one per-base query across navigation and sheet closure.
Pending/failed checks withhold current conclusions and comparisons while keeping
full saved or previous files exportable with explicit unknown status. Reconnect
does not silently start another capture. Acknowledgment is disabled until a
complete current scan is available and binds to the exact base, commit, digest
and analyzer version; scan actions reset it.

Verification adds six lifecycle cases, including actual offline browser transport,
route/sheet observer loss, reconnect, acknowledgment and both-theme 390px/WCAG
checks with export notifications visible. All 125 Firefox tests and eight focused
Chromium cases pass. Native WebKit verifies a controlled IPC failure, navigation,
unknown/disabled review state, retained failure on reopening and a real Rust/AUR
retry using isolated unchanged synthetic review state. Private HTTPS delays only
delivery of an actual source response; exports preserve full bytes and agree with
the independent CLI, with zero review writes. Evidence and verification limits
are recorded under Recipe scan lifecycle in IMPLEMENTATION.md.
