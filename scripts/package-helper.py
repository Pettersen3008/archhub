#!/usr/bin/env python3
"""Build an optional pacman package from release output; never installs anything."""
import hashlib
import io
import os
import time
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def build():
    binary = ROOT / 'target/release/archhub-helper'
    if not binary.is_file():
        raise SystemExit('Build first: cargo build --release -p archhub-helper')
    builddate = int(os.environ.get("SOURCE_DATE_EPOCH", str(int(time.time()))))
    output = ROOT / 'artifacts/archhub-helper-0.1.0-1-x86_64.pkg.tar.zst'
    output.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='archhub-package-', dir=ROOT / 'target') as temporary:
        archive = Path(temporary) / 'package.tar'
        with tarfile.open(archive, 'w') as tar:
            files = {
                'usr/lib/archhub/archhub-helper': (binary.read_bytes(), 0o755),
                'usr/share/polkit-1/actions/dev.archhub.remove.policy': ((ROOT / 'packaging/dev.archhub.remove.policy').read_bytes(), 0o644),
            }
            info = f'pkgname = archhub-helper\npkgbase = archhub-helper\npkgver = 0.1.0-1\npkgdesc = Authenticated one-shot reviewed removal for ArchHub\nbuilddate = {builddate}\npackager = ArchHub local build\nsize = {sum(len(v[0]) for v in files.values())}\narch = x86_64\nlicense = GPL-3.0-only\ndepend = pacman>=7.1\ndepend = libalpm.so=16-64\ndepend = polkit\ndepend = glibc\ndepend = libgcc\n'
            files['.PKGINFO'] = (info.encode(), 0o644)
            dirs = sorted({str(parent) for name in files for parent in Path(name).parents if str(parent) != '.'}, key=lambda x: (x.count('/'), x))
            for name in dirs:
                entry = tarfile.TarInfo(name)
                entry.type = tarfile.DIRTYPE
                entry.mode = 0o755
                entry.uid = entry.gid = 0
                tar.addfile(entry)
            for name, (data, mode) in files.items():
                entry = tarfile.TarInfo(name)
                entry.uid = entry.gid = 0
                entry.mode = mode
                entry.size = len(data)
                tar.addfile(entry, io.BytesIO(data))
        subprocess.run(['zstd', '-q', '-f', '-19', str(archive), '-o', str(output)], check=True)
    output.with_suffix(output.suffix + '.sha256').write_text(hashlib.sha256(output.read_bytes()).hexdigest() + '  ' + output.name + '\n')
    print(output)
    return output

if __name__ == '__main__':
    build()
