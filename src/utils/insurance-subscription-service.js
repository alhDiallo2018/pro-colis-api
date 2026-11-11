/**
 * Préparation d'une souscription d'assurance colis — service pur.
 *
 * Prend un devis déjà calculé par `insurance-quote.js` et retourne le
 * payload prêt à être inséré via Prisma. Jamais d'accès DB ici — les
 * lectures/écritures sont assurées par le controller.
 *
 * Idempotence : si une souscription active existe pour le colis, on
 * refuse. Le caller peut, s'il le souhaite, annuler l'ancienne (`status:
 * 'cancelled'`) avant de resouscrire.
 */

/**
 * @param {object} args
 * @param {{ ok: boolean, premiumXof?: number, coverageXof?: number, exclusions?: string[] }} args.quote
 * @param {string} args.parcelId
 * @param {string} args.parcelType
 * @param {number} args.declaredValueXof
 * @param {object | null} [args.existingSubscription]
 * @returns {{ shouldCreate: boolean, payload?: object, reason?: string }}
 */
export function planInsuranceSubscription({
  quote,
  parcelId,
  parcelType,
  declaredValueXof,
  existingSubscription = null
} = {}) {
  if (!quote || quote.ok !== true) {
    return { shouldCreate: false, reason: quote?.reason ?? 'invalid_quote' };
  }
  if (typeof parcelId !== 'string' || parcelId.length === 0) {
    return { shouldCreate: false, reason: 'invalid_parcel' };
  }
  if (existingSubscription && existingSubscription.status === 'active') {
    return {
      shouldCreate: false,
      reason: 'already_subscribed',
      existing: { id: existingSubscription.id }
    };
  }

  return {
    shouldCreate: true,
    payload: {
      parcelId,
      premiumXof: quote.premiumXof,
      coverageXof: quote.coverageXof,
      declaredValueXof,
      parcelType,
      status: 'active',
      exclusions: Array.isArray(quote.exclusions) ? quote.exclusions : []
    }
  };
}
