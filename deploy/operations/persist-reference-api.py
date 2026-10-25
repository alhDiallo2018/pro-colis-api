#!/usr/bin/python3 -I
"""Persist the already-approved live routing without rebuilding/deploying the app."""
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.request

DOCKER = '/usr/bin/docker'
CONTAINER = 'sendprocolis-caddy'
IMAGE = 'sendprocolis-web:latest'
SOURCE = Path('/home/debian/procolis/SendProColis-Web/Caddyfile')
ADMIN = 'http://172.21.0.4:2019/config/'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'}


def run(*args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=ENV, cwd='/', timeout=180)
    if result.returncode:
        # Docker/Caddy diagnostics may include configuration values: keep the
        # detailed output in the private backup instead of exposing it in chat.
        if LOG is not None:
            with (LOG / 'errors.log').open('ab') as log:
                log.write(result.stdout + result.stderr)
        raise RuntimeError('Command failed: ' + args[0] + '; private errors.log has details')
    return result.stdout


def inspect(target):
    return json.loads(run(DOCKER, 'inspect', target))[0]


def current_config():
    with urllib.request.urlopen(ADMIN, timeout=15) as response:
        return json.load(response)


def patch(content):
    # Only standalone upstream directives are changed; unexpected configurations
    # stop the operation instead of being rewritten heuristically.
    pattern = rb'(?m)^([ \t]*reverse_proxy[ \t]+)api:8080([ \t]*(?:#[^\r\n]*)?\r?)$'
    result, count = re.subn(pattern, rb'\1sendprocolis-api:8080\2', content)
    if count == 0 and len(re.findall(rb'(?m)^[ \t]*reverse_proxy[ \t]+sendprocolis-api:8080[ \t]*\r?$', content)) == 2:
        return content
    if count != 2:
        raise RuntimeError('Expected exactly two API routes; no files modified')
    return result


def normalize_validation_path(config, temporary_path):
    """Compare a staged file as if Caddy adapted its final startup location."""
    result = copy.deepcopy(config)

    def visit(node):
        if isinstance(node, dict):
            # Caddy automatically hides the input Caddyfile from file_server.
            # Staging under /tmp changes this generated path. Normalize ONLY
            # that exact entry; preserve every other hide rule and route value.
            if node.get('handler') == 'file_server' and isinstance(node.get('hide'), list):
                node['hide'] = ['/etc/caddy/Caddyfile' if value == temporary_path else value
                                for value in node['hide']]
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(result)
    return result


def atomic_source(content, metadata):
    fd, name = tempfile.mkstemp(prefix='.Caddyfile.procolis-', dir=SOURCE.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
        os.replace(name, SOURCE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def container_file():
    return run(DOCKER, 'exec', CONTAINER, 'cat', '/etc/caddy/Caddyfile')


def install_container_file(path):
    # Stage on the same filesystem and rename atomically: a failed Docker copy
    # must not leave a truncated startup configuration behind.
    staged = '/etc/caddy/.' + LOG.name + '.Caddyfile'
    try:
        run(DOCKER, 'cp', str(path), CONTAINER + ':' + staged)
        run(DOCKER, 'exec', CONTAINER, 'mv', '-f', staged, '/etc/caddy/Caddyfile')
    finally:
        run(DOCKER, 'exec', CONTAINER, 'rm', '-f', staged)


LOG = None


def main():
    global LOG
    if os.geteuid() != 0:
        raise RuntimeError('Run from the administrator session with sudo')
    os.umask(0o077)
    with open('/run/lock/procolis-reference-api.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        LOG = Path(tempfile.mkdtemp(prefix='procolis-reference-', dir='/root'))
        print('Private backup:', LOG, flush=True)
        live = current_config()
        if patch_live_check(live) != 2:
            raise RuntimeError('Live routing must already target sendprocolis-api twice')
        info = inspect(CONTAINER)
        old_image = info['Image']
        if inspect(IMAGE)['Id'] != old_image:
            raise RuntimeError('Image tag differs from running image; refusing to overwrite it')
        if any(m['Destination'] in ['/etc', '/etc/caddy', '/etc/caddy/Caddyfile'] for m in info.get('Mounts', [])):
            raise RuntimeError('Unexpected Caddyfile mount; manual review required')
        if SOURCE.is_symlink() or not SOURCE.is_file():
            raise RuntimeError('Unexpected source Caddyfile')
        metadata = SOURCE.stat()
        source_before = SOURCE.read_bytes()
        runtime_before = container_file()
        source_after = patch(source_before)
        runtime_after = patch(runtime_before)
        (LOG / 'source.before').write_bytes(source_before)
        (LOG / 'Caddyfile.before').write_bytes(runtime_before)
        (LOG / 'Caddyfile').write_bytes(runtime_after)
        # The container runs as root and Caddyfile is not secret; keep its original
        # normal read permissions when Docker copies the validated file back.
        (LOG / 'Caddyfile').chmod(0o644)
        (LOG / 'Caddyfile.before').chmod(0o644)
        (LOG / 'live.json').write_text(json.dumps(live))
        temp_config = '/tmp/' + LOG.name + '.Caddyfile'
        try:
            run(DOCKER, 'cp', str(LOG / 'Caddyfile'), CONTAINER + ':' + temp_config)
            adapted = json.loads(run(DOCKER, 'exec', CONTAINER, 'caddy', 'adapt',
                '--config', temp_config, '--adapter', 'caddyfile', '--validate'))
            (LOG / 'adapted.json').write_text(json.dumps(adapted))
            if normalize_validation_path(adapted, temp_config) != live:
                raise RuntimeError('Patched startup file differs from live configuration; refusing persistence')
            # Build one file layer on the EXACT running web image. No frontend
            # compilation, network dependency, API deployment or migration occurs.
            base_tag = 'procolis-caddy-routing-base:' + old_image.split(':')[1][:16]
            fixed_tag = 'procolis-caddy-routing:' + LOG.name
            run(DOCKER, 'tag', old_image, base_tag)
            build_dir = LOG / 'build'
            build_dir.mkdir()
            (build_dir / 'Caddyfile').write_bytes(runtime_after)
            (build_dir / 'Caddyfile').chmod(0o644)
            (build_dir / 'Dockerfile').write_text('FROM ' + base_tag + '\nCOPY Caddyfile /etc/caddy/Caddyfile\n')
            run(DOCKER, 'build', '--network=none', '--pull=false', '-t', fixed_tag, str(build_dir))
            new_image = inspect(fixed_tag)['Id']
            (LOG / 'images.json').write_text(json.dumps({'previous': old_image, 'fixed': new_image, 'tag': IMAGE}))
            # Refuse drift during the build before touching persistent state.
            if (current_config() != live or inspect(CONTAINER)['Id'] != info['Id']
                    or inspect(IMAGE)['Id'] != old_image or SOURCE.read_bytes() != source_before
                    or container_file() != runtime_before):
                raise RuntimeError('Concurrent change detected; persistent state left unchanged')
            source_written = container_written = image_tagged = False
            try:
                atomic_source(source_after, metadata)
                source_written = True
                container_written = True  # Copy may partially succeed before reporting an error.
                install_container_file(LOG / 'Caddyfile')
                image_tagged = True
                run(DOCKER, 'tag', new_image, IMAGE)
                if (SOURCE.read_bytes() != source_after or container_file() != runtime_after
                        or inspect(IMAGE)['Id'] != new_image or current_config() != live):
                    raise RuntimeError('Persistence verification failed')
                with urllib.request.urlopen('https://sendprocolis.com/api/v1/health', timeout=15) as response:
                    result = json.load(response)
                    if response.status != 200 or result.get('data', {}).get('status') != 'ok':
                        raise RuntimeError('Public health check failed')
            except Exception:
                # Restore only our own changes, leaving a concurrent operator's
                # configuration untouched. Live routing is never changed here.
                if image_tagged and inspect(IMAGE)['Id'] == new_image:
                    run(DOCKER, 'tag', old_image, IMAGE)
                if container_written and container_file() == runtime_after:
                    install_container_file(LOG / 'Caddyfile.before')
                if source_written and SOURCE.read_bytes() == source_after:
                    atomic_source(source_before, metadata)
                raise
        finally:
            run(DOCKER, 'exec', CONTAINER, 'rm', '-f', temp_config)
        print('SUCCESS: source, container startup file and local web image pinned; HTTPS health OK')
        print('No API deployment, migration, JWT change or container restart performed')


def patch_live_check(node):
    count = 0
    if isinstance(node, dict):
        if node.get('handler') == 'reverse_proxy':
            for upstream in node.get('upstreams', []):
                if upstream.get('dial') == 'api:8080':
                    raise RuntimeError('Ambiguous upstream remains in live configuration')
                count += upstream.get('dial') == 'sendprocolis-api:8080'
        for value in node.values():
            count += patch_live_check(value)
    elif isinstance(node, list):
        for value in node:
            count += patch_live_check(value)
    return count


if __name__ == '__main__':
    main()
