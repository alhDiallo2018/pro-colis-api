import {
  generateReferralCode,
  canClaimReferral,
  computeReferralReward,
  REFERRAL_DEFAULTS
} from '../src/utils/referral-rewards.js';

describe('generateReferralCode', () => {
  test('retourne un code de 8 caractères par défaut', () => {
    const code = generateReferralCode('user-123');
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
  });

  test('stable pour un même userId', () => {
    const a = generateReferralCode('user-123');
    const b = generateReferralCode('user-123');
    expect(a).toBe(b);
  });

  test('codes différents pour utilisateurs différents', () => {
    const a = generateReferralCode('user-123');
    const b = generateReferralCode('user-124');
    expect(a).not.toBe(b);
  });

  test('retourne null si userId invalide', () => {
    expect(generateReferralCode(null)).toBeNull();
    expect(generateReferralCode('')).toBeNull();
  });

  test('longueur configurable', () => {
    const code = generateReferralCode('user-123', { length: 6 });
    expect(code).toHaveLength(6);
  });

  test('évite les caractères ambigus (0, O, 1, I, l)', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateReferralCode(`user-${i}`);
      expect(code).not.toMatch(/[0O1Il]/);
    }
  });
});

describe('canClaimReferral — validations', () => {
  test('refuse auto-parrainage', () => {
    const r = canClaimReferral({ referrerId: 'u1', referreeId: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('self_referral_forbidden');
  });

  test('refuse si filleul déjà parrainé', () => {
    const r = canClaimReferral({
      referrerId: 'u1',
      referreeId: 'u2',
      referreeAlreadyReferred: true
    });
    expect(r.reason).toBe('referree_already_referred');
  });

  test('refuse si plafond parrain atteint', () => {
    const r = canClaimReferral({
      referrerId: 'u1',
      referreeId: 'u2',
      referrerSuccessfulReferrals: 20
    });
    expect(r.reason).toBe('referrer_cap_reached');
  });

  test('refuse si ids invalides', () => {
    expect(canClaimReferral({ referrerId: null, referreeId: 'u2' }).reason).toBe('invalid_ids');
  });

  test('accepte quand toutes conditions ok', () => {
    const r = canClaimReferral({
      referrerId: 'u1',
      referreeId: 'u2',
      referrerSuccessfulReferrals: 3,
      referreeAlreadyReferred: false
    });
    expect(r.ok).toBe(true);
  });

  test('respecte le flag enabled=false', () => {
    const r = canClaimReferral(
      { referrerId: 'u1', referreeId: 'u2' },
      { config: { enabled: false } }
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disabled');
  });
});

describe('computeReferralReward', () => {
  test('bonus accordé à la première livraison du filleul', () => {
    const r = computeReferralReward({
      eventType: 'first_delivery',
      referreeSuccessfulDeliveries: 1
    });
    expect(r.ok).toBe(true);
    expect(r.referrerBonusXof).toBe(REFERRAL_DEFAULTS.bonusReferrerXof);
    expect(r.referreeBonusXof).toBe(REFERRAL_DEFAULTS.bonusReferreeXof);
    expect(r.currency).toBe('XOF');
  });

  test('refuse pour un event différent du trigger', () => {
    const r = computeReferralReward({
      eventType: 'signup',
      referreeSuccessfulDeliveries: 0
    });
    expect(r.reason).toBe('event_not_triggering');
  });

  test('refuse si le filleul n\'a pas encore livré', () => {
    const r = computeReferralReward({
      eventType: 'first_delivery',
      referreeSuccessfulDeliveries: 0
    });
    expect(r.reason).toBe('referree_not_eligible_yet');
  });

  test('override des montants via config', () => {
    const r = computeReferralReward(
      { eventType: 'first_delivery', referreeSuccessfulDeliveries: 1 },
      { config: { bonusReferrerXof: 2000, bonusReferreeXof: 1000 } }
    );
    expect(r.referrerBonusXof).toBe(2000);
    expect(r.referreeBonusXof).toBe(1000);
  });

  test('respecte le flag enabled=false', () => {
    const r = computeReferralReward(
      { eventType: 'first_delivery', referreeSuccessfulDeliveries: 1 },
      { config: { enabled: false } }
    );
    expect(r.ok).toBe(false);
  });
});

describe('REFERRAL_DEFAULTS', () => {
  test('plafond raisonnable (max 20 parrainages)', () => {
    expect(REFERRAL_DEFAULTS.maxReferralsPerUser).toBe(20);
  });

  test('bonus en XOF par défaut', () => {
    expect(REFERRAL_DEFAULTS.bonusCurrency).toBe('XOF');
  });
});
