/**
 * ETA prédictive dynamique — service pur (sans DB, sans Prisma).
 *
 * Prend la dernière position GPS d'un chauffeur + une fenêtre de positions
 * récentes + les coordonnées d'arrivée + le statut du colis, et retourne un
 * objet ParcelEta ou `null` quand les conditions ne sont pas réunies.
 *
 * Le contrat de sortie est figé par `chantier-B-openapi.yaml`.
 * Cette fonction est testée unitairement dans `tests/eta-calculator.test.js`
 * sans aucun accès base de données.
 */

const DEFAULTS = Object.freeze({
  routeFactor: 1.3,
  defaultSpeedKmh: 25,
  minSpeedKmh: 15,
  stopThresholdKmh: 2,
  freshPositionMaxAgeSec: 120,
  stalePositionMaxAgeSec: 600,
  recentWindowMinutes: 5,
  minPointsForMeasuredSpeed: 3,
  aberrationMaxSpeedKmh: 200,
  marginHigh: 0.2,
  marginMedium: 0.35,
  marginLow: 0.5
});

// Statuts pendant lesquels le suivi GPS est actif et une ETA fait sens.
// Aligné sur `GPS_LIVE_PARCEL_STATUSES` du mobile.controller.js — doublon
// volontaire : le service reste pur et sans dépendance applicative.
const ACTIVE_STATUSES = Object.freeze(['picked_up', 'in_transit', 'arrived', 'out_for_delivery']);

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function marginFor(cfg, confidence) {
  if (confidence === 'high') return cfg.marginHigh;
  if (confidence === 'medium') return cfg.marginMedium;
  return cfg.marginLow;
}

/**
 * Calcule l'ETA pour un colis donné.
 *
 * @param {object} input
 * @param {{ latitude: number, longitude: number, createdAt: Date } | null} input.lastLocation
 *   Dernière position GPS (la plus récente). `null` si aucune position connue.
 * @param {Array<{ latitude: number, longitude: number, createdAt: Date }>} [input.recentLocations]
 *   Positions de la fenêtre récente (les N dernières, ordre indifférent).
 *   Typiquement les 50 dernières minutes ou les positions des 5 dernières minutes.
 *   Peut être vide.
 * @param {{ latitude: number|null|undefined, longitude: number|null|undefined }} input.destination
 *   Coordonnées d'arrivée. Si l'une des deux est non-finite, retourne null.
 * @param {string} input.status Statut courant du colis (`ParcelStatus`).
 * @param {object} [input.config] Overrides des constantes (lus depuis SystemConfig par l'appelant).
 * @param {Date} [input.now] Heure de référence. Défaut: `new Date()`.
 * @returns {object|null} Objet ParcelEta sérialisable JSON, ou `null`.
 */
export function computeEta({
  lastLocation,
  recentLocations = [],
  destination,
  status,
  config = {},
  now = new Date()
} = {}) {
  const cfg = { ...DEFAULTS, ...config };

  // Statut non actif → pas d'ETA. Inclut delivered, cancelled, pending, confirmed, etc.
  if (!ACTIVE_STATUSES.includes(status)) {
    return null;
  }

  // Coordonnées d'arrivée manquantes ou invalides.
  if (
    destination == null ||
    !isFiniteNumber(destination.latitude) ||
    !isFiniteNumber(destination.longitude)
  ) {
    return null;
  }

  // Aucune position GPS connue pour ce colis → fallback statique côté client.
  if (
    lastLocation == null ||
    !isFiniteNumber(lastLocation.latitude) ||
    !isFiniteNumber(lastLocation.longitude) ||
    !(lastLocation.createdAt instanceof Date)
  ) {
    return null;
  }

  const ageSec = (now.getTime() - lastLocation.createdAt.getTime()) / 1000;

  // Position trop ancienne → eta null, le mobile affichera estimatedDeliveryDate statique.
  if (ageSec > cfg.stalePositionMaxAgeSec) {
    return null;
  }

  const rawDistanceKm = haversineKm(
    lastLocation.latitude,
    lastLocation.longitude,
    destination.latitude,
    destination.longitude
  );
  const distanceRemainingKm = rawDistanceKm * cfg.routeFactor;

  // Vitesse mesurée sur la fenêtre récente, segments filtrés des aberrations.
  const windowStartMs = now.getTime() - cfg.recentWindowMinutes * 60 * 1000;
  const inWindow = recentLocations
    .filter(
      (p) =>
        p &&
        isFiniteNumber(p.latitude) &&
        isFiniteNumber(p.longitude) &&
        p.createdAt instanceof Date &&
        p.createdAt.getTime() >= windowStartMs &&
        p.createdAt.getTime() <= now.getTime()
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let measuredSpeedKmh = null;
  let validSegments = 0;

  if (inWindow.length >= cfg.minPointsForMeasuredSpeed) {
    let totalKm = 0;
    let totalHours = 0;
    for (let i = 1; i < inWindow.length; i++) {
      const a = inWindow[i - 1];
      const b = inWindow[i];
      const segHours = (b.createdAt.getTime() - a.createdAt.getTime()) / 3_600_000;
      if (segHours <= 0) continue;
      const segKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
      const segSpeed = segKm / segHours;
      // Filtre points GPS corrompus (saut > 200 km/h entre deux points).
      if (segSpeed > cfg.aberrationMaxSpeedKmh) continue;
      totalKm += segKm;
      totalHours += segHours;
      validSegments += 1;
    }
    if (totalHours > 0) {
      measuredSpeedKmh = totalKm / totalHours;
    }
  }

  const isFresh = ageSec <= cfg.freshPositionMaxAgeSec;
  let speedKmh;
  let movingState;
  let confidence;

  if (measuredSpeedKmh == null) {
    speedKmh = cfg.defaultSpeedKmh;
    movingState = 'unknown';
    confidence = isFresh ? 'medium' : 'low';
  } else if (measuredSpeedKmh < cfg.stopThresholdKmh) {
    speedKmh = cfg.minSpeedKmh;
    movingState = 'stopped';
    confidence = 'medium';
  } else {
    speedKmh = measuredSpeedKmh;
    movingState = 'moving';
    confidence = isFresh && validSegments >= 4 ? 'high' : 'medium';
  }

  const rawMinutes = (distanceRemainingKm / speedKmh) * 60;
  const etaMinutes = Math.max(1, Math.round(rawMinutes));
  const margin = marginFor(cfg, confidence);
  const minMinutes = Math.max(1, Math.round(etaMinutes * (1 - margin)));
  const maxMinutes = Math.max(etaMinutes, Math.round(etaMinutes * (1 + margin)));
  const arrivalAt = new Date(now.getTime() + etaMinutes * 60_000);

  return {
    etaMinutes,
    arrivalAt: arrivalAt.toISOString(),
    minMinutes,
    maxMinutes,
    distanceRemainingKm: Math.round(distanceRemainingKm * 10) / 10,
    confidence,
    movingState,
    computedAt: now.toISOString()
  };
}

export const ETA_DEFAULTS = DEFAULTS;
export const ETA_ACTIVE_STATUSES = ACTIVE_STATUSES;
