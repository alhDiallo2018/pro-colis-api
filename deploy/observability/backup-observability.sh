#!/usr/bin/env sh
set -eu

# Les timers systemd ne demarrent pas necessairement dans le dossier du depot.
# Resoudre le chemin du script rend les chemins Compose et Restic deterministes.
SCRIPT_DIRECTORY="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIRECTORY"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY manquant}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE manquant}"

LOKI_DOCKER_VOLUME="${LOKI_DOCKER_VOLUME:-procolis-observability_loki-data}"
PROMETHEUS_DOCKER_VOLUME="${PROMETHEUS_DOCKER_VOLUME:-procolis-observability_prometheus-data}"

resolve_volume() {
  volume_name="$1"
  mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "$volume_name")"

  # Restreindre explicitement la sauvegarde aux volumes Docker resolus. Une
  # valeur vide ou un chemin hors de l'espace Docker arrete immediatement le job.
  case "$mountpoint" in
    /var/lib/docker/volumes/*/_data) ;;
    *)
      echo "Point de montage Docker inattendu pour $volume_name" >&2
      exit 1
      ;;
  esac
  [ -d "$mountpoint" ] || {
    echo "Volume introuvable: $volume_name" >&2
    exit 1
  }
  printf '%s\n' "$mountpoint"
}

LOKI_DATA_PATH="$(resolve_volume "$LOKI_DOCKER_VOLUME")"
PROMETHEUS_DATA_PATH="$(resolve_volume "$PROMETHEUS_DOCKER_VOLUME")"

# Une courte pause produit une image disque coherente des TSDB. Les logs Docker
# continuent de tourner et Alloy reprend a sa derniere position au redemarrage.
restart_collectors() {
  docker compose --env-file .env -f compose.yml start loki prometheus alloy >/dev/null 2>&1 || true
}
trap restart_collectors EXIT INT TERM

docker compose --env-file .env -f compose.yml stop alloy prometheus loki

restic backup \
  --tag procolis-observability \
  "$LOKI_DATA_PATH" \
  "$PROMETHEUS_DATA_PATH" \
  ./loki \
  ./prometheus \
  ./alloy \
  ./grafana/provisioning

restic forget \
  --tag procolis-observability \
  --keep-daily 14 \
  --prune

restart_collectors
trap - EXIT INT TERM
