#!/usr/bin/python3 -I
"""Recuperer les medias references depuis l'ancien stockage, sans ecrasement."""
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

HELPER = Path('/usr/local/sbin/procolis-deploy')
HELPER_SHA256 = '8178a618fe9dea7b8f9d12913f45550e3ea93f8f71c16c31a04a29a8f71c2aec'
LEGACY = Path('/home/debian/procolis/SendProColis-Api/uploads')
VOLUME = 'sendprocolis-web_api-uploads'
ACTIVE = Path('/var/lib/docker/volumes') / VOLUME / '_data'
PUBLIC = 'https://sendprocolis.com'
EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.webm', '.mp3', '.m4a', '.aac', '.wav', '.pdf', '.bin'}
MAX_BYTES = 150 * 1024 * 1024

# Seuls les champs de medias sont lus. Aucun utilisateur, secret, contenu de
# message ou document n'est renvoye par le diagnostic. La base reste intacte.
REFERENCES = r"""
import {prisma} from './src/config/prisma.js';
import {env} from './src/config/env.js';
const fields = {
 user:['profilePhoto'], parcel:['signatureUrl'], parcelMedia:['url'],
 parcelEvent:['photoUrl'], bid:['audioUrl'], advertisement:['audioUrl'],
 message:['audioUrl','photoUrl','videoUrl'], supportChatEntry:['audioUrl','photoUrl','videoUrl'],
 identityVerification:['documentFrontUrl','documentBackUrl'], payment:['receiptUrl'], expense:['proofUrl']
};
try {
 const urls = new Set();
 for (const [model, names] of Object.entries(fields)) {
  const where = ['user','parcel','message','supportChatEntry'].includes(model) ? {deletedAt:null} : {};
  const rows = await prisma[model].findMany({where, select:Object.fromEntries(names.map(name=>[name,true]))});
  for (const row of rows) for (const value of Object.values(row)) if (typeof value==='string' && value) urls.add(value);
 }
 process.stdout.write(JSON.stringify({urls:[...urls], uploadDir:env.UPLOAD_LOCAL_DIR, baseUrl:env.PUBLIC_BASE_URL}));
} finally { await prisma.$disconnect(); }
"""


def relative_media(value):
    """Les URL ne deviennent jamais des chemins arbitraires du serveur."""
    try:
        url = urlsplit(value)
    except ValueError:
        return None
    if url.scheme not in ('', 'http', 'https') or url.netloc not in ('', 'sendprocolis.com', 'www.sendprocolis.com'):
        return None
    if not url.path.startswith('/uploads/') or url.username or url.password:
        return None
    relative = unquote(url.path[len('/uploads/'):])
    parts = relative.split('/')
    if len(parts) not in (1, 2) or (len(parts) == 2 and parts[0] not in ('photo', 'video', 'audio')):
        return None
    filename = Path(parts[-1])
    try:
        if str(UUID(filename.stem)) != filename.stem.lower() or filename.suffix.lower() not in EXTENSIONS:
            return None
    except ValueError:
        return None
    return relative


def directory_fd(path, create=False):
    # Traverser chaque composant via des descripteurs et O_NOFOLLOW evite les
    # liens symboliques, y compris un remplacement concurrent d'un repertoire.
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Repertoire absolu attendu')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            created = False
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                    created = True
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            if created:
                os.fchmod(child, 0o755)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def recover_one(source, target, relative):
    if relative_media('/uploads/' + relative) != relative:
        raise ValueError('Chemin de media refuse')
    rel = Path(relative)
    source_fd = target_fd = None
    temporary = None
    try:
        target_fd = directory_fd(target / rel.parent, create=True)
        try:
            info = os.stat(rel.name, dir_fd=target_fd, follow_symlinks=False)
            return {'status': 'existing' if stat.S_ISREG(info.st_mode) and info.st_size else 'existing_invalid'}
        except FileNotFoundError:
            pass
        try:
            source_fd = directory_fd(source / rel.parent)
            fd = os.open(rel.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_fd)
        except FileNotFoundError:
            return {'status': 'missing'}
        with os.fdopen(fd, 'rb') as incoming:
            before = os.fstat(incoming.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_BYTES:
                return {'status': 'source_invalid'}
            # Le fichier n'est publie qu'apres copie complete et fsync. Le lien
            # atomique echoue si un upload concurrent a deja cree la destination.
            temporary = '.recover-' + uuid4().hex
            out = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=target_fd)
            digest = hashlib.sha256()
            with os.fdopen(out, 'wb') as outgoing:
                copied = 0
                for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                    copied += len(chunk)
                    if copied > MAX_BYTES:
                        raise RuntimeError('Source trop volumineuse pendant la copie')
                    digest.update(chunk)
                    outgoing.write(chunk)
                after = os.fstat(incoming.fileno())
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise RuntimeError('Source modifiee pendant la copie')
                os.fchmod(outgoing.fileno(), 0o644)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            try:
                os.link(temporary, rel.name, src_dir_fd=target_fd, dst_dir_fd=target_fd, follow_symlinks=False)
            except FileExistsError:
                return {'status': 'concurrent_existing'}
            os.fsync(target_fd)
            return {'status': 'recovered', 'bytes': before.st_size, 'sha256': digest.hexdigest()}
    finally:
        if temporary is not None:
            os.unlink(temporary, dir_fd=target_fd)
        for fd in (source_fd, target_fd):
            if fd is not None:
                os.close(fd)


def load_helper():
    info = HELPER.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or hashlib.sha256(HELPER.read_bytes()).hexdigest() != HELPER_SHA256:
        raise RuntimeError('Moteur installe different de la version revue')
    loader = importlib.machinery.SourceFileLoader('trusted_media_deploy', str(HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def apply(deploy, backup):
    rows = json.loads(deploy.docker('inspect', 'sendprocolis-api', 'procolis-node-api'))
    active, legacy = rows
    current = next((m for m in active['Mounts'] if m['Destination'] == '/app/uploads'), {})
    previous = next((m for m in legacy['Mounts'] if m['Destination'] == '/app/uploads'), {})
    if not active['State']['Running'] or legacy['State']['Running']:
        raise RuntimeError('Etat des deux API inattendu')
    if current.get('Type') != 'volume' or current.get('Name') != VOLUME or Path(current.get('Source', '/')) != ACTIVE:
        raise RuntimeError('Volume actif inattendu')
    if previous.get('Type') != 'bind' or Path(previous.get('Source', '/')) != LEGACY:
        raise RuntimeError('Ancien stockage inattendu')
    for root in (ACTIVE, LEGACY):
        os.close(directory_fd(root))
    data = json.loads(deploy.docker('exec', '-w', '/app', 'sendprocolis-api', 'node', '--input-type=module', '-e', REFERENCES))
    if data['uploadDir'] not in ('uploads', '/app/uploads') or data['baseUrl'].rstrip('/') != PUBLIC:
        raise RuntimeError('Configuration du stockage ou de l URL publique inattendue')
    paths = sorted({path for url in data['urls'] if (path := relative_media(url)) is not None})
    report = {'references': len(paths), 'otherUrls': sum(relative_media(url) is None for url in data['urls']), 'files': {}, 'counts': {}, 'httpChecks': []}
    manifest = backup / 'media-report.json'
    for relative in paths:
        try:
            result = recover_one(LEGACY, ACTIVE, relative)
        except OSError as error:
            result = {'status': 'unsafe_or_unreadable', 'errorType': type(error).__name__}
        report['files'][relative] = result
        status = result['status']
        report['counts'][status] = report['counts'].get(status, 0) + 1
        manifest.write_text(json.dumps(report, indent=2))
    # Verifier un echantillon de chaque categorie via le meme HTTPS que les
    # clients. Le corps des images/videos n'est jamais affiche ni conserve.
    categories = set()
    for relative, result in report['files'].items():
        if result['status'] not in ('recovered', 'existing'):
            continue
        ext = Path(relative).suffix.lower()
        category = 'video' if ext in ('.mp4', '.mov', '.webm') else 'audio' if ext in ('.mp3', '.m4a', '.aac', '.wav') else 'image_or_document'
        if category in categories:
            continue
        categories.add(category)
        try:
            request = Request(PUBLIC + '/uploads/' + relative, method='HEAD')
            with urlopen(request, timeout=15) as response:
                report['httpChecks'].append({'category': category, 'status': response.status, 'type': response.headers.get('Content-Type')})
        except Exception as error:
            report['httpChecks'].append({'category': category, 'errorType': type(error).__name__})
    manifest.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'files'}, indent=2), flush=True)
    unresolved = sum(count for status, count in report['counts'].items() if status not in ('existing', 'recovered', 'concurrent_existing'))
    print('TERMINE : fichiers existants conserves, aucune modification de base ni redemarrage.', flush=True)
    if unresolved:
        print('ATTENTION : %s media(s) non recuperes ; consulter le rapport prive.' % unresolved, flush=True)


def main(args):
    if args or os.geteuid() != 0:
        print('Executer en administrateur, sans argument.', file=sys.stderr)
        return 2
    os.umask(0o077)
    try:
        deploy = load_helper()
        deploy.private_directory(deploy.STATE)
        with (deploy.STATE / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            backup = Path(tempfile.mkdtemp(prefix='media-recovery-', dir=deploy.STATE))
            print('Rapport prive : ' + str(backup), flush=True)
            with (backup / 'operations.log').open('ab', buffering=0) as log:
                deploy.LOG = log
                apply(deploy, backup)
        return 0
    except Exception as error:
        print('ARRET : ' + type(error).__name__ + '. Sources conservees ; aucun fichier existant remplace.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
