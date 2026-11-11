/**
 * Moteur de recommandation chauffeur — service pur (sans DB).
 *
 * Score une offre (`Bid`) pour un colis donné en combinant cinq critères :
 *  - **price**        : plus bas = meilleur score (relatif aux autres offres).
 *  - **rating**       : note moyenne du chauffeur (0..5).
 *  - **distance**     : proximité par rapport à la zone de départ.
 *  - **punctuality**  : taux de livraisons à l'heure historique (0..1).
 *  - **typeMatch**    : le chauffeur accepte ce type de colis (bool).
 *
 * Chaque critère est normalisé dans [0, 1]. Le score final est une somme
 * pondérée configurable via SystemConfig (`driverScoring.*`).
 *
 * Volontairement déterministe, auditable, sans ML en V1. Si un critère
 * manque de données (ex. pas d'historique de ponctualité), on retombe
 * gracieusement sur une valeur neutre (0.5).
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  weightPrice: 0.30,
  weightRating: 0.25,
  weightDistance: 0.20,
  weightPunctuality: 0.15,
  weightTypeMatch: 0.10,
  // Distance au-delà de laquelle on considère le chauffeur « hors zone ».
  maxDistanceKm: 50,
  // Rating minimum pour garantir un score strictement positif.
  minAcceptableRating: 2.5
});

function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Normalise un prix dans [0, 1] par rapport à la fourchette observée.
 * Prix le plus bas → 1. Prix le plus haut → 0.
 * Si toutes les offres ont le même prix, toutes obtiennent 1.
 */
function normalizePrice(price, minPrice, maxPrice) {
  if (!isFiniteNumber(price)) return 0.5;
  if (maxPrice === minPrice) return 1;
  return clamp(1 - (price - minPrice) / (maxPrice - minPrice), 0, 1);
}

function normalizeRating(rating) {
  if (!isFiniteNumber(rating)) return 0.5;
  return clamp(rating / 5, 0, 1);
}

function normalizeDistance(distanceKm, maxKm) {
  if (!isFiniteNumber(distanceKm)) return 0.5;
  return clamp(1 - distanceKm / maxKm, 0, 1);
}

function normalizePunctuality(onTimeRatio) {
  if (!isFiniteNumber(onTimeRatio)) return 0.5;
  return clamp(onTimeRatio, 0, 1);
}

function normalizeTypeMatch(hasTypeMatch) {
  return hasTypeMatch === true ? 1 : hasTypeMatch === false ? 0 : 0.5;
}

/**
 * Score une liste d'offres. Les scores price sont normalisés **à l'intérieur
 * de la liste** fournie (comparaison inter-offres). Retourne un tableau de
 * mêmes objets avec un champ `score` ajouté (0..100) et `breakdown`.
 *
 * @param {Array<object>} bids
 * @param {object} [options]
 * @param {object} [options.config]
 * @returns {Array<object & { score: number, breakdown: object }>}
 */
export function scoreBids(bids, { config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (!Array.isArray(bids) || bids.length === 0) return [];
  if (cfg.enabled === false) {
    return bids.map((b) => ({ ...b, score: null, breakdown: null }));
  }

  const prices = bids.map((b) => (isFiniteNumber(b.price) ? b.price : null)).filter((p) => p != null);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  return bids.map((b) => {
    const nPrice = normalizePrice(b.price, minPrice, maxPrice);
    const nRating = normalizeRating(b.driverRating);
    const nDistance = normalizeDistance(b.distanceKm, cfg.maxDistanceKm);
    const nPunctuality = normalizePunctuality(b.onTimeRatio);
    const nTypeMatch = normalizeTypeMatch(b.acceptsParcelType);

    const weighted =
      cfg.weightPrice * nPrice +
      cfg.weightRating * nRating +
      cfg.weightDistance * nDistance +
      cfg.weightPunctuality * nPunctuality +
      cfg.weightTypeMatch * nTypeMatch;

    // Filtre souple : chauffeur très mal noté → score réduit, pas éliminé.
    const ratingPenalty =
      isFiniteNumber(b.driverRating) && b.driverRating < cfg.minAcceptableRating
        ? 0.6
        : 1;

    const finalScore = Math.round(weighted * ratingPenalty * 100);

    return {
      ...b,
      score: finalScore,
      breakdown: {
        price: Number(nPrice.toFixed(3)),
        rating: Number(nRating.toFixed(3)),
        distance: Number(nDistance.toFixed(3)),
        punctuality: Number(nPunctuality.toFixed(3)),
        typeMatch: Number(nTypeMatch.toFixed(3)),
        ratingPenalty
      }
    };
  });
}

/**
 * Tri décroissant par score (meilleure offre en premier).
 */
export function rankBids(bids, options) {
  return scoreBids(bids, options).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export const DRIVER_SCORING_DEFAULTS = DEFAULTS;
