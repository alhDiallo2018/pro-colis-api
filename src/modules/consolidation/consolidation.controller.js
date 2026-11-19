/**
 * Consolidation / backhaul matching — endpoint driver.
 *
 * Consomme le service pur `matchCompatibleParcels` (voir
 * `src/utils/consolidation-matcher.js`) sur des données réelles :
 *  - L'annonce chauffeur fournit le trajet (zones départ / arrivée) et la
 *    capacité restante (availableWeight moins la somme des offres déjà
 *    acceptées sur cette annonce).
 *  - Les candidats sont les colis `pending` / `free` récents (≤ 14 jours) avec
 *    leurs zones de retrait / livraison.
 *
 * Aucune persistance : la route retourne uniquement la liste triée des
 * correspondances compatibles et un extrait des rejetés pour debug.
 */
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { matchCompatibleParcels } from '../../utils/consolidation-matcher.js';
import { NotFoundError, ForbiddenError } from '../../utils/errors.js';

const PARCEL_LOOKBACK_DAYS = 14;
const PARCEL_LIMIT = 100;
const REJECTED_PREVIEW_LIMIT = 20;
const ADOPTABLE_STATUSES = ['pending', 'free'];

function toNumber(decimalLike) {
  if (decimalLike === null || decimalLike === undefined) return null;
  const n = Number(decimalLike);
  return Number.isFinite(n) ? n : null;
}

function zoneToPoint(zone) {
  if (!zone) return null;
  const latitude = toNumber(zone.latitude);
  const longitude = toNumber(zone.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

/**
 * GET /drivers/backhaul-matches/:advertisementId
 *
 * Accès : le driver propriétaire de l'annonce ou un shuttle_operator.
 */
export async function listBackhaulMatches(req, res, next) {
  try {
    const { advertisementId } = req.params;

    const advertisement = await prisma.advertisement.findUnique({
      where: { id: advertisementId },
      include: {
        departureZone: true,
        arrivalZone: true,
        offers: {
          where: { status: 'accepted' },
          include: { parcel: { select: { id: true, weight: true, status: true } } }
        }
      }
    });

    if (!advertisement) {
      throw new NotFoundError('Annonce introuvable');
    }

    const user = req.user;
    const isOwner = advertisement.driverId === user.id;
    const isShuttleOperator = user.role === 'shuttle_operator';
    if (!isOwner && !isShuttleOperator) {
      throw new ForbiddenError('Accès refusé à cette annonce');
    }

    const departure = zoneToPoint(advertisement.departureZone);
    const arrival = zoneToPoint(advertisement.arrivalZone);

    // Capacité restante : availableWeight moins la somme des poids des colis
    // déjà adossés via des offres acceptées. Si availableWeight est manquant,
    // on laisse remainingWeightKg à null : le matcher ne filtrera alors pas
    // sur le poids (hard filter 2 est no-op quand la valeur n'est pas finie).
    const capacity = toNumber(advertisement.availableWeight);
    const usedWeight = (advertisement.offers || []).reduce((sum, offer) => {
      const w = toNumber(offer.parcel?.weight);
      return sum + (w && offer.parcel && !['cancelled', 'delivered'].includes(offer.parcel.status) ? w : 0);
    }, 0);
    const remainingWeightKg = capacity !== null ? Math.max(0, capacity - usedWeight) : null;

    const trip = {
      departure: departure || { latitude: null, longitude: null },
      arrival: arrival || { latitude: null, longitude: null },
      remainingWeightKg
    };

    const since = new Date(Date.now() - PARCEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const rawParcels = await prisma.parcel.findMany({
      where: {
        status: { in: ADOPTABLE_STATUSES },
        createdAt: { gte: since },
        deletedAt: null
      },
      include: {
        departureZone: true,
        arrivalZone: true
      },
      orderBy: { createdAt: 'desc' },
      take: PARCEL_LIMIT
    });

    const parcels = rawParcels.map((p) => ({
      id: p.id,
      status: p.status,
      weightKg: toNumber(p.weight) ?? 0,
      pickupZone: zoneToPoint(p.departureZone) || {},
      dropoffZone: zoneToPoint(p.arrivalZone) || {},
      // Champs utiles pour l'UI (pas consommés par le matcher).
      trackingNumber: p.trackingNumber,
      senderName: p.senderName,
      price: toNumber(p.price),
      createdAt: p.createdAt
    }));

    const results = matchCompatibleParcels({ trip, parcels });

    const matches = results
      .filter((r) => r.compatible)
      .sort((a, b) => b.score - a.score);
    const rejected = results.filter((r) => !r.compatible).slice(0, REJECTED_PREVIEW_LIMIT);

    return res.json({
      ok: true,
      data: {
        matches,
        rejected
      }
    });
  } catch (error) {
    logger.warn(
      { err: error, advertisementId: req.params?.advertisementId, userId: req.user?.id },
      'listBackhaulMatches failed'
    );
    return next(error);
  }
}
