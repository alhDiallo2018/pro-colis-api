import { quoteInsurance, INSURANCE_DEFAULTS } from '../src/utils/insurance-quote.js';

describe('quoteInsurance — validations', () => {
  test('refuse une valeur déclarée invalide', () => {
    expect(quoteInsurance({ declaredValueXof: 0, parcelType: 'package' }).reason).toBe('invalid_value');
    expect(quoteInsurance({ declaredValueXof: -100, parcelType: 'package' }).reason).toBe('invalid_value');
    expect(quoteInsurance({ declaredValueXof: 'abc', parcelType: 'package' }).reason).toBe('invalid_value');
  });

  test('refuse un type non string', () => {
    expect(quoteInsurance({ declaredValueXof: 1000, parcelType: null }).reason).toBe('invalid_type');
  });

  test('type perishable → non assurable', () => {
    const r = quoteInsurance({ declaredValueXof: 10000, parcelType: 'perishable' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('type_not_insurable');
  });

  test('type inconnu → refus explicite', () => {
    const r = quoteInsurance({ declaredValueXof: 10000, parcelType: 'nuclear' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_parcel_type');
  });

  test('respecte le flag enabled=false', () => {
    const r = quoteInsurance(
      { declaredValueXof: 10000, parcelType: 'package' },
      { config: { enabled: false } }
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disabled');
  });
});

describe('quoteInsurance — calcul de prime', () => {
  test('package 100 000 XOF → prime ≈ 1 500 XOF', () => {
    const r = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'package' });
    expect(r.ok).toBe(true);
    expect(r.premiumXof).toBe(1500); // 1.5 % × 100 000 × 1.0
  });

  test('document moins cher que package (risque plus faible)', () => {
    const doc = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'document' });
    const pkg = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'package' });
    expect(doc.premiumXof).toBeLessThan(pkg.premiumXof);
  });

  test('valuable plus cher que fragile', () => {
    const fragile = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'fragile' });
    const valuable = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'valuable' });
    expect(valuable.premiumXof).toBeGreaterThan(fragile.premiumXof);
  });

  test('surprime de 15 % pour transfrontalier', () => {
    const local = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'package', crossBorder: false });
    const cross = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'package', crossBorder: true });
    expect(cross.premiumXof).toBeGreaterThan(local.premiumXof);
    expect(cross.premiumXof / local.premiumXof).toBeCloseTo(1.15, 1);
  });

  test('prime plancher à minimumPremiumXof pour les petites valeurs', () => {
    const r = quoteInsurance({ declaredValueXof: 1000, parcelType: 'document' });
    expect(r.premiumXof).toBe(INSURANCE_DEFAULTS.minimumPremiumXof);
  });
});

describe('quoteInsurance — couverture', () => {
  test('coverageXof = declaredValue si ≤ maxCoverage', () => {
    const r = quoteInsurance({ declaredValueXof: 500_000, parcelType: 'package' });
    expect(r.coverageXof).toBe(500_000);
  });

  test('coverageXof plafonné à maxCoverage', () => {
    const r = quoteInsurance({ declaredValueXof: 5_000_000, parcelType: 'package' });
    expect(r.coverageXof).toBe(INSURANCE_DEFAULTS.maxCoverageXof);
  });

  test('expose les exclusions standard', () => {
    const r = quoteInsurance({ declaredValueXof: 100_000, parcelType: 'package' });
    expect(r.exclusions).toEqual(expect.arrayContaining(['war_damage', 'natural_disaster']));
  });
});

describe('INSURANCE_DEFAULTS', () => {
  test('perishable explicitement non assurable', () => {
    expect(INSURANCE_DEFAULTS.riskMultipliers.perishable).toBeNull();
  });

  test('document moins cher que package', () => {
    expect(INSURANCE_DEFAULTS.riskMultipliers.document).toBeLessThan(
      INSURANCE_DEFAULTS.riskMultipliers.package
    );
  });
});
