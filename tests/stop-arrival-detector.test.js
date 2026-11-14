import { detectStopArrival, STOP_ARRIVAL_DEFAULTS } from '../src/utils/stop-arrival-detector.js';

// Un point de référence à Dakar.
const DAKAR = { lat: 14.6937, lng: -17.4441 };

// Décale un point d'environ `meters` vers le nord (approx. 1° latitude ≈ 111 km).
function shift(lat, lng, metersNorth = 0, metersEast = 0) {
  const dLat = metersNorth / 111_320;
  const dLng = metersEast / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function pos(lat, lng, capturedAt) {
  return { latitude: lat, longitude: lng, capturedAt };
}

function stop(order, lat, lng, { radiusKm = null, label = `Stop ${order}`, zoneId = `zone-${order}` } = {}) {
  return { order, label, zoneId, zone: { latitude: lat, longitude: lng, radiusKm } };
}

describe('detectStopArrival', () => {
  const now = new Date('2026-11-11T12:00:00Z');

  test('aucune position : rien détecté', () => {
    const res = detectStopArrival({
      recentPositions: [],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res).toEqual({ stopReached: [], nearest: null });
  });

  test('position courante dans le rayon par défaut, confirmée par 2 points : arrêt atteint', () => {
    const near1 = shift(DAKAR.lat, DAKAR.lng, 50); // 50m au nord
    const near2 = shift(DAKAR.lat, DAKAR.lng, 20);
    const res = detectStopArrival({
      recentPositions: [
        pos(near1.lat, near1.lng, new Date(now.getTime() - 60_000)),
        pos(near2.lat, near2.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res.stopReached).toHaveLength(1);
    expect(res.stopReached[0].order).toBe(0);
    expect(res.stopReached[0].confirmedBy).toBe(2);
    expect(res.stopReached[0].distanceMeters).toBeLessThan(STOP_ARRIVAL_DEFAULTS.radiusMeters);
    expect(res.nearest.order).toBe(0);
  });

  test('un seul point dans le rayon : pas de confirmation', () => {
    const inRadius = shift(DAKAR.lat, DAKAR.lng, 50);
    const far = shift(DAKAR.lat, DAKAR.lng, 2000);
    const res = detectStopArrival({
      recentPositions: [
        pos(far.lat, far.lng, new Date(now.getTime() - 60_000)),
        pos(inRadius.lat, inRadius.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res.stopReached).toHaveLength(0);
    expect(res.nearest.order).toBe(0);
  });

  test('toutes les positions au-delà du rayon : non atteint', () => {
    const far1 = shift(DAKAR.lat, DAKAR.lng, 2000);
    const far2 = shift(DAKAR.lat, DAKAR.lng, 1500);
    const res = detectStopArrival({
      recentPositions: [
        pos(far1.lat, far1.lng, new Date(now.getTime() - 60_000)),
        pos(far2.lat, far2.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res.stopReached).toHaveLength(0);
    expect(res.nearest.distanceMeters).toBeGreaterThan(1000);
  });

  test('arrêt déjà marqué atteint : pas de duplicata', () => {
    const near1 = shift(DAKAR.lat, DAKAR.lng, 30);
    const near2 = shift(DAKAR.lat, DAKAR.lng, 20);
    const res = detectStopArrival({
      recentPositions: [
        pos(near1.lat, near1.lng, new Date(now.getTime() - 60_000)),
        pos(near2.lat, near2.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      alreadyReachedOrders: [0],
      now
    });
    expect(res.stopReached).toHaveLength(0);
  });

  test('plusieurs arrêts, un seul proche : seul lui détecté', () => {
    const near1 = shift(DAKAR.lat, DAKAR.lng, 30);
    const near2 = shift(DAKAR.lat, DAKAR.lng, 20);
    const far = shift(DAKAR.lat, DAKAR.lng, 50_000); // 50 km plus loin
    const res = detectStopArrival({
      recentPositions: [
        pos(near1.lat, near1.lng, new Date(now.getTime() - 60_000)),
        pos(near2.lat, near2.lng, now)
      ],
      stops: [
        stop(0, DAKAR.lat, DAKAR.lng),
        stop(1, far.lat, far.lng)
      ],
      now
    });
    expect(res.stopReached).toHaveLength(1);
    expect(res.stopReached[0].order).toBe(0);
    expect(res.nearest.order).toBe(0);
  });

  test('fenêtre temporelle dépassée : positions anciennes ignorées', () => {
    const near1 = shift(DAKAR.lat, DAKAR.lng, 30);
    const near2 = shift(DAKAR.lat, DAKAR.lng, 20);
    const res = detectStopArrival({
      recentPositions: [
        pos(near1.lat, near1.lng, new Date(now.getTime() - 20 * 60_000)), // 20 min ago, hors fenêtre (10 min défaut)
        pos(near2.lat, near2.lng, new Date(now.getTime() - 15 * 60_000))
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res.stopReached).toHaveLength(0);
    expect(res.nearest).toBeNull();
  });

  test('rayon de zone > rayon par défaut : utilisé comme plancher', () => {
    const edge = shift(DAKAR.lat, DAKAR.lng, 600); // 600 m, hors rayon défaut 300 m
    const edge2 = shift(DAKAR.lat, DAKAR.lng, 500);
    const res = detectStopArrival({
      recentPositions: [
        pos(edge.lat, edge.lng, new Date(now.getTime() - 60_000)),
        pos(edge2.lat, edge2.lng, now)
      ],
      // Zone « large » de 1 km de rayon.
      stops: [stop(0, DAKAR.lat, DAKAR.lng, { radiusKm: 1 })],
      now
    });
    expect(res.stopReached).toHaveLength(1);
    expect(res.stopReached[0].radiusMeters).toBe(1000);
  });

  test('config.enabled = false : désactive tout', () => {
    const near = shift(DAKAR.lat, DAKAR.lng, 30);
    const res = detectStopArrival({
      recentPositions: [
        pos(near.lat, near.lng, new Date(now.getTime() - 60_000)),
        pos(near.lat, near.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      config: { enabled: false },
      now
    });
    expect(res).toEqual({ stopReached: [], nearest: null });
  });

  test('positions invalides filtrées', () => {
    const near = shift(DAKAR.lat, DAKAR.lng, 30);
    const res = detectStopArrival({
      recentPositions: [
        { latitude: null, longitude: -17, capturedAt: now },
        { latitude: 14, longitude: 'oops', capturedAt: now },
        pos(near.lat, near.lng, new Date(now.getTime() - 60_000)),
        pos(near.lat, near.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res.stopReached).toHaveLength(1);
  });

  test('config.minConsecutivePoints = 3 : 2 points suffisent plus', () => {
    const near1 = shift(DAKAR.lat, DAKAR.lng, 30);
    const near2 = shift(DAKAR.lat, DAKAR.lng, 20);
    const res = detectStopArrival({
      recentPositions: [
        pos(near1.lat, near1.lng, new Date(now.getTime() - 60_000)),
        pos(near2.lat, near2.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      config: { minConsecutivePoints: 3 },
      now
    });
    expect(res.stopReached).toHaveLength(0);
  });

  test('séquence : sortie puis retour dans le rayon, confirmation réinitialisée', () => {
    const near1 = shift(DAKAR.lat, DAKAR.lng, 30);
    const far = shift(DAKAR.lat, DAKAR.lng, 2000);
    const near2 = shift(DAKAR.lat, DAKAR.lng, 40);
    // On a 3 points : near1 (ancien), far (milieu), near2 (courant).
    // On compte les consécutifs à partir de la fin : near2 OK, far hors rayon → stop.
    // Donc 1 seul point consécutif → pas de confirmation.
    const res = detectStopArrival({
      recentPositions: [
        pos(near1.lat, near1.lng, new Date(now.getTime() - 120_000)),
        pos(far.lat, far.lng, new Date(now.getTime() - 60_000)),
        pos(near2.lat, near2.lng, now)
      ],
      stops: [stop(0, DAKAR.lat, DAKAR.lng)],
      now
    });
    expect(res.stopReached).toHaveLength(0);
  });
});
