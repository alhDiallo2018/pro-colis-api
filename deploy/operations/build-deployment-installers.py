#!/usr/bin/env python3
"""Regenerer les installateurs autonomes apres modification des helpers audites."""
from pathlib import Path

BASE = Path(__file__).resolve().parent
OLD = {
    'procolis-deploy': '5299980c4c84a821a508c9be8810442c1d9395e107c98e287d8eb973e1fbb105',
    'procolis-deploy.sudoers': 'a96396c3528c32a33c36de14395b1d56bd64c09978b49e695dd79c3b6e487174',
}
FILES = {'procolis-deploy': '/usr/local/sbin/procolis-deploy',
         'procolis-deploy-report': '/usr/local/sbin/procolis-deploy-report',
         'procolis-deploy.sudoers': '/etc/sudoers.d/procolis-deploy'}


def render(update):
    # Le compte operateur transporte l'installateur ; seule une copie verifiee
    # sous /root doit etre executee par l'administrateur. Aucun telechargement.
    script = '''#!/bin/bash
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
'''
    check = '''import hashlib, os, stat
from pathlib import Path
'''
    for name, target in FILES.items():
        if update and name in OLD:
            check += f'''path = Path({target!r})
st = path.lstat()
if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
    raise SystemExit('Fichier privilegie non protege : ' + str(path))
if hashlib.sha256(path.read_bytes()).hexdigest() != {OLD[name]!r}:
    raise SystemExit('Version installee inattendue : ' + str(path))
'''
        else:
            check += f'''if os.path.lexists({target!r}):
    raise SystemExit('Installation refusee : fichier deja present ' + {target!r})
'''
    script += "/usr/bin/python3 -I - <<'CHECK_EXISTING'\n" + check + 'CHECK_EXISTING\n'
    script += '''work=$(mktemp -d /root/procolis-deploy-update.XXXXXXXX)
changed=0
committed=0
cleanup() {
  if [ "$changed" -eq 1 ] && [ "$committed" -eq 0 ]; then
'''
    for name, target in FILES.items():
        mode = '0440' if name.endswith('.sudoers') else '0555'
        if update and name in OLD:
            script += f'    install -o root -g root -m {mode} "$work/old-{name}" "{target}"\n'
        else:
            script += f'    rm -f -- "{target}"\n'
    script += '''    echo 'Installation interrompue : permissions precedentes restaurees.' >&2
  fi
  echo "Copie administrateur conservee : $work"
}
trap cleanup EXIT
'''
    if update:
        for name in OLD:
            script += f'cp -- "{FILES[name]}" "$work/old-{name}"\n'
    for index, name in enumerate(FILES):
        marker = f'PROCOLIS_FILE_{index}'
        script += f'cat > "$work/{name}" <<\'{marker}\'\n' + (BASE / name).read_text() + marker + '\n'
    script += '''/usr/bin/python3 -I - "$work" <<'CHECK_PYTHON'
from pathlib import Path
import sys
for name in ['procolis-deploy', 'procolis-deploy-report']:
    path = Path(sys.argv[1]) / name
    compile(path.read_text(), str(path), 'exec')
CHECK_PYTHON
/usr/sbin/visudo -cf "$work/procolis-deploy.sudoers"
changed=1
'''
    for name, target in FILES.items():
        mode = '0440' if name.endswith('.sudoers') else '0555'
        # Les fichiers temporaires sont dans des repertoires exclusivement root.
        # Le renommage conserve une commande complete pour les appels concurrents.
        script += f'install -o root -g root -m {mode} "$work/{name}" "{target}.new"\nmv -f -- "{target}.new" "{target}"\n'
    script += '''/usr/sbin/visudo -c
committed=1
echo 'INSTALLE : livraison revue API/web et rapport de diagnostic.'
echo 'Aucun deploiement lance. Aucun droit sudo general ni acces Docker direct ajoute.'
echo 'Commandes : sudo -n /usr/local/sbin/procolis-deploy-report'
echo '            sudo -n /usr/local/sbin/procolis-deploy'
'''
    return script


if __name__ == '__main__':
    for update, filename in [(False, 'install-procolis-deploy.sh'), (True, 'update-procolis-deploy.sh')]:
        (BASE / filename).write_text(render(update))
