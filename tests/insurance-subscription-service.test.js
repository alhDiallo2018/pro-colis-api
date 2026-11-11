import { planInsuranceSubscription } from '../src/utils/insurance-subscription-service.js';

const GOOD_QUOTE = {
  ok: true,
  premiumXof: 1500,
  coverageXof: 100_000,
  exclusions: ['war_damage']
};

describe('planInsuranceSubscription', () => {
  test('refuse un devis non ok', () => {
    expect(
      planInsuranceSubscription({
        quote: { ok: false, reason: 'type_not_insurable' },
        parcelId: 'p1',
        parcelType: 'perishable',
        declaredValueXof: 10000
      }).reason
    ).toBe('type_not_insurable');
  });

  test('refuse un parcelId vide', () => {
    expect(
      planInsuranceSubscription({
        quote: GOOD_QUOTE,
        parcelId: '',
        parcelType: 'package',
        declaredValueXof: 100_000
      }).reason
    ).toBe('invalid_parcel');
  });

  test('refuse si une souscription active existe déjà', () => {
    const plan = planInsuranceSubscription({
      quote: GOOD_QUOTE,
      parcelId: 'p1',
      parcelType: 'package',
      declaredValueXof: 100_000,
      existingSubscription: { id: 'sub-1', status: 'active' }
    });
    expect(plan.shouldCreate).toBe(false);
    expect(plan.reason).toBe('already_subscribed');
    expect(plan.existing.id).toBe('sub-1');
  });

  test('autorise re-souscription si l\'existante est cancelled', () => {
    const plan = planInsuranceSubscription({
      quote: GOOD_QUOTE,
      parcelId: 'p1',
      parcelType: 'package',
      declaredValueXof: 100_000,
      existingSubscription: { id: 'sub-1', status: 'cancelled' }
    });
    expect(plan.shouldCreate).toBe(true);
  });

  test('construit le payload prêt pour Prisma', () => {
    const plan = planInsuranceSubscription({
      quote: GOOD_QUOTE,
      parcelId: 'p1',
      parcelType: 'package',
      declaredValueXof: 100_000
    });
    expect(plan.shouldCreate).toBe(true);
    expect(plan.payload).toEqual({
      parcelId: 'p1',
      premiumXof: 1500,
      coverageXof: 100_000,
      declaredValueXof: 100_000,
      parcelType: 'package',
      status: 'active',
      exclusions: ['war_damage']
    });
  });

  test('tolère un devis sans exclusions explicites', () => {
    const plan = planInsuranceSubscription({
      quote: { ok: true, premiumXof: 1500, coverageXof: 100_000 },
      parcelId: 'p1',
      parcelType: 'package',
      declaredValueXof: 100_000
    });
    expect(plan.payload.exclusions).toEqual([]);
  });
});
