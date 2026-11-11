import { matchCompatibleParcels, CONSOLIDATION_DEFAULTS } from '../src/utils/consolidation-matcher.js';

const DAKAR = { latitude: 14.6928, longitude: -17.4467 };
const THIES = { latitude: 14.7886, longitude: -16.9256 };
const KAOLACK = { latitude: 14.1562, longitude: -16.0756 };

const TRIP = {
  departure: DAKAR,
  arrival: THIES,
  remainingWeightKg: 20
};

describe('matchCompatibleParcels — matching de base', () => {
  test('colis sur la route + poids OK + status pending → compatible', () => {
    const parcels = [
      {
        id: 'P1',
        status: 'pending',
        weightKg: 5,
        pickupZone: { latitude: 14.73, longitude: -17.2 }, // mi-trajet
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].compatible).toBe(true);
    expect(r[0].reasons).toEqual([]);
    expect(r[0].score).toBeGreaterThan(0);
  });

  test('colis trop lourd → incompatible (overweight)', () => {
    const parcels = [
      {
        id: 'P2',
        status: 'pending',
        weightKg: 30,
        pickupZone: DAKAR,
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].compatible).toBe(false);
    expect(r[0].reasons).toContain('overweight');
  });

  test('colis hors route → incompatible (off_route)', () => {
    const parcels = [
      {
        id: 'P3',
        status: 'pending',
        weightKg: 5,
        pickupZone: KAOLACK, // très loin de la ligne Dakar-Thiès
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].compatible).toBe(false);
    expect(r[0].reasons).toContain('off_route');
  });

  test('colis au statut delivered → incompatible', () => {
    const parcels = [
      {
        id: 'P4',
        status: 'delivered',
        weightKg: 5,
        pickupZone: DAKAR,
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].compatible).toBe(false);
    expect(r[0].reasons).toContain('status_not_adoptable');
  });

  test('colis au statut free → compatible', () => {
    const parcels = [
      {
        id: 'P5',
        status: 'free',
        weightKg: 5,
        pickupZone: DAKAR,
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].compatible).toBe(true);
  });

  test('zone de départ absente → incompatible', () => {
    const parcels = [{ id: 'P6', status: 'pending', weightKg: 5 }];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].compatible).toBe(false);
    expect(r[0].reasons).toContain('missing_pickup_zone');
  });
});

describe('matchCompatibleParcels — ranking', () => {
  test('les colis plus proches de la route scorent mieux', () => {
    const parcels = [
      {
        id: 'close',
        status: 'pending',
        weightKg: 5,
        pickupZone: { latitude: 14.73, longitude: -17.2 },
        dropoffZone: THIES
      },
      {
        id: 'far',
        status: 'pending',
        weightKg: 5,
        pickupZone: { latitude: 14.76, longitude: -17.25 },
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    const close = r.find((p) => p.id === 'close');
    const far = r.find((p) => p.id === 'far');
    expect(close.score).toBeGreaterThanOrEqual(far.score);
  });

  test('plusieurs raisons sont toutes listées', () => {
    const parcels = [
      {
        id: 'bad',
        status: 'delivered',
        weightKg: 100,
        pickupZone: KAOLACK,
        dropoffZone: THIES
      }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels });
    expect(r[0].reasons).toContain('status_not_adoptable');
    expect(r[0].reasons).toContain('overweight');
    expect(r[0].reasons).toContain('off_route');
  });
});

describe('matchCompatibleParcels — flags', () => {
  test('flag enabled=false retourne tous incompatibles avec raison disabled', () => {
    const parcels = [
      { id: 'X', status: 'pending', weightKg: 5, pickupZone: DAKAR, dropoffZone: THIES }
    ];
    const r = matchCompatibleParcels({ trip: TRIP, parcels }, { config: { enabled: false } });
    expect(r[0].compatible).toBe(false);
    expect(r[0].reasons).toContain('disabled');
  });

  test('trip invalide (coordonnées manquantes) → incompatibles', () => {
    const parcels = [{ id: 'X', status: 'pending', weightKg: 5, pickupZone: DAKAR, dropoffZone: THIES }];
    const r = matchCompatibleParcels(
      { trip: { departure: null, arrival: THIES, remainingWeightKg: 20 }, parcels },
      {}
    );
    expect(r[0].compatible).toBe(false);
    expect(r[0].reasons).toContain('invalid_trip');
  });

  test('liste vide → résultat vide', () => {
    expect(matchCompatibleParcels({ trip: TRIP, parcels: [] })).toEqual([]);
  });
});

describe('CONSOLIDATION_DEFAULTS', () => {
  test('tolérance route configurable (défaut 5 km)', () => {
    expect(CONSOLIDATION_DEFAULTS.onRouteToleranceKm).toBe(5);
    expect(CONSOLIDATION_DEFAULTS.adoptableStatuses).toContain('pending');
  });
});
