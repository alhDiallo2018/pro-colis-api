import { estimateShipping, _zoneOf, _corridorConfidence } from '../src/utils/international-carriers.js';

describe('international-carriers (SCP-041)', () => {
  test('zones de base reconnues', () => {
    expect(_zoneOf('SN')).toBe('cedeao');
    expect(_zoneOf('FR')).toBe('europe');
    expect(_zoneOf('US')).toBe('america');
    expect(_zoneOf('CN')).toBe('asia');
    expect(_zoneOf('MA')).toBe('africa');
    expect(_zoneOf('ZZ')).toBe('other');
    expect(_zoneOf('')).toBe('other');
    expect(_zoneOf(null)).toBe('other');
  });

  test('confidence reflète la qualité du corridor', () => {
    expect(_corridorConfidence('cedeao', 'cedeao')).toBe('high');
    expect(_corridorConfidence('cedeao', 'europe')).toBe('medium');
    expect(_corridorConfidence('europe', 'asia')).toBe('medium');
    expect(_corridorConfidence('cedeao', 'other')).toBe('low');
    expect(_corridorConfidence('other', 'cedeao')).toBe('low');
  });

  test('estimateShipping : SN → FR, 2kg → 2 offres triées par prix (medium)', () => {
    const r = estimateShipping({ origin: 'SN', destination: 'FR', parcel: { weightKg: 2 } });
    expect(r.offers).toHaveLength(2);
    expect(r.offers[0].priceXof).toBeLessThanOrEqual(r.offers[1].priceXof);
    for (const o of r.offers) {
      expect(o.carrier).toBeTruthy();
      expect(o.service).toBeTruthy();
      expect(o.etaDays).toBeGreaterThan(0);
      expect(o.confidence).toBe('medium');
    }
  });

  test('estimateShipping : SN → CI (intra-CEDEAO) → confidence high', () => {
    const r = estimateShipping({ origin: 'SN', destination: 'CI', parcel: { weightKg: 1 } });
    for (const o of r.offers) {
      expect(o.confidence).toBe('high');
    }
  });

  test('estimateShipping : SN → ZZ (zone inconnue) → confidence low', () => {
    const r = estimateShipping({ origin: 'SN', destination: 'ZZ', parcel: { weightKg: 1 } });
    for (const o of r.offers) {
      expect(o.confidence).toBe('low');
    }
  });

  test('offre économique moins chère mais ETA plus long', () => {
    const r = estimateShipping({ origin: 'SN', destination: 'US', parcel: { weightKg: 5 } });
    const economy = r.offers.find((o) => o.carrier === 'economy_partner');
    const standard = r.offers.find((o) => o.carrier === 'dhl');
    expect(economy.priceXof).toBeLessThan(standard.priceXof);
    expect(economy.etaDays).toBeGreaterThan(standard.etaDays);
  });

  test('SN → SN (intra-CEDEAO) : ETA court et prix minimal', () => {
    const r = estimateShipping({ origin: 'SN', destination: 'CI', parcel: { weightKg: 1 } });
    for (const o of r.offers) {
      expect(o.etaDays).toBeLessThanOrEqual(8);
      expect(o.destinationZone).toBe('cedeao');
    }
  });

  test('origin invalide : throws INVALID_CARRIER_INPUT', () => {
    expect(() =>
      estimateShipping({ origin: 'SEN', destination: 'FR', parcel: { weightKg: 1 } })
    ).toThrow(/origin/);
  });

  test('weightKg manquant ou négatif : throws', () => {
    expect(() =>
      estimateShipping({ origin: 'SN', destination: 'FR', parcel: { weightKg: 0 } })
    ).toThrow(/weightKg/);
    expect(() =>
      estimateShipping({ origin: 'SN', destination: 'FR', parcel: {} })
    ).toThrow(/weightKg/);
  });

  test('prix croît avec le poids (même zone)', () => {
    const light = estimateShipping({ origin: 'SN', destination: 'FR', parcel: { weightKg: 1 } });
    const heavy = estimateShipping({ origin: 'SN', destination: 'FR', parcel: { weightKg: 10 } });
    expect(heavy.offers[0].priceXof).toBeGreaterThan(light.offers[0].priceXof);
  });

  test('destination inconnue : zone "other", ETA + cher', () => {
    const r = estimateShipping({ origin: 'SN', destination: 'ZZ', parcel: { weightKg: 1 } });
    expect(r.offers[0].destinationZone).toBe('other');
    expect(r.offers[0].etaDays).toBeGreaterThanOrEqual(14);
  });
});
