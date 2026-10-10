# Browser verification

Goal: repeat the complete dashboard suite in an independent browser while
preserving accessibility rules, screenshots, assertions and failure evidence.
This follows the Chromium interruptions recorded in RECIPE-REVIEW.md.

- [x] Reproduce capture failures and compare controlled conditions.
- [x] Review the evidence before changing the test runner.
- [x] Add explicit Firefox selection without automatic fallback.
- [x] Confirm both engines collect the same 95 tests and reject invalid selection.
- [x] Verify the final repository command and private HTTPS browser flow.

## Runner

`bun run test` retains system Chromium as the default. Its executable can be
selected with PLAYWRIGHT_CHROMIUM_EXECUTABLE. `bun run test:firefox` selects the
Firefox revision installed for the locked Playwright version; use
`bunx playwright install firefox` if it is absent. PLAYWRIGHT_BROWSER accepts
only chromium or firefox. Chromium paths/flags do not apply to Firefox.

Both commands run the existing suite with the same viewports, reduced motion,
timeouts, one worker, screenshot/trace retention and WCAG rules. No test assertion,
accessibility rule or capture was removed. An engine failure does not silently
switch engines. Browser selection verification is retained in
artifacts/browser-selection-verification.json.

## Investigation on 2026-10-06

System Chromium 152.0.7977.82 intermittently fails Page.captureScreenshot and
crashes during capture. The recorded renderer Compositor SIGTRAP and subsequent
browser failures are confirmed; their frames remain unsymbolized. A fresh browser
stderr probe also records browser SIGTRAP. No core was extracted. Earlier resource
checks found available memory/storage and no inspected cgroup/kernel OOM kill.
The failure mechanism is still unconfirmed.

A plain document captures successfully at 15,562px. The dashboard's integrity
fixture measures 15,482px; viewport and full-page captures also pass in a probe
without Axe/tracing. Running Axe before capture produces intermittent
failures even without tracing. Opening/closing a blank tab alone passes. Four
repeats per Axe variant yielded:

| Before capture                     | Passed | Failed |
| ---------------------------------- | -----: | -----: |
| No additional step after Axe       |      2 |      2 |
| Bring the app tab to front         |      0 |      4 |
| Wait two animation frames          |      2 |      2 |
| Bring to front and wait two frames |      2 |      2 |

These observations do not establish Axe as the cause or prove the app layout is
defective. They dismiss focus restoration as a reliable fix. Accordingly, no
focus delay, legacy Axe mode or renderer workaround was added. Browser packages,
system settings, GPU configuration and personal browser profiles were unchanged.

Artifacts: capture-integrity-controlled-repeats.json, `capture-integrity-*-repeat-*.log`,
capture-integrity-browser-stderr.log, `capture-integrity-*-metrics.json`,
capture-isolation-tall-evidence.json and capture-isolation-tall-run.log.
Probe scripts catch capture failures to record both outcomes; their process exit
code is not a test pass. The recorded failures are authoritative.

Bundled Firefox 155.0 passes the four focused dependency/integrity accessibility
and desktop/mobile capture checks. The first complete independent run passed
94/95: the dark recipe flow timed out after its panel disappeared following an
Axe scan. Its cause was unconfirmed at the time. Eleven isolated runs with pointer/focus event
instrumentation passed unchanged flow assertions; that is not evidence of a fix.
Follow-up source-search investigation confirms that this trace contains a second
Vite connection/main document load, consistent with loss of panel state on reload.
A controlled README edit emits Vite's full-reload message and navigates the page.
Development runs therefore need watched-file edits/builds stopped while testing;
see RECIPE-SOURCE-SEARCH.md for the controlled evidence. This does not explain
the separately confirmed Chromium Compositor crashes.
The original failure trace, screenshot and error context remain in
artifacts/firefox-test-results/recipe-reviews-dark-recipe-47964-o-automated-WCAG-violations/.
Logs: firefox-focused-verification.log, firefox-full-verification.log,
firefox-test-results.json and `firefox-panel-diagnostics*.log`. Eight event captures
are retained as `panel-events-*.json`.

## Final evidence

`bun run test:firefox -- --reporter=list,json` passes all 95 tests on the final
runner configuration in 127 seconds, with zero retries, skips or flaky results.
Assertions and captures are unchanged, including the previously interrupted dark
recipe flow. This is a clean independent run, not a claim that the earlier panel
interruption or Chromium crash was fixed. Reports are retained in
artifacts/firefox-final-verification.log and firefox-final-results.json.

The real Firefox private HTTPS probe searches AUR, captures the current
visual-studio-code-bin recipe, renders rules v1, jumps to exact PKGBUILD line 16
on desktop/390px and exports complete evidence after filtering. Its commit,
digest, ruleset and findings match an independent CLI capture. All browser
requests remain same-origin; hostile Origin/cross-site requests return 403.
There are no browser errors or failed network requests. This probe uses the real
service without transport replay or review writes. Artifacts:
tailscale-firefox-static-ruleset-evidence.json, tailscale-firefox-static-ruleset.log,
tailscale-firefox-static-ruleset.png and tailscale-firefox-static-ruleset-mobile.png.
The existing desktop and packed private preview continue running; the helper
confirms loopback, HTTPS and initial assets return 200. Host verification does
not establish connectivity from the user's Mac.

Frontend types, lint and formatting pass after the runner change.
Application/native/core source did not change, so native builds and Rust tests
are not repeated for this runner-only change. The prior native/WebKit evidence
remains documented in RECIPE-REVIEW.md. Independent engine coverage cannot
establish Chromium stability, recipe safety or assistive-technology usability.

The subsequent finding-comparison feature passes all 105 Firefox tests with zero
retries, skips or flaky results, including strict baseline invalidation, moved-ID
search and both-theme accessibility. Two new comparison flows also pass in system
Chromium. The native WebKit and private HTTPS checks pass; synthetic saved-baseline
comparison coverage is explicitly distinguished from live current recipe checks.
See RECIPE-FINDING-CHANGES.md and artifacts/finding-changes-full-results.json. The
existing full-suite Chromium screenshot instability remains unresolved.

Saved-review row rechecks subsequently pass all 108 Firefox tests without retries,
skips or flaky results. The three new explicit-check/failure/replaced-baseline
flows also pass in system Chromium. Both-theme row WCAG and 390px checks pass;
controlled geometry evidence distinguishes transient resize layout from lasting
overflow. Assertions target the active inspection where its status now also
appears in the row. The full width and accessibility assertions remain intact.
Native WebKit and private HTTPS checks pass, with synthetic saved-row evidence
explicitly separated from live capture/CLI agreement. See IMPLEMENTATION.md,
artifacts/review-row-full-results.json and artifacts/review-row-layout.json. The
existing Chromium Compositor/screenshot instability remains unresolved.

Shared advisory state passes all 119 Firefox tests in 170 seconds without retries,
skips or flaky results, plus all eleven new flows in system Chromium. The focused
41-case Firefox run also passes. Coverage includes navigation during pending/
failed checks, inactive query routes, full unknown/known exports, zero-match
recovery, shared plan capture, paused background resume, explicit offline fetch
failure/forced retry and native string rejection details. Both themes pass 390px
width/WCAG checks using the existing compact design.

Chromium fulfilled route responses can bypass offline transport. The explicit
offline regression continues that exact request to the browser network layer,
then asserts real failure, retained unknown state after reconnect, and a forced
manual retry. The initial harness failure is retained; no engine flags or app
changes were made for that correction. Native WebKit controlled failure/live retry
and the real HTTPS/CLI flow pass. The initial native interceptor failure and
unclassified HTTPS abort are documented separately in IMPLEMENTATION.md.

Evidence: artifacts/advisory-state-full-results.json,
advisory-state-chromium-final.log, advisory-state-native-evidence.json and
tailscale-advisory-state-evidence.json. Builds/source edits/native restart finished
before the full Firefox run. The earlier Chromium full-suite screenshot crashes
remain unresolved; focused passing flows do not establish overall engine stability.
