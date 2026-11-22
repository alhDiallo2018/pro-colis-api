#!/bin/bash
set -euo pipefail
# Installation initiale uniquement. Le sas d'entree SSH appartient a root et n'a
# aucun droit sudo propre : il ne fait qu'appeler les commandes sudo deja autorisees
# (procolis-ops et procolis-deploy). Aucun nouveau droit n'est accorde ici.
if [ "$(id -u)" != 0 ]; then
  echo "Executer cet installateur via sudo depuis la session debian." >&2
  exit 1
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
helper=/usr/local/sbin/procolis-ops-entry
if [ -e "$helper" ] || [ -L "$helper" ]; then
  echo "Installation existante detectee : aucun fichier remplace." >&2
  exit 1
fi
command -v python3 >/dev/null
# Les commandes cibles doivent deja etre en place : sinon le sas serait inutilisable.
[ -x /usr/local/sbin/procolis-ops ] || {
  echo "procolis-ops absent : installer procolis-ops avant le sas." >&2
  exit 1
}
[ -x /usr/bin/sudo ] || { echo "sudo introuvable." >&2; exit 1; }
id procolis-ops >/dev/null
helper_tmp=$(mktemp /usr/local/sbin/.procolis-ops-entry.XXXXXX)
trap 'rm -f "$helper_tmp"' EXIT
cat > "$helper_tmp" <<'PROCOLIS_ENTRY_EOF'
#!/usr/bin/python3 -I
"""Sas d'entree SSH pour le compte procolis-ops. Lit SSH_ORIGINAL_COMMAND, valide
un verbe exact sans argument, puis appelle la commande sudo correspondante. Les
droits sont ceux des regles sudoers existantes ; ce sas ne confere aucun privilege
supplementaire. Il refuse toute commande interactive ou argument additionnel."""
import os
import subprocess
import sys

SUDO = '/usr/bin/sudo'
PROCOLIS_OPS = '/usr/local/sbin/procolis-ops'
PROCOLIS_DEPLOY = '/usr/local/sbin/procolis-deploy'
PROCOLIS_DEPLOY_REPORT = '/usr/local/sbin/procolis-deploy-report'

# Mapping verbe -> commande sudo complete, figee. Aucune substitution ni concatenation.
COMMANDS = {
    'status':          [SUDO, '-n', PROCOLIS_OPS, 'status'],
    'routing':         [SUDO, '-n', PROCOLIS_OPS, 'routing'],
    'health':          [SUDO, '-n', PROCOLIS_OPS, 'health'],
    'logs':            [SUDO, '-n', PROCOLIS_OPS, 'logs'],
    'deployment-info': [SUDO, '-n', PROCOLIS_OPS, 'deployment-info'],
    'sysdiag':         [SUDO, '-n', PROCOLIS_OPS, 'sysdiag'],
    'deploy':          [SUDO, '-n', PROCOLIS_DEPLOY],
    'deploy-report':   [SUDO, '-n', PROCOLIS_DEPLOY_REPORT],
}

# Environnement minimal : aucun PATH, LANG, LC_*, ni variable SSH_* n'influence
# la commande privilegiee. SUDO ajoutera lui-meme ce dont il a besoin.
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C.UTF-8'}


def main():
    raw = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    verb = raw.strip()
    # Comparaison stricte : aucun espace, aucun argument, aucun joker. Un verbe
    # compose comme "logs --tail=100" n'est pas accepte comme "logs".
    if verb not in COMMANDS:
        sys.stderr.write(
            'Commande refusee. Verbes autorises : ' + ', '.join(sorted(COMMANDS)) + '\n'
        )
        return 2
    try:
        completed = subprocess.run(COMMANDS[verb], cwd='/', env=ENV,
                                   stdin=subprocess.DEVNULL, timeout=1800)
    except FileNotFoundError:
        sys.stderr.write('Binaire sudo introuvable.\n')
        return 127
    except subprocess.TimeoutExpired:
        sys.stderr.write('Execution trop longue : ' + verb + '\n')
        return 124
    except OSError:
        sys.stderr.write('Execution impossible : ' + verb + '\n')
        return 1
    return completed.returncode


if __name__ == '__main__':
    sys.exit(main())
PROCOLIS_ENTRY_EOF
chown root:root "$helper_tmp"
chmod 0555 "$helper_tmp"
# Validation Python avant mise en place : refuser un fichier invalide eviterait
# que la premiere connexion SSH tombe sur un sas casse (equivalent a un refus
# generique). Le fichier reste dans /usr/local/sbin/, hors d'ecriture par ops.
python3 -I -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$helper_tmp"
mv "$helper_tmp" "$helper"
echo "Sas d'entree SSH installe : /usr/local/sbin/procolis-ops-entry."
echo "Prochaine etape : enregistrer la cle publique Claude dans"
echo "  ~procolis-ops/.ssh/authorized_keys avec options :"
echo "  restrict,permitopen=\"localhost:3000\",permitopen=\"localhost:9090\",permitopen=\"localhost:3100\",from=\"<IP_OU_CIDR>\",command=\"/usr/local/sbin/procolis-ops-entry\" ssh-ed25519 AAAA... claude@sendprocolis-ops"
