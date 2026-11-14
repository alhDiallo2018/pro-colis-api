import { ValidationError } from './errors.js';

/**
 * Valide l'affectation d'arrêts d'une AdvertisementOffer.
 *
 * Contexte : une offre peut réserver un transport sur un trajet associé à
 * une ligne (DDD / AFTU / Tata). Le couple (boardingStopOrder, dropOffStopOrder)
 * désigne l'arrêt d'embarquement et l'arrêt de descente sur cette ligne.
 *
 * Règles :
 * - Annonce sans transitLineId → les stops doivent rester absents (sinon 422).
 * - Si l'annonce porte un itinéraire explicite (`metadata.itinerary`), les deux
 *   stops sont obligatoires : impossible de laisser le manifeste incomplet.
 * - Les deux ordres doivent exister dans les stops fournis.
 * - boardingStopOrder doit être strictement inférieur à dropOffStopOrder.
 *
 * Renvoie l'objet normalisé `{ boardingStopOrder, dropOffStopOrder }` (valeurs
 * nullables entières) à injecter dans `prisma.advertisementOffer.create`.
 *
 * @param {object} advertisement { transitLineId, metadata }
 * @param {object} body { boardingStopOrder?, dropOffStopOrder? }
 * @param {object} ctx { transitLineStops: Array<{ order: number }> }
 */
export function validateOfferStops(advertisement, body, { transitLineStops = [] } = {}) {
  const boarding = parseStopOrder(body?.boardingStopOrder, 'boardingStopOrder');
  const dropOff = parseStopOrder(body?.dropOffStopOrder, 'dropOffStopOrder');

  const hasBoarding = boarding !== null;
  const hasDropOff = dropOff !== null;

  if (!advertisement?.transitLineId) {
    if (hasBoarding || hasDropOff) {
      throw new ValidationError(
        [{ path: 'boardingStopOrder', message: "Cette annonce n'est pas associée à une ligne : aucun arrêt ne peut être précisé" }]
      );
    }
    return { boardingStopOrder: null, dropOffStopOrder: null };
  }

  const itineraryRequired = Boolean(advertisement?.metadata?.itinerary);
  if (itineraryRequired && (!hasBoarding || !hasDropOff)) {
    const details = [];
    if (!hasBoarding) details.push({ path: 'boardingStopOrder', message: 'Arrêt d\'embarquement requis pour ce trajet' });
    if (!hasDropOff) details.push({ path: 'dropOffStopOrder', message: 'Arrêt de descente requis pour ce trajet' });
    throw new ValidationError(details);
  }

  if (!hasBoarding && !hasDropOff) {
    return { boardingStopOrder: null, dropOffStopOrder: null };
  }

  if (hasBoarding !== hasDropOff) {
    throw new ValidationError(
      [{ path: hasBoarding ? 'dropOffStopOrder' : 'boardingStopOrder', message: 'Les deux arrêts doivent être précisés ensemble' }]
    );
  }

  const knownOrders = new Set(transitLineStops.map((s) => s.order));
  if (!knownOrders.has(boarding)) {
    throw new ValidationError(
      [{ path: 'boardingStopOrder', message: `Arrêt d'embarquement inconnu sur cette ligne (ordre ${boarding})` }]
    );
  }
  if (!knownOrders.has(dropOff)) {
    throw new ValidationError(
      [{ path: 'dropOffStopOrder', message: `Arrêt de descente inconnu sur cette ligne (ordre ${dropOff})` }]
    );
  }

  if (boarding >= dropOff) {
    throw new ValidationError(
      [{ path: 'dropOffStopOrder', message: "L'arrêt de descente doit être postérieur à l'arrêt d'embarquement" }]
    );
  }

  return { boardingStopOrder: boarding, dropOffStopOrder: dropOff };
}

function parseStopOrder(raw, field) {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError([{ path: field, message: `${field} doit être un entier positif` }]);
  }
  return value;
}
