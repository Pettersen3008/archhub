# Update preparation review

Scope: the new read-only request, fixed official RSS ingestion, Updates preparation,
CLI handoff, existing plan freshness guard and native verification hook. Compared
against `target/update-preparation-before`; this checkout has no Git metadata.

Findings presented before corrections:

- Confirmed integration defect: the official RSS includes a self-closing Atom
  metadata link. Rejecting every empty XML element rejected a valid upstream feed.
  Allow metadata elements while rejecting empty required fields and field markup.
- Confirmed boundary defect: a rendered enabled copy button could outlive the
  15-minute capture limit until the next clock tick. Schedule expiration and check
  the wall clock again on the copy click.
- Confirmed export boundary defect: a wall-clock jump could leave the displayed
  readiness state behind the actual expiry. Revalidate time while producing the
  export, as the copy handler already does.
- Confirmed evidence gap: initial stale-plan tests closed the plan before changing
  inventory. Keep it open, trigger a shared inventory refresh, and assert its own
  copy button becomes disabled.
- Confirmed mobile layout issue: center alignment clipped the first update tab at
  narrow widths; the repository list also pushed notice review too far down. Use
  left-aligned scrolling tabs and a bounded, scrollable version list.
- Confirmed accessibility defect: bounding the version list introduced a scroll
  region without keyboard access. Give the region an accessible name and tab stop.
- Confirmed evidence gap: the mobile theme fixture used an obsolete preference key.
  Use the current preference record and assert the actual document theme.
- Concern, addressed: ignored text outside the RSS root could accept an HTML/error
  suffix. Reject non-whitespace outer text, outer entities and outer CDATA.
- Confirmed development defect: Tailwind's repository-wide scan registered Markdown
  and Rust files as frontend inputs. An existing Markdown fixture edit reloads the
  document and clears the current review (red regression test). Restrict source
  detection to `src/` and retain a watcher regression test with a restored fixture.
  [Tailwind source paths](https://tailwindcss.com/docs/detecting-classes-in-source-files#setting-your-base-path).
- Dismissed: failed news should discard successful repository evidence. Preserve
  independent failures, mark the capture partial and withhold handoff.
- Dismissed: old article dates prove feed retrieval failed. Publication and retrieval
  are different evidence; show both, with window/freshness limitations.

Boundaries reviewed: fixed HTTPS endpoint with no redirects, bounded response bytes,
XML depth/fields/items, no DTDs, official credential-free article URLs, no rendered
article HTML, RFC2822 dates, independent source failures, shared repository check
semaphore, final forced inventory/lock/version checks, fixed full updater commands,
manual-only retries, navigation persistence, acknowledgment identity, expiration,
full exports and unchanged privileged-helper contracts. No upgrade is executed.

Final verdict: all confirmed findings are corrected. Verification evidence and
its limits are recorded in [IMPLEMENTATION.md](IMPLEMENTATION.md#guided-full-system-update-preparation).
