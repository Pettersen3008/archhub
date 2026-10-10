# Security evidence in update plans

Goal: a read-only update plan captures installed-version advisory evidence and
the configured candidate's relation to the tracker-listed fixed version. Done
means CLI, browser and native contracts agree, failed feeds remain unknown,
inventory changes invalidate creation, and compact UI/export flows pass.

Observed: plans include version changes and candidate metadata, but security is
only a textual precondition. Advisory matching already belongs to the Rust core;
the client has no version-comparison authority. A failed forced audit currently
leaves the core cache intact, although individual UI views hide it.

Design: plan creation attempts a fresh advisory fetch for its captured inventory,
then reloads/revalidates inventory before returning. It never holds the inventory
read lock across network work. The core captures either full audit evidence with
per-finding candidate context or an explicit unavailable reason. All installed
findings are retained, including packages without version changes. A candidate
reaching a listed fix is version context, never a candidate security verdict.
Shared types retain a nullable security field for older exported plans. A failed
audit clears the service cache so another client cannot reuse prior success.

Alternative: correlate only the browser's cached audit while exporting. Rejected
because CLI/native would differ and cached failures/identities could be hidden.
No new routes, package writes, external inventory submission or persistent records.

Verification: fixture-based epoch/revision/equal/below/missing-fix checks,
audit identity rejection, failed-cache invalidation, plan rendering and full
exports, light/dark accessibility and mobile layout, full existing tests, real
CLI/API/private browser and native probe/build. Human usability/AT testing is
outside automated coverage.

- [x] Explore plan/audit ownership and compatibility.
- [x] Define core capture, version semantics and failure handling.
- [x] Implement core, generated transport and focused plan UI.
- [x] Review boundaries and fix confirmed defects.
- [x] Verify and refresh desktop/private preview.

Review: the backend audit cache could survive a failed forced check; it now clears
before fetching and a loopback timeout test proves a second client cannot reuse
that success. The plan updates/clears the browser's shared advisory cache as well.
All findings are retained, including packages without version changes; candidate
ordering uses libalpm and no safety verdict is inferred. A redundant missing-
candidate status was removed because matching requires an official repository
candidate. External links use the existing validated browser/native opener.
Pagination bounds rendering to 25 rows without truncating exports. Historical
plans remain exportable and visibly warn when current inventory differs or fails.

Verification on 2026-10-05: `cargo test --workspace` passes all 48 tests;
`bun run test` passes all 71 browser tests without retries in its final full run.
`bun run check`, `bun run build`, workspace Rustfmt/Clippy with warnings denied,
the debug native WebKit probe and `bun run build:desktop` pass. The first full
browser run had one dark overview contrast measurement inconsistent with its
screenshot/computed styles; three isolated runs passed. The check now waits for
the selected theme, fonts and populated overview before measuring contrast, and
the final full run passes. No accessibility rule was disabled.

The updated optimized desktop is running. The private HTTPS browser's complete
plan export matches independently captured CLI candidate advisory context, with
no page errors or cross-origin browser requests. Hostile Origin/cross-site
requests return 403; stale plans return 400. The native probe records matching
plan advisory identity and renders the section, retaining prior evidence/scoped
export checks. See artifacts/native-smoke-evidence.json,
artifacts/tailscale-plan-security-evidence.json, the private plan desktop/mobile
screenshots and plan-security-{light,dark}-mobile.png. Nonempty, unavailable and
large plan findings are covered by fixtures; live metadata had no advisory matches.
The existing private Serve mapping is unchanged and its assets/API are healthy.

Accepted limits: captures do not freeze package state. Before/after reloads can
miss short intervening transactions. Feed publication freshness and full affected
ranges are unavailable; AUR, third-party, bundled and language dependencies remain
outside coverage. Candidate archives are not fetched/audited. No installation or
system update is executed. Creating a plan now needs a metadata fetch, and a failed
fetch yields an explicit unknown section while preserving local plan evidence.
