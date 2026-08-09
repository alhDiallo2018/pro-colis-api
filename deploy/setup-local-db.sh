#!/usr/bin/env bash
#
# Bascule du developpement local depuis la base PostgreSQL conteneurisee vers
# l'installation native de la machine.
#
# La base locale (EDB installer, /Library/PostgreSQL/18) n'ecoute que sur sa
# socket Unix, port 5433 : aucun port TCP n'est ouvert. C'est pourquoi l'API
# tourne desormais directement sur l'hote (`npm run dev`) et non dans Docker,
# et pourquoi DATABASE_URL passe par `?host=/tmp`.
#
# Le script est idempotent : il peut etre relance sans casser l'existant.
# Il demande une fois le mot de passe du superutilisateur `postgres`, cree le
# role et les bases applicatifs, restaure le dump, puis ecrit DATABASE_URL dans
# .env sans jamais afficher le secret genere.
#
# Usage :
#   ./deploy/setup-local-db.sh [chemin/vers/dump.dump]
# Sans argument, le dump le plus recent de backups/ est utilise.

set -euo pipefail

PG_BIN="${PG_BIN:-/Library/PostgreSQL/18/bin}"
PG_HOST="${PG_HOST:-/tmp}"
PG_PORT="${PG_PORT:-5433}"
APP_ROLE="${APP_ROLE:-procolis}"
APP_DB="${APP_DB:-procolis}"
TEST_DB="${TEST_DB:-procolis_test}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

export PATH="$PG_BIN:$PATH"
command -v psql >/dev/null || { echo "psql introuvable dans $PG_BIN" >&2; exit 1; }

dump="${1:-$(ls -t backups/*.dump 2>/dev/null | head -1 || true)}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "Aucun dump trouve. Passez le chemin en argument." >&2; exit 1; }
echo "Dump source : $dump"

# Un seul prompt : le mot de passe superutilisateur sert a toutes les etapes.
if [ -z "${PGPASSWORD:-}" ]; then
  read -rsp "Mot de passe du superutilisateur PostgreSQL (postgres) : " PGPASSWORD
  echo
  export PGPASSWORD
fi

su_psql() { psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

su_psql -d postgres -tAc "SELECT 1" >/dev/null || { echo "Connexion impossible." >&2; exit 1; }
echo "Connexion a PostgreSQL $(su_psql -d postgres -tAc 'SHOW server_version') sur $PG_HOST:$PG_PORT"

# Mot de passe applicatif : hexadecimal, donc utilisable tel quel dans une URL.
app_password="$(openssl rand -hex 32)"

if [ "$(su_psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE'")" = "1" ]; then
  echo "Role $APP_ROLE : deja present, mot de passe renouvele"
  su_psql -d postgres -c "ALTER ROLE $APP_ROLE WITH LOGIN PASSWORD '$app_password'" >/dev/null
else
  echo "Role $APP_ROLE : creation"
  su_psql -d postgres -c "CREATE ROLE $APP_ROLE WITH LOGIN PASSWORD '$app_password'" >/dev/null
fi

for db in "$APP_DB" "$TEST_DB"; do
  if [ "$(su_psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'")" = "1" ]; then
    echo "Base $db : deja presente"
  else
    echo "Base $db : creation"
    su_psql -d postgres -c "CREATE DATABASE $db OWNER $APP_ROLE TEMPLATE template0 ENCODING 'UTF8'" >/dev/null
  fi
done

# La restauration n'a de sens que sur une base vide : sinon on ecraserait un
# etat de travail plus recent que le dump.
tables="$(su_psql -d "$APP_DB" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [ "$tables" = "0" ]; then
  echo "Restauration du dump dans $APP_DB..."
  pg_restore -h "$PG_HOST" -p "$PG_PORT" -U postgres \
    --dbname="$APP_DB" --no-owner --role="$APP_ROLE" \
    --single-transaction --exit-on-error < "$dump"
  echo "Restauration terminee"
else
  echo "Base $APP_DB : $tables tables deja presentes, restauration ignoree"
fi

su_psql -d "$APP_DB" -c "GRANT ALL ON SCHEMA public TO $APP_ROLE" >/dev/null
su_psql -d "$TEST_DB" -c "GRANT ALL ON SCHEMA public TO $APP_ROLE" >/dev/null

# DATABASE_URL passe par la socket : `localhost` n'est qu'un placeholder exige
# par le format d'URL, c'est `host=` qui designe reellement le serveur.
database_url="postgresql://$APP_ROLE:$app_password@localhost:$PG_PORT/$APP_DB?host=$PG_HOST&schema=public"

if [ -f .env ]; then
  cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
  if grep -q '^DATABASE_URL=' .env; then
    tmp="$(mktemp)"
    grep -v '^DATABASE_URL=' .env > "$tmp"
    printf 'DATABASE_URL=%s\n' "$database_url" >> "$tmp"
    mv "$tmp" .env
  else
    printf 'DATABASE_URL=%s\n' "$database_url" >> .env
  fi
  chmod 600 .env
  echo "DATABASE_URL ecrite dans .env (sauvegarde de l'ancien fichier conservee)"
else
  echo "Pas de .env : ajoutez vous-meme la ligne DATABASE_URL." >&2
fi

echo
echo "Termine. Verification :"
echo "  npx prisma migrate status"
echo "  npm test"
echo "  npm run dev"
