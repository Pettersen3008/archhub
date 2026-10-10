#!/usr/bin/env python3
"""Run removal integration tests in a private KVM overlay, never on the host.
Requires a pinned Arch cloud image and QEMU/xorriso tools. No shared mounts,
external guest network, sudo, or workstation package installation is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE_SHA = '360f0fa49db6813bdc8e35bed230a2dc2ae3567b7b5ab74719c0a706e4e34e87'

def command(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--tools', type=Path, required=True, help='QEMU installation root containing usr/bin, usr/lib and usr/share/qemu')
    opts = parser.parse_args()
    if hashlib.file_digest(opts.image.open('rb'), 'sha256').hexdigest() != IMAGE_SHA:
        raise SystemExit('Cloud image checksum mismatch.')
    work = ROOT / 'target/transaction-vm' / str(time.time_ns())
    work.mkdir(parents=True, mode=0o700)
    environment = os.environ | {'LD_LIBRARY_PATH': str(opts.tools / 'usr/lib'), 'QEMU_MODULE_DIR': str(opts.tools / 'usr/lib/qemu')}
    def tool(name, *args):
        return command([str(opts.tools / 'usr/bin' / name), *map(str, args)], env=environment)
    key = work / 'id_ed25519'
    command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)])
    seed = work / 'seed'
    seed.mkdir()
    config = {'users': [{'name': 'root', 'ssh_authorized_keys': [key.with_suffix('.pub').read_text().strip()]}], 'disable_root': False, 'ssh_pwauth': False,
              'bootcmd': [['systemctl', 'stop', 'systemd-time-wait-sync.service']],
              'runcmd': [['systemctl', 'mask', 'systemd-time-wait-sync.service'], ['systemctl', 'enable', '--now', 'sshd.service']]}
    (seed / 'user-data').write_text('#cloud-config\n' + json.dumps(config))
    (seed / 'meta-data').write_text(json.dumps({'instance-id': work.name, 'local-hostname': 'archhub-transaction-test'}))
    (seed / 'network-config').write_text(json.dumps({'version': 2, 'ethernets': {'admin': {'match': {'macaddress': '52:54:00:a8:48:01'}, 'dhcp4': True, 'dhcp6': False, 'accept-ra': False}}}))
    tool('xorriso', '-as', 'mkisofs', '-o', work / 'seed.iso', '-V', 'cidata', '-J', '-r', seed)
    tool('qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', opts.image.resolve(), work / 'system.qcow2', '8G')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    guest_uuid = str(uuid.uuid4())
    args = [str(opts.tools / 'usr/bin/qemu-system-x86_64'), '-L', str(opts.tools / 'usr/share/qemu'), '-uuid', guest_uuid, '-name', 'archhub-transaction-test', '-accel', 'kvm', '-cpu', 'host', '-m', '1024', '-smp', '2', '-display', 'none', '-serial', f'file:{work}/serial.log', '-monitor', 'none', '-drive', f'file={work}/system.qcow2,if=virtio,format=qcow2', '-drive', f'file={work}/seed.iso,media=cdrom,readonly=on', '-netdev', f'user,id=admin,restrict=on,ipv6=off,hostfwd=tcp:127.0.0.1:{port}-:22', '-device', 'e1000,netdev=admin,mac=52:54:00:a8:48:01']
    ssh = ['ssh', '-i', str(key), '-p', str(port), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', '-o', f'UserKnownHostsFile={work}/known_hosts', '-o', 'StrictHostKeyChecking=accept-new', 'root@127.0.0.1']
    process = subprocess.Popen(args, env=environment, stdout=(work / 'qemu.log').open('w'), stderr=subprocess.STDOUT)
    evidence = {'imageSha256': IMAGE_SHA, 'network': 'restricted user network; loopback SSH only', 'hostMounts': False, 'work': str(work), 'pid': process.pid, 'uuid': guest_uuid}
    (ROOT / 'artifacts/transaction-vm-launch.json').write_text(json.dumps(evidence, indent=2))
    print(f'Booting isolated Arch guest (owned PID {process.pid})', flush=True)
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError((work / 'qemu.log').read_text())
            probe = subprocess.run([*ssh, 'true'], text=True, capture_output=True)
            if probe.returncode == 0:
                break
            time.sleep(2)
        else:
            raise RuntimeError('Guest SSH did not become ready; see serial.log')
        # After first contact, enforce the recorded key for all payload operations.
        ssh[ssh.index('StrictHostKeyChecking=accept-new')] = 'StrictHostKeyChecking=yes'
        print('Guest SSH ready', flush=True)
        deadline = time.monotonic() + 600
        while not (ROOT / 'target/release/archhub-helper').exists():
            if time.monotonic() > deadline:
                raise RuntimeError('Release helper build is missing')
            time.sleep(2)
        import runpy
        package = runpy.run_path(str(ROOT / 'scripts/package-helper.py'))['build']()
        evidence['helperPackageSha256'] = hashlib.sha256(package.read_bytes()).hexdigest()
        evidence['helperBinarySha256'] = hashlib.sha256((ROOT / 'target/release/archhub-helper').read_bytes()).hexdigest()
        evidence['guestDependencies'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / 'target/transaction-deps').glob('*.pkg.tar.zst*')}
        for source, destination in [(ROOT / 'target/release/archhub-core', '/root/archhub-core'), (package, '/root/helper.pkg.tar.zst'), (ROOT / 'scripts/transaction-guest.py', '/root/transaction-guest.py'), *[(p, '/var/cache/pacman/pkg/' + p.name) for p in (ROOT / 'target/transaction-deps').glob('*.pkg.tar.zst*')]]:
            with source.open('rb') as data:
                result = subprocess.run([*ssh, f'cat > {shlex.quote(destination)}'], stdin=data, capture_output=True)
                if result.returncode:
                    raise RuntimeError(result.stderr.decode())
        command([*ssh, 'chmod 755 /root/archhub-core; pacman -U --noconfirm /root/helper.pkg.tar.zst'], timeout=120)
        probe = command([*ssh, f'ARCHHUB_VM_UUID={guest_uuid} python /root/transaction-guest.py'], timeout=240)
        print(probe.stdout, flush=True)
        evidence['guest'] = json.loads(probe.stdout)
        boot_id = command([*ssh, 'cat /proc/sys/kernel/random/boot_id']).stdout.strip()
        reboot_request = subprocess.run([*ssh, 'systemctl reboot'], timeout=10, text=True, capture_output=True)
        if reboot_request.returncode not in (0, 255):
            raise RuntimeError(reboot_request.stderr)
        time.sleep(5)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            reboot = subprocess.run([*ssh, f'ARCHHUB_VM_UUID={guest_uuid} python /root/transaction-guest.py --after-reboot'], capture_output=True, text=True)
            current_boot = subprocess.run([*ssh, 'cat /proc/sys/kernel/random/boot_id'], text=True, capture_output=True)
            if reboot.returncode == 0 and current_boot.returncode == 0 and current_boot.stdout.strip() != boot_id:
                evidence['bootIdChanged'] = True
                evidence['afterReboot'] = json.loads(reboot.stdout)
                break
            time.sleep(2)
        else:
            raise RuntimeError('Reboot verification failed')
        evidence['guestLogTail'] = command([*ssh, 'tail -80 /var/log/pacman.log']).stdout
        evidence['passed'] = True
    except Exception as error:
        evidence['passed'] = False
        evidence['error'] = str(error)
        if isinstance(error, subprocess.CalledProcessError):
            evidence['stdout'] = error.stdout
            evidence['stderr'] = error.stderr
        raise
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        evidence['ownedVmStopped'] = process.poll() is not None
        key.unlink(missing_ok=True)
        key.with_suffix('.pub').unlink(missing_ok=True)
        (ROOT / 'artifacts/transaction-vm-evidence.json').write_text(json.dumps(evidence, indent=2))
        print('Owned guest stopped; evidence saved', flush=True)

if __name__ == '__main__':
    main()
