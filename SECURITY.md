# Security policy

ArchHub is an early public preview, not a security certification or malware
detector. Only the current default branch is receiving fixes during this phase;
no stable release support window has been announced.

Please report exploitable security issues privately through
[GitHub's vulnerability reporting page](https://github.com/Pettersen3008/archhub/security/advisories/new).
Include affected revision, reproduction steps, expected impact and the smallest
redacted evidence needed. Do not publish credentials, personal inventories or
an exploit in an ordinary public issue. Maintainers will acknowledge and assess
reports as availability permits; there is no staffed response-time guarantee.

The [technical security model](docs/SECURITY.md) describes network allowlists,
static analysis limits, local evidence, native IPC capabilities and the optional
authenticated removal helper. Package installation and full upgrades remain
reviewed terminal handoffs. ArchHub never handles administrator passwords.

## Current dependency risks

On 2026-10-10, `quick-xml` was upgraded from 0.38.4 to 0.42.0, which meets the
patched-version requirements of [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194.html)
and [RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195.html).
Our parsers use `Reader` rather than `NsReader` and do not iterate XML attributes;
that narrows the reported affected paths but is not a reason to retain the old
dependency. Input size, depth and network deadlines remain bounded.

The Tauri GTK3 dependency chain still includes:

- `glib` 0.18.5: [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html),
  unsound `VariantStrIter` methods, fixed in glib >=0.20. ArchHub does not call
  these methods directly. Transitive framework reachability has not been proven
  absent. Replacing a direct dependency cannot upgrade Tauri's GTK3 chain.
- `proc-macro-error` 1.0.4: [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html),
  unmaintained compile-time dependency through `glib-macros`.

These informational warnings remain visible in `cargo audit`; no ignores are
configured. Track upstream resolution and review them again before a stable
release. Keep Arch's WebKitGTK and system libraries updated through the supported
system updater. A passing language dependency audit does not inspect those system
libraries or prove that the application is secure.
