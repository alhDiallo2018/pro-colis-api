/**
 * Détection d'anomalies trajet — service pur (sans DB, sans Prisma).
 *
 * Trois détections V1, toutes basées sur les positions GPS déjà stockées :
 *  - `gps_silence`      : plus aucune position depuis > N min pendant transport actif.
 *  - `prolonged_stop`   : les K dernières positions tiennent dans un disque de R m
 *                         pendant > M min (le chauffeur ne bouge plus).
 *  - `route_deviation`  : la dernière position s'éloigne de la ligne départ→arrivée
 *                         de plus de D km (déviation d'itinéraire).
 *
 * Ces règles sont volontairement simples et déterministes. Pas de ML, pas de
 * données de trafic. Le but : signaler un cas suspect à l'admin ou au client,
 * jamais bloquer un flux métier.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  gpsSilenceMinutes: 15,
  prolongedStopMinutes: 20,
  stopRadiusMeters: 100,
  minPointsForStopDetection: 3,
  deviationThresholdKm: 2,
  recentWindowMinutes: 30
});

// Mêmes statuts actifs que l'ETA (doublon volontaire : service pur).
const ACTIVE_STATUSES = Object.freeze(['picked_up', 'in_transit', 'arrived', 'out_for_delivery']);

function toRad(deg) {
  return (deg * Math.PI) / 180;
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

/**
 * Distance perpendiculaire (km) entre un point et un segment de droite
 * (départ → arrivée), projetée sur la Terre.
 *
 * Approximation plane : légitime à l'échelle de ~100 km (Dakar-Thiès),
 * suffisamment précise pour un seuil de 2 km de déviation.
 */
function pointToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  // Convertit en « km approximatifs » autour du milieu du segment.
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
  if (len2 === 0) {
    // Segment dégénéré : départ == arrivée.
    return Math.hypot(px - ax, py - ay);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validLocation(loc) {
  return (
    loc != null &&
    isFiniteNumber(loc.latitude) &&
    isFiniteNumber(loc.longitude) &&
    loc.createdAt instanceof Date
  );
}

/**
 * Détecte les anomalies d'un trajet en cours.
 *
 * @param {object} input
 * @param {{latitude: number, longitude: number, createdAt: Date} | null} input.lastLocation
 * @param {Array<{latitude: number, longitude: number, createdAt: Date}>} [input.recentLocations]
 * @param {{ latitude: number|null, longitude: number|null }} input.departure
 * @param {{ latitude: number|null, longitude: number|null }} input.arrival
 * @param {string} input.status
 * @param {object} [input.config]
 * @param {Date} [input.now]
 * @returns {Array<{type: string, severity: 'info'|'warning'|'critical', detectedAt: string, details: object}>}
 */
export function detectAnomalies({
  lastLocation,
  recentLocations = [],
  departure,
  arrival,
  status,
  config = {},
  now = new Date()
} = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (cfg.enabled === false) return [];
  if (!ACTIVE_STATUSES.includes(status)) return [];

  const findings = [];

  // ─── GPS silence ─────────────────────────────────────────────────
  if (!validLocation(lastLocation)) {
    // Pas de position du tout pendant un statut actif : silence depuis au moins
    // la prise en charge. On ne peut pas dater précisément, on signale.
    findings.push({
      type: 'gps_silence',
      severity: 'warning',
      detectedAt: now.toISOString(),
      details: { lastPositionAt: null, silenceMinutes: null }
    });
  } else {
    const ageMin = (now.getTime() - lastLocation.createdAt.getTime()) / 60000;
    if (ageMin > cfg.gpsSilenceMinutes) {
      findings.push({
        type: 'gps_silence',
        severity: ageMin > cfg.gpsSilenceMinutes * 2 ? 'critical' : 'warning',
        detectedAt: now.toISOString(),
        details: {
          lastPositionAt: lastLocation.createdAt.toISOString(),
          silenceMinutes: Math.round(ageMin)
        }
      });
    }
  }

  // ─── Prolonged stop ──────────────────────────────────────────────
  const windowStart = now.getTime() - cfg.recentWindowMinutes * 60 * 1000;
  const inWindow = recentLocations
    .filter(validLocation)
    .filter((p) => p.createdAt.getTime() >= windowStart)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (inWindow.length >= cfg.minPointsForStopDetection) {
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const spanMin = (last.createdAt.getTime() - first.createdAt.getTime()) / 60000;
    if (spanMin >= cfg.prolongedStopMinutes) {
      // Cluster : toutes les positions sont-elles dans un disque de R mètres
      // autour du centre géométrique ?
      const avgLat = inWindow.reduce((s, p) => s + p.latitude, 0) / inWindow.length;
      const avgLng = inWindow.reduce((s, p) => s + p.longitude, 0) / inWindow.length;
      const maxDistKm = inWindow.reduce((m, p) => {
        const d = haversineKm(p.latitude, p.longitude, avgLat, avgLng);
        return d > m ? d : m;
      }, 0);
      if (maxDistKm * 1000 <= cfg.stopRadiusMeters) {
        findings.push({
          type: 'prolonged_stop',
          severity: 'warning',
          detectedAt: now.toISOString(),
          details: {
            stoppedSinceMinutes: Math.round(spanMin),
            radiusMeters: Math.round(maxDistKm * 1000),
            centerLatitude: Number(avgLat.toFixed(6)),
            centerLongitude: Number(avgLng.toFixed(6))
          }
        });
      }
    }
  }

  // ─── Route deviation ─────────────────────────────────────────────
  if (
    validLocation(lastLocation) &&
    isFiniteNumber(departure?.latitude) &&
    isFiniteNumber(departure?.longitude) &&
    isFiniteNumber(arrival?.latitude) &&
    isFiniteNumber(arrival?.longitude)
  ) {
    const devKm = pointToSegmentKm(
      lastLocation.latitude,
      lastLocation.longitude,
      departure.latitude,
      departure.longitude,
      arrival.latitude,
      arrival.longitude
    );
    if (devKm > cfg.deviationThresholdKm) {
      findings.push({
        type: 'route_deviation',
        severity: devKm > cfg.deviationThresholdKm * 2 ? 'critical' : 'warning',
        detectedAt: now.toISOString(),
        details: {
          deviationKm: Number(devKm.toFixed(2)),
          thresholdKm: cfg.deviationThresholdKm
        }
      });
    }
  }

  return findings;
}

export const ANOMALY_DEFAULTS = DEFAULTS;
export const ANOMALY_ACTIVE_STATUSES = ACTIVE_STATUSES;
