# Workspace redesign

Goal: reduce the work required to find and review package evidence. Done means a
coherent new shell/palette, useful overview, simpler Security/Updates screens,
retained package/scanning/export workflows, mobile keyboard/accessibility checks,
and verified native/private browser delivery.

Observed: twelve sidebar destinations, marketing copy, decorative coverage ring,
repeated cards explaining trust/updaters, and 9–11px supporting copy. The shared
shell owns route navigation and preferences; semantic CSS tokens style the
shadcn/Radix controls. Package/scanning state belongs to existing feature modules.

Design: five main areas (Overview, Packages, Security, Updates, Activity), with
local route tabs for package scopes and security tools. Existing hashes/deep links
continue to work. A compact overview shows actionable review rows and evidence
freshness. Security prioritizes findings and clear coverage status. Updates uses
Changes/Compare views instead of stacking both workflows and explanatory cards.
Metadata, source policy and detailed limitations use disclosures; incomplete,
stale and unavailable status remains visible beside the evidence.

User-selected light slate/navy is the default direction, with a complementary
graphite dark theme. Existing appearance preferences persist. New sessions choose
light appearance and compact package rows; appearance can be changed in Settings. No remote font/image assets.
A restrained line-based visual language replaces nested rounded cards, colored
application avatars and ornamental badges. Text/actions stay clearly distinct.

Alternative: only recolor the current layout. Rejected because the user identified
bloat and poor hierarchy, which cannot be resolved through color alone.

Risks: local tabs may hide less-used tools; route groups, command search and task
links retain access. Disclosures must not conceal uncertainty or export coverage.
Navigation changes intentionally require updated route-focused tests. Preserve
Rust/IPC contracts and evidence export semantics. Mobile navigation uses the
existing Radix Sheet focus/escape behavior. No host/package mutations.

- [x] Explore current screens, route ownership, tests and component contracts.
- [x] Define task hierarchy, compatibility and verification.
- [x] Implement tokens, shell, overview and focused evidence layouts.
- [x] Review changed behavior and fix confirmed issues.
- [x] Verify browser accessibility/workflows, native and private preview; update docs.

Review: confirmed tab switching would unmount a captured comparison; both update
views now preserve state while inactive panels stay hidden. Confirmed an explicit
advisory refresh could leave old success visible; failure now invalidates current
results and export availability. File-check reference limits were moved to a
disclosure, with a concise unauthenticated-metadata statement retained beside the
result. Package list signature badges and duplicate detail buttons were removed;
trust evidence remains in the detail sheet. AUR rows no longer offer unsupported
bookmark actions. Native scan verification was updated for the new views and its
selectors distinguish tab triggers from action buttons.

Focused and full browser verification passes. The final full run has 64 tests,
all passing without retries, including both-theme WCAG A/AA scans, 390px overflow,
mobile trapped focus/Escape/focus return, legacy route/query links, preserving
comparisons across tab changes, full exports despite collapsed metadata, failed
forced advisory checks and existing inventory/AUR/review/integrity/dependency
flows. Rust workspace's 42 tests, Rustfmt and Clippy pass, alongside frontend
types/lint/format/build. Early runs caught outdated navigation/disclosure selectors
and button fade measurements; selectors and availability transitions were fixed.
Automated accessibility does not replace assistive-technology user testing.

The native WebKit probe passes with the final interface, including comparison,
source evidence, file integrity, dependency paths, recipe reviews and denied
unselected export paths. The optimized desktop build passes and its running
window was refreshed. The private Tailscale browser flow passed with real
inventory, CLI-matched comparison metadata, plan exports, AUR static scans,
source evidence, themes and mobile navigation. Cross-site requests remain denied;
same-origin assets/API and the existing private preview mapping remain healthy.
Screenshots and evidence are saved in artifacts/redesign-*.png,
artifacts/native-smoke-evidence.json and artifacts/tailscale-redesign-evidence.json.
No package installation or host configuration changes were made.
