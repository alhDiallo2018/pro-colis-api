#!/bin/bash
# Installation par l'administrateur uniquement. Ne lance aucun deploiement.
set -euo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[ "$EUID" -eq 0 ] || { echo "Executer depuis la session administrateur avec sudo." >&2; exit 1; }
[ "$#" -eq 0 ] || { echo "Aucun argument accepte." >&2; exit 2; }
helper=/usr/local/sbin/procolis-deploy
rule=/etc/sudoers.d/procolis-deploy
for target in "$helper" "$rule"; do
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "Installation refusee : $target existe deja." >&2
    exit 1
  fi
done
/usr/bin/python3 -I - <<'CHECK'
import os, stat
for path in ['/root', '/usr/local/sbin', '/etc/sudoers.d']:
    st = os.lstat(path)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
        raise SystemExit('Repertoire administrateur non protege : ' + path)
CHECK
work=$(mktemp -d /root/procolis-deploy-install.XXXXXXXX)
installed_helper=0
installed_rule=0
committed=0
cleanup() {
  if [ "$committed" -eq 0 ]; then
    [ "$installed_rule" -eq 0 ] || rm -f -- "$rule"
    [ "$installed_helper" -eq 0 ] || rm -f -- "$helper"
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
cat > "$work/helper" <<'PROCOLIS_DEPLOY_PY'
#!/usr/bin/python3 -I
"""Deploiement unique des deux revisions approuvees, sans argument operateur."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

BASE = Path('/home/debian/procolis')
API = BASE / 'SendProColis-Api'
WEB = BASE / 'SendProColis-Web'
REVISIONS = {API: '5779764acc6ec8f69e3c297fb97954ce2eb694f8',
             WEB: '1a88896599f7c90717a142aad8944282216648a2'}
CLIENT = '856894814285-liup8k5nqvth5f10h2bcnd82obc4v5vi.apps.googleusercontent.com'
STATE = Path('/var/lib/procolis-deploy')
RUNTIME = Path('/etc/procolis/deployment-runtime.json')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8',
       'DOCKER_HOST': 'unix:///var/run/docker.sock', 'DOCKER_CONFIG': '/root/.docker',
       'APP_RELEASE': REVISIONS[WEB]}
SNAPSHOT = 'import {env} from "./src/config/env.js"; process.stdout.write(JSON.stringify(env));'
LOG = None


def run(args, *, cwd='/', output=None, timeout=1800):
    """Aucun shell, stdin, environnement ou repertoire fourni par l'operateur.

    Les sorties completes restent privees : une erreur de build peut inclure
    une configuration. Tuer tout le groupe evite un deploiement orphelin.
    """
    with subprocess.Popen(args, cwd=cwd, env=ENV, stdin=subprocess.DEVNULL,
                          stdout=output or subprocess.PIPE, stderr=LOG,
                          start_new_session=True) as process:
        try:
            stdout, _ = process.communicate(timeout=timeout)
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise
        if process.returncode:
            if stdout and LOG:
                LOG.write(stdout)
                LOG.flush()
            raise RuntimeError('Echec de commande ; consulter le journal prive avec le compte administrateur.')
        return stdout or b''


def git(repo, *args):
    # Git reste sous l'identite du proprietaire des depots, jamais root. Les
    # hooks sont desactives et les deux commits sont figes dans ce programme.
    return run(['/usr/sbin/runuser', '-u', 'debian', '--', '/usr/bin/env', '-i',
                'HOME=/home/debian', 'PATH=/usr/bin:/bin', 'GIT_TERMINAL_PROMPT=0',
                '/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                '-C', str(repo), *args])


def docker(*args, **kwargs):
    return run(['/usr/bin/docker', *map(str, args)], **kwargs)


def compose(*args, overlay=False, **kwargs):
    files = ['-f', str(WEB / 'docker-compose.yml')]
    if overlay:
        files += ['-f', str(RUNTIME)]
    return docker('compose', '--project-directory', WEB, '--env-file', WEB / '.env',
                  '-p', 'sendprocolis-web', *files, *args, **kwargs)


def private_directory(path):
    if not path.exists():
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Repertoire privilegie non protege : ' + str(path))


def trusted_tree(repo, debian_uid):
    # /home/debian ferme l'acces a ops. Refuser aussi les liens et les fichiers
    # modifiables par un tiers qui pourraient detourner les entrees de build.
    for current, directories, files in os.walk(repo, followlinks=False):
        if Path(current) == repo:
            excluded = {'.git', 'node_modules'} | ({'uploads', 'backups'} if repo == API else set())
            directories[:] = [name for name in directories if name not in excluded]
        for path in [Path(current), *(Path(current) / name for name in directories + files)]:
            info = path.lstat()
            if (stat.S_ISLNK(info.st_mode) or info.st_uid not in (0, debian_uid)
                    or info.st_mode & 0o022 or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))):
                raise RuntimeError('Entree de build non protegee : ' + str(path.relative_to(repo)))


def validate_config(config):
    """Limiter Docker aux deux services et volumes connus ; aucun acces hote."""
    for name, container, targets in [('api', 'sendprocolis-api', {'/app/uploads'}),
                                      ('caddy', 'sendprocolis-caddy', {'/data', '/config'})]:
        service = config['services'][name]
        if service.get('container_name') != container:
            raise RuntimeError('Nom de conteneur inattendu.')
        for field in ('privileged', 'network_mode', 'pid', 'ipc', 'cap_add', 'devices',
                      'device_cgroup_rules', 'volumes_from', 'security_opt', 'use_api_socket',
                      'develop', 'post_start', 'pre_stop', 'userns_mode', 'cgroup_parent'):
            if service.get(field):
                raise RuntimeError('Option Docker non autorisee : ' + field)
        if set(service.get('networks', {})) != {'default', 'observability'}:
            raise RuntimeError('Reseaux inattendus.')
        expected_sources = {'api-uploads': '/app/uploads'} if name == 'api' else {'caddy-data': '/data', 'caddy-config': '/config'}
        for volume in service.get('volumes', []):
            if volume.get('type') != 'volume' or volume.get('target') not in targets:
                raise RuntimeError('Montage Docker non autorise.')
            if expected_sources.get(volume.get('source')) != volume.get('target'):
                raise RuntimeError('Volume hors du perimetre ProColis.')
            definition = config.get('volumes', {}).get(volume.get('source'), {})
            if definition.get('name') != 'sendprocolis-web_' + volume['source']:
                raise RuntimeError('Nom physique de volume inattendu.')
            if definition.get('driver_opts') or definition.get('driver', 'local') != 'local':
                raise RuntimeError('Pilote de volume non autorise.')
        build = service.get('build', {})
        expected = API if name == 'api' else WEB
        if Path(build.get('context', '')) != expected or build.get('dockerfile', 'Dockerfile') != 'Dockerfile':
            raise RuntimeError('Contexte de build inattendu.')
        if set(build) - {'context', 'dockerfile', 'args'}:
            raise RuntimeError('Options de build non autorisees.')
        if name == 'api' and service.get('ports'):
            raise RuntimeError('Publication de port API refusee.')
        if name == 'caddy' and any(str(port.get('published')) not in ('80', '443')
                                  or port.get('target') not in (80, 443) for port in service.get('ports', [])):
            raise RuntimeError('Publication de port Caddy inattendue.')


def update_repo(repo, backup):
    allowed = {'docker-compose.yml', 'Caddyfile'} if repo == WEB else set()
    changed = set(git(repo, 'diff', 'HEAD', '--name-only').decode().splitlines())
    if changed - allowed:
        raise RuntimeError('Modifications locales a examiner : ' + ', '.join(sorted(changed - allowed)))
    (backup / (repo.name + '.patch')).write_bytes(git(repo, 'diff', 'HEAD'))
    git(repo, 'fetch', 'origin')
    target = REVISIONS[repo]
    git(repo, 'merge-base', '--is-ancestor', 'HEAD', target)
    stash = None
    if changed:
        git(repo, 'stash', 'push', '-m', 'procolis-deploy-' + backup.name)
        stash = git(repo, 'rev-parse', 'refs/stash').decode().strip()
        (backup / (repo.name + '.stash')).write_text(stash)
    git(repo, 'merge', '--ff-only', target)
    if stash:
        # Garder le stash apres application permet une recuperation manuelle.
        # Un conflit interrompt la procedure avant toute migration/redemarrage.
        git(repo, 'stash', 'apply', '--index', stash)
    if git(repo, 'rev-parse', 'HEAD').decode().strip() != target:
        raise RuntimeError('Revision finale inattendue.')


def runtime_overlay(values):
    # Compose interpole les dollars meme dans un fichier JSON. Doubler chaque
    # dollar conserve exactement les secrets existants, sans les regenerer.
    converted = {key: str(value).lower() if isinstance(value, bool) else str(value)
                 for key, value in values.items() if value is not None}
    converted.update(GOOGLE_WEB_CLIENT_ID=CLIENT, APP_RELEASE=REVISIONS[API], NODE_ENV='production')
    return {'services': {'api': {'environment': {key: value.replace('$', '$$')
                                               for key, value in converted.items()}}}}


def probe(url):
    for _ in range(30):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                body = json.load(response)
            if body.get('success') is True:
                return body
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('Verification HTTP en echec.')


def deploy(backup):
    print('Etape : verification des depots et de la topologie actuelle.', flush=True)
    debian_uid = pwd.getpwnam('debian').pw_uid
    home = Path('/home/debian').lstat()
    if not stat.S_ISDIR(home.st_mode) or home.st_uid != debian_uid or home.st_mode & 0o077:
        raise RuntimeError('/home/debian doit appartenir a debian et rester en mode 0700.')
    for repo in REVISIONS:
        if repo.resolve() != repo:
            raise RuntimeError('Chemin de depot indirect refuse.')
        trusted_tree(repo, debian_uid)
    current = json.loads(docker('inspect', 'sendprocolis-api', 'sendprocolis-caddy'))
    for row in current:
        labels = row['Config']['Labels']
        if (labels.get('com.docker.compose.project') != 'sendprocolis-web'
                or labels.get('com.docker.compose.project.working_dir') != str(WEB)):
            raise RuntimeError('Projet Compose actif inattendu.')
        docker('tag', row['Image'], 'procolis-rollback-' + row['Name'].lstrip('/') + ':' + backup.name)
    for row in current:
        for mount in row.get('Mounts', []):
            if mount.get('Type') != 'volume':
                raise RuntimeError('Montage actif inattendu.')
            volume = json.loads(docker('volume', 'inspect', mount['Name']))[0]
            if volume.get('Driver') != 'local' or volume.get('Options'):
                raise RuntimeError('Volume actif hors du perimetre autorise.')
    (backup / 'containers.json').write_text(json.dumps(current))
    old = json.loads(docker('exec', '-w', '/app', 'sendprocolis-api', 'node', '--input-type=module', '-e', SNAPSHOT))
    (backup / 'environment-before.json').write_text(json.dumps(old))
    for repo in REVISIONS:
        if (repo / '.env').exists():
            shutil.copyfile(repo / '.env', backup / (repo.name + '.env'))
        print('Etape : preparation de ' + repo.name + '.', flush=True)
        update_repo(repo, backup)
        trusted_tree(repo, debian_uid)
    validate_config(json.loads(compose('config', '--format', 'json')))
    private_directory(RUNTIME.parent)
    if RUNTIME.exists():
        if RUNTIME.is_symlink() or RUNTIME.stat().st_uid != 0 or RUNTIME.stat().st_mode & 0o077:
            raise RuntimeError('Configuration runtime non protegee.')
        shutil.copyfile(RUNTIME, backup / 'runtime-before.json')
    staged = backup / 'runtime.json'
    staged.write_text(json.dumps(runtime_overlay(old)))
    # Remplacement atomique sur le meme systeme de fichiers que /etc/procolis.
    fd, pending = tempfile.mkstemp(dir=RUNTIME.parent)
    with os.fdopen(fd, 'w') as stream:
        stream.write(staged.read_text())
    os.replace(pending, RUNTIME)
    config = json.loads(compose('config', '--format', 'json', overlay=True))
    validate_config(config)
    print('Etape : construction des images API et web.', flush=True)
    compose('build', 'api', 'caddy', overlay=True)
    new = json.loads(compose('run', '--rm', '--no-deps', '-T', 'api', 'node', '--input-type=module', '-e', SNAPSHOT, overlay=True))
    keys = {'DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'METRICS_TOKEN'}
    keys.update(key for key in old if key.startswith(('PAYDUNYA_', 'FIREBASE_', 'BREVO_')))
    if any(old.get(key) != new.get(key) for key in keys):
        raise RuntimeError('La nouvelle image ne conserve pas la configuration critique.')
    # Le client pg_dump de la nouvelle image utilise la connexion effective,
    # pas une base du VPS choisie par son seul nom. Le dump reste prive.
    dump = r'''
import {env} from './src/config/env.js';
import {spawnSync} from 'node:child_process';
const u = new URL(env.DATABASE_URL);
if (decodeURIComponent(u.pathname.slice(1)) !== 'sendprocolis') process.exit(2);
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
 env: {...process.env, PGHOST: u.searchParams.get('host') || u.hostname,
 PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username),
 PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: 'sendprocolis',
 ...(u.searchParams.get('sslmode') ? {PGSSLMODE:u.searchParams.get('sslmode')} : {})}, stdio:'inherit'});
process.exit(result.status ?? 1);
'''
    print('Etape : sauvegarde PostgreSQL avant migration.', flush=True)
    with (backup / 'database.dump').open('wb') as output:
        compose('run', '--rm', '--no-deps', '-T', 'api', 'node', '--input-type=module', '-e', dump, overlay=True, output=output)
    if (backup / 'database.dump').stat().st_size < 100:
        raise RuntimeError('Sauvegarde PostgreSQL vide.')
    compose('run', '--rm', '--no-deps', '-T', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile', overlay=True)
    # Detecter une intervention parallele pendant la construction des images.
    fresh = json.loads(docker('inspect', 'sendprocolis-api', 'sendprocolis-caddy'))
    if [row['Id'] for row in fresh] != [row['Id'] for row in current]:
        raise RuntimeError('Les conteneurs ont change pendant la preparation.')
    print('Etape : migrations puis remplacement de l API.', flush=True)
    compose('run', '--rm', '--no-deps', '-T', 'api', 'npx', 'prisma', 'migrate', 'deploy', overlay=True)
    compose('up', '-d', '--no-deps', '--no-build', 'api', overlay=True)
    # Verifier directement l'instance de reference depuis le proxy existant.
    ready = False
    for _ in range(30):
        try:
            docker('exec', 'sendprocolis-caddy', 'wget', '-q', '-T', '5', '-O', '/dev/null', 'http://sendprocolis-api:8080/health')
            ready = True
            break
        except RuntimeError:
            time.sleep(2)
    if not ready:
        raise RuntimeError('La nouvelle API ne repond pas ; web non remplace.')
    print('Etape : remplacement du web et controles HTTPS.', flush=True)
    compose('up', '-d', '--no-deps', '--no-build', 'caddy', overlay=True)
    probe('https://sendprocolis.com/api/v1/health')
    result = probe('https://sendprocolis.com/api/v1/auth/google/config')
    if result.get('enabled') is not True or result.get('serverClientId') != CLIENT:
        raise RuntimeError('Configuration Google publique incorrecte.')
    # Rendre la configuration preservee persistante pour les futurs appels
    # Compose standards avec sudo. Ne jamais copier un .env d'exemple en prod.
    path = WEB / '.env'
    content = path.read_text().splitlines()
    pattern = re.compile(r'^\s*(?:export\s+)?(?:COMPOSE_FILE|GOOGLE_WEB_CLIENT_ID)\s*=')
    content = [line for line in content if not pattern.match(line)]
    content += ['GOOGLE_WEB_CLIENT_ID=' + CLIENT,
                'COMPOSE_FILE=' + str(WEB / 'docker-compose.yml') + ':' + str(RUNTIME)]
    path.write_text('\n'.join(content) + '\n')


def main(args):
    global LOG
    if args:
        print('Cette commande refuse tout argument.', file=sys.stderr)
        return 2
    if os.geteuid() != 0:
        print('Cette commande doit etre lancee via sudo.', file=sys.stderr)
        return 1
    os.umask(0o077)
    # Une interruption doit aussi arreter le groupe de processus enfant.
    def terminate(_signum, _frame):
        raise RuntimeError('Deploiement interrompu.')
    signal.signal(signal.SIGTERM, terminate)
    try:
        private_directory(STATE)
        with (STATE / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            marker = STATE / ('completed-' + REVISIONS[WEB])
            if marker.exists():
                print('Cette livraison a deja ete deployee ; aucune action.')
                return 0
            backup = Path(tempfile.mkdtemp(prefix='release-', dir=STATE))
            print('Deploiement des revisions API 5779764 / web 1a88896. Journal prive : ' + str(backup), flush=True)
            with (backup / 'operations.log').open('ab', buffering=0) as LOG:
                deploy(backup)
            marker.write_text(str(backup))
            print('SUCCESS : API, web, migrations et configuration Google verifies.')
            return 0
    except Exception as error:
        print('ARRET : ' + str(error) + ' Aucun retour arriere de base automatique.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
PROCOLIS_DEPLOY_PY
cat > "$work/rule" <<'PROCOLIS_DEPLOY_RULE'
# Livraison precise uniquement ; "" interdit tout argument supplementaire.
procolis-ops ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/procolis-deploy ""
PROCOLIS_DEPLOY_RULE
/usr/bin/python3 -I - "$work/helper" <<'CHECK'
from pathlib import Path
import sys
compile(Path(sys.argv[1]).read_text(), sys.argv[1], 'exec')
CHECK
/usr/sbin/visudo -cf "$work/rule"
install -o root -g root -m 0555 "$work/helper" "$helper"
installed_helper=1
install -o root -g root -m 0440 "$work/rule" "$rule"
installed_rule=1
/usr/sbin/visudo -c
committed=1
echo 'INSTALLE : une seule commande de deploiement ProColis, sans argument.'
echo 'Aucun deploiement lance. Aucun droit sudo general ni acces Docker direct ajoute.'
echo 'Commande autorisee : sudo -n /usr/local/sbin/procolis-deploy'
