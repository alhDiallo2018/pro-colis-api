# Stack d'observabilite PRO COLIS

Cette stack est separee du Compose applicatif afin de pouvoir redemarrer ou
mettre a jour l'API sans perdre l'acces aux journaux deja collectes.

## 1. Preparation

Demarrer d'abord le Compose de l'API : il cree le reseau Docker partage
`procolis-observability-shared`. Utiliser la meme valeur de
`PROCOLIS_DOCKER_NETWORK` dans les deux stacks si ce nom est surcharge.

Depuis ce dossier :

```bash
cp .env.example .env
cp alertmanager/alertmanager.yml.example alertmanager/alertmanager.yml
mkdir -p secrets
openssl rand -hex 32 > secrets/metrics_token
openssl rand -hex 32 > secrets/grafana_admin_password
openssl rand -hex 32 > secrets/postgres_monitor_password
chmod 600 secrets/metrics_token secrets/grafana_admin_password secrets/postgres_monitor_password
```

Ajouter la cle SMTP Brevo dans `secrets/brevo_smtp_key`, adapter les adresses
email dans `alertmanager/alertmanager.yml`, puis renseigner `.env`.

La valeur de `secrets/metrics_token` doit egalement etre definie comme
`METRICS_TOKEN` dans le service API. Ajouter a ce service :

```yaml
environment:
  APP_RELEASE: ${APP_RELEASE}
  LOKI_BASE_URL: http://loki:3100
  PROMETHEUS_BASE_URL: http://prometheus:9090
  OBSERVABILITY_TIMEOUT_MS: 5000
  METRICS_TOKEN: ${METRICS_TOKEN}
```

## 2. Role PostgreSQL de monitoring

Creer un utilisateur distinct de l'utilisateur applicatif :

```sql
CREATE ROLE procolis_monitor LOGIN PASSWORD 'mot-de-passe-aleatoire';
GRANT pg_monitor TO procolis_monitor;
```

Reporter le meme mot de passe dans `secrets/postgres_monitor_password`, puis
configurer `POSTGRES_EXPORTER_URI` sans identifiants et
`POSTGRES_EXPORTER_USER`. Ce role ne doit recevoir aucun droit d'ecriture sur
les tables metier.

## 3. Raccordement Caddy et React

Le projet frontend, gere par un autre agent, doit :

1. rattacher son service Caddy au reseau Docker externe defini par
   `PROCOLIS_DOCKER_NETWORK` ;
2. proxifier uniquement les requetes `POST /collect/faro` vers le receiver
   `alloy:12347`, sans proxy generique vers l'interface Alloy ;
3. autoriser un corps maximal de 256 Kio sur ce chemin ;
4. activer les metriques Caddy sur `0.0.0.0:2019` sans publier ce port ;
5. configurer Grafana Faro avec `app.name=procolis-web`,
   `app.environment=production`, la release courante et un `beforeSend` qui
   retire tokens, cookies, formulaires, adresses et numeros de telephone ;
6. capturer les exceptions et promesses rejetees, mais pas les corps Axios ni
   l'ensemble de la console ;
7. produire des source maps non publiques pour symboliser les stacks.

Pour chaque release, copier les source maps en conservant l'arborescence des
assets sous `deploy/observability/sourcemaps/<APP_RELEASE>/`. Le prefixe retire
des URL minifiees est configure par `FARO_SOURCEMAP_PREFIX`. Caddy ne doit
jamais servir ce dossier.

Le contrat des endpoints React se trouve dans
`specs/logs/observability.md`.

## 4. Validation et demarrage

```bash
docker compose --env-file .env -f compose.yml config -q
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

Verifier ensuite :

```bash
docker compose --env-file .env -f compose.yml logs --tail=100 alloy loki prometheus
curl -fsS http://127.0.0.1:13000/api/health
```

Grafana est disponible uniquement depuis le VPS. Depuis un poste operateur :

```bash
ssh -L 13000:127.0.0.1:13000 utilisateur@serveur
```

Puis ouvrir `http://localhost:13000`.

## 5. Sauvegarde et retention

- Loki et Prometheus conservent 14 jours de donnees.
- Inclure les volumes `procolis-observability_loki-data` et
  `procolis-observability_prometheus-data` dans la sauvegarde chiffree du VPS.
- Ne jamais sauvegarder les fichiers sous `secrets/` sans chiffrement.
- Tester une restauration sur un environnement isole avant de compter sur la
  sauvegarde en production.

Un script Restic est fourni pour produire une sauvegarde coherente avec une
courte pause de Loki, Prometheus et Alloy :

```bash
cp backup.env.example /etc/procolis/observability-backup.env
chmod 600 /etc/procolis/observability-backup.env
set -a
. /etc/procolis/observability-backup.env
set +a
./backup-observability.sh
```

Planifier ce script quotidiennement avec un timer systemd root. Tester d'abord
`restic snapshots` et une restauration complete ; ne pas automatiser le timer
avant cette verification.

## Limitation

Une panne totale du VPS arrete egalement Alertmanager. Un moniteur HTTP externe
sur `/api/v1/health` est necessaire pour couvrir ce cas.
