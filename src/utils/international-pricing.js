/**
 * Tarification internationale sous-régionale (CEDEAO + Mauritanie) —
 * service pur, sans DB.
 *
 * Donnée pour une paire pays (origin → destination), un poids et une
 * devise d'affichage, retourne un devis complet : prix en XOF (devise
 * pivot), prix converti dans la devise d'affichage, supplément douane,
 * et SLA estimé en jours.
 *
 * V1 déterministe : table de tarifs en dur (configurables via
 * SystemConfig), taux de change figés dans un sous-dictionnaire (à
 * rafraîchir manuellement par un admin ou via un cron V2 branché sur
 * une source officielle).
 *
 * Volontairement simple. Aucun appel douanes réel — on expose le concept
 * et le flux pour les partenariats à venir.
 */

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
