#!/usr/bin/python3 -I
"""Pin only the two ambiguous Caddy upstreams; preserve all other live settings."""
import copy
import json
import os
from pathlib import Path
import tempfile
import urllib.request

ADMIN = 'http://172.21.0.4:2019/config/'
PUBLIC_HEALTH = 'https://sendprocolis.com/api/v1/health'


def read_config():
    with urllib.request.urlopen(ADMIN, timeout=15) as response:
        config = json.load(response)
        etag = response.headers.get('ETag')
    if not etag:
        raise RuntimeError('Missing ETag; refusing an unguarded configuration change')
    return config, etag


def replace_upstreams(node):
    count = 0
    if isinstance(node, dict):
        if node.get('handler') == 'reverse_proxy':
            for upstream in node.get('upstreams', []):
                if upstream.get('dial') == 'api:8080':
                    upstream['dial'] = 'sendprocolis-api:8080'
                    count += 1
        for value in node.values():
            count += replace_upstreams(value)
    elif isinstance(node, list):
        for value in node:
            count += replace_upstreams(value)
    return count


def apply(config, etag):
    # A single guarded root replacement changes both routes atomically and refuses
    # to overwrite another operator's changes made since our initial snapshot.
    request = urllib.request.Request(ADMIN, data=json.dumps(config).encode(),
        headers={'Content-Type': 'application/json', 'If-Match': etag}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError('Caddy rejected configuration')


def health(url):
    with urllib.request.urlopen(url, timeout=15) as response:
        result = json.load(response)
        if response.status != 200 or result.get('success') is not True or result.get('data', {}).get('status') != 'ok':
            raise RuntimeError('API health check failed')


def main():
    os.umask(0o077)
    health('http://172.21.0.3:8080/health')
    health(PUBLIC_HEALTH)
    before, etag = read_config()
    after = copy.deepcopy(before)
    if replace_upstreams(after) != 2:
        raise RuntimeError('Expected exactly two ambiguous upstreams; nothing changed')
    backup = Path(tempfile.mkdtemp(prefix='procolis-routing-', dir=Path.home()))
    (backup / 'before.json').write_text(json.dumps(before))
    (backup / 'after.json').write_text(json.dumps(after))
    print('Configuration backup:', backup, flush=True)
    try:
        apply(after, etag)
        current, _ = read_config()
        if current != after:
            raise RuntimeError('Live configuration differs from expected result')
        for _ in range(5):
            health(PUBLIC_HEALTH)
    except Exception:
        # Restore only if our version is still active, so concurrent changes are
        # never silently overwritten, even during recovery after a timeout.
        current, current_etag = read_config()
        if current == after:
            apply(before, current_etag)
            print('Previous routing restored', flush=True)
        raise
    print('SUCCESS: both live routes pinned; five HTTPS health checks passed')


if __name__ == '__main__':
    main()
