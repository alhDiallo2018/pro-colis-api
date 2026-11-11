import { detectAnomalies, ANOMALY_DEFAULTS } from '../src/utils/anomaly-detector.js';

/**
 * Tests unitaires du détecteur d'anomalies trajet. Zero DB, zero Prisma.
 * Dakar ≈ (14.6928, -17.4467), Thiès ≈ (14.7886, -16.9256).
 */

const DAKAR = { latitude: 14.6928, longitude: -17.4467 };
const THIES = { latitude: 14.7886, longitude: -16.9256 };

function pos(lat, lng, secondsAgo, now) {
  return { latitude: lat, longitude: lng, createdAt: new Date(now.getTime() - secondsAgo * 1000) };
}

describe('detectAnomalies — status non actif', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  test('retourne [] si statut delivered', () => {
    const anomalies = detectAnomalies({
      lastLocation: pos(14.74, -17.0, 20 * 60, now),
      recentLocations: [],
      departure: DAKAR,
      arrival: THIES,
      status: 'delivered',
      now
    });
    expect(anomalies).toEqual([]);
  });

  test('retourne [] si statut pending', () => {
    const anomalies = detectAnomalies({
      lastLocation: null,
      recentLocations: [],
      departure: DAKAR,
      arrival: THIES,
      status: 'pending',
      now
    });
    expect(anomalies).toEqual([]);
  });

  test('retourne [] si feature flag enabled=false', () => {
    const anomalies = detectAnomalies({
      lastLocation: pos(14.74, -17.0, 20 * 60, now),
      recentLocations: [],
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      config: { enabled: false },
      now
    });
    expect(anomalies).toEqual([]);
  });
});

describe('detectAnomalies — gps_silence', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  test('détecte un silence > 15 min', () => {
    const anomalies = detectAnomalies({
      lastLocation: pos(14.74, -17.0, 20 * 60, now),
      recentLocations: [pos(14.74, -17.0, 20 * 60, now)],
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    expect(anomalies.find((a) => a.type === 'gps_silence')).toBeTruthy();
  });

  test('promeut en critical au-delà de 2× le seuil', () => {
    const anomalies = detectAnomalies({
      lastLocation: pos(14.74, -17.0, 45 * 60, now),
      recentLocations: [],
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    const silence = anomalies.find((a) => a.type === 'gps_silence');
    expect(silence?.severity).toBe('critical');
  });

  test('pas de silence si position fraîche (< 15 min)', () => {
    const anomalies = detectAnomalies({
      lastLocation: pos(14.74, -17.0, 5 * 60, now),
      recentLocations: [pos(14.74, -17.0, 5 * 60, now)],
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    expect(anomalies.find((a) => a.type === 'gps_silence')).toBeUndefined();
  });

  test('signale si aucune position du tout', () => {
    const anomalies = detectAnomalies({
      lastLocation: null,
      recentLocations: [],
      departure: DAKAR,
      arrival: THIES,
      status: 'picked_up',
      now
    });
    const silence = anomalies.find((a) => a.type === 'gps_silence');
    expect(silence).toBeTruthy();
    expect(silence.details.lastPositionAt).toBeNull();
  });
});

describe('detectAnomalies — prolonged_stop', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  test('détecte un arrêt > 20 min dans un rayon de 100 m', () => {
    // 10 points étalés sur 27 min, tous dans un disque de ~10 m.
    const recent = [];
    for (let i = 0; i < 10; i++) {
      recent.push(pos(14.74 + i * 0.00001, -17.0, (27 - i * 3) * 60, now));
    }
    const anomalies = detectAnomalies({
      lastLocation: recent[recent.length - 1],
      recentLocations: recent,
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    const stop = anomalies.find((a) => a.type === 'prolonged_stop');
    expect(stop).toBeTruthy();
    expect(stop.details.stoppedSinceMinutes).toBeGreaterThanOrEqual(20);
  });

  test("pas d'arrêt si le chauffeur bouge (trajectoire répartie)", () => {
    const recent = [];
    for (let i = 0; i < 10; i++) {
      recent.push(pos(14.74 + i * 0.01, -17.0, (25 - i) * 60, now));
    }
    const anomalies = detectAnomalies({
      lastLocation: recent[recent.length - 1],
      recentLocations: recent,
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    expect(anomalies.find((a) => a.type === 'prolonged_stop')).toBeUndefined();
  });

  test('pas d\'arrêt si moins de 3 points dans la fenêtre', () => {
    const recent = [pos(14.74, -17.0, 5 * 60, now), pos(14.74, -17.0, 10 * 60, now)];
    const anomalies = detectAnomalies({
      lastLocation: recent[0],
      recentLocations: recent,
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    expect(anomalies.find((a) => a.type === 'prolonged_stop')).toBeUndefined();
  });
});

describe('detectAnomalies — route_deviation', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  test('détecte une déviation > 2 km de la ligne départ→arrivée', () => {
    // Position très au nord de la ligne Dakar-Thiès.
    const anomalies = detectAnomalies({
      lastLocation: pos(15.1, -17.0, 60, now),
      recentLocations: [pos(15.1, -17.0, 60, now)],
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    const dev = anomalies.find((a) => a.type === 'route_deviation');
    expect(dev).toBeTruthy();
    expect(dev.details.deviationKm).toBeGreaterThan(2);
  });

  test('pas de déviation si la position est sur la ligne', () => {
    // Milieu approximatif Dakar-Thiès.
    const anomalies = detectAnomalies({
      lastLocation: pos(14.74, -17.18, 60, now),
      recentLocations: [pos(14.74, -17.18, 60, now)],
      departure: DAKAR,
      arrival: THIES,
      status: 'in_transit',
      now
    });
    expect(anomalies.find((a) => a.type === 'route_deviation')).toBeUndefined();
  });

  test('pas de déviation si coordonnées départ/arrivée manquent', () => {
    const anomalies = detectAnomalies({
      lastLocation: pos(15.5, -17.0, 60, now),
      recentLocations: [pos(15.5, -17.0, 60, now)],
      departure: { latitude: null, longitude: null },
      arrival: THIES,
      status: 'in_transit',
      now
    });
    expect(anomalies.find((a) => a.type === 'route_deviation')).toBeUndefined();
  });
});

describe('detectAnomalies — defaults', () => {
  test('expose les valeurs par défaut documentées', () => {
    expect(ANOMALY_DEFAULTS.gpsSilenceMinutes).toBe(15);
    expect(ANOMALY_DEFAULTS.prolongedStopMinutes).toBe(20);
    expect(ANOMALY_DEFAULTS.stopRadiusMeters).toBe(100);
    expect(ANOMALY_DEFAULTS.deviationThresholdKm).toBe(2);
  });
});
