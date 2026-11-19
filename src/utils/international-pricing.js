/**
 * Tarification internationale sous-régionale (CEDEAO + Mauritanie) —
 * service pur, sans DB.
 *
 * Donnée pour une paire pays (origin → destination), un poids et une
 * devise d'affichage, retourne un devis complet : prix en XOF (devise
 * pivot), prix converti dans la devise d'affichage, supplément douane,
 * et SLA estimé en jours.
 *
 * V1 déterministe : table de tarifs administrée via `SystemConfig` sous
 * les clés `international.countryPairs`, `international.maxWeightKg`,
 * `international.customsSurchargeXof`, `international.exchangeRates` et
 * `international.requiredDocuments`. Les valeurs ci-dessous ne sont que
 * des repères utilisés par les tests unitaires et par
 * `loadInternationalPricingConfig()` lorsque la configuration admin
 * est absente — un `console.warn` est alors émis afin que la supervision
 * détecte l'omission et déclenche un seed.
 *
 * Volontairement simple. Aucun appel douanes réel — on expose le concept
 * et le flux pour les partenariats à venir.
 */

import { prisma } from '../config/prisma.js';

const DEFAULTS = Object.freeze({
  enabled: true,
  // Devise pivot interne. Tous les tarifs sont stockés en XOF.
  pivotCurrency: 'XOF',
  // Taux de change 1 XOF = X devise. Rafraîchir périodiquement.
  exchangeRates: {
    XOF: 1,
    GHS: 0.020, // Ghana cedi
    NGN: 2.6, // Nigeria naira
    MRU: 0.066, // Mauritanie ouguiya
    GMD: 0.11, // Gambie dalasi
    EUR: 0.00152,
    USD: 0.00164
  },
  // Tarifs de base par paire pays (ISO-3166 alpha-2). Format :
  //   `${origin}-${destination}` → { baseFeeXof, pricePerKgXof, slaDays }.
  // La paire inverse est considérée identique (symétrie).
  countryPairs: {
    'SN-SN': { baseFeeXof: 500, pricePerKgXof: 300, slaDays: 1 },
    'SN-ML': { baseFeeXof: 5000, pricePerKgXof: 1200, slaDays: 4 },
    'SN-GN': { baseFeeXof: 4500, pricePerKgXof: 1100, slaDays: 3 },
    'SN-MR': { baseFeeXof: 4000, pricePerKgXof: 1000, slaDays: 2 },
    'SN-GM': { baseFeeXof: 3000, pricePerKgXof: 800, slaDays: 1 },
    'SN-CI': { baseFeeXof: 6000, pricePerKgXof: 1300, slaDays: 4 },
    'SN-BF': { baseFeeXof: 6500, pricePerKgXof: 1400, slaDays: 5 }
  },
  // Supplément douane fixe pour toute paire transfrontalière.
  customsSurchargeXof: 1500,
  // Plafond au-delà duquel on refuse le devis (nécessite transporteur dédié).
  maxWeightKg: 50,
  // Documents requis selon la paire (V1 : liste statique).
  requiredDocuments: {
    default: ['invoice'],
    crossBorder: ['invoice', 'cn22_or_cn23', 'sender_id']
  }
});

const KNOWN_CURRENCIES = new Set(Object.keys(DEFAULTS.exchangeRates));

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function normalizeCountry(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : null;
}

function pairKey(origin, destination) {
  // Canonicalise la paire : on cherche en priorité la paire orientée,
  // puis la paire inversée (symétrie prix).
  return `${origin}-${destination}`;
}

function lookupPair(cfg, origin, destination) {
  const direct = cfg.countryPairs[pairKey(origin, destination)];
  if (direct) return direct;
  const reverse = cfg.countryPairs[pairKey(destination, origin)];
  return reverse ?? null;
}

/**
 * Calcule un devis international.
 *
 * @param {object} input
 * @param {string} input.originCountry  ISO-3166 alpha-2 (ex: 'SN')
 * @param {string} input.destinationCountry
 * @param {number} input.weightKg
 * @param {string} [input.displayCurrency]  Défaut: XOF
 * @param {boolean} [input.declareValue]    Si valeur déclarée → force cn22.
 * @param {object} [options.config]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   priceXof?: number,
 *   priceDisplay?: number,
 *   displayCurrency?: string,
 *   customsSurchargeXof?: number,
 *   crossBorder?: boolean,
 *   slaDays?: number,
 *   requiredDocuments?: string[]
 * }}
 */
export function quoteInternationalShipment({
  originCountry,
  destinationCountry,
  weightKg,
  displayCurrency = 'XOF',
  declareValue = false
} = {}, { config = {} } = {}) {
  const cfg = {
    ...DEFAULTS,
    ...config,
    exchangeRates: { ...DEFAULTS.exchangeRates, ...(config.exchangeRates || {}) },
    countryPairs: { ...DEFAULTS.countryPairs, ...(config.countryPairs || {}) },
    requiredDocuments: { ...DEFAULTS.requiredDocuments, ...(config.requiredDocuments || {}) }
  };

  if (cfg.enabled === false) return { ok: false, reason: 'disabled' };

  const origin = normalizeCountry(originCountry);
  const destination = normalizeCountry(destinationCountry);
  if (!origin || !destination) return { ok: false, reason: 'invalid_country' };

  if (!isFiniteNumber(weightKg) || weightKg <= 0) {
    return { ok: false, reason: 'invalid_weight' };
  }
  if (weightKg > cfg.maxWeightKg) {
    return { ok: false, reason: 'overweight', maxWeightKg: cfg.maxWeightKg };
  }

  const pair = lookupPair(cfg, origin, destination);
  if (!pair) return { ok: false, reason: 'country_pair_not_served' };

  const crossBorder = origin !== destination;

  const basePrice = pair.baseFeeXof + pair.pricePerKgXof * weightKg;
  const customsSurchargeXof = crossBorder ? cfg.customsSurchargeXof : 0;
  const priceXof = Math.round(basePrice + customsSurchargeXof);

  const currency = KNOWN_CURRENCIES.has(displayCurrency) ? displayCurrency : 'XOF';
  const rate = cfg.exchangeRates[currency];
  const priceDisplay = Number((priceXof * rate).toFixed(2));

  const docs = [...(cfg.requiredDocuments[crossBorder ? 'crossBorder' : 'default'] ?? [])];
  if (declareValue && !docs.includes('cn22_or_cn23')) docs.push('cn22_or_cn23');

  return {
    ok: true,
    priceXof,
    priceDisplay,
    displayCurrency: currency,
    customsSurchargeXof,
    crossBorder,
    slaDays: pair.slaDays,
    requiredDocuments: docs
  };
}

export const INTERNATIONAL_PRICING_DEFAULTS = DEFAULTS;
export const SUPPORTED_CURRENCIES = [...KNOWN_CURRENCIES];

/// Clés SystemConfig consommées par la tarification internationale. Toutes
/// sont administrables : une clé absente laisse la valeur par défaut tout en
/// loggant un avertissement explicite (cf. `loadInternationalPricingConfig`).
export const INTERNATIONAL_CONFIG_KEYS = Object.freeze({
  countryPairs: 'international.countryPairs',
  maxWeightKg: 'international.maxWeightKg',
  customsSurchargeXof: 'international.customsSurchargeXof',
  exchangeRates: 'international.exchangeRates',
  requiredDocuments: 'international.requiredDocuments',
  enabled: 'international.enabled'
});

/// Normalise une entrée SystemConfig : les écritures historiques enveloppent
/// parfois la valeur dans `{ value }`, qu'on déballe sans confondre un tableau
/// avec un objet.
function unwrapConfigValue(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return raw.value;
  }
  return raw;
}

/// Lit la configuration internationale depuis `SystemConfig`. En cas de clé
/// manquante, log un warning explicite (plutôt qu'un silence) pour que
/// l'administrateur alimente les clés.
export async function loadInternationalPricingConfig(client = prisma) {
  const keys = Object.values(INTERNATIONAL_CONFIG_KEYS);
  let rows = [];
  try {
    rows = await client.systemConfig.findMany({ where: { key: { in: keys } } });
  } catch (error) {
    console.warn(
      '[international-pricing] Lecture SystemConfig impossible — fallback DEFAULTS. ' +
      `Cause: ${error?.message || error}`
    );
    return DEFAULTS;
  }

  const map = Object.fromEntries(rows.map((row) => [row.key, unwrapConfigValue(row.value)]));
  const missing = keys.filter((k) => map[k] === undefined);
  if (missing.length) {
    console.warn(
      `[international-pricing] Admin config manquante — valeurs par défaut utilisées pour: ${missing.join(', ')}. ` +
      'Exécuter `npm run seed:international` ou configurer via l\'admin.'
    );
  }

  const countryPairs = map[INTERNATIONAL_CONFIG_KEYS.countryPairs];
  const exchangeRates = map[INTERNATIONAL_CONFIG_KEYS.exchangeRates];
  const requiredDocuments = map[INTERNATIONAL_CONFIG_KEYS.requiredDocuments];
  const maxWeightKg = map[INTERNATIONAL_CONFIG_KEYS.maxWeightKg];
  const customsSurchargeXof = map[INTERNATIONAL_CONFIG_KEYS.customsSurchargeXof];
  const enabled = map[INTERNATIONAL_CONFIG_KEYS.enabled];

  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULTS.enabled,
    pivotCurrency: DEFAULTS.pivotCurrency,
    exchangeRates:
      exchangeRates && typeof exchangeRates === 'object' && !Array.isArray(exchangeRates)
        ? exchangeRates
        : DEFAULTS.exchangeRates,
    countryPairs:
      countryPairs && typeof countryPairs === 'object' && !Array.isArray(countryPairs)
        ? countryPairs
        : DEFAULTS.countryPairs,
    customsSurchargeXof: isFiniteNumber(Number(customsSurchargeXof))
      ? Number(customsSurchargeXof)
      : DEFAULTS.customsSurchargeXof,
    maxWeightKg: isFiniteNumber(Number(maxWeightKg))
      ? Number(maxWeightKg)
      : DEFAULTS.maxWeightKg,
    requiredDocuments:
      requiredDocuments && typeof requiredDocuments === 'object' && !Array.isArray(requiredDocuments)
        ? requiredDocuments
        : DEFAULTS.requiredDocuments
  };
}
