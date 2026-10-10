#!/usr/bin/env python3
"""Generate a deterministic source archive and checksum-pinned Arch recipe.

Reads committed source; never installs packages or publishes a release.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd)


def prepare(output):
    if run("git", "status", "--porcelain").strip():
        raise SystemExit("Commit or stash source changes before preparing a release.")
    commit = run("git", "rev-parse", "HEAD").decode().strip()
    version = json.loads(run("git", "show", f"{commit}:package.json"))["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise SystemExit("Release version must be major.minor.patch.")
    for manifest in ("crates/archhub-core/Cargo.toml", "crates/archhub-helper/Cargo.toml", "src-tauri/Cargo.toml"):
        if tomllib.loads(run("git", "show", f"{commit}:{manifest}").decode())["package"]["version"] != version:
            raise SystemExit(f"Version mismatch in {manifest}")
    if json.loads(run("git", "show", f"{commit}:src-tauri/tauri.conf.json"))["version"] != version:
        raise SystemExit("Version mismatch in Tauri configuration.")
    archive = run("git", "archive", "--format=tar", f"--prefix=archhub-{version}/", commit)
    # Also verify the actual exported tree, not just its archive filename.
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        prefix = f"archhub-{version}"
        if any(member.name != prefix and not member.name.startswith(prefix + "/") for member in tar):
            raise SystemExit("Unexpected source archive path.")
    output.mkdir(parents=True, exist_ok=True)
    source = output / f"archhub-{version}.tar.gz"
    source.write_bytes(gzip.compress(archive, mtime=0))
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    template = run("git", "show", f"{commit}:packaging/PKGBUILD.in").decode()
    recipe = template.replace("@VERSION@", version).replace("@SOURCE_SHA256@", digest)
    (output / "PKGBUILD").write_text(recipe)
    (output / ".SRCINFO").write_bytes(run("makepkg", "--printsrcinfo", cwd=output))
    manifest = {"version": version, "commit": commit, "sourceSha256": digest, "architecture": "x86_64", "libalpmABI": 16}
    (output / "source.json").write_text(json.dumps(manifest, indent=2) + "\n")
    files = [source, output / "PKGBUILD", output / ".SRCINFO", output / "source.json"]
    (output / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in files))
    print(f"Prepared {version} from {commit} in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/release")
    args = parser.parse_args()
    prepare(args.output_dir.resolve())
