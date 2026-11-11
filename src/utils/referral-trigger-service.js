/**
 * Déclencheur de bonus parrainage — service pur.
 *
 * Prend un snapshot d'un Referral pending + un compteur de livraisons
 * réussies du filleul, et retourne un plan d'action :
 *   - `shouldTrigger: bool`
 *   - `payload` prêt pour `prisma.referral.update`
 *   - `reward` montants à créditer
 *
 * Volontairement dissocié de la DB : le caller fait les lectures, puis
 * l'écriture si `shouldTrigger === true`. Testable isolément.
 */

import { computeReferralReward } from './referral-rewards.js';

/**
 * @param {object} args
 * @param {object | null} args.referral  Ligne Referral existante pour ce filleul, ou null.
 * @param {number} args.referreeSuccessfulDeliveries
 * @param {object} [options.config]
 * @param {Date} [options.now]
 * @returns {{ shouldTrigger: boolean, payload?: object, reward?: object, reason?: string }}
 */
export function planReferralTrigger(
  { referral, referreeSuccessfulDeliveries = 0 } = {},
  { config = {}, now = new Date() } = {}
) {
  if (!referral) return { shouldTrigger: false, reason: 'no_referral' };
  if (referral.status !== 'pending') {
    return { shouldTrigger: false, reason: 'already_triggered' };
  }

  const reward = computeReferralReward(
    {
      eventType: 'first_delivery',
      referreeSuccessfulDeliveries
    },
    { config }
  );
  if (!reward.ok) return { shouldTrigger: false, reason: reward.reason };

  return {
    shouldTrigger: true,
    reward,
    payload: {
      status: 'triggered',
      triggeredAt: now,
      referrerBonusXof: reward.referrerBonusXof,
      referreeBonusXof: reward.referreeBonusXof
    }
  };
}
