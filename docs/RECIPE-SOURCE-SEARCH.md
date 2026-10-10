# Find in captured recipe files

Goal: inspect text beyond static findings and diff hunks without leaving the
captured file. Done means literal case-insensitive search reaches exact matching
lines across 400-line windows, keyboard navigation retains search focus, file and
capture changes reset search, exports preserve all bytes, and mobile/themes/native
rendering work. Recipe execution and network fetching remain unchanged.

- [x] Explore SourceView, its two callers, source jumps and existing tests.
- [x] Define search scope, line navigation, focus and identity boundaries.
- [x] Reproduce missing search and implement the shared controls.
- [x] Review empty/literal input, boundaries, identity changes and focus.
- [x] Verify focused/full browser flows, native and private preview; document results.

SourceView owns the file-local query, matching line indices, selection and source
window. Callers already key its lifetime by file/capture/jump identity; the main
workbench key will include the bundle/commit identity explicitly. Matching uses
the complete captured file, once per query, independent of the displayed page.
There is one result per matching line, even if text repeats within that line.
Enter/Shift+Enter and next/previous actions wrap through matches. Empty or absent
matches cannot select unrelated lines. IME composition must not navigate.

Search navigation scrolls the inner source viewport and retains input focus;
external finding/diff jumps retain their existing region focus and source scroll.
Clearing search keeps the source window available for manual reading. All captured
code remains plain text. UI matches do not add scanner findings or imply safety.

Alternative: search the entire bundle and add a separate results list. File-local
search uses the existing file picker and shared source pane with fewer controls.
It also works identically for offline saved, reviewed and current diff snapshots
without adding transport, storage or analyzer contracts.

Verification: fixture browser flow with 1,000 lines, matches at 50/450/850, literal
regex punctuation, mixed case, wrapping, no-match input, manual paging, file/capture
reset and full export equality; reviewed/current side isolation; both-theme mobile
WCAG checks; native WebKit search on real captured source; private HTTPS search
with independent CLI agreement. Native/core compilation is required for the debug
hook and embedded assets; core logic remains unchanged.

Review confirmed a clipping defect in the initial implementation: the matching
line was selected inside the correct source window but its viewport ratio was
zero because the pane was below the visible sheet area. Search now scrolls the
shared section into view before centering its selected row in the inner code
viewport. Input focus stays intact. The failed trace is retained as
artifacts/source-search-clipped-trace.zip, alongside the missing-search regression
in source-search-before.log and source-search-before-trace.zip.

Review also avoids repeated query normalization while locating the first match.
Lines and matching-line sets are memoized within the file. File identity is
explicit in the main viewer key, including commit-only capture changes. No
backend, persistence, analyzer version or export format changed.

Native WebKit passes real captured-file search and search within reviewed/current
diff contexts. The latter uses the existing explicitly synthetic ffff… baseline
in an isolated temporary XDG directory; its record hash is unchanged afterward
and the directory is removed. Native sourceSearchWorkspaceRendered and
changedLineSourceWorkspaceRendered are true. Artifacts:
source-search-native-evidence.json, source-search-native-probe.log and
native-smoke-evidence.json. Debug/optimized builds, Rustfmt and Clippy pass.
Core unit tests are not repeated because core logic did not change.

The private HTTPS probe uses real assets, AUR and the current recipe service.
Literal uppercase search finds exact PKGBUILD line 16, keyboard navigation
retains input focus, and search works at 390px. Filtered exports retain the
complete scan and agree with an independent CLI capture. Same-origin requests,
403 origin boundaries and zero browser/network errors pass. No review is written.
Artifacts: tailscale-source-search-evidence.json, tailscale-source-search.log,
tailscale-source-search.png, tailscale-source-search-mobile.png and
source-search-large-mobile.png (the 1,000-line fixture). The updated desktop
and existing private packed preview are running.

The first full Firefox run passes 96/97, including every search/recipe check.
Its existing dependency accessibility case loses inspection state to a page
reload: Vite reconnects 0.217 seconds after a README edit made during the run.
A controlled follow-up observes Vite's full-reload WebSocket message and main
navigation immediately after another README edit. This is a confirmed development
reload trigger, so the final suite must run without watched-file edits or builds.
Artifacts: source-search-reload-run.log, source-search-reload-results.json,
source-search-dependency-reload-trace.zip and source-search-document-reload.json.
No test assertion or timeout was changed. The existing Chromium screenshot crash
remains a separate unconfirmed mechanism; see BROWSER-VERIFICATION.md.

Final verification passes all 97 Firefox tests in 131 seconds, with zero retries,
skips or flaky results after watched-file activity stops. Both new source-search
flows also pass in system Chromium. The 26 focused recipe/source checks, frontend
type/lint/format checks, Rustfmt/Clippy, debug/optimized builds, native probe and
real private HTTPS probe pass. Full results: source-search-full.log and
source-search-full-results.json; Chromium results: source-search-chromium-focused.log.
Automated accessibility checks do not replace assistive-technology usability
testing, and text matches do not establish recipe safety.
