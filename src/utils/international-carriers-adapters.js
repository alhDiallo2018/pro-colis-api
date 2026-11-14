/**
 * Adapters carriers réels — squelettes contractuels (SCP-042).
 *
 * Chaque adapter expose `estimate({ origin, destination, weightKg })` →
 * `{ carrier, service, priceXof, etaDays, confidence }` ou null en cas d'échec.
 * L'interface est volontairement identique à celle des stubs
 * `international-carriers.js` pour que l'orchestrateur n'ait rien à changer :
 * il suffit d'enregistrer un adapter réel à la place d'un stub quand les
 * credentials sont posés.
 *
 * Les implémentations HTTP réelles (DHL Express, FedEx Open Ship, UPS
 * Rating API) viendront en V2. Ici on fournit :
 *   1. La signature attendue (`estimate` async, mêmes arguments).
 *   2. Les variables d'environnement requises (documentées dans `envVars`).
 *   3. Une méthode `isConfigured()` qui vérifie la présence des secrets.
 *   4. Une bascule douce : `isConfigured() = false` → l'adapter renvoie null
 *      et l'orchestrateur utilisera les stubs comme fallback.
 */

export const DHL_ADAPTER = Object.freeze({
  carrier: 'dhl',
  envVars: Object.freeze(['DHL_API_KEY', 'DHL_API_SECRET', 'DHL_ACCOUNT_NUMBER']),
  isConfigured() {
    return DHL_ADAPTER.envVars.every((k) => typeof process.env[k] === 'string' && process.env[k].length > 0);
  },
  async estimate(/* { origin, destination, weightKg } */) {
    if (!DHL_ADAPTER.isConfigured()) return null;
    // TODO V2 : POST https://api-eu.dhl.com/mydhlapi/rates avec AuthBasic.
    // Doit mapper la réponse DHL vers { carrier, service, priceXof, etaDays, confidence: 'live' }.
    throw new Error('DHL adapter : implémentation HTTP non livrée (V2).');
  }
});

export const FEDEX_ADAPTER = Object.freeze({
  carrier: 'fedex',
  envVars: Object.freeze(['FEDEX_API_KEY', 'FEDEX_SECRET_KEY', 'FEDEX_ACCOUNT_NUMBER']),
  isConfigured() {
    return FEDEX_ADAPTER.envVars.every((k) => typeof process.env[k] === 'string' && process.env[k].length > 0);
  },
  async estimate() {
    if (!FEDEX_ADAPTER.isConfigured()) return null;
    // TODO V2 : POST https://apis.fedex.com/rate/v1/rates/quotes avec OAuth2 client_credentials.
    throw new Error('FedEx adapter : implémentation HTTP non livrée (V2).');
  }
});

export const UPS_ADAPTER = Object.freeze({
  carrier: 'ups',
  envVars: Object.freeze(['UPS_CLIENT_ID', 'UPS_CLIENT_SECRET', 'UPS_ACCOUNT_NUMBER']),
  isConfigured() {
    return UPS_ADAPTER.envVars.every((k) => typeof process.env[k] === 'string' && process.env[k].length > 0);
  },
  async estimate() {
    if (!UPS_ADAPTER.isConfigured()) return null;
    // TODO V2 : POST https://wwwcie.ups.com/api/rating/v1/Rate avec Bearer OAuth2.
    throw new Error('UPS adapter : implémentation HTTP non livrée (V2).');
  }
});

export const REAL_CARRIER_ADAPTERS = Object.freeze([DHL_ADAPTER, FEDEX_ADAPTER, UPS_ADAPTER]);

/**
 * Snapshot de configuration pour l'endpoint /health/integrations.
 * Ne divulgue pas les valeurs des secrets, uniquement leur présence.
 */
export function carriersConfigurationReport() {
  return REAL_CARRIER_ADAPTERS.map((a) => ({
    carrier: a.carrier,
    configured: a.isConfigured(),
    missing: a.envVars.filter((k) => !process.env[k])
  }));
}
