# Static findings since a saved review

Goal: compare scanner observations in the existing Changes tab. Done means newly
reported, still reported and no longer reported patterns have accurate counts,
bounded searchable lists and exact captured-source navigation. Both snapshots
must be complete, use a known matching static analyzer version, and match the
comparison's saved baseline. No missing finding is described as fixed or safe.

- [x] Explore scanner identities, saved baseline contracts, Changes and tests.
- [x] Define matching, uncertainty gates and source navigation.
- [x] Reproduce the missing workflow; implement the comparison.
- [x] Review identity, duplicate occurrences, stale records and focus boundaries.
- [x] Verify logic, browser accessibility/mobile, native and private preview.

The frontend derives a comparison from existing captured scans; IPC, saved records,
exports and analyzer rules remain unchanged. A shared saved-review identity check
serves both the file diff and finding comparison. Findings match by rule identity,
file, all scanner metadata and exact captured line text, ignoring line-number
movement. Duplicate observations consume one reviewed occurrence each. A changed
command produces a newly reported observation and a no-longer-reported observation.
Missing locations or malformed rule identities block comparison rather than
inventing correspondence. Matching source text does not prove unchanged behavior:
surrounding code, inputs and execution context require the existing file review.

Alternative: compare finding IDs alone. Current IDs include line numbers, so an
inserted comment would falsely classify moved findings as additions/removals, and
a changed command on the same line could falsely look unchanged. Exact line text
and rule metadata provide a conservative presentation without new scanner state.

The component owns category/search/page state and reviewed/current source context.
Lists show at most 25 observations per page. Source actions open only captured
files and return focus to their triggering action. A changed baseline invalidates
all derived observations and source context. Reload uses the existing saved-record
request. Legacy/different analyzer versions retain file comparison and exports but
do not receive a finding comparison. Incomplete/offline/failed current captures
use the existing Changes uncertainty messages.

Verification: rule/line movement, changed commands and metadata, duplicate counts,
malformed locations, version gates and strict baseline identity; fixture UI with
all categories, search/paging, source actions/focus, mobile and both-theme WCAG;
full Firefox suite, focused Chromium checks and debug/optimized native builds.
Native/private comparison verification uses clearly labeled isolated synthetic
saved records; real current capture/preview checks must not write personal reviews.

Review found and corrected duplicate sibling keys between the file diff and
finding comparison. A recheck could preserve a stale duplicate component; the
baseline-replacement regression reproduced this. Distinct file/finding keys now
also include both analyzer versions and scan times. Review also found that moved
observations were searchable only by the current ID. A regression confirms the
saved ID incorrectly hid its retained observation; search now includes both IDs.
Artifacts: finding-changes-before.log, finding-changes-duplicate-key-trace.zip,
finding-changes-saved-id-before.log and finding-changes-saved-id-before-trace.zip.

The initial full Firefox run passes all 105 tests with zero retries, skips or
flaky results before the search refinement. The final run verifies that
refinement too. The 34 focused checks pass, including both-theme WCAG and 390px
layout. Both new flows pass in system Chromium. All source actions stay within
captured bytes; filters preserve full exported evidence. Frontend checks,
Rustfmt/Clippy and debug/optimized native builds pass. Core logic is unchanged,
so core unit tests are not repeated.

Native WebKit renders counts and both reviewed/current finding source contexts
and returns focus to their actions. This uses the existing explicitly synthetic
ffff… baseline in temporary XDG state. Its record hash remains unchanged and the
directory is removed. Artifacts: finding-changes-native-evidence.json and
finding-changes-native-probe.log; findingChangesWorkspaceRendered is true in
native-smoke-evidence.json. The separately shipped release desktop runs the
updated assets without the debug hook.

The private HTTPS comparison probe replays that isolated Rust/native comparison,
with real shipped assets, inventory and AUR search. A separate live recipe API
request matches the native current capture. Finding source links, focus return,
390px visibility and full export equality pass. This is synthetic comparison
coverage, not a historical AUR observation or a personal review write. Artifacts:
tailscale-finding-changes-evidence.json, tailscale-finding-changes.log and
tailscale-finding-comparison-{reviewed,current,mobile}.png. A separate real HTTPS
probe uses no replay: current source search/export agree with an independent CLI,
requests stay same-origin, hostile origins/cross-site requests return 403, and no
browser/network errors occur (tailscale-finding-changes-live-evidence.json).
The preview's prior stopped server was restarted on the existing private Serve
mapping. Loopback/HTTPS/assets return 200 in finding-changes-preview-status.json.

Final verification passes all 105 Firefox tests in 143 seconds, with
zero retries, skips or flaky results. The moved-observation regression now finds
both reviewed and current IDs. Reports: finding-changes-full.log and
finding-changes-full-results.json; initial results remain separately preserved.
Both new flows pass again in system Chromium after the refinement.

Final debug and optimized builds use the project desktop commands
(bunx tauri build --debug --no-bundle and bun run build:desktop), with embedded
frontend assets. The native probe and both private HTTPS probes pass again after
the refinement. One intermediate Cargo release compile received SIGKILL; no OOM
event was recorded in the inspected kernel log or process cgroup. Its cause is
unknown; a repeated compile and both final project builds succeed. The interruption
log remains in finding-changes-release-interrupted.log. The final desktop, dev API
and existing packed preview remain running. Refresh the Mac page for new assets.

Chromium's earlier full-suite Compositor/screenshot instability remains open;
focused comparison coverage does not establish full-engine stability. Automated
WCAG checks do not replace assistive-technology usability testing. No finding
comparison proves safe execution or authenticates installed/upstream bytes.
