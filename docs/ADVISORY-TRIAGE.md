# Advisory investigation

Goal: find a captured installed-package advisory quickly and carry its package
into existing inspection tools, within the compact slate/navy design.

The Security route owns local search, severity/confidence filtering and 25-row
paging. It consumes the existing Audit and Snapshot contracts; no new network,
persistence or backend API is needed. Search includes package, advisory ID, title,
description, CVEs and versions. The existing inventory fingerprint/failure gate
continues to control all findings, counts and full-evidence export. Paging is
clamped when refreshed evidence shrinks. Search/filter changes start at page one.
Package links use the established installed/dependency routes with encoded query
strings. Dependency inspection remains an explicit action on its destination.

Alternative: a separate advisory inspector with its own package requests. Existing
tools already own those inspections; another inspector would duplicate UI and
introduce asynchronous identity/state handling without improving evidence.

Done means large captures remain searchable and bounded, exports retain every
finding, failed/stale evidence never appears current, and both themes work at
390px without accessibility regressions. Live preview must load real evidence.

- [x] Explore current audit, navigation, row and export contracts.
- [x] Define UI ownership, stale-state boundaries and compatibility.
- [x] Implement compact search, paging and inspection links.
- [x] Review boundary, refresh, empty and large-result behavior.
- [x] Verify fixtures, real preview, build and regression checks.

Automated accessibility checks do not replace assistive-technology/user testing.
Search and metadata paths do not establish exploit reachability or package safety.

The first responsive test measured immediately after a desktop-to-mobile resize:
the browser still used the prior flex positions. A standalone browser reproduced
the transient overflow; two animation frames yielded the correct 390px layout.
The tests now wait for layout before measuring. No CSS assertion was relaxed.

Verification on 2026-10-06: all 86 Playwright tests pass, including seven new
investigation checks. They cover a 57-finding capture, search across late CVEs,
versions and IDs, full JSON export, severity/confidence filters, exact package
handoffs, smaller refreshed captures, failed refreshes and mismatched inventory.
Light/dark desktop and 390px WCAG checks pass; screenshots are under
artifacts/advisory-triage-*.png. Frontend type/lint/format checks and the optimized
desktop build pass. The existing native WebKit probe passes and the rebuilt
desktop is running. No backend contract changed, so Rust logic tests were not
rerun for this UI-only slice; the desktop builds compile the unchanged core.

The restored private preview exported real advisory evidence that matched an
independent CLI process: 1062 checked packages, 38 outside coverage and zero
matches. These are live observations, not fixture expectations or a safety score.
The preview has no live findings to exercise inspection links; those use fixtures
with real destination workspaces. All browser requests remain on the preview
origin; hostile Origin/cross-site requests return 403. See
artifacts/tailscale-advisory-triage-evidence.json and its desktop/mobile screenshots.
The matching Serve slot was reused with loopback development/API and preview
processes; the preview requires a rebuild when application source changes.
