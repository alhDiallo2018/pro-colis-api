import { scoreFraud, FRAUD_SCORING_DEFAULTS } from '../src/utils/fraud-scoring.js';

const now = new Date('2026-11-11T12:00:00.000Z');

function days(n) {
  return new Date(now.getTime() - n * 24 * 3600 * 1000);
}

describe('scoreFraud — compte sain', () => {
  test('retourne safe quand tous les signaux sont neutres', () => {
    const r = scoreFraud({
      accountCreatedAt: days(90),
      totalParcels: 50,
      cancelledParcels: 2,
      recentCancellations: 0,
      hasCancellationDebt: false,
      otpFailures24h: 1,
      distinctDevices: 1
    }, { now });
    expect(r.score).toBe(0);
    expect(r.level).toBe('safe');
    expect(r.flags).toEqual([]);
  });
});

describe('scoreFraud — signaux individuels', () => {
  test('new_account', () => {
    const r = scoreFraud({ accountCreatedAt: days(3) }, { now });
    expect(r.flags).toContain('new_account');
    expect(r.score).toBeGreaterThan(0);
  });

  test('high_cancellation_ratio', () => {
    const r = scoreFraud({
      accountCreatedAt: days(90),
      totalParcels: 10,
      cancelledParcels: 5
    }, { now });
    expect(r.flags).toContain('high_cancellation_ratio');
  });

  test('cancellation_debt_unpaid', () => {
    const r = scoreFraud({ accountCreatedAt: days(90), hasCancellationDebt: true }, { now });
    expect(r.flags).toContain('cancellation_debt_unpaid');
  });

  test('otp_abuse', () => {
    const r = scoreFraud({ accountCreatedAt: days(90), otpFailures24h: 10 }, { now });
    expect(r.flags).toContain('otp_abuse');
  });

  test('multi_devices', () => {
    const r = scoreFraud({ accountCreatedAt: days(90), distinctDevices: 5 }, { now });
    expect(r.flags).toContain('multi_devices');
  });

  test('recent_cancellations_burst', () => {
    const r = scoreFraud({ accountCreatedAt: days(90), recentCancellations: 5 }, { now });
    expect(r.flags).toContain('recent_cancellations_burst');
  });
});

describe('scoreFraud — combinaisons', () => {
  test('compte flambant neuf + dette + OTP = high', () => {
    const r = scoreFraud({
      accountCreatedAt: days(1),
      totalParcels: 5,
      cancelledParcels: 3,
      recentCancellations: 3,
      hasCancellationDebt: true,
      otpFailures24h: 10,
      distinctDevices: 4
    }, { now });
    expect(r.level).toBe('high');
    expect(r.score).toBeGreaterThanOrEqual(75);
  });

  test('score ne dépasse jamais 100', () => {
    const r = scoreFraud({
      accountCreatedAt: days(1),
      totalParcels: 5,
      cancelledParcels: 5,
      recentCancellations: 10,
      hasCancellationDebt: true,
      otpFailures24h: 100,
      distinctDevices: 20
    }, { now });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  test('deux flags légers → low', () => {
    const r = scoreFraud({ accountCreatedAt: days(3), distinctDevices: 5 }, { now });
    expect(r.level).toBe('low');
  });
});

describe('scoreFraud — flag enabled=false', () => {
  test('retourne safe + zéro flag', () => {
    const r = scoreFraud({
      accountCreatedAt: days(1),
      hasCancellationDebt: true,
      otpFailures24h: 100
    }, { config: { enabled: false }, now });
    expect(r.score).toBe(0);
    expect(r.level).toBe('safe');
    expect(r.flags).toEqual([]);
  });
});

describe('scoreFraud — tolérance', () => {
  test('signals vides → safe', () => {
    const r = scoreFraud({}, { now });
    expect(r.score).toBe(0);
    expect(r.level).toBe('safe');
  });

  test('signals null/undefined → safe', () => {
    const r = scoreFraud({
      accountCreatedAt: null,
      totalParcels: null,
      cancelledParcels: null,
      otpFailures24h: null
    }, { now });
    expect(r.level).toBe('safe');
  });
});

describe('FRAUD_SCORING_DEFAULTS', () => {
  test('seuils cohérents (low < medium < high)', () => {
    const t = FRAUD_SCORING_DEFAULTS.flagThresholds;
    expect(t.low).toBeLessThan(t.medium);
    expect(t.medium).toBeLessThan(t.high);
    expect(t.high).toBeLessThanOrEqual(100);
  });
});
