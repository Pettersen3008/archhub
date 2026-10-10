# AUR source declaration evidence

Goal: make the pinned recipe's upstream source and integrity declarations readable,
with per-architecture checksum alignment, VCS references and signature declarations.
Done means real browser/CLI/native reports agree, saved reviews remain compatible,
and malformed/partial metadata never becomes verified-source evidence.

## Grounding and design

The existing recipe flow resolves one AUR commit and fetches PKGBUILD, .SRCINFO and
literal install files. Findings are textual heuristics, saved baselines retain raw
files, and both transports use shared Rust types. There is no repository sandbox
contract yet; the roadmap defers repository tooling until that boundary works.
This slice extends static package evidence without running makepkg, Git, GPG or a
shell, downloading upstream sources, or selecting arbitrary filesystem paths.

A pure Rust analyzer reads captured .SRCINFO, preserving declaration order, line
numbers and architecture groups. Checksums pair only within the same source group;
count mismatches remain unaligned. Valid checksum syntax is a declaration, not a
successful byte comparison. Sources show local/download/VCS/signature/unknown
classification, transport, literal filename/rename, VCS reference and signed
checkout requests. Tags/branches remain mutable references. Detached signatures
are associated conservatively by declared filenames; fingerprints are declarations
whose ownership and authenticity are unknown. PKGBUILD is never evaluated and
.SRCINFO can be stale even at the same commit.

RecipeScan gets optional versioned sourceEvidence. New fetches populate it; saved
reviews recompute it from validated captured files when read, preserving original
commit, bundle digest, note and timestamps. Old JSON without the field still loads.
Derived evidence does not redefine the existing complete captured-file flag or a
personal review's meaning. Separate incomplete metadata state remains visible.

Bound input to 512 KB, sources to 200, signing-key declarations to 100, recognized
entries to 2000 and warning previews to 50. Any bounds, invalid sections/values or
unaligned checksum arrays mark extraction incomplete. All captured raw files remain
available in exports. Add a Sources tab with filters/search, 25-row pages, checksum
and key details, and jumps back to exact .SRCINFO lines. Scope/status and capture
identity stay visible; neutral counts never say that sources are safe or verified.

Alternative: execute makepkg --printsrcinfo or --verifysource. Rejected because
sourcing an untrusted PKGBUILD executes code and no repository sandbox exists.
A future source-byte check needs a bounded isolated fetch/verifier and reviewed
network policy; these declarations cannot substitute for that check.

## Verification

- Rust: architecture/order pairing, weak/SKIP/invalid/misaligned checksums, renamed
  signatures, VCS tags/branches/full/short commits and signed requests, dynamic/
  unsupported values, split-section contamination, missing metadata and bounds.
- Persistence: old review JSON loads, derived evidence is recomputed, raw snapshot
  identity and notes remain unchanged.
- Browser: real pinned AUR flow/export, metadata line jumps, filtering/pagination,
  stale saved evidence, missing/partial states, both-theme WCAG and mobile layout.
- Project: generated bindings, Rust tests/fmt/clippy, frontend check/build, complete
  browser suite, actual private Tailscale flow and native IPC/render/build.

References: [PKGBUILD manual](https://man.archlinux.org/man/PKGBUILD.5.en) and
[SRCINFO manual](https://man.archlinux.org/man/SRCINFO.5.en). The installed makepkg
signature lookup implementation is also inspected for filename matching behavior.

- [x] Explore and design
- [x] Implement
- [x] Review
- [x] Verify

## Review outcome

Unsupported VCS transports and reference kinds remain unknown rather than becoming
recognized source evidence. Checksums never pair across architecture groups or
assert aligned coverage when counts mismatch. Derived evidence is recomputed after
saved-file validation and is not trusted from editable JSON. Failed refreshes
separate unsaved previous captures from saved baselines in labels and exports.
Signature associations preserve ambiguous compatible filename candidates; no
actual signature or signing-key authenticity is inferred.

## Verification evidence

38 Rust workspace tests and all 50 browser tests pass, together with frontend
check/build and workspace Rustfmt/Clippy. Eight new browser tests include live
AUR export/line identity, full-capture filtering/pages, keys and unaligned values,
failed refreshes, absent/empty/bounded metadata, both-theme WCAG, mobile layout,
and unsaved changed-capture retention. Rust fixtures cover metadata parsing,
resource bounds and compatible saved-review recomputation.

The actual private Tailscale flow captured visual-studio-code-bin's four declared
sources, checked every source/checksum line and independently recomputed the
.SRCINFO hash. Exported commit, bundle digest and derived evidence matched a
separate CLI process. Exact line navigation, mobile search and exports worked;
403 origin/cross-site and 400 malformed-identity boundaries held. The browser made
no request to declared source hosts. Evidence is in
`artifacts/tailscale-source-evidence.json`, `artifacts/tailscale-sources.png`
and `artifacts/tailscale-sources-mobile.png`.

The debug WebKit probe queried real source evidence through native IPC, activated
the Static scan and Sources tabs, and observed Source bytes not verified in the
rendered workspace. It retained the installed-file/dependency checks, stale input
rejection and denied unselected-path write. Its artifact is written only after
all checks pass: `artifacts/native-smoke-evidence.json`. The optimized desktop build
also passes. The probe dispatches Radix's mouse activation event before clicking
its tabs, matching normal pointer interaction.
