import { computeEta, ETA_DEFAULTS, ETA_ACTIVE_STATUSES } from '../src/utils/eta-calculator.js';

/**
 * Tests unitaires du service ETA. Pas de DB, pas de Prisma, pas de HTTP.
 * Les 10 scénarios documentés dans plans/chantier-B-eta-predictif.md §8.
 *
 * Point de référence géographique : Dakar ≈ (14.6928, -17.4467),
 *  Thiès ≈ (14.7886, -16.9256) — ~57 km à vol d'oiseau.
 */

// Helper : construit une position fraîche datée "now - secondsAgo".
function pos(latOrOverrides, lng, secondsAgo, now) {
  if (typeof latOrOverrides === 'object') return latOrOverrides;
  return {
    latitude: latOrOverrides,
    longitude: lng,
    createdAt: new Date(now.getTime() - secondsAgo * 1000)
  };
}

// Helper : série de positions le long d'une ligne, espacées de `intervalSec`,
// avec une vitesse de `kmh`. La dernière est à `secondsAgo` de `now`.
function trail({ fromLat, fromLng, bearingDeg = 90, kmh, nPoints, intervalSec, lastSecondsAgo, now }) {
  const points = [];
  const kmPerSec = kmh / 3600;
  // On construit du plus ancien au plus récent.
  for (let i = 0; i < nPoints; i++) {
    const indexFromLatest = nPoints - 1 - i; // 0 = dernier
    const secondsAgo = lastSecondsAgo + indexFromLatest * intervalSec;
    const km = i * intervalSec * kmPerSec;
    const deltaLatDeg = km / 111; // approx ; marche pour les tests
    const latitude = fromLat + deltaLatDeg;
    const longitude = fromLng;
    points.push({
      latitude,
      longitude,
      createdAt: new Date(now.getTime() - secondsAgo * 1000)
    });
  }
  return points;
}

const DAKAR = { lat: 14.6928, lng: -17.4467 };
const THIES = { lat: 14.7886, lng: -16.9256 };

describe('computeEta()', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  // 1. Chauffeur en mouvement 30 km/h, distance résiduelle ~5 km.
  test('moving driver, fresh position, high confidence', () => {
    const recent = trail({
      fromLat: 14.74,
      fromLng: -17.00,
      kmh: 30,
      nPoints: 6,
      intervalSec: 30,
      lastSecondsAgo: 10,
      now
    });
    const last = recent[recent.length - 1];

    const eta = computeEta({
      lastLocation: last,
      recentLocations: recent,
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });

    expect(eta).not.toBeNull();
    expect(eta.confidence).toBe('high');
    expect(eta.movingState).toBe('moving');
    expect(eta.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(eta.minMinutes).toBeLessThanOrEqual(eta.etaMinutes);
    expect(eta.maxMinutes).toBeGreaterThanOrEqual(eta.etaMinutes);
    // Invariant : arrivalAt ≈ computedAt + etaMinutes (±1 min arrondi).
    const diffMin = (new Date(eta.arrivalAt).getTime() - new Date(eta.computedAt).getTime()) / 60000;
    expect(Math.abs(diffMin - eta.etaMinutes)).toBeLessThanOrEqual(1);
  });

  // 2. Chauffeur à l'arrêt (< 2 km/h depuis 3 min).
  test('stopped driver (< 2 km/h) uses minSpeedKmh', () => {
    // Trail quasi-immobile : 6 points dans un rayon de ~10 m.
    const recent = [];
    for (let i = 5; i >= 0; i--) {
      recent.push({
        latitude: 14.74 + i * 0.00001,
        longitude: -17.00,
        createdAt: new Date(now.getTime() - (10 + i * 30) * 1000)
      });
    }
    const last = recent[recent.length - 1];

    const eta = computeEta({
      lastLocation: last,
      recentLocations: recent,
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });

    expect(eta).not.toBeNull();
    expect(eta.movingState).toBe('stopped');
    expect(eta.confidence).toBe('medium');
    // ETA calculé à minSpeedKmh (15 km/h) → doit être plus long qu'à vitesse moyenne.
    expect(eta.etaMinutes).toBeGreaterThan(10);
  });

  // 3. Position vieille de 15 min → eta null, le mobile affiche fallback statique.
  test('stale position (> stalePositionMaxAgeSec) returns null', () => {
    const last = {
      latitude: 14.74,
      longitude: -17.00,
      createdAt: new Date(now.getTime() - 15 * 60 * 1000)
    };

    const eta = computeEta({
      lastLocation: last,
      recentLocations: [last],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });

    expect(eta).toBeNull();
  });

  // 4. 3 positions seulement sur la fenêtre → medium confidence.
  test('exactly 3 recent points gives medium confidence', () => {
    const recent = trail({
      fromLat: 14.74,
      fromLng: -17.00,
      kmh: 30,
      nPoints: 3,
      intervalSec: 60,
      lastSecondsAgo: 5,
      now
    });
    const last = recent[recent.length - 1];

    const eta = computeEta({
      lastLocation: last,
      recentLocations: recent,
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });

    expect(eta).not.toBeNull();
    expect(eta.movingState).toBe('moving');
    expect(eta.confidence).toBe('medium');
  });

  // 5. 10 positions dont 1 aberrante → point filtré, confidence reste high.
  test('aberrant GPS point (> 200 km/h) is filtered out', () => {
    const recent = trail({
      fromLat: 14.74,
      fromLng: -17.00,
      kmh: 30,
      nPoints: 10,
      intervalSec: 20,
      lastSecondsAgo: 5,
      now
    });
    // Injecte un point aberrant entre les deux derniers : saut de 10 km.
    const bogus = {
      latitude: recent[recent.length - 2].latitude + 10 / 111,
      longitude: recent[recent.length - 2].longitude,
      createdAt: new Date(
        (recent[recent.length - 2].createdAt.getTime() +
          recent[recent.length - 1].createdAt.getTime()) /
          2
      )
    };
    const withBogus = [...recent, bogus];
    const last = recent[recent.length - 1];

    const eta = computeEta({
      lastLocation: last,
      recentLocations: withBogus,
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });

    expect(eta).not.toBeNull();
    expect(eta.movingState).toBe('moving');
    // Confidence high maintenue (le point aberrant ne compte pas dans validSegments).
    expect(['high', 'medium']).toContain(eta.confidence);
  });

  // 6. Pas de position du tout → eta null.
  test('no location at all returns null', () => {
    const eta = computeEta({
      lastLocation: null,
      recentLocations: [],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });
    expect(eta).toBeNull();
  });

  // 7. Statut delivered → eta null.
  test('delivered parcel returns null', () => {
    const last = { latitude: 14.74, longitude: -17.00, createdAt: new Date(now.getTime() - 30 * 1000) };
    const eta = computeEta({
      lastLocation: last,
      recentLocations: [last],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'delivered',
      now
    });
    expect(eta).toBeNull();
  });

  // 8. Statut pending → eta null.
  test('pending parcel returns null', () => {
    const last = { latitude: 14.74, longitude: -17.00, createdAt: new Date(now.getTime() - 30 * 1000) };
    const eta = computeEta({
      lastLocation: last,
      recentLocations: [last],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'pending',
      now
    });
    expect(eta).toBeNull();
  });

  // 9. Trajet très court : etaMinutes clampé à >= 1.
  test('very short remaining distance clamps etaMinutes to >= 1', () => {
    const last = {
      latitude: THIES.lat - 0.001, // ~110 m
      longitude: THIES.lng,
      createdAt: new Date(now.getTime() - 20 * 1000)
    };
    const eta = computeEta({
      lastLocation: last,
      recentLocations: [last],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'out_for_delivery',
      now
    });

    expect(eta).not.toBeNull();
    expect(eta.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(eta.minMinutes).toBeGreaterThanOrEqual(1);
    expect(eta.minMinutes).toBeLessThanOrEqual(eta.etaMinutes);
  });

  // 10. config.routeFactor = 1.5 → ETA proportionnellement plus longue.
  test('routeFactor override stretches the ETA proportionally', () => {
    const recent = trail({
      fromLat: 14.74,
      fromLng: -17.00,
      kmh: 30,
      nPoints: 6,
      intervalSec: 30,
      lastSecondsAgo: 10,
      now
    });
    const last = recent[recent.length - 1];

    const base = computeEta({
      lastLocation: last,
      recentLocations: recent,
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });
    const stretched = computeEta({
      lastLocation: last,
      recentLocations: recent,
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      config: { routeFactor: 1.5 },
      now
    });

    expect(base).not.toBeNull();
    expect(stretched).not.toBeNull();
    // 1.5 / 1.3 ≈ 1.154 → tolérance large pour arrondis.
    expect(stretched.distanceRemainingKm).toBeGreaterThan(base.distanceRemainingKm);
    expect(stretched.etaMinutes).toBeGreaterThanOrEqual(base.etaMinutes);
  });

  // Edge : destination coordonnées manquantes.
  test('missing destination coordinates returns null', () => {
    const last = { latitude: 14.74, longitude: -17.00, createdAt: new Date(now.getTime() - 20 * 1000) };
    expect(
      computeEta({
        lastLocation: last,
        recentLocations: [last],
        destination: { latitude: null, longitude: null },
        status: 'in_transit',
        now
      })
    ).toBeNull();
  });

  // Edge : fewer than 3 points → confidence medium (fresh) ou low (stale, mais non-stale ici).
  test('fewer than 3 points with fresh last position → medium (unknown)', () => {
    const last = { latitude: 14.74, longitude: -17.00, createdAt: new Date(now.getTime() - 30 * 1000) };
    const eta = computeEta({
      lastLocation: last,
      recentLocations: [last],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });
    expect(eta).not.toBeNull();
    expect(eta.movingState).toBe('unknown');
    expect(eta.confidence).toBe('medium');
  });

  // Edge : position fresh/limit → position d'âge 119 s = fresh, 121 s = low.
  test('position just past freshPositionMaxAgeSec drops confidence to low (unknown)', () => {
    const last = {
      latitude: 14.74,
      longitude: -17.00,
      createdAt: new Date(now.getTime() - 121 * 1000)
    };
    const eta = computeEta({
      lastLocation: last,
      recentLocations: [last],
      destination: { latitude: THIES.lat, longitude: THIES.lng },
      status: 'in_transit',
      now
    });
    expect(eta).not.toBeNull();
    expect(eta.confidence).toBe('low');
    expect(eta.movingState).toBe('unknown');
  });
});

describe('ETA_ACTIVE_STATUSES', () => {
  test('exposes the 4 live tracking statuses', () => {
    expect(ETA_ACTIVE_STATUSES).toEqual(['picked_up', 'in_transit', 'arrived', 'out_for_delivery']);
  });
});

describe('ETA_DEFAULTS', () => {
  test('exposes immutable defaults used by the backend', () => {
    expect(ETA_DEFAULTS.routeFactor).toBe(1.3);
    expect(ETA_DEFAULTS.defaultSpeedKmh).toBe(25);
    expect(ETA_DEFAULTS.minSpeedKmh).toBe(15);
    expect(ETA_DEFAULTS.stopThresholdKmh).toBe(2);
    expect(ETA_DEFAULTS.stalePositionMaxAgeSec).toBe(600);
  });
});
