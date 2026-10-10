# Security boundaries

ArchHub's UI, browser API and CLI remain unprivileged. The browser/CLI expose no package mutation or generic shell. Optional desktop removal uses a separate root-owned one-shot helper, described below; install, upgrades and arbitrary system configuration remain outside its API.

## Data and trust

Inventory comes from libalpm's local/configured sync databases. `/usr/bin/pacman-conf` resolves includes and compiled-in configuration defaults; inventory queries do not launch pacman or yay. Explicit installed-file checks launch a fixed pacman query, described below. libalpm handles are created and consumed in blocking workers, never shared across async threads. An owned in-memory index supports bounded, ranked queries.

Configured repository priority determines the preferred package candidate. A matching package name is not cryptographic installation provenance. A foreign package is absent from the current configured repositories; its original source remains unknown. The signature label reports local validation metadata, not a fresh verification of bytes or installed files.

Advisory data is downloaded from `security.archlinux.org/all.json`. Installed package names are matched locally; no installed inventory is submitted to a remote scanner. Only current candidates in core/extra/multilib are counted as checked. The feed lacks complete version intervals and publication-freshness metadata. Potential matches retain tracker status and version evidence and need human applicability review. No matches is not a secure-system verdict. The Advisories screen requires a matching inventory fingerprint for current results. A failed forced refresh clears that current status and disables exports until a successful check restores it; cached success is not shown as a new successful check.

AUR searches and build-file reads use fixed `aur.archlinux.org` endpoints. Package bases are validated and URL-encoded. Metadata response bodies are limited to 8 MB; build files to 512 KB each; requests time out after 20 seconds. Redirects are limited to the two HTTPS metadata hosts. HTML challenges are rejected instead of scanned as shell files. React renders all descriptions and recipes as text.

The static scanner runs text heuristics only, never a shell. It resolves the newest commit from the fixed AUR cgit Atom endpoint and fetches all files with that full commit ID. It inspects PKGBUILD and installation scripts declared by literal .SRCINFO references or simple literal PKGBUILD assignments. Paths reject traversal, absolute paths, shell syntax, URL query/fragment syntax and excessive depth. Dynamic Bash is not evaluated, and .SRCINFO can be stale; generated files, patches, source archives and dependencies remain outside coverage.

Files are bounded to 512 KB each, six install scripts and a 2 MB total bundle. Up to three scans run concurrently per service, with a 45-second scan deadline. Findings are bounded during analysis, with truncation explicitly marking coverage incomplete. Source and finding views are paged; diff computation runs on a blocking worker with a deadline and capped display output. Full captured bytes remain exportable. The versioned, length-framed SHA-256 identifies file names and bytes; separate file hashes and the commit ID identify the snapshot. None of these authenticate the maintainer or verify source archives, built packages or installed bytes.

Static captures identify the ruleset version. Checksum detection recognizes exact
literal SKIP words in supported PKGBUILD checksum assignments, including multiline
and architecture arrays; escaped/dynamic expressions remain uninterpreted. Remote
shell pipeline detection requires an exact downstream sh/bash/zsh basename. These
rules do not parse complete shell context and can still miss behavior or produce
contextual false positives. Version metadata is not authenticated. Saved static
findings remain as recorded, including older unversioned captures; reads do not
recompute those findings or rewrite personal records. This differs from derived
source-declaration evidence below.

Diff line numbers are presentation hints. Source-context actions require bounded
hunk coordinates and exact equality with the corresponding captured file line.
Reviewed context additionally requires the loaded saved record to match the
comparison baseline's package, commit, bundle digest, scan/review times and static
analyzer version. Replaced/unavailable records cannot supply another snapshot's
source. The pane explicitly distinguishes reviewed/current captures; it does not
read files from disk, execute recipes or fetch declared upstream sources.

Captured-file search is a local, case-insensitive literal text match. It searches
only the selected snapshot file, including source windows beyond the current page.
Search terms are not sent to the API and do not become analyzer findings. File or
capture identity changes reset search; navigation and exports retain captured bytes.

## AUR source declarations

A pure analyzer reads the captured .SRCINFO file, preserving source/checksum order
within each architecture group and exact line numbers. Source or checksum entries
outside the pkgbase section, unsupported values and mismatched array lengths leave
metadata extraction incomplete. SKIP and legacy algorithms are review evidence,
not failed byte checks. VCS tag/branch/abbreviated references remain mutable or
ambiguous; a full Git commit string is only a declared reference. Git signed-query
requests and filename-based detached-signature associations are unverified.
Declared key fingerprints do not establish ownership, trust, expiry or revocation.

The analyzer does not execute makepkg, shell, Git, GPG or project tooling. It does
not download declared upstream URLs, keys, signatures or local sources, and it does
not expose an arbitrary path/URL request. React renders declarations as text;
source URLs can be copied but are not automatically opened. Downloaded sources,
patch contents, generated files and executable recipe/metadata agreement remain
outside coverage. Same-commit .SRCINFO can still be stale. Extraction is bounded
to 512 KB of metadata, 200 sources, 100 key declarations and 2000 recognized entries;
warning previews are bounded. Captured raw files remain exportable.

Recipe reports include versioned derived source evidence and the .SRCINFO digest.
Validated saved reviews recompute it from their captured bytes on read, including
older JSON records. Reads preserve the original snapshot identity, notes and
review/capture times and do not rewrite records. Derived fields in saved JSON are
not used as authoritative analysis. Metadata extraction completeness is separate
from captured-file coverage and personal review status. A failed current fetch
retains prior evidence with current state unknown; an unsaved cached capture is
identified separately from a saved review in the UI and exports.
See [design and verification](SOURCE-EVIDENCE.md).

## Installed-file checks

The `integrity` request accepts only a validated installed package name and expected version. It launches `/usr/bin/pacman` with fixed query/double-check flags, root/database paths resolved from system configuration, color disabled and C locale, without a shell. It never executes hooks, refreshes a database, repairs files or elevates privileges. Only one check can run per service; the child has a 90-second deadline and each captured stream is limited to 2 MB. Cancellation, output overflow and deadline expiry stop the child.

The result groups per-path diagnostics, separates pacman backup content/timestamp changes from ordinary changes, and preserves unreadable files/missing checksums as unavailable evidence. Missing or permission-altered backup files remain ordinary changes. Unknown diagnostics, missing mtree/summary, a short manifest count, configured NoExtract rules, or inconsistent exit/altered counts mark coverage incomplete. Per-file messages report differences, not the original and observed bytes or hash values. No file contents leave the checker.

Before/after SHA-256 fingerprints of expanded configuration and local desc/files/mtree detect observed reference changes. A different installed version, an observed lock or changed metadata prevents a complete result. This does not lock or freeze the filesystem; concurrent file changes and undetected short-lived transactions remain possible. Local metadata and the pacman executable are trusted, unauthenticated references. This is not a malware scanner, signed-artifact comparison or tamper-proof audit. Results stay in memory until explicitly exported. See [design and verification](FILE-INTEGRITY.md).

## Installed dependency paths

The `dependencies` request accepts a validated installed package name and expected
version, never a path or command. An owned index built from libalpm's local
installed metadata records required/optional declarations and virtual providers.
The matcher uses libalpm version comparison and validates each declaration
against its canonical satisfier lookup. It reports every matching installed
provider, which can overstate a particular runtime choice. Reverse edges include
only required declarations. No package code or shell executes.

Traversal selects one shortest deterministic path per package, excludes cycles,
and limits each direction to 1000 nodes and 12 edges. Missing-required evidence
is capped at 5000 declarations. Bounds or unresolved required providers leave
completeness false. Optional declarations are not traversed. Build, bundled and
language dependencies, runtime symbols and resolved removal transactions remain
outside coverage.

Snapshot fingerprints include installed versions, required/optional declarations,
provisions, install reason and recorded validation bits. Metadata-only changes
invalidate correlation. Cached inventory can be up to 60 seconds old; an explicit
refresh is available. An observed package lock rejects inspection. Reading local
metadata is not an atomic transaction: a short lock/change can go unobserved.
Advisory evidence correlates only with the identical snapshot fingerprint and
matching installed versions. Failed or stale advisory refreshes remain unknown,
including in exports. Matching occurs locally without submitting installed names.
Zero matches and complete metadata paths are neutral evidence, not security or
removal-safety verdicts. See [design and verification](DEPENDENCY-PATHS.md).

## Access and persistence

The desktop transport exposes one typed package evidence interface, generated from Rust with Specta. Package reads and personal review-record writes share the Rust service; no request can mutate package state or select an arbitrary internal persistence path. Tauri CSP limits scripts/assets to the application and network connections to IPC. Browser metadata requests go through the Rust backend rather than remote page scripts. Only HTTP/HTTPS package links may open in an external browser.

The optional development API binds to `127.0.0.1:4318`, with Vite on `127.0.0.1:1420`. JSON bodies are bounded to 16 KB. The API checks Host, Origin and cross-site fetch metadata; no CORS permissions are granted to remote websites. This is a local development interface, not an authenticated remote dashboard.

Native report export grants Save As dialog permission and scoped text-file writing. No blanket filesystem read/write scope is granted. Tauri's save dialog grants the selected path; arbitrary unselected paths are denied. The browser uses normal JSON downloads. No clipboard content is read; copying hashes/commands only writes the user-selected value.

Appearance preferences and saved repository package IDs are persisted in application-local storage. Stored values are validated before use. Explicit personal recipe reviews persist to the workstation's XDG state directory: one latest baseline per package base, with the captured scan, commit, file bytes/digests, review time and note. Up to 40 records are retained. File names derive from a hash of validated package bases. Atomic writes, private permissions and a filesystem lock serialize separate browser/native clients. Files are bounded when read; corrupt or mismatched hashes produce an error instead of a reviewed state. Package state remains untouched.

Foreign package AUR lookups are explicit. The core validates the selected name,
installed version, foreign classification, inventory fingerprint and lock state
before and after requesting exact-name RPC info. Only that name is sent to AUR.
Replies must have one matching result or a valid empty result; malformed, duplicate,
mismatched and unsafe recipe-base identities fail. The lookup response is capped
at 64 KB, uses the existing 20-second network deadline and shares three bounded
recipe/lookup slots. An association is a provenance clue, not verified installed
origin. Split packages use the returned validated base for a separately pinned
static capture. Failed rechecks clear prior lookup/handoff state; inventory changes
disable the handoff. Exports preserve captured context and current-identity status.
Before/after inventory checks cannot freeze the filesystem or remote metadata.
No provenance record or package mutation is persisted. See FOREIGN-RECIPES.md.

A review request must match the service's most recent cached scan by digest, commit and displayed analyzer version, include a note, and have complete required-file coverage. Missing or mismatched analyzer versions reject the write, preventing an older client from recording newly analyzed findings it did not inspect. A later different commit, bundle or analyzer version cannot inherit that review. Older unversioned records remain readable and require findings review against current scans even when file bytes match. Failed remote reads leave current state unknown; saved evidence remains separately available. Review records are editable application data under the user's account, not a signed/tamper-resistant audit trail or a privileged action authorization. Replacing a baseline replaces its previous note; export before replacement when long-term history matters. No telemetry, credentials or account is required.

The temporary Tailscale preview uses private Serve access and a separate loopback Vite preview. Its temporary configuration allows only the exact discovered hostname and translates only that preview's exact HTTPS Origin for the loopback API. Untrusted origins and cross-site fetch metadata still fail. Access to workstation evidence relies on the tailnet's access policy; this is not a public authenticated hosting service. The temporary machine-specific configuration lives outside application source.

## Plans and updates

Plans refresh and revalidate the package-state fingerprint before creation. The fingerprint includes expanded pacman configuration, repository version candidates, installed versions, required/optional declarations, provisions, install reason and recorded validation bits. Lock contention prevents plan creation. Plans are explicit read-only version inventories, not resolved transactions or application authorizations. A later updater can select additional changes; exported plans cannot enforce its choices.

Plan creation attempts a fresh Arch Security Tracker fetch for the captured
inventory, then reloads and revalidates local state after network work. A failure
clears the backend advisory cache and captures an unavailable reason rather than
empty successful evidence. The browser updates or clears its shared advisory
cache accordingly. Exports preserve the complete captured audit and every
installed-version finding, including packages without a newer candidate. The
core compares each candidate with the tracker-listed fixed version using libalpm;
reaching that version is context, not a candidate audit or safety verdict. The
interface keeps publication freshness, uncovered packages and applicability
limits visible. Before/after captures are not an atomic freeze of package state.
See [plan security evidence](PLAN-SECURITY.md).

No host database refresh or update transaction is run. The explicit online repository check invokes only `/usr/bin/checkupdates --nocolor`, with a cleared environment, fixed system PATH and a private temporary database. It requires pacman-contrib, never selects download/change options, bounds each output stream to 1 MB, and stops the private process group on timeout or cancellation. Before/after package-state validation rejects stale or locked results; temporary indexes do not become host candidate-comparison evidence. See [checkupdates documentation](https://man.archlinux.org/man/checkupdates.8.en).

Batch foreign checks send names only after an explicit user action, at most 1,000 packages in 100-name requests, with a 45-second overall deadline and 2 MB response bounds per batch. Unexpected/duplicate names, malformed identities, partial failures and package-state changes fail the whole check. No-match, version equality and failed requests remain distinct. Recipe review uses the captured split-package base without another lookup; a new version check or inventory invalidation closes that handoff.

Maintenance reads installed sizes and dependency/provider relationships from the shared index. Orphans exclude required and optional consumers, including virtual/versioned providers. Cache reads count regular-file lengths without following entry symlinks or descending into subdirectories; unreadable/bounded captures show partial totals. No cleanup is executed. Copyable shell commands validate and quote package identifiers and allow only known AUR helper names. Omarchy's supported updater is preserved; plain Arch install commands include a full system upgrade. A future direct write path still requires the root-owned helper, authenticated requests, plan invalidation, and disposable-VM transaction/recovery tests described in WORKSTATION-PLAN.md.

The `removal_plan` request accepts 1–100 unique installed name/version targets and
an expected inventory fingerprint. A blocking worker owns a fresh libalpm handle,
initializes with NO_LOCK, adds only those targets, prepares plain removal and
releases the transaction; it never calls commit, runs scripts/hooks, selects
recursive/cascade options or elevates. An owned semaphore permit stays with the
worker on client disconnect. Before/after fingerprints, installed-version checks
and explicit lock-path reads reject observed changes and locks. Preparation errors
remain unknown; unsatisfied requirements are structured blockers. Blocker and
optional-impact output is capped at 5000 entries each, otherwise the request fails.

Optional impacts exclude removed consumers and declarations retaining a provider.
Matched HoldPkg rules withhold commands. Ordinary `*`, `?` and bracket globs are
supported; escaped patterns, caret-negated brackets, POSIX character/collation/
equivalence classes and malformed patterns fail explicitly because their grammar differs from the glob matcher.
Commands use validated quoted names and only plain `sudo pacman -R --` semantics.
The client reconstructs that command and requires exact agreement with the core,
matching targets/fingerprint, an idle successful capture, unlocked available
inventory, no blockers and no held packages. Exports keep complete historical
evidence with capture status and a separate nullable `actionableCommand`.

The unlocked review does not freeze package state or authorize a future updater.
Installed size is metadata, not predicted freed space; optional declarations do
not cover undeclared use, services or boot/login needs. Scripts, hooks and pacsave
behavior are not simulated. Pacman must revalidate and obtain confirmation when
a copied command is run. This is preparation evidence, not removal-safety proof.

## Repository candidate comparisons

The comparison request forces a local inventory reload, requires a matching state
fingerprint, and rejects malformed names, missing repository candidates and an
observed database lock. Owned metadata captures the installed package and the
first configured repository candidate. Declaration/artifact metadata and signature
declaration digests participate in the state fingerprint, including changes with
unchanged package versions. Reads do not lock/freeze the database.

Candidate hashes and embedded signatures are unverified database declarations. No
archive is fetched, scanned or executed. Installed validation describes historic
installation records. Required/optional/provides/conflicts/replaces differences
are not a dependency-resolved transaction. Plans include at most 100 comparisons,
with 500 added/removed declarations per category and explicit omitted counts.
The full version-change package list remains in the export. Advisory correlation
checks the installed version and snapshot identity; failed forced checks or failed
inventory refreshes leave current status unknown. Listed fixes do not establish
candidate safety or remediation. See [design and verification](CANDIDATE-REVIEW.md).

Static finding comparisons are derived from the two captured scans, only when
both are complete and use the same known static analyzer version. The loaded
saved record must match the comparison's package base, commit, digest, scan time,
review time and analyzer version. Correspondence uses rule identity, file, exact
line text and scanner metadata, with one match per occurrence, independent of
line-number movement. Missing rule/location evidence blocks comparison. A missing
observation is not a fix or safety verdict; matching observations can still have
changed surrounding code. Captured-file review remains necessary. Comparison
filters and source navigation do not change stored records or exports.

Saved-review rows never initiate recipe fetching on mount, search, saved-record
refresh or window focus. An explicit check uses the existing bounded scanner and
shares its captured inspection with the workbench. Row conclusions require the
returned baseline to match the displayed record's package, commit, digest, scan
time, review time and analyzer version. Pending/failed checks withhold conclusions
in both the row and detail pane; replacing/removing the baseline requires updated
records. Capture timestamps describe observed bytes at that time, not continuous
remote monitoring. Checks cannot save, remove or approve reviews. Saved exports
continue to read the saved record independently of the current capture.

Advisory checks share one client query state across Overview, Advisories,
dependencies, candidate comparisons and review-plan capture. A pending or paused
background attempt withholds prior conclusions; a failure stays unknown across
route navigation. Explicit checks target the local HTTP/IPC service immediately,
which reports external network failures. They continue across route unmounts and
retry only by an intentional check. Failed query mounts/reconnects do not retry
automatically. New dependency inspections may request fresh advisory evidence;
only a completed successful capture can restore conclusions. Metadata plans and
dependency/comparison exports remain usable with unknown advisory evidence.
Fingerprint, installed-version, nominal coverage and publication-freshness
limitations still apply after success. None of this authorizes package changes.
Native IPC rejection strings normalize to Error, preserving details and existing
AbortError behavior. Browser request behavior and Rust error serialization are
unchanged. Fault-injection verification uses isolated UI transports; it does not
change the public tracker or personal saved reviews.

Recipe queries share explicit scan state per package base. An in-flight bounded
read finishes when its last view closes; navigation cannot restore an old current
verdict. Failed checks remain unknown on reopening. Local HTTP/IPC requests start
explicitly even when the browser reports offline; the service owns external AUR
connectivity errors and its existing scan limits. Mount, focus and reconnect do
not start another scan. Review acknowledgment is disabled for pending, failed or
incomplete captures and binds to base, commit, bundle digest and analyzer version.
The backend's authoritative review validation remains required. Saved evidence
and exports remain readable without approving a current capture.

## Authenticated desktop removal

Only native commands `removal_task_state` and `start_removal_task` expose the task
boundary. The latter takes protocol 1, up to 100 unique installed name/version
identities, a state fingerprint and an execution digest. There are no caller paths,
flags, commands, shell strings, cancellation or automatic retries. Unknown request
fields, malformed identities and unsupported protocol values are rejected. The
HTTP/CLI Request enum has no mutation variant.

The native backend repeats the exact preparation before authentication. It launches
fixed `/usr/bin/pkexec --disable-internal-agent /usr/lib/archhub/archhub-helper remove`
with a cleared environment, fixed PATH/locale and working directory. Helper, policy
and pkexec paths require root ownership, no writable group/other bits and no symlink
components. The installed policy must exactly match the desktop's policy. It names
the fixed executable and `remove` first argument and uses active `auth_admin`,
without retained authorization or GUI environment inheritance. No session agent
means authentication fails; ArchHub never handles passwords. The helper rejects
unprivileged invocation and execution outside its fixed installed path, and accepts
at most 32 KiB of strict JSON on stdin. All package mutation runs in the helper.

An execution digest binds resolved pacman configuration, package state, selected
local desc/files/mtree/install bytes, hook definitions/masks, pacman-conf and the
libalpm shared library. Files and their parents must be root-owned, with protected
paths; definitions are bounded by count and byte limits. Direct application currently
requires default `/`, `/var/lib/pacman` and `/var/log/pacman.log`. The helper checks
HoldPkg/dependencies, acquires the real libalpm transaction lock, rereads state and
digest under its own lock, prepares the exact selected set without recursive/cascade
flags, rechecks evidence, and commits once. It never clears an existing lock.

The digest does not freeze arbitrary executable dependencies or data read by hooks,
processes, undeclared consumers, boot/login needs or a concurrently acting root
administrator. Installed scripts and hooks are trusted system policy, run as root,
and are neither sandboxed nor made atomically reversible by the review. The explicit
confirmation says so. After attempting commit, any commit/release/local-inventory
failure or logged libalpm error produces a possible-partial outcome, with remaining
installed versions. Success requires a successful commit/release, fresh valid local
database, no logged errors, no remaining targets and a matching native receipt.

The native task survives view changes; normal window close is blocked while running.
Output is drained with bounded retained bytes, without killing a commit. Only after
the helper exits do inherited pipes have a deadline. Diagnostic write failures do
not panic the root helper. Missing/malformed/truncated outcomes become unknown,
never success. State is atomically written and fsynced before authentication and
when finished. A prior running record restores as unknown on restart; unreadable
records disable direct removal. Local records are personal evidence, not authenticated
system logs. The desktop refreshes native inventory and invalidates package views;
the frontend clears reviews and refreshes its shared snapshot once per finished task.
Failed refreshes remain unknown. Pacman's log and actual installed state determine
recovery; no automatic retry, rollback or stale-lock deletion is provided.

Disposable-VM tests use a pinned Arch cloud image, root-owned installed package,
private overlay, restricted user networking and loopback SSH. No host mounts or
workstation package mutations are used. The guest guard rejects this destructive
fixture script outside the disposable hostname/root environment and assigned virtual-machine UUID. Test helpers kill
only their owned guest process group and clear their known stale guest lock only
after confirming the helper/pacman processes ended. Interactive successful session
password authentication is not automated; actual policy loading, privileged pkexec
transport and an unauthenticated user's denial are verified separately.
