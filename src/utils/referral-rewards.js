/**
 * Parrainage & fidélité — service pur, sans DB.
 *
 * Trois fonctions :
 *  - `generateReferralCode(userId)`  : code court, stable, dérivé de l'userId.
 *  - `computeReferralReward(signals)`: montant du bonus accordé au parrain
 *    et au filleul, et flags anti-abus.
 *  - `canClaimReferral(signals)`     : peut-on encore enregistrer un
 *    parrainage pour cet utilisateur (plafond, auto-parrainage).
 *
 * V1 déterministe. Les règles sont configurables via SystemConfig
 * (`referral.*`). La persistence (code → user, claim history) est à faire
 * dans un module séparé — ici on n'expose que la logique métier.
 */

import { createHash } from 'node:crypto';

const DEFAULTS = Object.freeze({
  enabled: true,
  codeLength: 8,
  bonusReferrerXof: 1000,
  bonusReferreeXof: 500,
  maxReferralsPerUser: 20,
  minReferreeDeliveriesBeforeReward: 1,
  bonusCurrency: 'XOF',
  // Seul le premier colis livré du filleul déclenche le bonus.
  triggerEventType: 'first_delivery'
});

/**
 * Code de parrainage dérivé de l'userId : court, lisible, stable. L'absence
 * d'aléatoire garantit qu'un utilisateur ne peut pas en changer sans que le
 * serveur le régénère volontairement. Pas de collision pratique sur 8 car.
 *
 * @param {string} userId
 * @param {object} [options]
 * @param {number} [options.length]
 */
export function generateReferralCode(userId, { length = DEFAULTS.codeLength } = {}) {
  if (typeof userId !== 'string' || userId.length === 0) return null;
  const hash = createHash('sha256').update('procolis-referral:' + userId).digest('base64url');
  // Retire les caractères ambigus (0/O, 1/l/I) pour lisibilité humaine.
  // Deux passes : avant toUpperCase pour attraper les variantes minuscules,
  // après pour les variantes majuscules nées de toUpperCase.
  const clean = hash
    .replace(/[0OIl1_\-]/g, '')
    .toUpperCase()
    .replace(/[0OI1]/g, '');
  return clean.slice(0, length);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Peut-on enregistrer un parrainage pour cet utilisateur maintenant ?
 *
 * @param {object} signals
 * @param {string} signals.referrerId
 * @param {string} signals.referreeId
 * @param {number} signals.referrerSuccessfulReferrals
 * @param {boolean} signals.referreeAlreadyReferred
 * @param {object} [options.config]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canClaimReferral(signals = {}, { config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (cfg.enabled === false) return { ok: false, reason: 'disabled' };

  if (typeof signals.referrerId !== 'string' || typeof signals.referreeId !== 'string') {
    return { ok: false, reason: 'invalid_ids' };
  }
  if (signals.referrerId === signals.referreeId) {
    return { ok: false, reason: 'self_referral_forbidden' };
  }
  if (signals.referreeAlreadyReferred === true) {
    return { ok: false, reason: 'referree_already_referred' };
  }
  if (
    isFiniteNumber(signals.referrerSuccessfulReferrals) &&
    signals.referrerSuccessfulReferrals >= cfg.maxReferralsPerUser
  ) {
    return { ok: false, reason: 'referrer_cap_reached' };
  }

  return { ok: true };
}

/**
 * Calcule les montants à créditer au parrain et au filleul.
 *
 * @param {object} signals
 * @param {string} signals.eventType  ex: 'first_delivery' ou 'signup'
 * @param {number} signals.referreeSuccessfulDeliveries
 * @param {object} [options.config]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   referrerBonusXof?: number,
 *   referreeBonusXof?: number,
 *   currency?: string
 * }}
 */
export function computeReferralReward(signals = {}, { config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (cfg.enabled === false) return { ok: false, reason: 'disabled' };

  if (signals.eventType !== cfg.triggerEventType) {
    return { ok: false, reason: 'event_not_triggering' };
  }

  if (
    !isFiniteNumber(signals.referreeSuccessfulDeliveries) ||
    signals.referreeSuccessfulDeliveries < cfg.minReferreeDeliveriesBeforeReward
  ) {
    return { ok: false, reason: 'referree_not_eligible_yet' };
  }

  return {
    ok: true,
    referrerBonusXof: cfg.bonusReferrerXof,
    referreeBonusXof: cfg.bonusReferreeXof,
    currency: cfg.bonusCurrency
  };
}

export const REFERRAL_DEFAULTS = DEFAULTS;
