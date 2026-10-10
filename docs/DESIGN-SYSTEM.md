# Design system

ArchHub is a compact package-security workspace. The user selected light slate and
navy for this redesign. Task hierarchy, evidence readability and predictable
controls take precedence over banners, decorative charts and explanatory cards.

## Foundations

| Role            | Light     | Dark      | Purpose                               |
| --------------- | --------- | --------- | ------------------------------------- |
| Canvas          | `#f5f6f8` | `#101216` | Neutral workspace                     |
| Surface         | `#ffffff` | `#171b22` | Lists and focused evidence            |
| Text            | `#20252e` | `#e4e9f1` | Primary reading                       |
| Supporting text | `#596578` | `#a5b0c0` | Metadata and context                  |
| Accent          | `#29476b` | `#a9bfde` | Actions and selection                 |
| Border          | `#dce1e9` | `#303743` | Quiet separation                      |
| Review          | `#825715` | `#efc785` | Missing, stale or incomplete evidence |
| Finding         | `#ad3541` | `#f3a4ac` | Severity requiring attention          |

Semantic tokens in src/styles/globals.css map into Tailwind v4. Customized
shadcn/Radix primitives consume the same tokens. Application identity and package
icons use a restrained monochrome treatment. No remote fonts, gradients, imagery,
coverage rings or aggregate safety scores.

Locally served Manrope headings, DM Sans controls/body and IBM Plex Mono technical
values remain available. Page titles are plain task names at 26–28px; body is
13–14px and supporting copy 12px. Versions, filenames and hashes wrap as needed.
Spacing follows a 4px rhythm; borders are 1px, surface corners 6–8px. Shadows are
reserved for floating layers and small selected controls. Buttons transition
colors, avoiding opacity animation when availability changes.

## Hierarchy and navigation

Six primary areas: Overview, Packages, Security, Updates, Maintenance and Activity. Settings
is separate at the bottom of the 196px sidebar. Related views are local route
links with aria-current: Installed/Repositories/AUR/Foreign/Saved under Packages,
and Advisories/File integrity/Dependency paths/Recipe reviews under Security.
Existing route hashes and query deep links remain valid. These links navigate;
Radix tabs are used for views within a task. Command/Ctrl K searches packages and
navigates without exposing every destination in the sidebar.

The overview contains a single metrics strip and actionable review queue.
Advisories with zero matches do not occupy a review row; coverage remains visible.
Foreign origins and old/missing databases retain explicit review states. Small
inspection links lead to AUR recipes, installed files and dependencies. No
featured packages, promotional banners or redundant checklist panels.

Package lists prioritize name, description, version and repository. Lists retain
search, filters, pagination, virtualized rows, bookmarks and detail sheets. Light
appearance and compact rows are the defaults for new sessions; existing stored
appearance/density choices persist. Settings makes both choices explicit.

## Progressive disclosure and evidence

Security leads with findings, with a small coverage strip rather than three large
cards. Publication freshness stays unknown. Failed forced advisory refreshes
invalidate current results and disable exports of apparently current evidence.
Detailed coverage limitations remain available in a disclosure.

Updates separates Version changes and Compare package. Both views retain their
state while switching. Review actions carry the selected package into comparison.
Changed dependency/provides/conflict/replacement sections open by default; unchanged
sections collapse. Artifact metadata is labeled unverified in its summary.
Incomplete coverage remains visible above the details. Plans and exports retain
all captured evidence regardless of display state. Full transaction resolution,
archive verification and updates remain outside the read-only boundary.

File and dependency checks show summary counts after a result exists. Results
retain changed/configuration/unavailable distinctions, gaps and stale/unknown
advisory evidence. Local metadata's unauthenticated status remains visible beside
file-check results. Reference digests and longer interpretation notes collapse.
Recipe reviews show saved records rather than placeholder statistic cards.

AUR recipe workspaces retain raw numbered files, Sources, Changes and Review
record tabs. Source checksums, commits and key fingerprints are declarations;
bytes and signatures remain unverified. Personal review notes are inspection
records, not install permission or safety verdicts.

Changed recipes use reviewed/current line gutters in the existing unified diff.
Selecting a valid line opens one source pane within Changes, labeled with side,
path and full captured commit. Return to diff restores the originating control's
focus. Missing or mismatched baseline bytes leave reviewed jumps unavailable with
an explicit reload action. Truncated previews stay visibly incomplete; full
captured exports retain both the diff and scan regardless of source selection.

Captured source has one inline find field with previous/next/clear actions.
Case-insensitive literal search counts matching lines across the whole selected
file. Enter/Shift+Enter wrap through matches while retaining input focus; the
search controls and selected line stay visible together. Source pages and complete
exports retain all bytes. Reviewed/current panes keep their explicit identities.

## Interaction and verification

Radix dialogs/sheets/tabs/selects provide keyboard behavior. Mobile navigation
uses a modal Sheet with trapped focus, Escape dismissal and explicit focus return
to its trigger. Closed navigation and inactive task tabs leave the accessibility
tree and tab order. Local view links scroll horizontally within their own bounds.
The main content fits 390px width; primary actions stay reachable without hover.
All statuses combine text and color. Reduced-motion preferences are respected.

Verify real workflows and full evidence exports, theme-specific WCAG A/AA scans,
mobile overflow, keyboard focus, failed/stale evidence, native WebKit and private
Tailscale delivery. Automated checks supplement visual review and do not establish
full assistive-technology usability. See REDESIGN.md for this change's evidence.

The existing recipe Changes tab includes a compact static-finding comparison.
Category buttons carry observation counts; search and 25-row pages bound review
work. Reviewed/current actions open the existing numbered source pane and Return
to findings restores keyboard focus. Neutral labels describe scanner observations
without a green resolution state. Unknown analyzer/baseline/location states show
an explanation instead of speculative counts. No additional top-level navigation
or summary dashboard cards are introduced.

Saved recipe rows include one explicit check, a dated capture result and the
existing evidence/export actions. Compare opens Changes directly when a complete
inspection matches the displayed saved baseline. A neutral match badge describes
snapshot equality, without a safety verdict. Pending/failed/changed-baseline
states explain the next useful action. Check/Recheck, Compare and Export remain
on one row at 390px, with full accessible labels identifying each package. Saved
notes and reviewed/captured commits remain visually distinct.

Advisory pending/failure states are consistent across workspace navigation.
Overview shows an em dash, checking/waiting/unavailable copy and an actionable
review-queue item. Prior findings and coverage counts are withheld. Background
checks waiting for network access say so. Updates explains why plan creation is
disabled while another advisory check runs. Metadata inspection and export remain
available with explicit unknown advisory evidence. These states use existing
neutral/warning tokens and compact layouts; no extra dashboard cards are added.

Recipe capture state follows the package across navigation and inspection closure.
Pending/failed reads leave existing files and exports available under an explicit
unknown label, with current comparisons withheld. Acknowledgment stays disabled
until a complete current capture is available and resets for another identity.
Notifications use the workspace's popover, text and border tokens in both themes,
with semantic icon colors. Text remains neutral and readable rather than using
Sonner's independent colored notification palette.

Maintenance groups online checks, orphan review and disk usage in three tabs.
No online check starts on navigation. Pending/failed checks withhold old
conclusions, retain explicit unknown states and require manual retry. Captured
results persist across navigation and carry their check date and package-state
identity. Overview shows an em dash for stale zero local updates and links to
Maintenance. Cache totals label partial coverage. Package actions display validated,
quoted terminal commands, including the full updater lifecycle, with a Copy action;
they do not imply a resolved transaction or execute package operations.

Removal review uses exact installed versions. Package details offer an explicit
Review removal action; the orphan list supports checkboxes, Select this page,
Clear selection and a removable selection disclosure. Filtering/paging retains
the selection, capped at 100; inventory changes clear it. Mobile package metadata
uses its own full-width row above selection/inspection controls.

A current removal capture lists every selected package, installed metadata size,
required blockers, HoldPkg matches and optional features losing all providers.
Only a successful unblocked capture offers a Copy command. Rechecks withhold old
conclusions while pending; failure/lock/change retains unknown state. Exports
preserve all captured rows with status and a nullable actionable command. The
UI explains plain removal and pacman's final prompts without claiming safety.
