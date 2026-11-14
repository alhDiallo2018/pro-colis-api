import { haversineMeters, effectiveStopRadiusMeters, isWithinStop, GEOFENCE_DEFAULTS } from '../src/utils/geofence.js';

const DAKAR = { latitude: 14.6937, longitude: -17.4441 };

function shift(lat, lng, metersNorth = 0, metersEast = 0) {
  const dLat = metersNorth / 111_320;
  const dLng = metersEast / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + dLat, longitude: lng + dLng };
}

describe('haversineMeters', () => {
  test('même point : 0 m', () => {
    expect(haversineMeters(DAKAR, DAKAR)).toBeCloseTo(0, 1);
  });

  test('50 m au nord : ~50 m', () => {
    const b = shift(DAKAR.latitude, DAKAR.longitude, 50);
    expect(haversineMeters(DAKAR, b)).toBeGreaterThan(45);
    expect(haversineMeters(DAKAR, b)).toBeLessThan(55);
  });

  test('point invalide : Infinity', () => {
    expect(haversineMeters(DAKAR, { latitude: 'oops', longitude: 0 })).toBe(Infinity);
    expect(haversineMeters(null, DAKAR)).toBe(Infinity);
  });
});

describe('effectiveStopRadiusMeters', () => {
  test('rayon config par défaut si zone sans rayon', () => {
    const r = effectiveStopRadiusMeters({ zone: { latitude: 14, longitude: -17 } });
    expect(r).toBe(GEOFENCE_DEFAULTS.radiusMeters);
  });

  test('rayon zone utilisé si > rayon config', () => {
    const r = effectiveStopRadiusMeters({ zone: { radiusKm: 1 } });
    expect(r).toBe(1000);
  });

  test('rayon zone ignoré si plus petit que config', () => {
    const r = effectiveStopRadiusMeters({ zone: { radiusKm: 0.1 } });
    expect(r).toBe(GEOFENCE_DEFAULTS.radiusMeters);
  });

  test('useZoneRadiusAsFloor=false : toujours config', () => {
    const r = effectiveStopRadiusMeters({ zone: { radiusKm: 5 } }, { useZoneRadiusAsFloor: false });
    expect(r).toBe(GEOFENCE_DEFAULTS.radiusMeters);
  });
});

describe('isWithinStop', () => {
  const stop = { zone: { latitude: DAKAR.latitude, longitude: DAKAR.longitude } };

  test('position dans le rayon par défaut', () => {
    const near = shift(DAKAR.latitude, DAKAR.longitude, 100);
    const r = isWithinStop(stop, near);
    expect(r.within).toBe(true);
    expect(r.distanceMeters).toBeLessThan(GEOFENCE_DEFAULTS.radiusMeters);
    expect(r.radiusMeters).toBe(GEOFENCE_DEFAULTS.radiusMeters);
  });

  test('position hors du rayon', () => {
    const far = shift(DAKAR.latitude, DAKAR.longitude, 2000);
    const r = isWithinStop(stop, far);
    expect(r.within).toBe(false);
    expect(r.distanceMeters).toBeGreaterThan(1000);
  });

  test('zone large : rayon utilisé comme plancher', () => {
    const wideStop = { zone: { latitude: DAKAR.latitude, longitude: DAKAR.longitude, radiusKm: 1 } };
    const edge = shift(DAKAR.latitude, DAKAR.longitude, 600);
    const r = isWithinStop(wideStop, edge);
    expect(r.within).toBe(true);
    expect(r.radiusMeters).toBe(1000);
  });
});
