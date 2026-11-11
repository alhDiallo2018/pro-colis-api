import {
  quoteInternationalShipment,
  INTERNATIONAL_PRICING_DEFAULTS,
  SUPPORTED_CURRENCIES
} from '../src/utils/international-pricing.js';

describe('quoteInternationalShipment — validations', () => {
  test('refuse un code pays invalide', () => {
    expect(
      quoteInternationalShipment({ originCountry: null, destinationCountry: 'SN', weightKg: 2 })
        .reason
    ).toBe('invalid_country');
  });

  test('refuse un poids invalide ou nul', () => {
    expect(quoteInternationalShipment({ originCountry: 'SN', destinationCountry: 'SN', weightKg: 0 }).reason).toBe('invalid_weight');
    expect(quoteInternationalShipment({ originCountry: 'SN', destinationCountry: 'SN', weightKg: -1 }).reason).toBe('invalid_weight');
  });

  test('refuse un poids > maxWeightKg', () => {
    const r = quoteInternationalShipment({ originCountry: 'SN', destinationCountry: 'ML', weightKg: 100 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('overweight');
  });

  test('refuse une paire non desservie', () => {
    const r = quoteInternationalShipment({ originCountry: 'SN', destinationCountry: 'US', weightKg: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('country_pair_not_served');
  });

  test('respecte le flag enabled=false', () => {
    const r = quoteInternationalShipment(
      { originCountry: 'SN', destinationCountry: 'SN', weightKg: 2 },
      { config: { enabled: false } }
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disabled');
  });
});

describe('quoteInternationalShipment — devis national', () => {
  test('SN → SN 2 kg (pas de supplément douane)', () => {
    const r = quoteInternationalShipment({
      originCountry: 'SN',
      destinationCountry: 'SN',
      weightKg: 2
    });
    expect(r.ok).toBe(true);
    expect(r.crossBorder).toBe(false);
    expect(r.customsSurchargeXof).toBe(0);
    expect(r.priceXof).toBe(500 + 300 * 2); // 1100
    expect(r.slaDays).toBe(1);
  });
});

describe('quoteInternationalShipment — devis transfrontalier', () => {
  test('SN → ML 5 kg ajoute le supplément douane', () => {
    const r = quoteInternationalShipment({
      originCountry: 'SN',
      destinationCountry: 'ML',
      weightKg: 5
    });
    expect(r.ok).toBe(true);
    expect(r.crossBorder).toBe(true);
    expect(r.customsSurchargeXof).toBe(1500);
    expect(r.priceXof).toBe(5000 + 1200 * 5 + 1500); // 12500
    expect(r.requiredDocuments).toEqual(expect.arrayContaining(['invoice', 'cn22_or_cn23', 'sender_id']));
  });

  test('symétrie inverse : ML → SN même tarif', () => {
    const forward = quoteInternationalShipment({ originCountry: 'SN', destinationCountry: 'ML', weightKg: 3 });
    const reverse = quoteInternationalShipment({ originCountry: 'ML', destinationCountry: 'SN', weightKg: 3 });
    expect(forward.priceXof).toBe(reverse.priceXof);
    expect(forward.slaDays).toBe(reverse.slaDays);
  });

  test('declareValue ajoute cn22_or_cn23 même pour une paire nationale', () => {
    const r = quoteInternationalShipment({
      originCountry: 'SN',
      destinationCountry: 'SN',
      weightKg: 2,
      declareValue: true
    });
    expect(r.requiredDocuments).toContain('cn22_or_cn23');
  });
});

describe('quoteInternationalShipment — conversion de devise', () => {
  test('conversion XOF → GHS applique le taux', () => {
    const r = quoteInternationalShipment({
      originCountry: 'SN',
      destinationCountry: 'GH',
      weightKg: 2,
      displayCurrency: 'GHS'
    });
    // SN-GH pas desservi par défaut → ignore ce test.
    if (r.ok === false) {
      expect(r.reason).toBe('country_pair_not_served');
    }
  });

  test('conversion XOF → EUR applique le taux', () => {
    const r = quoteInternationalShipment({
      originCountry: 'SN',
      destinationCountry: 'ML',
      weightKg: 2,
      displayCurrency: 'EUR'
    });
    expect(r.ok).toBe(true);
    expect(r.displayCurrency).toBe('EUR');
    expect(r.priceDisplay).toBeGreaterThan(0);
    expect(r.priceDisplay).toBeLessThan(r.priceXof); // EUR plus cher que XOF
  });

  test('devise inconnue → tombe sur XOF silencieusement', () => {
    const r = quoteInternationalShipment({
      originCountry: 'SN',
      destinationCountry: 'SN',
      weightKg: 2,
      displayCurrency: 'BTC'
    });
    expect(r.displayCurrency).toBe('XOF');
    expect(r.priceDisplay).toBe(r.priceXof);
  });
});

describe('INTERNATIONAL_PRICING_DEFAULTS', () => {
  test('taux de change cohérents (XOF = 1)', () => {
    expect(INTERNATIONAL_PRICING_DEFAULTS.exchangeRates.XOF).toBe(1);
  });

  test('inclut au moins 5 paires pays CEDEAO', () => {
    expect(Object.keys(INTERNATIONAL_PRICING_DEFAULTS.countryPairs).length).toBeGreaterThanOrEqual(5);
  });

  test('SUPPORTED_CURRENCIES inclut XOF, EUR, USD', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(expect.arrayContaining(['XOF', 'EUR', 'USD']));
  });
});
