/**
 * Détection d'arrivée à un arrêt de ligne — service pur (sans DB, sans Prisma).
 *
 * Comparée à anomaly-detector, cette détection est dédiée aux trajets navette
 * sur `TransitLine` : à chaque position GPS reçue, on calcule la distance aux
 * arrêts ordonnés de la ligne et on marque ceux atteints (position à < R m
 * pendant >= N positions d'affilée dans une fenêtre temporelle).
 *
 * Signature volontairement symétrique à anomaly-detector : config + input pur,
 * sortie sous forme d'événements `stop_reached` horodatés, à persister côté
 * caller si pertinent.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  // Rayon par défaut : 300 m autour du centre de la zone. Les arrêts de bus
  // AFTU/DDD ont un marquage au sol imprécis, et la précision GPS smartphone
  // tourne autour de 10-30 m. 300 m couvre « le bus s'arrête devant l'arrêt ».
  radiusMeters: 300,
  // Nombre minimal de positions consécutives à l'intérieur du rayon pour
  // confirmer l'arrivée (filtre contre les pics GPS isolés).
  minConsecutivePoints: 2,
  // Fenêtre temporelle maximale (minutes) couverte par les positions prises
  // en compte. Au-delà, les positions sont considérées obsolètes.
  windowMinutes: 10,
  // Si le rayon de la zone est connu et > radiusMeters, on utilise le rayon
  // de la zone plutôt que la valeur par défaut (cas des gares/centres larges).
  useZoneRadiusAsFloor: true
});

import { haversineMeters as haversineBetween, effectiveStopRadiusMeters } from './geofence.js';

function haversineMeters(lat1, lng1, lat2, lng2) {
  return haversineBetween({ latitude: lat1, longitude: lng1 }, { latitude: lat2, longitude: lng2 });
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validPosition(p) {
  return p != null &&
    isFiniteNumber(p.latitude) &&
    isFiniteNumber(p.longitude) &&
    p.capturedAt instanceof Date;
}

function validStop(stop) {
  return stop != null &&
    typeof stop.order === 'number' &&
    stop.zone != null &&
    isFiniteNumber(stop.zone.latitude) &&
    isFiniteNumber(stop.zone.longitude);
}

/**
 * Évalue, à partir des positions récentes d'un trajet, quels arrêts d'une ligne
 * ont été atteints.
 *
 * @param {object} input
 * @param {Array<{latitude: number, longitude: number, capturedAt: Date}>} input.recentPositions
 *   Positions ordonnées chronologiquement (plus ancienne en premier). Doit
 *   inclure la position courante en dernier.
 * @param {Array<{order: number, label?: string, zoneId?: string, zone: { latitude: number, longitude: number, radiusKm?: number|null }}>} input.stops
 *   Arrêts de la ligne à évaluer (ordonnés par `order`).
 * @param {Array<number>} [input.alreadyReachedOrders]
 *   Orders d'arrêts déjà marqués comme atteints lors des évaluations précédentes.
 *   Permet d'éviter de re-émettre `stop_reached` pour un même arrêt.
 * @param {object} [input.config]
 * @param {Date} [input.now]
 * @returns {{ stopReached: Array<{order: number, label: string|null, zoneId: string|null, distanceMeters: number, radiusMeters: number, reachedAt: string, confirmedBy: number}>, nearest: {order: number, distanceMeters: number}|null }}
 */
export function detectStopArrival({
  recentPositions = [],
  stops = [],
  alreadyReachedOrders = [],
  config = {},
  now = new Date()
} = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (cfg.enabled === false) return { stopReached: [], nearest: null };

  const validStops = stops.filter(validStop).sort((a, b) => a.order - b.order);
  if (!validStops.length) return { stopReached: [], nearest: null };

  const reachedSet = new Set(alreadyReachedOrders.filter((o) => Number.isInteger(o)));

  const windowStart = now.getTime() - cfg.windowMinutes * 60 * 1000;
  const positions = recentPositions
    .filter(validPosition)
    .filter((p) => p.capturedAt.getTime() >= windowStart)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  if (!positions.length) return { stopReached: [], nearest: null };

  const current = positions[positions.length - 1];

  // Nearest : arrêt dont le centre est le plus proche de la position courante.
  let nearest = null;
  for (const stop of validStops) {
    const d = haversineMeters(current.latitude, current.longitude, stop.zone.latitude, stop.zone.longitude);
    if (nearest === null || d < nearest.distanceMeters) {
      nearest = { order: stop.order, distanceMeters: Math.round(d) };
    }
  }

  const stopReached = [];

  for (const stop of validStops) {
    if (reachedSet.has(stop.order)) continue;

    // Rayon effectif : délégué à geofence.effectiveStopRadiusMeters (DRY).
    const effectiveRadius = effectiveStopRadiusMeters(stop, cfg);

    // Compte des positions consécutives récentes dans le rayon, en partant de
    // la fin (position courante). On s'arrête à la première position hors rayon.
    let consecutive = 0;
    let firstHitAt = null;
    let lastHitDistance = null;
    for (let i = positions.length - 1; i >= 0; i--) {
      const p = positions[i];
      const d = haversineMeters(p.latitude, p.longitude, stop.zone.latitude, stop.zone.longitude);
      if (d <= effectiveRadius) {
        consecutive += 1;
        firstHitAt = p.capturedAt;
        if (lastHitDistance === null) lastHitDistance = d;
      } else {
        break;
      }
    }

    if (consecutive >= cfg.minConsecutivePoints) {
      stopReached.push({
        order: stop.order,
        label: stop.label ?? null,
        zoneId: stop.zoneId ?? null,
        distanceMeters: Math.round(lastHitDistance),
        radiusMeters: Math.round(effectiveRadius),
        reachedAt: firstHitAt.toISOString(),
        confirmedBy: consecutive
      });
    }
  }

  return { stopReached, nearest };
}

export const STOP_ARRIVAL_DEFAULTS = DEFAULTS;
