import { aggregateShipperStats } from '../src/utils/business-shipper-stats.js';

function parcel(overrides = {}) {
  return {
    id: 'p-' + Math.random().toString(36).slice(2),
    status: 'delivered',
    totalAmount: 5000,
    arrivalZoneId: 'zone-thies',
    arrivalZoneName: 'Thiès',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    deliveryDate: new Date('2026-11-02T14:00:00Z'),
    estimatedDeliveryDate: new Date('2026-11-02T18:00:00Z'),
    ...overrides
  };
}

describe('aggregateShipperStats — comptages', () => {
  test('liste vide → zéros', () => {
    const r = aggregateShipperStats([]);
    expect(r.volumeTotal).toBe(0);
    expect(r.averageCost).toBeNull();
    expect(r.slaOnTimePercent).toBeNull();
    expect(r.topDestinations).toEqual([]);
  });

  test('compte par statut (delivered / in_progress / cancelled)', () => {
    const r = aggregateShipperStats([
      parcel({ status: 'delivered' }),
      parcel({ status: 'delivered' }),
      parcel({ status: 'in_transit' }),
      parcel({ status: 'cancelled' }),
      parcel({ status: 'pending' })
    ]);
    expect(r.volumeTotal).toBe(5);
    expect(r.volumeDelivered).toBe(2);
    expect(r.volumeInProgress).toBe(2);
    expect(r.volumeCancelled).toBe(1);
  });
});

describe('aggregateShipperStats — financier', () => {
  test('averageCost sur tous les colis avec un montant', () => {
    const r = aggregateShipperStats([
      parcel({ totalAmount: 4000 }),
      parcel({ totalAmount: 6000 }),
      parcel({ totalAmount: 5000 })
    ]);
    expect(r.averageCost).toBe(5000);
  });

  test('totalBilled ne compte que les colis livrés', () => {
    const r = aggregateShipperStats([
      parcel({ status: 'delivered', totalAmount: 5000 }),
      parcel({ status: 'cancelled', totalAmount: 3000 }),
      parcel({ status: 'in_transit', totalAmount: 7000 })
    ]);
    expect(r.totalBilled).toBe(5000);
  });

  test('utilise price comme fallback si totalAmount manque', () => {
    const r = aggregateShipperStats([parcel({ totalAmount: null, price: 4500 })]);
    expect(r.averageCost).toBe(4500);
  });
});

describe('aggregateShipperStats — SLA', () => {
  test('livré avant estimatedDeliveryDate → compte comme on-time', () => {
    const r = aggregateShipperStats([
      parcel({
        status: 'delivered',
        deliveryDate: new Date('2026-11-02T14:00:00Z'),
        estimatedDeliveryDate: new Date('2026-11-02T18:00:00Z')
      })
    ]);
    expect(r.slaOnTimePercent).toBe(100);
  });

  test('livré après estimatedDeliveryDate → en retard', () => {
    const r = aggregateShipperStats([
      parcel({
        status: 'delivered',
        deliveryDate: new Date('2026-11-02T20:00:00Z'),
        estimatedDeliveryDate: new Date('2026-11-02T18:00:00Z')
      })
    ]);
    expect(r.slaOnTimePercent).toBe(0);
  });

  test('ignore les colis non livrés dans le calcul SLA', () => {
    const r = aggregateShipperStats([
      parcel({ status: 'in_transit' }),
      parcel({ status: 'delivered' })
    ]);
    expect(r.slaOnTimePercent).toBe(100);
  });

  test('null si aucun colis livré avec dates complètes', () => {
    const r = aggregateShipperStats([
      parcel({ status: 'in_transit', deliveryDate: null })
    ]);
    expect(r.slaOnTimePercent).toBeNull();
  });
});

describe('aggregateShipperStats — top destinations', () => {
  test('retourne le top 3 par fréquence', () => {
    const r = aggregateShipperStats([
      parcel({ arrivalZoneId: 'z1', arrivalZoneName: 'Thiès' }),
      parcel({ arrivalZoneId: 'z1', arrivalZoneName: 'Thiès' }),
      parcel({ arrivalZoneId: 'z1', arrivalZoneName: 'Thiès' }),
      parcel({ arrivalZoneId: 'z2', arrivalZoneName: 'Kaolack' }),
      parcel({ arrivalZoneId: 'z2', arrivalZoneName: 'Kaolack' }),
      parcel({ arrivalZoneId: 'z3', arrivalZoneName: 'Saint-Louis' }),
      parcel({ arrivalZoneId: 'z4', arrivalZoneName: 'Louga' })
    ]);
    expect(r.topDestinations).toHaveLength(3);
    expect(r.topDestinations[0].zoneId).toBe('z1');
    expect(r.topDestinations[0].count).toBe(3);
    expect(r.topDestinations[1].zoneId).toBe('z2');
  });
});

describe('aggregateShipperStats — timeline', () => {
  test('groupe les créations par jour ISO', () => {
    const r = aggregateShipperStats([
      parcel({ createdAt: new Date('2026-11-01T10:00:00Z') }),
      parcel({ createdAt: new Date('2026-11-01T18:00:00Z') }),
      parcel({ createdAt: new Date('2026-11-02T09:00:00Z') })
    ]);
    expect(r.byDay).toEqual([
      { date: '2026-11-01', count: 2 },
      { date: '2026-11-02', count: 1 }
    ]);
  });

  test('tolère les dates manquantes', () => {
    const r = aggregateShipperStats([parcel({ createdAt: null })]);
    expect(r.byDay).toEqual([]);
  });
});
