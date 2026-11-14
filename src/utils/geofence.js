/**
 * Primitives de géofencing — service pur (sans DB).
 *
 * Deux fonctions publiques :
 *  - `haversineMeters(a, b)` : distance en mètres entre deux points GPS.
 *  - `isWithinStop(stop, position, config)` : teste si une position GPS est à
 *    l'intérieur du rayon d'influence d'un arrêt, en tenant compte du rayon
 *    de la zone si configuré.
 *
 * Utilisé par `stop-arrival-detector` et `anomaly-detector`. Factorisé pour
 * que d'autres modules (notifications arrivée, webhook partenaires, dashboard
 * ops) puissent partager la même logique sans dupliquer les calculs.
 */

const DEFAULTS = Object.freeze({
  radiusMeters: 300,
  useZoneRadiusAsFloor: true
});

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const latA = Number(a.latitude);
  const lngA = Number(a.longitude);
  const latB = Number(b.latitude);
  const lngB = Number(b.longitude);
  if (![latA, lngA, latB, lngB].every(Number.isFinite)) return Infinity;
  const R = 6_371_000;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Calcule le rayon effectif d'un arrêt : max(rayon config, rayon zone si > et activé).
 * Un arrêt peut être attaché à une zone large (gare routière) dont le rayon
 * dépasse la valeur par défaut — on l'utilise alors comme plancher.
 *
 * @param {{zone?: {radiusKm?: number|null}}} stop
 * @param {{radiusMeters?: number, useZoneRadiusAsFloor?: boolean}} [config]
 */
export function effectiveStopRadiusMeters(stop, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const zoneRadiusMeters = stop?.zone?.radiusKm != null
    ? Number(stop.zone.radiusKm) * 1000
    : null;
  if (cfg.useZoneRadiusAsFloor && zoneRadiusMeters && zoneRadiusMeters > cfg.radiusMeters) {
    return zoneRadiusMeters;
  }
  return cfg.radiusMeters;
}

/**
 * @param {{zone: {latitude: number, longitude: number, radiusKm?: number|null}}} stop
 * @param {{latitude: number, longitude: number}} position
 * @param {object} [config]
 * @returns {{within: boolean, distanceMeters: number, radiusMeters: number}}
 */
export function isWithinStop(stop, position, config = {}) {
  const radius = effectiveStopRadiusMeters(stop, config);
  const d = haversineMeters(stop?.zone, position);
  return {
    within: d <= radius,
    distanceMeters: Number.isFinite(d) ? Math.round(d) : Infinity,
    radiusMeters: Math.round(radius)
  };
}

export const GEOFENCE_DEFAULTS = DEFAULTS;
