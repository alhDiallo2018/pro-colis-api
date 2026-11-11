/**
 * Enregistrement d'une revendication de parrainage — service pur.
 *
 * Le caller (controller) fait les lectures DB nécessaires :
 *  - user avec `referralCode` ∈ code → c'est le parrain
 *  - existingReferral avec `referreeId` = user courant → pour l'idempotence
 *
 * Cette fonction applique les règles métier (`referral-rewards.js`) et
 * retourne un plan d'action :
 *   - `shouldCreate: bool`
 *   - `payload` (prêt à `prisma.referral.create`)
 *   - `reason` en cas de refus
 *
 * Volontairement sans accès DB — teste la logique métier isolément.
 */

import { canClaimReferral } from './referral-rewards.js';

/**
 * @param {object} args
 * @param {string} args.code                  Code de parrainage saisi par le filleul.
 * @param {object | null} args.referrer       Utilisateur matching le code, ou null.
 * @param {string} args.referreeId            Utilisateur courant.
 * @param {object | null} args.existingReferral  Ligne Referral existante où referreeId = user.
 * @param {number} args.referrerSuccessfulReferrals
 * @param {object} [options.config]
 * @returns {{ shouldCreate: boolean, payload?: object, reason?: string }}
 */
export function planReferralClaim(
  {
    code,
    referrer,
    referreeId,
    existingReferral = null,
    referrerSuccessfulReferrals = 0
  } = {},
  { config = {} } = {}
) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { shouldCreate: false, reason: 'invalid_code' };
  }
  if (!referrer || typeof referrer.id !== 'string') {
    return { shouldCreate: false, reason: 'referrer_not_found' };
  }

  const decision = canClaimReferral(
    {
      referrerId: referrer.id,
      referreeId,
      referrerSuccessfulReferrals,
      referreeAlreadyReferred: !!existingReferral
    },
    { config }
  );
  if (!decision.ok) return { shouldCreate: false, reason: decision.reason };

  return {
    shouldCreate: true,
    payload: {
      referrerId: referrer.id,
      referreeId,
      code: code.trim(),
      status: 'pending'
    }
  };
}
