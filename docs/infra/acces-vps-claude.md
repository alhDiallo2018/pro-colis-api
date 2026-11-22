# Accès SSH de Claude au VPS de production

**Objet** : permettre à l'assistant Claude Code d'auditer, surveiller et
déployer SendProColis sur le VPS de production, **sans jamais lui donner
d'accès shell libre ni de droits sudo génériques**. Aligné sur le modèle de
sécurité de `deploy/operations/README.md`.

**Date de mise en place** : 2026-11-22.
**VPS concerné** : `51.38.234.102` port 22, compte Unix `procolis-ops`.

---

## 1. Modèle de sécurité en une image

```
┌─────────────────────────┐        SSH clé ed25519 dédiée             ┌──────────────────────────────────────┐
│ Machine locale          │  ────────────────────────────────────▶    │ VPS Debian                           │
│ utilisateur (Mac)       │                                           │                                      │
│                         │                                           │ sshd ──▶ compte procolis-ops         │
│ ~/.ssh/config :         │                                           │           │                          │
│   Host procolis-prod    │                                           │           │ authorized_keys force    │
│     User procolis-ops   │                                           │           ▼                          │
│     IdentityFile ...    │                                           │ /usr/local/sbin/procolis-ops-entry   │
│                         │                                           │   (whitelist stricte de 8 verbes)    │
│ Claude invoque :        │                                           │           │                          │
│   ssh procolis-prod     │                                           │           │ sudo -n (NOSETENV)       │
│   status|sysdiag|...    │                                           │           ▼                          │
│                         │                                           │ /usr/local/sbin/procolis-ops         │
│                         │                                           │ /usr/local/sbin/procolis-deploy      │
│                         │                                           │ /usr/local/sbin/procolis-deploy-report│
└─────────────────────────┘                                           └──────────────────────────────────────┘
```

Aucune commande n'est construite dynamiquement : chaque verbe est un chemin
absolu avec arguments figés.

---

## 2. Verbes autorisés à Claude

Le sas d'entrée `/usr/local/sbin/procolis-ops-entry` lit `SSH_ORIGINAL_COMMAND`
et n'exécute que les 8 verbes exacts suivants. Tout argument supplémentaire,
chaîne vide ou verbe inconnu produit un code 2 et aucune commande n'est lancée.

### Diagnostics (lecture seule)

| Verbe | Rôle | Durée | Payload |
|---|---|---|---|
| `status` | État des 4 conteneurs ProColis (image, health, labels Compose) | ~1 s | JSON |
| `routing` | Réseaux et résolution DNS de `api` depuis Caddy | ~1 s | JSON |
| `health` | GET `/health` sur `api:8080` depuis Caddy | ~1 s | JSON |
| `logs` | 120 dernières lignes / 15 min des deux API | ~1 s | JSON |
| `deployment-info` | Revisions Git + config filtrée + comparaison empreintes HMAC des configs | ~3 s | JSON |
| `sysdiag` | fail2ban actif + jails (sans IP), UFW, nftables, apt pending, uptime, df /, free | ~2 s | JSON |

### Déploiement (révisions whitelistées uniquement)

| Verbe | Rôle | Qui décide |
|---|---|---|
| `deploy` | Applique la dernière révision autorisée (Compose build, Prisma migrate deploy, Caddy swap) | Utilisateur confirme dans la conversation, Claude lance |
| `deploy-report` | Rapport de la dernière exécution de `deploy` (étape, code sortie, revisions, cause d'échec) | Claude seul (lecture) |

### Tunnels locaux (observabilité)

L'option `permitopen=` dans `authorized_keys` n'autorise que 3 destinations
pour `ssh -L` :

| Port local | Service distant | Accès |
|---|---|---|
| `localhost:3000` | Grafana | `ssh -N -L 3000:localhost:3000 procolis-prod` |
| `localhost:9090` | Prometheus | `ssh -N -L 9090:localhost:9090 procolis-prod` |
| `localhost:3100` | Loki | `ssh -N -L 3100:localhost:3100 procolis-prod` |

Les services ne sont **jamais exposés publiquement** — seul le tunnel SSH
authentifié y accède.

---

## 3. Ce que Claude ne peut PAS faire

- Ouvrir un shell interactif (`ssh procolis-prod bash` → refusé).
- Ajouter un argument libre (`ssh procolis-prod 'logs --tail=5'` → refusé).
- Exécuter `sudo` d'autre chose, `docker` directement, `git push`, édition
  de fichiers.
- Modifier `procolis-ops`, `procolis-deploy`, les sudoers, les images, le `.env`.
- Ajouter ou modifier une révision autorisée au déploiement (passe par
  `deploy/operations/update-procolis-deploy.sh`, revu et exécuté par l'admin).
- Faire des requêtes SQL ad-hoc. Le diagnostic `check-database-identity.py`
  est un one-shot admin, pas une capacité opérateur.

Toute tentative hors whitelist est **tracée** dans `/var/log/auth.log` via sudo
et `/var/log/btmp`/sshd. Côté sas : les verbes invalides renvoient un message
explicite vers `stderr` et retournent code 2.

---

## 4. Installation initiale (déjà faite — pour archive)

### Côté machine locale

1. Génération de la keypair dédiée :
   ```sh
   ssh-keygen -t ed25519 -a 100 \
     -f ~/.ssh/claude_sendprocolis_ops \
     -C "claude@sendprocolis-ops $(date -u +%Y-%m-%d)" -N ""
   chmod 600 ~/.ssh/claude_sendprocolis_ops*
   ```
2. Entrée `~/.ssh/config` :
   ```
   Host procolis-prod
       HostName 51.38.234.102
       User procolis-ops
       IdentityFile ~/.ssh/claude_sendprocolis_ops
       IdentitiesOnly yes
       ServerAliveInterval 30
       ServerAliveCountMax 4
       HashKnownHosts yes
       ForwardAgent no
       ForwardX11 no
   ```

### Côté VPS (session admin `debian`)

1. Transfert des deux installateurs dans `/root`, vérification SHA-256
   contre les valeurs calculées localement via `shasum -a 256`.
2. Désinstallation de l'ancien `procolis-ops` :
   ```sh
   sudo rm /usr/local/sbin/procolis-ops /etc/sudoers.d/procolis-ops
   sudo visudo -c
   ```
3. Installation de la version étendue (ajoute `sysdiag`) :
   ```sh
   sudo bash /root/install-procolis-ops.sh
   sudo bash /root/install-procolis-ops-entry.sh
   ```
4. Enregistrement de la clé publique Claude :
   ```sh
   sudo -u procolis-ops install -d -m 0700 ~procolis-ops/.ssh
   # Ligne exacte à ajouter (voir deploy/operations/README.md pour la syntaxe)
   # restrict,permitopen="localhost:3000",permitopen="localhost:9090",
   #   permitopen="localhost:3100",from="<IP_UTILISATEUR>",
   #   command="/usr/local/sbin/procolis-ops-entry" ssh-ed25519 <PUBKEY> <COMMENT>
   sudo chown procolis-ops:procolis-ops ~procolis-ops/.ssh/authorized_keys
   sudo chmod 600 ~procolis-ops/.ssh/authorized_keys
   ```

### Fichiers produits (versionnés dans ce dépôt)

- `deploy/operations/procolis-ops` : étendu avec `sysdiag`.
- `deploy/operations/procolis-ops.sudoers` : ajout `sysdiag` à `PROCOLIS_DIAGNOSTICS`.
- `deploy/operations/procolis-ops-entry` : **nouveau** sas d'entrée.
- `deploy/operations/install-procolis-ops.sh` : régénéré.
- `deploy/operations/install-procolis-ops-entry.sh` : **nouveau** installateur.
- `deploy/operations/test_operations.py` : tests du verbe `sysdiag`.
- `deploy/operations/test_procolis_ops_entry.py` : **nouveaux** tests du sas.

Validation locale avant transfert :
```sh
python3 -m unittest discover -s deploy/operations -p 'test_*.py'
bash -n deploy/operations/install-procolis-ops.sh
bash -n deploy/operations/install-procolis-ops-entry.sh
```

---

## 5. Workflow quotidien

### Audit en lecture (sans confirmation)

Claude peut lancer sans demander :
```sh
ssh procolis-prod status
ssh procolis-prod routing
ssh procolis-prod health
ssh procolis-prod logs
ssh procolis-prod deployment-info
ssh procolis-prod sysdiag
ssh procolis-prod deploy-report
```

### Déploiement (confirmation utilisateur obligatoire)

1. Claude lit l'état courant :
   ```sh
   ssh procolis-prod deployment-info
   ssh procolis-prod deploy-report
   ```
2. Claude commit ses changements et pousse sur `master`/`main`.
3. L'admin met à jour `deploy/operations/update-procolis-deploy.sh` avec le
   nouveau SHA de la révision autorisée, régénère l'installateur via
   `python3 deploy/operations/build-deployment-installers.py`, transfère,
   vérifie le SHA-256 et exécute en session admin.
4. Après ce feu vert, Claude demande explicitement : *"Je peux lancer
   `ssh procolis-prod deploy` ?"* et attend la validation utilisateur.
5. Après succès, Claude vérifie via `deploy-report` + `health`.

### Investigation observabilité

L'humain ouvre les dashboards Grafana :
```sh
ssh -N -L 3000:localhost:3000 procolis-prod &
open http://localhost:3000
kill %1
```

Claude peut lancer le tunnel et le fermer, mais le contenu visuel reste lu par
l'humain.

---

## 6. Révocation / rotation

### Retirer l'accès Claude

```sh
# Depuis la session admin sur le VPS
sudo sed -i.bak '/claude@sendprocolis-ops/d' ~procolis-ops/.ssh/authorized_keys
```

Ne pas toucher aux sudoers ni au sas : d'autres opérateurs légitimes peuvent
en dépendre.

### Rotation de clé

1. Générer une nouvelle keypair ed25519 locale (même commande qu'en §4.1).
2. Ajouter la nouvelle pubkey en haut d'`authorized_keys`, tester l'accès.
3. Retirer l'ancienne ligne, puis `shred -u` la clé privée locale correspondante.

### Changement d'IP (`from=`)

1. `curl -4 -s https://ifconfig.me` sur la machine locale.
2. Remplacer `from="<ancienne>"` par `from="<nouvelle>"` dans `authorized_keys`.
3. Tester l'accès. Si échec : retirer `from=` entièrement (fail2ban et clé
   unique restent protecteurs ; ⚠️ fail2ban n'était pas installé au
   2026-11-22, à vérifier).

---

## 7. Vérifications périodiques

### Mensuelles

- `sudo grep procolis-ops /var/log/auth.log | tail -50` → toutes les commandes
  Claude doivent être dans la whitelist.
- `sudo sha256sum /usr/local/sbin/procolis-ops{,-entry} /usr/local/sbin/procolis-deploy{,-report}`
  → comparer avec les SHA de référence (stockés dans
  `build-deployment-installers.py`).
- `sudo getfacl /home/debian` → **toujours 0700, pas d'accès ops**.
- `sudo visudo -c` → syntaxe sudoers OK.

### Après chaque mise à jour d'un helper

```sh
python3 -m unittest discover -s deploy/operations -p 'test_*.py'
# (actuellement 70 tests)
```

### En cas d'alerte fail2ban (une fois installé)

- Vérifier si une des IPs bloquées correspondait à la clé Claude
  (`grep 'claude@sendprocolis-ops' /var/log/auth.log`).
- Si oui : rotation de clé (§6.2) et investigation du poste local compromis.

---

## 8. Base de données : natif, pas conteneurisé

Contrairement à ce que `docker ps` laisse croire sur le VPS (un container
`sendprocolis-postgres:16-alpine` apparaît comme *running*), **PostgreSQL 16 est
installé nativement sur l'hôte Debian** et c'est cette instance qui sert les
containers API. Deux preuves concrètes :

1. **Règles UFW** visibles dans `sysdiag` :
   ```
   172.21.0.1 5432/tcp  ALLOW IN  172.21.0.0/16
   172.17.0.1 5432/tcp  ALLOW IN  172.19.0.0/16
   172.17.0.1 5432/tcp  ALLOW IN  172.21.0.0/16
   ```
   Ces adresses (`172.17.0.1`, `172.21.0.1`) sont les **gateways Docker** des
   bridges vers l'hôte. Elles ne seraient jamais nécessaires si les containers
   API dialoguaient avec un autre container (le trafic inter-container passe
   directement, sans UFW).
2. **Titre et plan du runbook** : `docs/infra/guide-deploiement-postgresql-natif.html`
   détaille l'installation APT, le socket Unix, `pg_hba.conf`, et les dumps
   `pg_dump` natifs — aucune de ces procédures ne porterait sens avec une base
   conteneurisée.

Le container `sendprocolis-postgres` encore présent en `docker ps` est un
**reliquat legacy** antérieur à la migration vers PostgreSQL natif
(documentée dans `deploy/operations/VPS-AUDIT-2026-10-25.md`). Il peut être
supprimé de la même manière que `procolis-node-api`, après confirmation via :

```sh
# Depuis la session admin, pas depuis le compte procolis-ops
# Copier le script dans /root, vérifier le SHA-256 depuis la copie revue locale,
# puis exécuter en root :
sudo python3 /root/check-database-identity.py
```

Ce diagnostic lit les métadonnées serveur depuis les deux containers API,
place un marqueur `application_name` aléatoire par session, puis vérifie la
visibilité réciproque dans `pg_stat_activity`. Si les deux API voient le même
cluster, c'est la même instance ; les identifiants ne quittent jamais les
containers.

Côté Claude : la DB n'est pas accessible directement (pas de verbe `sql` ni
de connexion déléguée). Toute requête ad-hoc reste une opération administrateur
ponctuelle, documentée au cas par cas.

## 9. Développement local : la DB n'est pas Docker non plus

Pour information, côté **machine de développement** :

| Composant | Lieu | Détail |
|---|---|---|
| PostgreSQL | **Hôte natif**, via Homebrew (`postgresql@15`) | `/usr/local/opt/postgresql@15` sur macOS |
| API `procolis-node-api` | **Container Docker** (`docker-compose.yml` racine) | pointe vers `host.docker.internal:5432` depuis le container |
| Alternative `npm run dev` | **Hôte**, pas de Docker | utilise Unix socket, lecture directe de `.env` |

Aucun service `postgres` n'est défini dans `docker-compose.yml` — le fallback
`host.docker.internal:5433` dans le compose est hérité d'une ancienne config
EDB-installer v18 (voir `deploy/setup-local-db.sh`, **obsolète** sur cette
machine qui utilise v15 port 5432).

Conséquence : la **topologie est symétrique** entre local et VPS — PostgreSQL
natif sur l'hôte + API conteneurisée — seule la version diffère (15 Homebrew
local, 16 APT en prod).

## 10. Références

- `deploy/operations/README.md` — security model complet des helpers.
- `deploy/operations/VPS-AUDIT-2026-10-25.md` — pin de l'API de référence.
- `docs/infra/guide-deploiement-postgresql-natif.html` — runbook de
  déploiement (section "Opérateurs & accès Claude" ajoutée en 2026-11-22).
- `CLAUDE.md` racine du dépôt — pointe ici.
