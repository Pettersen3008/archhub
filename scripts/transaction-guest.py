#!/usr/bin/env python3
"""DESTRUCTIVE GUEST TEST: requires the harness cloud hostname and root.
Creates/removes tiny fixture packages only in the disposable Arch guest.
"""
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import time

expected_uuid = os.environ.get('ARCHHUB_VM_UUID', '')
if (os.geteuid() != 0 or Path('/etc/hostname').read_text().strip() != 'archhub-transaction-test'
        or not expected_uuid or Path('/sys/class/dmi/id/product_uuid').read_text().strip().lower() != expected_uuid.lower()):
    raise SystemExit('This destructive test is restricted to the disposable harness guest.')
HELPER = '/usr/lib/archhub/archhub-helper'
CLI = '/root/archhub-core'
PREFIX = 'archhub-vm-'
ROOT = Path('/root/archhub-fixtures')
ROOT.mkdir(exist_ok=True)
results = []

def run(*args, check=True, **kw):
    return subprocess.run(args, text=True, capture_output=True, check=check, **kw)

def installed(name):
    return run('pacman', '-Q', name, check=False).returncode == 0

def make(name, depends=None, script=None, version="1-1"):
    name = PREFIX + name
    output = ROOT / (name + '.pkg.tar')
    info = f'pkgname = {name}\npkgver = {version}\npkgdesc = ArchHub disposable VM fixture\nbuilddate = 1791230400\nsize = 12\narch = any\n'
    if depends:
        info += f'depend = {PREFIX}{depends}\n'
    files = {'.PKGINFO': info.encode(), f'usr/share/archhub-fixtures/{name}': b'fixture data'}
    if script:
        files['.INSTALL'] = script.encode()
    with tarfile.open(output, 'w') as tar:
        for directory in ['usr', 'usr/share', 'usr/share/archhub-fixtures']:
            entry = tarfile.TarInfo(directory)
            entry.type = tarfile.DIRTYPE
            entry.mode = 0o755
            tar.addfile(entry)
        for path, data in files.items():
            entry = tarfile.TarInfo(path)
            entry.mode = 0o644
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    run('pacman', '-U', '--noconfirm', str(output))
    return name

def plan(*names):
    return json.loads(run(CLI, 'removal-plan', *names).stdout)

def request(review):
    assert review['executionDigest'], review
    return {'protocol': 1, 'targets': review['targets'], 'fingerprint': review['fingerprint'], 'executionDigest': review['executionDigest']}

def apply(review, status, **changes):
    data = request(review) | changes
    result = run(HELPER, 'remove', input=json.dumps(data), check=False)
    outcome = json.loads(result.stdout)
    assert outcome['status'] == status, (result.returncode, outcome, result.stderr)
    assert (result.returncode == 0) == (status == 'removed'), outcome
    assert not Path('/var/lib/pacman/db.lck').exists(), outcome
    return outcome

def record(name, evidence):
    results.append({'case': name, 'passed': True, 'evidence': evidence})

if '--after-reboot' in sys.argv:
    saved = json.loads((ROOT / 'results.json').read_text())
    assert all(not installed(n) for n in saved['removed'])
    assert all(installed(n) for n in saved['retained'])
    assert not Path('/var/lib/pacman/db.lck').exists()
    # Restore the interrupted fixture by reinstalling its original offline archive.
    name = saved['interrupted']
    run('pacman', '-U', '--noconfirm', str(ROOT / (name + '.pkg.tar')))
    assert installed(name)
    print(json.dumps({'passed': True, 'removedRemainAbsent': saved['removed'], 'retainedRemainInstalled': saved['retained'], 'interruptedFixtureRestored': name}))
    raise SystemExit(0)

policy = run('pkaction', '--action-id', 'dev.archhub.remove', '--verbose').stdout
assert 'auth_admin' in policy and 'auth_admin_keep' not in policy and HELPER in policy
record('installed polkit policy uses auth_admin and the fixed helper', policy)
record('helper protocol and package ownership', {'protocol': run(HELPER, '--protocol').stdout.strip(), 'owner': run('stat', '-c', '%u:%g:%a', HELPER).stdout.strip()})
pk = make('pkexec-root')
pk_review = plan(pk)
pk_result = run('pkexec', '--disable-internal-agent', HELPER, 'remove', input=json.dumps(request(pk_review)))
assert json.loads(pk_result.stdout)['status'] == 'removed' and not installed(pk)
record('real pkexec-to-helper transport with privileged guest caller', json.loads(pk_result.stdout))
edge = make('unusual-version', version='1~rc1-1')
record('valid unusual Arch version is reviewed and removed', apply(plan(edge), 'removed'))
assert not installed(edge)
a = make('normal')
review = plan(a)
outcome = apply(review, 'removed')
assert not installed(a) and not Path('/usr/share/archhub-fixtures', a).exists()
assert 'removed ' + a + ' (1-1)' in Path('/var/log/pacman.log').read_text()
record('normal removal and independent pacman/file/log receipt', outcome)
base = make('provider')
consumer = make('consumer', 'provider')
blocked = plan(base)
assert not blocked['dependencyCheckPassed'] and blocked['blockers']
record('dependency blocked', apply(blocked, 'rejected'))
assert installed(base) and installed(consumer)
joint = apply(plan(base, consumer), 'removed')
assert not installed(base) and not installed(consumer)
record('joint consumer/provider removal', joint)
b = make('retained')
fresh = plan(b)
record('stale snapshot', apply(fresh, 'rejected', fingerprint='0' * 64))
record('stale version', apply(fresh, 'rejected', targets=[{'name': b, 'version': '2-1'}]))
record('changed digest', apply(fresh, 'rejected', executionDigest='0' * 64))
assert installed(b)
# Real config policy is restored after the held selection probe.
config = Path('/etc/pacman.conf')
original = config.read_text()
config.write_text(original.replace('HoldPkg     = pacman glibc', 'HoldPkg     = pacman glibc ' + b))
if b not in run('pacman-conf', 'HoldPkg').stdout:
    config.write_text(original.replace('[options]', '[options]\nHoldPkg = ' + b))
held = plan(b)
assert held['heldPackages'] == [b], held
record('HoldPkg enforced', apply(held, 'rejected'))
config.write_text(original)
lock = Path('/var/lib/pacman/db.lck')
locked = plan(b)
lock.touch()
result = run(HELPER, 'remove', input=json.dumps(request(locked)), check=False)
assert json.loads(result.stdout)['status'] == 'rejected' and lock.exists() and installed(b)
lock.unlink()
record('other transaction lock is retained', json.loads(result.stdout))
# A change to a hook definition after review invalidates execution evidence.
hooks = Path('/etc/pacman.d/hooks')
hooks.mkdir(exist_ok=True)
hook = hooks / 'archhub-vm-fixture.hook'
hook.write_text('[Trigger]\nOperation = Remove\nType = Package\nTarget = ' + b + '\n[Action]\nWhen = PostTransaction\nExec = /usr/bin/true\n')
review = plan(b)
hook.write_text(hook.read_text() + '# changed after review\n')
record('changed hook definition', apply(review, 'rejected'))
hook.unlink()
# Script metadata is also covered by the reviewed digest.
s = make('script', script='pre_remove() { :; }\n')
review = plan(s)
script = Path('/var/lib/pacman/local', s + '-1-1', 'install')
script.write_text(script.read_text() + '# changed after review\n')
record('changed install script metadata', apply(review, 'rejected'))
for payload in [json.dumps(request(plan(b)) | {'command': 'rm -rf /'}), 'x' * 32769, '{']:
    rejected = run(HELPER, 'remove', input=payload, check=False)
    assert json.loads(rejected.stdout)['status'] == 'rejected' and installed(b)
record('unknown field, oversized and malformed JSON rejected', True)
assert run('runuser', '-u', 'nobody', '--', HELPER, 'remove', input='{}', check=False).returncode == 1
record('unprivileged direct invocation denied', True)
# Even root cannot elevate a copied source-tree helper or writable installation.
copy = ROOT / 'copied-helper'
copy.write_bytes(Path(HELPER).read_bytes())
copy.chmod(0o755)
assert 'fixed system path' in run(str(copy), 'remove', input='{}', check=False).stdout
Path(HELPER).chmod(0o777)
assert 'root-owned' in run(HELPER, 'remove', input='{}', check=False).stdout
Path(HELPER).chmod(0o755)
record('fixed executable path and writable installation rejected', True)
if Path('/usr/bin/pkexec').exists():
    denied = run('runuser', '-u', 'nobody', '--', 'pkexec', '--disable-internal-agent', HELPER, 'remove', input=json.dumps(request(plan(b))), check=False, timeout=15)
    assert denied.returncode == 127 and installed(b), (denied.returncode, denied.stderr)
    record('polkit denies unauthenticated inactive caller', {'exit': denied.returncode, 'diagnostics': denied.stderr})
else:
    raise AssertionError('Guest polkit is required for the authentication boundary test')
# A failing post-transaction hook must not produce a green receipt even when
# package removal itself completed. Scripts/hooks are not atomically reversible.
f = make('hook-failure')
hook.write_text('[Trigger]\nOperation = Remove\nType = Package\nTarget = ' + f + '\n[Action]\nWhen = PostTransaction\nExec = /usr/bin/false\n')
partial = apply(plan(f), 'partial')
assert not installed(f)
record('failed post hook reports partial, independent removal confirmed', partial)
hook.unlink()
# Closed desktop pipes cannot interrupt libalpm's error reporting or commit.
closed = make('closed-stderr', script='pre_remove() { sleep 1; }\n')
hook.write_text('[Trigger]\nOperation = Remove\nType = Package\nTarget = ' + closed + '\n[Action]\nWhen = PostTransaction\nExec = /usr/bin/false\n')
closed_request = request(plan(closed))
child = subprocess.Popen([HELPER, 'remove'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
child.stderr.close()
child.stdin.write(json.dumps(closed_request))
child.stdin.close()
closed_result = json.loads(child.stdout.read())
child.wait(timeout=10)
assert closed_result['status'] == 'partial' and not installed(closed) and not lock.exists()
record('closed diagnostic pipe does not panic or interrupt commit', closed_result)
hook.unlink()
pre = make('pre-hook-failure')
hook.write_text('[Trigger]\nOperation = Remove\nType = Package\nTarget = ' + pre + '\n[Action]\nWhen = PreTransaction\nAbortOnFail\nExec = /usr/bin/false\n')
pre_result = apply(plan(pre), 'partial')
assert installed(pre) and pre_result['remaining'][0]['name'] == pre
record('failed aborting pre-hook retains package and reports attempted failure', pre_result)
hook.unlink()
apply(plan(pre), 'removed')
# Kill only the disposable guest helper after a script visibly starts. This
# models lost process outcome and demonstrates pacman's manual lock recovery.
i = make('interrupted', script='pre_remove() { touch /root/archhub-script-started; sleep 8; }\n')
review = plan(i)
process = subprocess.Popen([HELPER, 'remove'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
process.stdin.write(json.dumps(request(review)))
process.stdin.close()
deadline = time.monotonic() + 15
while not Path('/root/archhub-script-started').exists():
    assert process.poll() is None
    assert time.monotonic() < deadline
    time.sleep(0.1)
os.killpg(process.pid, signal.SIGKILL)
process.wait(timeout=5)
assert lock.exists()
assert run('pgrep', '-x', 'archhub-helper', check=False).returncode != 0
assert run('pgrep', '-x', 'pacman', check=False).returncode != 0
state = installed(i)
# This removal of a stale lock is restricted to the disposable guest, after
# checking the owned helper group ended and no pacman/helper process remains.
lock.unlink()
assert not lock.exists()
record('interrupted commit has no success receipt; isolated manual recovery', {'helperExit': process.returncode, 'retainedPackage': state, 'staleLockVerifiedThenClearedInGuest': True})
assert installed(b) and installed(s)
saved = {'removed': [pk, edge, a, base, consumer, f, closed, pre], 'retained': [b, s], 'interrupted': i, 'cases': results}
(ROOT / 'results.json').write_text(json.dumps(saved))
print(json.dumps(saved))
