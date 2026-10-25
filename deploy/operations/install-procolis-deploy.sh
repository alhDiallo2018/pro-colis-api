#!/bin/bash
# Installation administrateur seulement. Aucun deploiement ni changement de donnees.
set -euo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[ "$EUID" -eq 0 ] || { echo 'Executer avec sudo depuis la session administrateur.' >&2; exit 1; }
[ "$#" -eq 0 ] || { echo 'Aucun argument accepte.' >&2; exit 2; }
/usr/bin/python3 -I - <<'CHECK_PARENTS'
import os, stat
from pathlib import Path
for path in ['/root', '/usr/local/sbin', '/etc/sudoers.d', '/var/lib']:
    st = os.lstat(path)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
        raise SystemExit('Repertoire administrateur non protege : ' + path)
state = Path('/var/lib/procolis-deploy')
state.mkdir(mode=0o700, exist_ok=True)
st = state.lstat()
if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
    raise SystemExit('Etat de deploiement non protege')
CHECK_PARENTS
# Partage le verrou du deploiement : ne jamais remplacer un helper en cours.
exec 9>/var/lib/procolis-deploy/lock
flock -n 9 || { echo 'Un deploiement est en cours.' >&2; exit 1; }
/usr/bin/python3 -I - <<'CHECK_EXISTING'
import hashlib, os, stat
from pathlib import Path
if os.path.lexists('/usr/local/sbin/procolis-deploy'):
    raise SystemExit('Installation refusee : fichier deja present ' + '/usr/local/sbin/procolis-deploy')
if os.path.lexists('/usr/local/sbin/procolis-deploy-report'):
    raise SystemExit('Installation refusee : fichier deja present ' + '/usr/local/sbin/procolis-deploy-report')
if os.path.lexists('/etc/sudoers.d/procolis-deploy'):
    raise SystemExit('Installation refusee : fichier deja present ' + '/etc/sudoers.d/procolis-deploy')
CHECK_EXISTING
work=$(mktemp -d /root/procolis-deploy-update.XXXXXXXX)
changed=0
committed=0
cleanup() {
  if [ "$changed" -eq 1 ] && [ "$committed" -eq 0 ]; then
    rm -f -- "/usr/local/sbin/procolis-deploy"
    rm -f -- "/usr/local/sbin/procolis-deploy-report"
    rm -f -- "/etc/sudoers.d/procolis-deploy"
    echo 'Installation interrompue : permissions precedentes restaurees.' >&2
  fi
  echo "Copie administrateur conservee : $work"
}
trap cleanup EXIT
cat > "$work/procolis-deploy" <<'PROCOLIS_FILE_0'
#!/usr/bin/python3 -I
"""Deploiement unique des deux revisions approuvees, sans argument operateur."""
import fcntl
import hashlib
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
REVISIONS = {API: '49f0b2a3bd7c3b5d4c5e6a25d7152384f4e511e5',
             WEB: 'fc2150fcd2840fa665dedc1bc49e3c0a649e4690'}
CLIENT = '856894814285-liup8k5nqvth5f10h2bcnd82obc4v5vi.apps.googleusercontent.com'
STATE = Path('/var/lib/procolis-deploy')
RUNTIME = Path('/etc/procolis/deployment-runtime.json')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8',
       'DOCKER_HOST': 'unix:///var/run/docker.sock', 'DOCKER_CONFIG': '/root/.docker',
       'APP_RELEASE': REVISIONS[WEB]}
SNAPSHOT = 'import {env} from "./src/config/env.js"; process.stdout.write(JSON.stringify(env));'
LOG = None
REPORT_PATH = None
REPORT = {}
# Le patch du VPS a ete examine : routage/configuration integres aux commits,
# remplacement npm install inutile depuis la correction du lockfile Linux.
REVIEWED_WEB_PATCH = '23aa6d9a273b5395d38335d6a5e85c4b5ff6fd53c9b9bef92ff57e3678172268'


def report(**values):
    """Rapport structure sans stdout, stderr, arguments ou valeurs de secrets."""
    REPORT.update(values)
    if REPORT_PATH:
        pending = REPORT_PATH.with_suffix('.pending')
        pending.write_text(json.dumps(REPORT))
        os.replace(pending, REPORT_PATH)


def stage(name):
    print('Etape : ' + name + '.', flush=True)
    report(stage=name)



def run(args, *, cwd='/', output=None, timeout=1800):
    """Aucun shell, stdin, environnement ou repertoire fourni par l'operateur.

    Les sorties completes restent privees : une erreur de build peut inclure
    une configuration. Tuer tout le groupe evite un deploiement orphelin.
    """
    report(command=Path(args[0]).name, exitCode=None)
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
        report(exitCode=process.returncode)
        if process.returncode:
            if stdout and LOG:
                LOG.write(stdout)
                LOG.flush()
            raise RuntimeError('Echec de commande (code %s) ; consulter sudo -n /usr/local/sbin/procolis-deploy-report.' % process.returncode)
        return stdout or b''


def git(repo, *args):
    # Git reste sous l'identite du proprietaire des depots, jamais root. Les
    # hooks sont desactives et les deux commits sont figes dans ce programme.
    report(operation='git ' + args[0], repository=repo.name)
    return run(['/usr/sbin/runuser', '-u', 'debian', '--', '/usr/bin/env', '-i',
                'HOME=/home/debian', 'PATH=/usr/bin:/bin', 'GIT_TERMINAL_PROMPT=0',
                '/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                '-C', str(repo), *args])


def docker(*args, **kwargs):
    if args[0] != 'compose':
        report(operation='docker ' + args[0], repository=None)
    return run(['/usr/bin/docker', *map(str, args)], **kwargs)


def compose(*args, overlay=False, **kwargs):
    report(operation='docker compose ' + args[0], repository=None)
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
    allowed = {'docker-compose.yml', 'Caddyfile', 'Dockerfile'} if repo == WEB else set()
    changed = set(git(repo, 'diff', 'HEAD', '--name-only').decode().splitlines())
    if changed - allowed:
        raise RuntimeError('Modifications locales a examiner : ' + ', '.join(sorted(changed - allowed)))
    delta = git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD')
    (backup / (repo.name + '.patch')).write_bytes(delta)
    if changed and (repo != WEB or hashlib.sha256(delta).hexdigest() != REVIEWED_WEB_PATCH):
        raise RuntimeError('Le patch local differe de la copie examinee ; aucune modification appliquee.')
    git(repo, 'fetch', 'origin')
    target = REVISIONS[repo]
    git(repo, 'merge-base', '--is-ancestor', 'HEAD', target)
    stash = None
    if changed:
        git(repo, 'stash', 'push', '-m', 'procolis-deploy-' + backup.name)
        stash = git(repo, 'rev-parse', 'refs/stash').decode().strip()
        (backup / (repo.name + '.stash')).write_text(stash)
    git(repo, 'merge', '--ff-only', target)
    # Le stash reste disponible pour recuperation. Ne pas le reappliquer :
    # les corrections examinees sont integrees a la revision cible, et le
    # contournement npm install doit laisser place au lockfile corrige.
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
    stage('verification des depots et de la topologie actuelle')
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
        stage('preparation de ' + repo.name)
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
    stage('construction des images API et web')
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
    stage('sauvegarde PostgreSQL avant migration')
    with (backup / 'database.dump').open('wb') as output:
        compose('run', '--rm', '--no-deps', '-T', 'api', 'node', '--input-type=module', '-e', dump, overlay=True, output=output)
    if (backup / 'database.dump').stat().st_size < 100:
        raise RuntimeError('Sauvegarde PostgreSQL vide.')
    compose('run', '--rm', '--no-deps', '-T', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile', overlay=True)
    # Detecter une intervention parallele pendant la construction des images.
    fresh = json.loads(docker('inspect', 'sendprocolis-api', 'sendprocolis-caddy'))
    if [row['Id'] for row in fresh] != [row['Id'] for row in current]:
        raise RuntimeError('Les conteneurs ont change pendant la preparation.')
    stage('migrations puis remplacement de l API')
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
    stage('remplacement du web et controles HTTPS')
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
    global LOG, REPORT_PATH
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
            REPORT_PATH = backup / 'report.json'
            report(status='running', release=backup.name, api=REVISIONS[API], web=REVISIONS[WEB])
            print('Deploiement des revisions API ' + REVISIONS[API][:7] + ' / web ' + REVISIONS[WEB][:7] + '. Journal prive : ' + str(backup), flush=True)
            with (backup / 'operations.log').open('ab', buffering=0) as LOG:
                deploy(backup)
            marker.write_text(str(backup))
            report(status='succeeded')
            print('SUCCESS : API, web, migrations et configuration Google verifies.')
            return 0
    except Exception as error:
        report(status='failed', errorType=type(error).__name__)
        print('ARRET : ' + str(error) + ' Aucun retour arriere de base automatique.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
PROCOLIS_FILE_0
cat > "$work/procolis-deploy-report" <<'PROCOLIS_FILE_1'
#!/usr/bin/python3 -I
"""Etat et causes connues des deploiements ProColis, sans journal brut ni secret."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

STATE = Path('/var/lib/procolis-deploy')
BASE = Path('/home/debian/procolis')
REVISIONS = {'SendProColis-Api': '49f0b2a3bd7c3b5d4c5e6a25d7152384f4e511e5',
             'SendProColis-Web': 'fc2150fcd2840fa665dedc1bc49e3c0a649e4690'}
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}


def protected(path, directory=False):
    info = path.lstat()
    valid_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not valid_type or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Etat prive non protege')


def known_errors(content):
    # Retourner uniquement des categories fixes : les lignes npm/SQL peuvent
    # contenir une URL de connexion ou une valeur d'environnement sensible.
    patterns = {
        'git_non_fast_forward': r'Not possible to fast-forward|not an ancestor',
        'git_conflict': r'CONFLICT|would be overwritten',
        'git_authentication': r'fatal: Authentication failed|could not read Username|Permission denied \(publickey\)',
        'git_missing_revision': r'Not a valid commit|unknown revision|bad object',
        'npm_lockfile': r'can only install packages when|Missing: .+ from lock file|EUSAGE',
        'typescript_build': r'error TS\d+',
        'invalid_environment': r'Invalid environment configuration',
        'brevo_sender_email': r'BREVO_SENDER_EMAIL',
        'metrics_configuration': r'METRICS_TOKEN',
        'database_authentication': r'password authentication failed',
        'database_unreachable': r'could not connect to server|Connection refused',
        'dump_version': r'server version mismatch',
        'disk_full': r'No space left on device',
        'docker_build': r'failed to solve|failed to build',
    }
    result = [label for label, pattern in patterns.items() if re.search(pattern, content, re.I)]
    result += sorted(set(re.findall(r'\bP[1236]\d{3}\b', content)))
    return result


def git(repo, *args):
    result = subprocess.run(['/usr/sbin/runuser', '-u', 'debian', '--', '/usr/bin/env', '-i',
        'HOME=/home/debian', 'PATH=/usr/bin:/bin', 'GIT_TERMINAL_PROMPT=0', '/usr/bin/git',
        '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', str(repo), *args],
        cwd='/', env=ENV, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20)
    return result.returncode, result.stdout


def inspect():
    protected(STATE, directory=True)
    releases = []
    for path in STATE.glob('release-*'):
        protected(path, directory=True)
        releases.append(path)
    result = {'latest': None, 'repositories': []}
    if releases:
        latest = max(releases, key=lambda path: path.stat().st_mtime_ns)
        details = {'release': latest.name}
        if (latest / 'report.json').exists():
            protected(latest / 'report.json')
            raw = json.loads((latest / 'report.json').read_text())
            details.update({key: raw.get(key) for key in ('status', 'stage', 'operation', 'repository',
                            'command', 'exitCode', 'errorType', 'api', 'web')})
        log = latest / 'operations.log'
        if log.exists():
            protected(log)
            with log.open('rb') as stream:
                stream.seek(max(0, log.stat().st_size - 262144))
                details['errorCategories'] = known_errors(stream.read().decode(errors='replace'))
        result['latest'] = details
    for name, target in REVISIONS.items():
        repo = BASE / name
        rc, revision = git(repo, 'rev-parse', 'HEAD')
        changes_rc, changes = git(repo, 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--name-only')
        ancestor_rc, _ = git(repo, 'merge-base', '--is-ancestor', 'HEAD', target)
        result['repositories'].append({'name': name, 'revision': revision.strip() if rc == 0 else None,
            'target': target, 'ancestorExitCode': ancestor_rc,
            'trackedFilesChanged': changes.splitlines() if changes_rc == 0 else None})
    return result


def main(args):
    if args:
        print('Aucun argument accepte.', file=sys.stderr)
        return 2
    if os.geteuid() != 0:
        print('Executer via sudo.', file=sys.stderr)
        return 1
    try:
        print(json.dumps(inspect(), ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        # Le message d'une exception externe peut contenir des secrets.
        print('Rapport indisponible : ' + type(error).__name__, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
PROCOLIS_FILE_1
cat > "$work/procolis-deploy.sudoers" <<'PROCOLIS_FILE_2'
# Livraison precise uniquement ; "" interdit tout argument supplementaire.
procolis-ops ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/procolis-deploy ""
# Rapport fixe : historique Git et causes connues, sans sortie brute.
procolis-ops ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/procolis-deploy-report ""
PROCOLIS_FILE_2
/usr/bin/python3 -I - "$work" <<'CHECK_PYTHON'
from pathlib import Path
import sys
for name in ['procolis-deploy', 'procolis-deploy-report']:
    path = Path(sys.argv[1]) / name
    compile(path.read_text(), str(path), 'exec')
CHECK_PYTHON
/usr/sbin/visudo -cf "$work/procolis-deploy.sudoers"
changed=1
install -o root -g root -m 0555 "$work/procolis-deploy" "/usr/local/sbin/procolis-deploy.new"
mv -f -- "/usr/local/sbin/procolis-deploy.new" "/usr/local/sbin/procolis-deploy"
install -o root -g root -m 0555 "$work/procolis-deploy-report" "/usr/local/sbin/procolis-deploy-report.new"
mv -f -- "/usr/local/sbin/procolis-deploy-report.new" "/usr/local/sbin/procolis-deploy-report"
install -o root -g root -m 0440 "$work/procolis-deploy.sudoers" "/etc/sudoers.d/procolis-deploy.new"
mv -f -- "/etc/sudoers.d/procolis-deploy.new" "/etc/sudoers.d/procolis-deploy"
/usr/sbin/visudo -c
committed=1
echo 'INSTALLE : livraison revue API/web et rapport de diagnostic.'
echo 'Aucun deploiement lance. Aucun droit sudo general ni acces Docker direct ajoute.'
echo 'Commandes : sudo -n /usr/local/sbin/procolis-deploy-report'
echo '            sudo -n /usr/local/sbin/procolis-deploy'
