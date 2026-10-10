# Foreign package recipe lookup

Goal: inspect an installed foreign package's possible AUR recipe without inventing
provenance. Done means explicit exact-name lookup, safe split-package base mapping,
version/maintainer evidence, existing pinned static review, complete export and
verified CLI/browser/native/private delivery.

Observed: local packages have no packageBase and cannot enter the recipe workbench
from their detail sheet. AUR search associates installed versions only by name;
that association is not provenance. Inventory owns foreign classification and
version identity; network owns bounded permitted-host metadata; the workbench
already owns pinned captures and personal reviews.

Design: a typed foreign_recipe request validates name, installed version,
fingerprint, foreign classification and locks before sending exactly that name
to AUR RPC info. It reloads and revalidates inventory after the request. Exact-name
success/no-match are distinct from failed/malformed results. Split packages use
the returned validated package base. Local/AUR version ordering uses libalpm.
One explicit lookup section in Origin & trust provides metadata and a separate
action to open the existing static workbench. No automatic inventory submission,
new sidebar area, recipe execution, installation or provenance approval.

Alternative: search AUR automatically for all foreign names. Rejected because it
sends inventory remotely and fuzzy matches could hide identity ambiguity.

Risks: matching names/versions do not prove origin or installed bytes; metadata
can change before a later pinned recipe capture. Missing packages may be deleted,
renamed, private or local builds. Failures clear previous evidence; changed state
disables the scan handoff. Exports retain the lookup context, capture time and
limitations. No persisted provenance claim is added.

- [x] Explore inventory, AUR transport and recipe workbench contracts.
- [x] Design explicit lookup and state validation.
- [x] Implement shared core/CLI/typed client and compact lookup UI.
- [x] Review identity, failure and disclosure boundaries.
- [x] Verify fixtures, live CLI/private/native, accessibility and builds.

Review: extreme RPC timestamps could break date rendering; timestamps now have a
finite nonnegative bound through year 9999. Invalid/whitespace versions, unsafe
base identifiers, malformed counts/types, duplicate or different-name results
remain failures. The streamed response is capped at 64 KB, with the existing
20-second client deadline and three shared recipe/lookup slots. A focused loopback
test checks the exact byte boundary. UI rechecks discard old lookup/scan state,
and inactive trust tabs retain state while remaining hidden. Current inventory
identity is required before handing off; historical exports mark mismatches.
The lookup is positioned before generic reference material for foreign packages.

RPC method semantics were checked against the official
[aurweb RPC documentation](https://github.com/archlinux/aurweb/blob/master/doc/rpc.txt)
and a real v5 info response. The service only contacts its fixed allowed HTTPS
host, with URL-encoded query parameters. Metadata lookup and pinned static scan
exports are separate evidence; neither associates installed bytes with a recipe.

Verification on 2026-10-05: all 52 Rust workspace tests pass, alongside workspace
Rustfmt/Clippy with warnings denied and frontend types/lint/format/build. Eight
new browser checks cover explicit lookup, split-base handoff, no match, failed
recheck, mismatched/stale inventory, state retention, full exports, both-theme
WCAG scans, 390px layouts and live service validation/origin boundaries. The first
full browser suite passed all 79 tests. After moving the lookup earlier in the
trust view, the full run passed 78 and one existing live source scan was
interrupted by a page reload. Its trace shows the page returning to empty AUR
search with the recipe request unfinished, rather than a completed failed scan.
The isolated live source flow then passed with build/window activity stopped;
the cause of that reload is not confirmed. The trace is retained in
artifacts/foreign-recipes-browser-reload-trace.zip. No assertion was relaxed.

The final debug WebKit probe renders foreign lookup and recipe handoff, rejects
stale identities and retains earlier security-plan/source/comparison/file/
dependency/scoped-export checks. The optimized build passes and its running
window is refreshed. The private HTTPS browser exported antigravity lookup
metadata matching a separate CLI process, then statically inspected the returned
base. Hostile Origin/cross-site requests returned 403; stale/injected identities
returned 400; browser requests stayed on the preview origin with no page errors.
No personal review was written. Screenshots/evidence are saved under
artifacts/tailscale-foreign-recipes*, artifacts/foreign-recipes-{light,dark}-mobile.png
and artifacts/native-smoke-evidence.json. Existing Tailscale Serve mapping/assets
remain healthy. Runtime package names/versions are observations, not expected
fixture constants. Human assistive-technology/usability testing remains outside
the automated evidence.
