# CLAUDE.md — Instructions permanentes pour l'assistant

Ce fichier est chargé automatiquement au début de chaque session. Il est la
source de vérité pour qui est ce projet, comment on y travaille, et ce qui est
hors périmètre.

## Identité du projet

**pro-colis-api** est le backend REST de **SendProColis**, un produit de
livraison/logistique colis. L'API Node/Express/Prisma sert Web (React/Vite),
PWA et Mobile (Flutter). Les 4 dépôts de l'écosystème :

- **API** (ici) : `/Users/testad/Web/Procolis-Api/pro-colis-api`
- **Web** : `/Users/testad/Web/Procolis-Web/site/pro-colis-web`
- **PWA** : même dépôt que Web, service worker à `pwa/sw.js`
- **Mobile** (Flutter) : `/Users/testad/Mobile/Procolis-App/pro-colis-mobile`

**Règle fondamentale** : le Mobile Flutter est la référence fonctionnelle
absolue. Toute feature mobile doit être livrée côté Web et PWA aussi. Les
seules exceptions tolérées sont ↩️ (dégradation UX documentée) ou 🚫 (capacité
native impossible : GPS background, Contacts OS, OCR on-device). Pas de
"mobile-only V1" ni de "desktop-first" comme solution acceptable.

Rôles utilisateurs : `client`, `driver`, `admin`, `super_admin`, `support`,
`support_technique`, `support_commercial`, `shuttle_operator`. Cas particulier :
le code Mobile utilise `super-admin/` et `garage_admin/`, le Web utilise
`superAdmin/` et `garageAdmin/`.

## Stack technique

| Couche | Technologie |
|---|---|
| Runtime | Node ≥ 20, ES modules (`"type": "module"`) |
| HTTP | Express 4, Helmet, express-rate-limit, Pino |
| ORM | Prisma 5 + PostgreSQL 16 |
| Auth | JWT access (`JWT_ACCESS_EXPIRES_IN`, défaut 15 m) + refresh (clients 30 j / staff 12 h) |
| Tests | Jest 29 (`--runInBand`) + supertest |
| Validation | Zod |
| Observabilité | Pino + prom-client, Loki/Prometheus/Grafana/Alloy |
| Déploiement | Docker Compose + Caddy (HTTPS auto) sur VPS Debian |

## Commandes usuelles

```sh
npm run dev            # nodemon src/server.js (port 18081 par défaut)
npm test               # Jest en série, prisma generate au préalable
npm run prisma:migrate # dev (crée migration + applique)
npm run prisma:deploy  # production (applique sans créer)
npm run seed:reference # seeds de référence (zones, rôles, etc.)
```

## Base de données : local vs VPS

| Environnement | PostgreSQL | API | Connexion |
|---|---|---|---|
| **Local (Mac)** | **Natif Homebrew** (`postgresql@15`, host `/usr/local/opt/postgresql@15`) | Container Docker `procolis-node-api` | `host.docker.internal:5432` depuis le container, Unix socket depuis `npm run dev` |
| **VPS (Debian)** | **Natif APT** (PostgreSQL 16, sur l'hôte) | Containers `sendprocolis-api` + `sendprocolis-caddy` | `172.17.0.1:5432` / `172.21.0.1:5432` (bridge Docker → hôte), UFW whitelist les sous-réseaux `172.19.0.0/16` et `172.21.0.0/16` |

**Dans les deux cas, PostgreSQL n'est jamais en container** — c'est un service natif de l'hôte. Les containers API s'y connectent via le réseau bridge Docker (nommage macOS : `host.docker.internal` ; Linux : IP du gateway bridge).

**Container `sendprocolis-postgres` sur VPS** : running mais **non utilisé** (reliquat legacy avant la migration natif). Peut être arrêté/supprimé après confirmation via `deploy/operations/check-database-identity.py`.

**`deploy/setup-local-db.sh` est obsolète** : il référence EDB-installer v18 port 5433, mais la config actuelle est Homebrew v15 port 5432. Si tu veux resynchroniser la DB locale sur un dump VPS, adapter d'abord `PG_BIN`, `PG_PORT` et `PG_HOST` du script.

## Documentation (sources de vérité par priorité)

1. **`specs/`** : contrats fonctionnels — **à relire avant de coder une nouvelle feature**.
   - `specs/api/00-overview.md` → `09-admin-reporting-audit.md`
   - `specs/api/paydunya-disbursement.md`
   - `specs/mobile-app/00-conventions.md` → `06-super-admin.md` (par rôle)
   - `specs/logs/observability.md`
2. **`docs/`** : décisions, intégrations tierces, sessions.
   - Intégrations : `google-auth.md`, `google-maps.md`, `brevo-configuration.md`,
     `whatsapp-templates.md`, `support-chat.md`
   - Pilotage : `docs/continuous-development/{PROJECT_MASTER_PLAN,ARCHITECTURE_DECISIONS,TASK_TRACKER,CURRENT_STATE,SESSION_LOG,NEXT_SESSION}.md`
3. **`deploy/`** : infrastructure et opérations.
   - `deploy/operations/README.md` : security model VPS (commandes sudoers)
   - `deploy/operations/VPS-AUDIT-2026-10-25.md` : audit du pin API
   - `deploy/observability/README.md` : stack Loki/Prometheus/Grafana
4. **`docs/infra/guide-deploiement-postgresql-natif.html`** : runbook de déploiement complet (lisible dans un navigateur).
5. **`docs/infra/acces-vps-claude.md`** : procédure d'accès SSH de Claude au VPS et workflow de déploiement.

Côté Mobile (parité, non éditable depuis ici) :
- `../../../Mobile/Procolis-App/pro-colis-mobile/Docs/parity-mobile-web-pwa.md`
- `../../../Mobile/Procolis-App/pro-colis-mobile/Docs/api-pending.md`

## Accès au VPS de production

Claude a un accès SSH restreint au VPS (`procolis-prod` → `51.38.234.102`) via
le compte Unix `procolis-ops`, passant par un **sas d'entrée** qui n'autorise
que 8 verbes exacts. La procédure complète est dans
[`docs/infra/acces-vps-claude.md`](docs/infra/acces-vps-claude.md).

**Capacités Claude** (depuis `~/.ssh/config` → `Host procolis-prod`) :
- Lecture : `status`, `routing`, `health`, `logs`, `deployment-info`, `sysdiag`
- Déploiement : `deploy` (révisions whitelistées uniquement), `deploy-report`
- Tunnels : Grafana (3000), Prometheus (9090), Loki (3100) via `ssh -L`

**Hors périmètre Claude** (admin uniquement) :
- Modification du code source du VPS, des sudoers, des images Docker, des `.env`
- Ajout d'une nouvelle révision autorisée au déploiement (passe par
  `deploy/operations/update-procolis-deploy.sh` revu par l'admin)
- Accès SQL ad-hoc hors des 5 diagnostics
- Toute commande hors de la whitelist du sas

**Workflow de déploiement** (depuis cette machine locale) :
1. Claude commit les changements, pousse sur `master`/`main`
2. L'admin met à jour les SHA whitelistés via `update-procolis-deploy.sh`
3. `ssh procolis-prod deployment-info` pour voir l'état actuel
4. `ssh procolis-prod deploy-report` pour voir le dernier déploiement
5. Confirmation utilisateur **toujours** requise avant `ssh procolis-prod deploy`

## Conventions de code et de PR

- **Sans commentaires par défaut** : n'écrire un commentaire que si le "pourquoi"
  est non-évident (contrainte cachée, workaround daté, invariant subtil).
- **Pas de refacto opportuniste** : un fix reste un fix, une feature reste une feature.
- **Pas d'abstraction prématurée** : 3 lignes dupliquées valent mieux qu'un helper
  spéculatif.
- **Pas de backwards-compat shim** : si quelque chose est inutilisé, le supprimer.
- **Zéro `.env`, `.env.production`, dump, image binaire, secret dans Git.**
- **Prisma** : les migrations déclenchées par `prisma:migrate` doivent être
  revues manuellement avant commit. `prisma:deploy` ne crée **jamais** de migration.
- **Tests** : `npm test` est sériel (`--runInBand`) — prévoir des scoped resets
  pour ne pas polluer la base `procolis_test`.

## Gotchas / erreurs à ne pas reproduire

- **Rôles mobile ≠ web** (voir plus haut). Ne pas renommer pour "uniformiser"
  sans discussion : chaque codebase a sa convention assumée.
- **Mobile = référence** : ne jamais justifier un refus de livrer sur Web/PWA
  par "mobile-only V1" ou "desktop-first". Référence : correction utilisateur
  du 2026-11-19.
- **`procolis-node-api` dans `docker ps -a`** : c'est l'ancien container de
  l'ancienne topologie, rendu orphelin par le pin de référence du 25 octobre
  2026. Peut être `docker rm` (ses volumes sont des bind mounts, zéro perte).
- **Sur le VPS, `trackedChanges: true`** côté Git est attendu : patch Caddyfile
  local documenté dans `VPS-AUDIT-2026-10-25.md`. Ce n'est PAS un drift.

## Quand douter : demander

Si la demande touche à :
- Suppression de données en production
- Changement de schéma Prisma sans migration
- Modification d'une spec `specs/api/*.md`
- Déploiement sans révision whitelistée
- Toute action côté admin VPS (pas opérateur)

→ s'arrêter et confirmer avec l'utilisateur avant d'agir.
