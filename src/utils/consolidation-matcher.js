/**
 * Consolidation / backhaul matching — service pur (sans DB).
 *
 * Étant donnés un trajet chauffeur (départ → arrivée) avec une capacité en
 * poids, et une liste de colis candidats, retourne la liste des colis
 * compatibles, triée par score de compatibilité.
 *
 * Trois conditions dures (binaires) :
 *  - Le colis doit tenir dans la capacité restante.
 *  - La zone de départ du colis doit être sur la trajectoire du chauffeur.
 *  - Le statut du colis doit être adossable (`pending`, `free`).
 *
 * Score souple (tie-break) : proximité départ + proximité arrivée + poids.
 *
 * Volontairement simple : Haversine entre centres de zones, pas de routage
 * routier, pas de prédiction ML. Inputs numériques normalisés.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  // Distance max entre le colis et la trajectoire du chauffeur pour être
  // considéré sur le chemin.
  onRouteToleranceKm: 5,
  // Statuts de colis adossables.
  adoptableStatuses: ['pending', 'free'],
  // Pondérations du score de tie-break.
  weightPickupDistance: 0.4,
  weightDropoffDistance: 0.4,
  weightWeightFit: 0.2
});

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function toRad(d) {
  return (d * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pointToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  // Approximation plane (voir anomaly-detector.js — même logique).
  const midLat = (aLat + bLat) / 2;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(toRad(midLat));

  const ax = aLng * kmPerDegLng;
  const ay = aLat * kmPerDegLat;
  const bx = bLng * kmPerDegLng;
  const by = bLat * kmPerDegLat;
  const px = pLng * kmPerDegLng;
  const py = pLat * kmPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function validZone(z) {
  return z && isFiniteNumber(z.latitude) && isFiniteNumber(z.longitude);
}

/**
 * @param {object} trip
 * @param {{latitude: number, longitude: number}} trip.departure
 * @param {{latitude: number, longitude: number}} trip.arrival
 * @param {number} trip.remainingWeightKg
 * @param {Array<object>} parcels
 * @param {object} [options.config]
 * @returns {Array<object & { compatible: boolean, score: number, reasons: string[], detourKm: number }>}
 */
export function matchCompatibleParcels({ trip, parcels }, { config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config, adoptableStatuses: config.adoptableStatuses ?? DEFAULTS.adoptableStatuses };
  if (!Array.isArray(parcels) || parcels.length === 0) return [];
  if (cfg.enabled === false) {
    return parcels.map((p) => ({ ...p, compatible: false, score: null, reasons: ['disabled'], detourKm: null }));
  }

  if (!validZone(trip?.departure) || !validZone(trip?.arrival)) {
    return parcels.map((p) => ({ ...p, compatible: false, score: 0, reasons: ['invalid_trip'], detourKm: null }));
  }

  const tripKm = haversineKm(
    trip.departure.latitude,
    trip.departure.longitude,
    trip.arrival.latitude,
    trip.arrival.longitude
  );

  return parcels.map((parcel) => {
    const reasons = [];

    // Hard filter 1 : statut.
    if (!cfg.adoptableStatuses.includes(parcel.status)) {
      reasons.push('status_not_adoptable');
    }

    // Hard filter 2 : poids.
    if (isFiniteNumber(parcel.weightKg) && isFiniteNumber(trip.remainingWeightKg)) {
      if (parcel.weightKg > trip.remainingWeightKg) reasons.push('overweight');
    }

    // Hard filter 3 : on-route (distance du départ colis à la droite trajet).
    let detourKm = null;
    if (validZone(parcel.pickupZone)) {
      detourKm = pointToSegmentKm(
        parcel.pickupZone.latitude,
        parcel.pickupZone.longitude,
        trip.departure.latitude,
        trip.departure.longitude,
        trip.arrival.latitude,
        trip.arrival.longitude
      );
      if (detourKm > cfg.onRouteToleranceKm) reasons.push('off_route');
    } else {
      reasons.push('missing_pickup_zone');
    }

    const compatible = reasons.length === 0;

    // Score de tie-break (uniquement si compatible).
    let score = 0;
    if (compatible) {
      const pickupProx = 1 - Math.min(1, detourKm / cfg.onRouteToleranceKm);
      const dropoffDist = validZone(parcel.dropoffZone)
        ? haversineKm(
            parcel.dropoffZone.latitude,
            parcel.dropoffZone.longitude,
            trip.arrival.latitude,
            trip.arrival.longitude
          )
        : null;
      const dropoffProx =
        dropoffDist != null && tripKm > 0 ? 1 - Math.min(1, dropoffDist / (tripKm * 0.5)) : 0.5;
      const weightFit =
        isFiniteNumber(parcel.weightKg) && isFiniteNumber(trip.remainingWeightKg) && trip.remainingWeightKg > 0
          ? 1 - parcel.weightKg / trip.remainingWeightKg
          : 0.5;
      score = Math.round(
        (cfg.weightPickupDistance * pickupProx +
          cfg.weightDropoffDistance * dropoffProx +
          cfg.weightWeightFit * weightFit) *
          100
      );
    }

    return {
      ...parcel,
      compatible,
      score,
      reasons,
      detourKm: detourKm != null ? Number(detourKm.toFixed(2)) : null
    };
  });
}

export const CONSOLIDATION_DEFAULTS = DEFAULTS;
