/**
 * Devis d'assurance colis — service pur, sans DB.
 *
 * Étant donnés une valeur déclarée et un type de colis, retourne la prime
 * à payer, le plafond d'indemnisation en cas de sinistre, et la liste
 * d'exclusions.
 *
 * V1 déterministe :
 *  - Prime = max(primeMinimum, pourcentage × valeurDéclarée).
 *  - Types « valuable » / « fragile » appliquent un multiplicateur risque.
 *  - Types « perishable » : non assurables (exclusion métier).
 *  - Plafond d'indemnisation = min(valeurDéclarée, cap global).
 *
 * Service pur — l'intégration avec un partenaire réel (ASA Sénégal, NSIA,
 * SUNU) consistera à poser cette prime via leur API et à persister la
 * souscription (hors scope V1).
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  baseRatePercent: 1.5, // 1.5 % de la valeur déclarée
  minimumPremiumXof: 300,
  maxCoverageXof: 2_000_000, // plafond d'indemnisation
  // Multiplicateurs de risque par type de colis.
  riskMultipliers: {
    document: 0.8,
    package: 1.0,
    fragile: 1.6,
    valuable: 2.2,
    perishable: null // non assurable
  },
  // Exclusions standard listées dans le contrat.
  standardExclusions: [
    'war_damage',
    'natural_disaster',
    'inherent_defect',
    'improper_packaging'
  ]
});

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {object} input
 * @param {number} input.declaredValueXof  Valeur déclarée par l'expéditeur.
 * @param {string} input.parcelType        'document' | 'package' | 'fragile' | 'valuable' | 'perishable'
 * @param {boolean} [input.crossBorder]    Transfrontalier → surprime 15 %.
 * @param {object} [options.config]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   premiumXof?: number,
 *   coverageXof?: number,
 *   coverageRate?: number,
 *   exclusions?: string[],
 *   crossBorder?: boolean
 * }}
 */
export function quoteInsurance(
  { declaredValueXof, parcelType, crossBorder = false } = {},
  { config = {} } = {}
) {
  const cfg = {
    ...DEFAULTS,
    ...config,
    riskMultipliers: { ...DEFAULTS.riskMultipliers, ...(config.riskMultipliers || {}) },
    standardExclusions: config.standardExclusions ?? DEFAULTS.standardExclusions
  };

  if (cfg.enabled === false) return { ok: false, reason: 'disabled' };

  if (!isFiniteNumber(declaredValueXof) || declaredValueXof <= 0) {
    return { ok: false, reason: 'invalid_value' };
  }
  if (typeof parcelType !== 'string') {
    return { ok: false, reason: 'invalid_type' };
  }

  const multiplier = cfg.riskMultipliers[parcelType];
  if (multiplier === null) {
    // Type non assurable (ex. perishable).
    return { ok: false, reason: 'type_not_insurable' };
  }
  if (multiplier == null || !isFiniteNumber(multiplier)) {
    return { ok: false, reason: 'unknown_parcel_type' };
  }

  const rawPremium =
    (cfg.baseRatePercent / 100) * declaredValueXof * multiplier * (crossBorder ? 1.15 : 1);
  const premiumXof = Math.max(cfg.minimumPremiumXof, Math.round(rawPremium));

  const coverageXof = Math.min(declaredValueXof, cfg.maxCoverageXof);
  const coverageRate = Number((premiumXof / declaredValueXof).toFixed(4));

  return {
    ok: true,
    premiumXof,
    coverageXof,
    coverageRate,
    crossBorder,
    exclusions: [...cfg.standardExclusions]
  };
}

export const INSURANCE_DEFAULTS = DEFAULTS;
