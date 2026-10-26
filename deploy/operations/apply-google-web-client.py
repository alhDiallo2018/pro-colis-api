#!/usr/bin/python3 -I
"""Configurer le client OAuth Web approuve, avec controle et retour arriere."""
import copy
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import pwd
import re
from pathlib import Path
import stat
import sys
import tempfile
import time
import urllib.request

HELPER = Path('/usr/local/sbin/procolis-deploy')
HELPER_SHA256 = '8178a618fe9dea7b8f9d12913f45550e3ea93f8f71c16c31a04a29a8f71c2aec'
CLIENT = '856894814285-blm20bnfamss8spptpjvp2c5984rgsni.apps.googleusercontent.com'
VALUES = {'GOOGLE_WEB_CLIENT_ID': CLIENT}
PUBLIC_URL = 'https://sendprocolis.com/api/v1/auth/google/config'


def updated_dotenv(content):
    # Remplacer toutes les occurrences pour eviter qu'une ancienne ligne ou
    # une affectation export masquee ne retablisse le client precedent.
    pattern = re.compile(r'^\s*(?:export\s+)?GOOGLE_WEB_CLIENT_ID\s*=')
    lines = [line for line in content.splitlines() if not pattern.match(line)]
    return '\n'.join([*lines, 'GOOGLE_WEB_CLIENT_ID=' + CLIENT]) + '\n'



def updated_runtime(original):
    # Copier la structure complete conserve les secrets echappes pour Compose,
    # les autres services et tous les parametres non concernes par cette livraison.
    result = copy.deepcopy(original)
    result['services']['api']['environment'].update(VALUES)
    return result


def protected_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('Fichier administrateur non protege')


def atomic_write(path, content):
    metadata = path.lstat()
    fd, temporary = tempfile.mkstemp(prefix='.google-client-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            # Le .env web reste possede par son utilisateur initial.
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def public_policy():
    with urllib.request.urlopen(PUBLIC_URL, timeout=5) as response:
        result = json.load(response)
    if result.get('success') is not True:
        raise RuntimeError('Politique publique indisponible')
    return {key: result[key] for key in ('enabled', 'serverClientId')}


def wait_policy(expected):
    for _ in range(30):
        try:
            if public_policy() == expected:
                return
        except (OSError, ValueError, KeyError, RuntimeError):
            pass
        time.sleep(2)
    raise RuntimeError('La politique publique ne correspond pas a la configuration attendue')


def load_helper():
    protected_file(HELPER)
    if hashlib.sha256(HELPER.read_bytes()).hexdigest() != HELPER_SHA256:
        raise RuntimeError('Version du helper installe inattendue')
    loader = importlib.machinery.SourceFileLoader('trusted_deploy', str(HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def apply(deploy, backup):
    runtime = deploy.RUNTIME
    protected_file(runtime)
    if runtime.stat().st_mode & 0o077:
        raise RuntimeError('Configuration runtime non privee')
    original = runtime.read_bytes()
    (backup / 'runtime-before.json').write_bytes(original)
    previous_policy = public_policy()
    expected_policy = {'enabled': True, 'serverClientId': CLIENT}
    dotenv = deploy.WEB / '.env'
    metadata = dotenv.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o022
            or metadata.st_uid not in (0, pwd.getpwnam('debian').pw_uid)):
        raise RuntimeError('Fichier environnement web non protege')
    previous_dotenv = dotenv.read_bytes()
    (backup / 'web-env-before').write_bytes(previous_dotenv)
    next_dotenv = updated_dotenv(previous_dotenv.decode()).encode()
    row = json.loads(deploy.docker('inspect', 'sendprocolis-api'))[0]
    labels = row['Config']['Labels']
    if (labels.get('com.docker.compose.project') != 'sendprocolis-web'
            or labels.get('com.docker.compose.project.working_dir') != str(deploy.WEB)
            or not row['State']['Running']):
        raise RuntimeError('API active inattendue')
    old_env = json.loads(deploy.docker('exec', '-w', '/app', 'sendprocolis-api', 'node', '--input-type=module', '-e', deploy.SNAPSHOT))
    expected_env = {**old_env, **VALUES}
    candidate = backup / 'runtime-candidate.json'
    candidate.write_text(json.dumps(updated_runtime(json.loads(original))))
    switched = False
    try:
        deploy.RUNTIME = candidate
        config = json.loads(deploy.compose('config', '--format', 'json', overlay=True))
        deploy.validate_config(config)
        image = config['services']['api']['image']
        if json.loads(deploy.docker('image', 'inspect', image))[0]['Id'] != row['Image']:
            raise RuntimeError('L image candidate differe de l API active')
        # Valider le schema dans l'image existante, sans lancer le serveur ni
        # le CMD de demarrage qui execute habituellement Prisma.
        new_env = json.loads(deploy.compose('run', '--rm', '--no-deps', '-T', '--entrypoint', 'node',
            'api', '--input-type=module', '-e', deploy.SNAPSHOT, overlay=True))
        if new_env != expected_env:
            raise RuntimeError('Une configuration autre que le client OAuth Web serait modifiee')
        fresh = json.loads(deploy.docker('inspect', 'sendprocolis-api'))[0]
        if fresh['Id'] != row['Id'] or json.loads(deploy.docker('image', 'inspect', image))[0]['Id'] != row['Image']:
            raise RuntimeError('L API a change pendant la validation')
        # Marquer avant la premiere ecriture permet de restaurer les deux
        # fichiers si la seconde ecriture echoue.
        switched = True
        atomic_write(runtime, candidate.read_bytes())
        atomic_write(dotenv, next_dotenv)
        deploy.RUNTIME = runtime
        print('Configuration validee ; recreation du service API.', flush=True)
        deploy.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'api', overlay=True)
        wait_policy(expected_policy)
        deploy.probe('https://sendprocolis.com/api/v1/health')
        print('SUCCESS : nouveau client OAuth Web actif et verifie : ' + CLIENT, flush=True)
    except Exception:
        if switched:
            # Retour a la configuration sauvegardee et a la meme image si la
            # verification echoue. Aucun reset Git ni restauration de base.
            atomic_write(runtime, original)
            atomic_write(dotenv, previous_dotenv)
            deploy.RUNTIME = runtime
            print('Verification echouee ; restauration de la configuration precedente.', flush=True)
            deploy.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'api', overlay=True)
            wait_policy(previous_policy)
        raise
    finally:
        deploy.RUNTIME = runtime


def main(args):
    if args or os.geteuid() != 0:
        print('Executer en administrateur, sans argument.', file=sys.stderr)
        return 2
    os.umask(0o077)
    backup = None
    try:
        deploy = load_helper()
        deploy.private_directory(deploy.STATE)
        deploy.private_directory(deploy.RUNTIME.parent)
        with (deploy.STATE / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            backup = Path(tempfile.mkdtemp(prefix='google-web-client-', dir=deploy.STATE))
            print('Sauvegarde privee : ' + str(backup), flush=True)
            with (backup / 'operations.log').open('ab', buffering=0) as log:
                deploy.LOG = log
                apply(deploy, backup)
        return 0
    except Exception as error:
        # Ne jamais afficher stderr Docker ni les valeurs des fichiers prives.
        print('ARRET : ' + type(error).__name__ + '. Consulter le journal administrateur : ' + str(backup), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
