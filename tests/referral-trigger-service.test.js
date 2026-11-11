import { planReferralTrigger } from '../src/utils/referral-trigger-service.js';

describe('planReferralTrigger', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  test('refuse si aucun Referral existant', () => {
    const r = planReferralTrigger({ referral: null, referreeSuccessfulDeliveries: 1 }, { now });
    expect(r.shouldTrigger).toBe(false);
    expect(r.reason).toBe('no_referral');
  });

  test('refuse si le Referral est déjà triggered', () => {
    const r = planReferralTrigger(
      { referral: { status: 'triggered' }, referreeSuccessfulDeliveries: 1 },
      { now }
    );
    expect(r.reason).toBe('already_triggered');
  });

  test('refuse si le filleul n\'a pas encore livré', () => {
    const r = planReferralTrigger(
      { referral: { status: 'pending' }, referreeSuccessfulDeliveries: 0 },
      { now }
    );
    expect(r.reason).toBe('referree_not_eligible_yet');
  });

  test('déclenche à la première livraison : payload + reward', () => {
    const r = planReferralTrigger(
      { referral: { id: 'r1', status: 'pending' }, referreeSuccessfulDeliveries: 1 },
      { now }
    );
    expect(r.shouldTrigger).toBe(true);
    expect(r.payload.status).toBe('triggered');
    expect(r.payload.triggeredAt).toBe(now);
    expect(r.payload.referrerBonusXof).toBeGreaterThan(0);
    expect(r.payload.referreeBonusXof).toBeGreaterThan(0);
    expect(r.reward.ok).toBe(true);
  });

  test('respecte flag enabled=false', () => {
    const r = planReferralTrigger(
      { referral: { status: 'pending' }, referreeSuccessfulDeliveries: 1 },
      { now, config: { enabled: false } }
    );
    expect(r.shouldTrigger).toBe(false);
  });

  test('override des montants via config', () => {
    const r = planReferralTrigger(
      { referral: { status: 'pending' }, referreeSuccessfulDeliveries: 1 },
      { now, config: { bonusReferrerXof: 3000, bonusReferreeXof: 1500 } }
    );
    expect(r.payload.referrerBonusXof).toBe(3000);
    expect(r.payload.referreeBonusXof).toBe(1500);
  });
});
