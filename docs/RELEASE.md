# Arch release preparation

The first public phase is a security-focused preview for Arch Linux x86_64 and
Omarchy with libalpm 16. Native browsing, inspection and evidence export work
without a privileged helper. Installs, AUR builds and upgrades use reviewed
terminal commands. Authenticated native removal is an optional separate package.

## Build packages from committed source

Requirements: `base-devel`, Rust, Bun >=1.4, Python >=3.11, GTK3,
WebKitGTK 4.1, `pkgconf`, `zstd` and `desktop-file-utils`. Maintain a fully updated
Arch build environment. On Omarchy, use `omarchy update` for that update.

```bash
# After committing the source revision:
bun run release:prepare
cd artifacts/release
CARGO_BUILD_JOBS=2 makepkg --cleanbuild
```

The preparation script exports committed source using `git archive`, verifies
application version agreement, creates a deterministic gzip source archive and
generates `PKGBUILD`, `.SRCINFO`, `source.json` and `SHA256SUMS`. The generated
recipe pins the source SHA-256; it has no `SKIP` source entry. Locally it consumes
the adjacent archive. A published recipe downloads that same archive from the
matching GitHub release. Never publish a generated recipe before its source
archive is available. Preparation and building do not install packages.

`makepkg` builds two standard pacman packages, including pacman's build metadata:

- `archhub`: `/usr/bin/archhub`, `/usr/bin/archhub-cli`, desktop launcher and icon.
- `archhub-helper`: root-owned one-shot helper and polkit policy. Install this
  only when authenticated native removal is wanted.

Two Cargo build jobs limit peak memory; increase this explicitly on a suitable
build machine. If Rust/Bun are installed through user toolchains rather than
pacman's package database, verify every listed build dependency yourself before
using makepkg's `--nodeps` option for a local build. CI uses installed Arch packages
and performs normal dependency checks.

For a local rebuild, an absolute `CARGO_TARGET_DIR` can reuse a Cargo cache. Use
a clean Arch chroot for release binaries. Do not run `makepkg` as root. Inspect
packages with `pacman -Qip` and `pacman -Qlp` before installing them in a VM.
The packages pin libalpm ABI 16; a new ABI requires a source compatibility review,
rebuild and updated packaging. AUR and alternate architectures are not yet
published/supported. Standard Arch checks cannot establish compatibility with
every derivative or every custom repository.

## Release gates

Before tagging a stable release:

- Run frontend checks/build, workspace formatting/Clippy/tests and verify generated
  bindings. Run `bun audit` and `cargo audit`; review the current upstream warnings
  in [security policy](../SECURITY.md), not just command exit codes.
- Run deterministic browser tests and the full Firefox suite with live feeds and
  accessibility checks. Keep failure traces locally and redact shared evidence.
- Build both packages in a clean Arch environment; inspect dependency metadata,
  root ownership and 0755/0644 helper/policy modes. Install the application in a
  disposable plain Arch graphical VM and an Omarchy VM. Verify launch, WebKit IPC,
  exports, missing optional tools and unsupported ABI diagnostics.
- Run the native smoke hook against current source, then rerun the isolated
  authenticated transaction harness for helper changes. Test success, dependency
  blockers, HoldPkg, stale inventory/config/hooks, lock contention, authentication
  denial, partial results and restart recovery. See the removal section in [implementation verification](IMPLEMENTATION.md).
- Enable GitHub private vulnerability reporting, secret scanning and branch rules.
  Require the Arch CI job and human review on future changes to `main`; GitHub
  account/plan capabilities may affect available protection settings.
- Publish release notes with supported ABI/architecture, dependency warnings and
  security limitations. Publish the matching source archive and generated recipe
  with the binaries; sign release packages/checksums using a maintainer-controlled
  key and publish its fingerprint through the repository. SHA-256 alone does not
  authenticate the maintainer. Never store the signing key in source or artifacts.
- Add an AUR entry only after the matching source release is public and the recipe
  has passed review/clean builds. An AUR listing does not make the recipe trusted.

## Product work after the preview

Keep security evidence prominent while improving the app-store experience:
AppStream-backed application names/icons/categories; curated discovery without
invented provenance claims; better multi-package review; application screenshots
and accessibility testing. Authenticate richer native transactions only after a
separate design covers libalpm lock ownership, signatures, hooks, progress,
interruption and recovery. AUR build jobs must run as an unprivileged user and
present pinned recipe/source review before installation. Omarchy full upgrades
must preserve its supported update/migration lifecycle.

The repository CI performs locked builds, audits, local browser regressions and
standard package builds in a disposable Arch container. It does not prove a
graphical desktop launch or an authenticated transaction in a full VM. CI
artifacts are build evidence, not signed public release packages.
