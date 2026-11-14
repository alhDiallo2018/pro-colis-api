/**
 * Abstraction carriers internationaux — service pur (sans DB, sans API externe).
 *
 * Expose une interface commune `estimateShipping({ origin, destination, parcel })`
 * → `{ offers: [{ carrier, service, priceXof, etaDays, confidence }] }`.
 *
 * Chaque carrier est un plugin isolé (fonction pure) ajouté à la liste
 * `CARRIERS`. V1 : un seul carrier stub basé sur un barème de zones pour
 * valider le contrat. Les intégrations réelles (DHL, FedEx, UPS) viendront
 * en V2 via leurs API respectives, en respectant la même signature.
 *
 * Volontairement local et fire-and-forget : aucune dépendance HTTP ici. Un
 * carrier qui dépend d'une API externe doit gérer ses propres timeouts et
 * retomber sur `null` en cas d'échec — l'orchestrateur agrège les offres
 * non nulles.
 */

const ISO2 = /^[A-Z]{2}$/;

/**
 * Zones pays simplifiées (CEDEAO / Afrique / Europe / Amérique / Asie).
 * Sert de proxy pour les tarifs stub. Les intégrations réelles DHL/FedEx
 * remplaceront cette heuristique par leur API officielle.
 */
const ZONE_BY_COUNTRY = Object.freeze({
  // CEDEAO (~ouest-africaine)
  SN: 'cedeao', ML: 'cedeao', BF: 'cedeao', GN: 'cedeao', CI: 'cedeao',
  TG: 'cedeao', BJ: 'cedeao', NE: 'cedeao', GW: 'cedeao', GM: 'cedeao',
  LR: 'cedeao', SL: 'cedeao', NG: 'cedeao', CV: 'cedeao',
  // Afrique hors CEDEAO
  MA: 'africa', DZ: 'africa', TN: 'africa', EG: 'africa',
  CM: 'africa', GA: 'africa', CG: 'africa', CD: 'africa',
  ZA: 'africa', KE: 'africa', ET: 'africa', GH: 'africa',
  // Europe
  FR: 'europe', BE: 'europe', DE: 'europe', ES: 'europe', IT: 'europe',
  GB: 'europe', NL: 'europe', PT: 'europe', CH: 'europe', LU: 'europe',
  // Amériques
  US: 'america', CA: 'america', BR: 'america',
  // Asie
  CN: 'asia', IN: 'asia', JP: 'asia', AE: 'asia', TR: 'asia'
});

function zoneOf(country) {
  if (!country || !ISO2.test(country)) return 'other';
  return ZONE_BY_COUNTRY[country] ?? 'other';
}

/**
 * Niveau de confiance d'une offre en fonction de la qualité des données
 * disponibles pour un corridor. CEDEAO = barème interne calibré sur les
 * corridors où nous opérons réellement ; autres zones catalogues = barème
 * approximatif ; `other` = extrapolation large.
 *
 * Reste à remplacer par `'live'` lorsqu'une intégration API carrier (DHL,
 * FedEx, UPS) répond en temps réel et renvoie un prix contractuel.
 */
function corridorConfidence(originZone, destinationZone) {
  if (originZone === 'cedeao' && destinationZone === 'cedeao') return 'high';
  if (originZone === 'other' || destinationZone === 'other') return 'low';
  return 'medium';
}

function validateInput({ origin, destination, parcel } = {}) {
  const errors = [];
  if (!origin || !ISO2.test(origin)) errors.push('origin invalide (ISO-2 attendu)');
  if (!destination || !ISO2.test(destination)) errors.push('destination invalide (ISO-2 attendu)');
  const weight = Number(parcel?.weightKg ?? parcel?.weight ?? 0);
  if (!Number.isFinite(weight) || weight <= 0) errors.push('weightKg > 0 requis');
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.code = 'INVALID_CARRIER_INPUT';
    throw err;
  }
  return { origin, destination, weightKg: weight };
}

/**
 * Barème DHL-like : tarif = baseByZone + perKgByZone * weightKg.
 * La confiance reflète la qualité des données du corridor (voir
 * `corridorConfidence`) — `'live'` sera retourné quand l'intégration API
 * contractuelle sera branchée.
 */
function dhlStub({ origin, destination, weightKg }) {
  const srcZone = zoneOf(origin);
  const dstZone = zoneOf(destination);
  const base = { cedeao: 3500, africa: 8000, europe: 18000, america: 28000, asia: 25000, other: 35000 };
  const perKg = { cedeao: 800, africa: 1500, europe: 3500, america: 5000, asia: 4500, other: 6000 };
  const eta = { cedeao: 3, africa: 5, europe: 7, america: 10, asia: 12, other: 14 };
  const priceXof = Math.round((base[dstZone] ?? base.other) + (perKg[dstZone] ?? perKg.other) * weightKg);
  return {
    carrier: 'dhl',
    service: 'international_standard',
    priceXof,
    etaDays: eta[dstZone] ?? eta.other,
    originZone: srcZone,
    destinationZone: dstZone,
    confidence: corridorConfidence(srcZone, dstZone)
  };
}

/**
 * Variante économique (moins chère, plus lente). Même règle de confiance que
 * `dhlStub` : la qualité du corridor détermine la fiabilité du prix.
 */
function economyStub({ origin, destination, weightKg }) {
  const srcZone = zoneOf(origin);
  const dstZone = zoneOf(destination);
  const base = { cedeao: 2500, africa: 6000, europe: 14000, america: 22000, asia: 20000, other: 28000 };
  const perKg = { cedeao: 600, africa: 1100, europe: 2800, america: 4000, asia: 3500, other: 4800 };
  const eta = { cedeao: 5, africa: 8, europe: 12, america: 18, asia: 20, other: 25 };
  return {
    carrier: 'economy_partner',
    service: 'international_economy',
    priceXof: Math.round((base[dstZone] ?? base.other) + (perKg[dstZone] ?? perKg.other) * weightKg),
    etaDays: eta[dstZone] ?? eta.other,
    originZone: srcZone,
    destinationZone: dstZone,
    confidence: corridorConfidence(srcZone, dstZone)
  };
}

const CARRIERS = [dhlStub, economyStub];

/**
 * Agrège les offres de tous les carriers configurés. Les carriers qui lèvent
 * sont ignorés (robustesse). Les offres sont triées par prix croissant.
 *
 * @param {object} input
 * @param {string} input.origin ISO-2
 * @param {string} input.destination ISO-2
 * @param {{weightKg?: number, weight?: number}} input.parcel
 * @returns {{ offers: Array, acceptedCarriers: number }}
 */
export function estimateShipping(input) {
  const normalized = validateInput(input);
  const offers = [];
  for (const carrier of CARRIERS) {
    try {
      const o = carrier(normalized);
      if (o && Number.isFinite(o.priceXof) && o.priceXof > 0) offers.push(o);
    } catch { /* carrier silencé */ }
  }
  offers.sort((a, b) => a.priceXof - b.priceXof);
  return { offers, acceptedCarriers: CARRIERS.length };
}

export { zoneOf as _zoneOf, corridorConfidence as _corridorConfidence };
export const CARRIER_ZONES = ZONE_BY_COUNTRY;
