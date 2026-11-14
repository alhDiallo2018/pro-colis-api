/**
 * Optimiseur de tournée — service pur (sans DB, sans Prisma).
 *
 * Entrée : une liste de points (dépôt + arrêts à visiter) avec coordonnées
 * GPS. Sortie : un ordre de visite minimisant la distance totale parcourue.
 *
 * Heuristique :
 *  1. Nearest-Neighbor au départ du dépôt (`origin`).
 *  2. Amélioration par 2-opt (échange de deux arêtes) : passe répétée tant
 *     qu'un échange réduit la distance totale, plafonné par `maxIterations`.
 *
 * Objectif : solution raisonnable (~5-15 % au-dessus de l'optimum TSP) en
 * quelques millisecondes pour N ≤ 30 arrêts, ce qui couvre une tournée
 * urbaine typique. Pas de preuve d'optimalité ; pas de contraintes de
 * fenêtres de temps ou de capacité (hors scope V1).
 */

const DEFAULTS = Object.freeze({
  // Nombre max de passes 2-opt avant d'abandonner la recherche d'amélioration.
  maxIterations: 50,
  // Si `true`, la tournée revient au dépôt en fin de course (cycle hamiltonien).
  returnToOrigin: false
});

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function isValidPoint(p) {
  return p != null &&
    typeof p.latitude === 'number' && Number.isFinite(p.latitude) &&
    typeof p.longitude === 'number' && Number.isFinite(p.longitude);
}

function routeDistanceKm(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineKm(route[i - 1], route[i]);
  }
  return total;
}

function nearestNeighbor(origin, stops) {
  const route = [origin];
  const remaining = stops.slice();
  let cursor = origin;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cursor, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    cursor = remaining[bestIndex];
    route.push(cursor);
    remaining.splice(bestIndex, 1);
  }
  return route;
}

function twoOpt(initialRoute, { maxIterations }) {
  let route = initialRoute.slice();
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations += 1;
    // On ne touche pas au dépôt (index 0).
    for (let i = 1; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        // Distance avant/après échange des arêtes (i-1, i) et (k, k+1).
        const a = route[i - 1];
        const b = route[i];
        const c = route[k];
        const d = route[k + 1]; // peut être undefined si fin de route
        const before = haversineKm(a, b) + (d ? haversineKm(c, d) : 0);
        const after = haversineKm(a, c) + (d ? haversineKm(b, d) : 0);
        if (after + 1e-9 < before) {
          const reversed = route.slice(i, k + 1).reverse();
          route = [...route.slice(0, i), ...reversed, ...route.slice(k + 1)];
          improved = true;
        }
      }
    }
  }
  return { route, iterations };
}

/**
 * @param {object} input
 * @param {{latitude: number, longitude: number, id?: string, label?: string}} input.origin
 * @param {Array<{latitude: number, longitude: number, id?: string, label?: string}>} input.stops
 * @param {object} [input.config]
 * @returns {{
 *   ordered: Array<any>,
 *   distanceKm: number,
 *   improvedBy: number,
 *   iterations: number
 * }}
 */
export function optimizeTour({ origin, stops = [], config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (!isValidPoint(origin)) {
    throw new Error('optimizeTour: origin invalide');
  }
  const valid = stops.filter(isValidPoint);
  if (!valid.length) {
    return { ordered: [], distanceKm: 0, improvedBy: 0, iterations: 0 };
  }

  // 2-opt opère sur [origin, ...stops] (open path). `returnToOrigin` est
  // appliqué uniquement à la distance mesurée, jamais à l'ordre retourné.
  const nnRoute = nearestNeighbor(origin, valid);
  const nnDistance = routeDistanceKm(nnRoute) + (cfg.returnToOrigin ? haversineKm(nnRoute.at(-1), origin) : 0);

  const { route: optimized, iterations } = twoOpt(nnRoute, { maxIterations: cfg.maxIterations });
  const optimizedDistance = routeDistanceKm(optimized) + (cfg.returnToOrigin ? haversineKm(optimized.at(-1), origin) : 0);

  // Ordre exposé : les arrêts sans l'origine (ni au début, ni en répétition finale).
  const ordered = optimized.slice(1);

  return {
    ordered,
    distanceKm: Number(optimizedDistance.toFixed(3)),
    improvedBy: Number((nnDistance - optimizedDistance).toFixed(3)),
    iterations
  };
}

export const TOUR_OPTIMIZER_DEFAULTS = DEFAULTS;
