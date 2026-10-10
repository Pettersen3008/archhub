# Contributing to ArchHub

ArchHub targets Arch Linux x86_64 with libalpm 16, including Omarchy. It is an
early public preview. Help with reproducible defects, accessibility, package
discovery and security evidence is welcome.

Start with the [README](README.md) and [security boundaries](docs/SECURITY.md).
Use a regular account. Development reads the workstation's package databases;
never run the GUI or development service as root. Use a disposable Arch VM for
package transactions. Do not test package removal against your working system.

## Development and checks

```bash
bun install --frozen-lockfile
bun run dev
```

Open http://127.0.0.1:1420. For desktop work, stop that server before starting
`bun run dev:desktop`, which uses the same frontend port. Check a change with:

```bash
bun run check
bun run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
bun run bindings
git diff -- src/lib/ipc/bindings.ts
bunx playwright install firefox
bun run test:release
```

`test:release` covers deterministic inventory/failure and local API security
flows. `bun run test:firefox` runs the full suite, including live Arch/AUR feeds,
screenshots and accessibility checks; it requires network connectivity and real
installed packages. See [browser verification](docs/BROWSER-VERIFICATION.md).
The native smoke check and isolated authenticated transaction VM remain separate
checks described in the README and [release checklist](docs/RELEASE.md).

Run `bun audit` and `cargo audit` after dependency changes. Review the dependency
warnings documented in [SECURITY.md](SECURITY.md); do not hide new warnings.

## Changes

Keep changes focused and explain the user-visible behavior, validation and
remaining limitations in the pull request. Add regression coverage for meaningful
failure paths. Rust owns the IPC types; regenerate TypeScript with `bun run
bindings`. Preserve bounded requests, exact-version checks and the distinction
between missing evidence, failed checks and a successful check with no findings.

Do not add generic privileged shell execution, run AUR build recipes as root,
disable pacman signature policy, clear locks automatically or treat a static
review as installation permission. Changes to the helper or authentication
boundary require design review and isolated transaction testing.

Never attach personal inventory exports, review notes, logs, credentials or VM
keys to a public issue. Local `artifacts/`, `target/`, environment files and
workstation planning notes are ignored. Redact diagnostics before sharing them.

## License

The repository uses GPL-3.0-only, matching its Rust crate metadata. See [LICENSE](LICENSE).
