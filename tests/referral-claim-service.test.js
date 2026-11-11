import { planReferralClaim } from '../src/utils/referral-claim-service.js';

const REFERRER = { id: 'ref-1' };

describe('planReferralClaim', () => {
  test('refuse un code vide', () => {
    expect(planReferralClaim({ code: '', referrer: REFERRER, referreeId: 'u2' }).reason)
      .toBe('invalid_code');
  });

  test('refuse si le parrain n\'existe pas', () => {
    expect(
      planReferralClaim({ code: 'ABC123', referrer: null, referreeId: 'u2' }).reason
    ).toBe('referrer_not_found');
  });

  test('refuse l\'auto-parrainage', () => {
    expect(
      planReferralClaim({ code: 'ABC', referrer: REFERRER, referreeId: 'ref-1' }).reason
    ).toBe('self_referral_forbidden');
  });

  test('refuse si le filleul est déjà parrainé', () => {
    expect(
      planReferralClaim({
        code: 'ABC',
        referrer: REFERRER,
        referreeId: 'u2',
        existingReferral: { id: 'ex-1' }
      }).reason
    ).toBe('referree_already_referred');
  });

  test('refuse si le parrain a atteint le plafond', () => {
    expect(
      planReferralClaim({
        code: 'ABC',
        referrer: REFERRER,
        referreeId: 'u2',
        referrerSuccessfulReferrals: 20
      }).reason
    ).toBe('referrer_cap_reached');
  });

  test('accepte et retourne le payload prêt à insert', () => {
    const plan = planReferralClaim({
      code: 'ABC123',
      referrer: REFERRER,
      referreeId: 'u2',
      referrerSuccessfulReferrals: 3
    });
    expect(plan.shouldCreate).toBe(true);
    expect(plan.payload).toEqual({
      referrerId: 'ref-1',
      referreeId: 'u2',
      code: 'ABC123',
      status: 'pending'
    });
  });

  test('trim le code', () => {
    const plan = planReferralClaim({
      code: '   ABC123  ',
      referrer: REFERRER,
      referreeId: 'u2'
    });
    expect(plan.payload.code).toBe('ABC123');
  });

  test('respecte le flag enabled=false via config', () => {
    const plan = planReferralClaim(
      { code: 'ABC', referrer: REFERRER, referreeId: 'u2' },
      { config: { enabled: false } }
    );
    expect(plan.shouldCreate).toBe(false);
    expect(plan.reason).toBe('disabled');
  });
});
