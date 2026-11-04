/**
 * Catalogue public des lignes de bus (DDD / AFTU) + recherche d'arrêts
 * et exposition des voyages actifs (Advertisement + GPS) par ligne.
 * Lecture seule : les lignes sont alimentées par le seed `seed-transit.js`.
 */
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { ValidationError, NotFoundError, normalizeError } from '../../utils/errors.js';

const LIVE_TTL_MS = 10 * 60 * 1000;

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.warn?.({ error, action, userId: req.user?.id }, `Transit endpoint failed: ${action}`);
      return fail(res, {
        status: normalized?.statusCode || 500,
        message: normalized?.publicMessage || (env.NODE_ENV === 'production' ? 'Opération impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || [],
      });
    }
  };
}

function serializeLine(line, { withStops = false } = {}) {
  return {
    id: line.id,
    operator: line.operator,
    number: line.number,
    direction: line.direction,
    name: line.name,
    origin: line.origin,
    destination: line.destination,
    ...(withStops ? {
      stops: (line.stops ?? []).map(s => ({
        order: s.order,
        label: s.label,
        zoneId: s.zoneId,
        zone: s.zone && {
          id: s.zone.id, name: s.zone.name,
          latitude: Number(s.zone.latitude), longitude: Number(s.zone.longitude),
          status: s.zone.status,
        },
      })),
    } : {}),
  };
}

export const listTransitLines = handle('transit.lines.list', async (req, res) => {
  const operator = req.query.operator;
  if (operator && !['ddd', 'aftu'].includes(operator)) {
    throw new ValidationError([{ path: 'operator', message: 'Opérateur invalide (ddd ou aftu)' }]);
  }
  const lines = await prisma.transitLine.findMany({
    where: operator ? { operator } : {},
    orderBy: [{ operator: 'asc' }, { number: 'asc' }, { direction: 'asc' }],
  });
  return ok(res, { data: { lines: lines.map(l => serializeLine(l)) } });
});

export const getTransitLine = handle('transit.lines.detail', async (req, res) => {
  const line = await prisma.transitLine.findUnique({
    where: { id: req.params.lineId },
    include: { stops: { include: { zone: true }, orderBy: { order: 'asc' } } },
  });
  if (!line) throw new NotFoundError('Ligne introuvable');
  return ok(res, { data: { line: serializeLine(line, { withStops: true }) } });
});

export const searchTransitStops = handle('transit.stops.search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) throw new ValidationError([{ path: 'q', message: 'Au moins 2 caractères' }]);
  // Zones d'arrêts créées par le seed transit, identifiables par leur placeId préfixé.
  const zones = await prisma.zone.findMany({
    where: {
      placeId: { startsWith: 'transit-stop:' },
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
      isActive: true,
    },
    take: 20,
    orderBy: { name: 'asc' },
  });
  return ok(res, {
    data: { stops: zones.map(z => ({
      id: z.id, name: z.name,
      latitude: Number(z.latitude), longitude: Number(z.longitude),
      status: z.status,
    })) },
  });
});

/**
 * Voyages actifs d'une ligne : chaque Advertisement ouvert avec sa session GPS live.
 * Tri : plus proche départ en premier. Utilisé par le client pour choisir un bus.
 */
export const listTransitLineLive = handle('transit.lines.live', async (req, res) => {
  const lineId = req.params.lineId;
  const line = await prisma.transitLine.findUnique({ where: { id: lineId } });
  if (!line) throw new NotFoundError('Ligne introuvable');

  const ads = await prisma.advertisement.findMany({
    where: {
      transitLineId: lineId,
      status: 'open',
    },
    include: {
      driver: { select: { id: true, fullName: true } },
      journeyLive: true,
    },
    orderBy: { departureAt: 'asc' },
    take: 100,
  });

  const cutoff = Date.now() - LIVE_TTL_MS;
  return ok(res, {
    data: {
      line: serializeLine(line),
      advertisements: ads.map(ad => {
        const live = ad.journeyLive && ad.journeyLive.capturedAt.getTime() >= cutoff ? {
          latitude: Number(ad.journeyLive.latitude),
          longitude: Number(ad.journeyLive.longitude),
          accuracyMeters: ad.journeyLive.accuracyMeters,
          capturedAt: ad.journeyLive.capturedAt,
        } : null;
        return {
          id: ad.id,
          driverId: ad.driverId,
          driverName: ad.driver.fullName,
          departureAt: ad.departureAt,
          availableWeight: ad.availableWeight ? Number(ad.availableWeight) : null,
          proposedPrice: ad.proposedPrice ? Number(ad.proposedPrice) : null,
          live,
        };
      }),
    },
  });
});

/**
 * Pré-remplissage d'un brouillon d'Advertisement depuis une ligne.
 * Renvoie les valeurs par défaut (zones départ/arrivée, itinerary) que le chauffeur
 * complète côté app (horaire, capacité) avant d'appeler POST /advertisements.
 */
export const draftFromTransitLine = handle('transit.lines.draft', async (req, res) => {
  const line = await prisma.transitLine.findUnique({
    where: { id: req.params.lineId },
    include: { stops: { include: { zone: true }, orderBy: { order: 'asc' } } },
  });
  if (!line) throw new NotFoundError('Ligne introuvable');
  if (line.stops.length < 2) throw new ValidationError([{ path: 'line', message: 'Ligne sans arrêts' }]);

  const stops = line.stops.map(s => ({
    zoneId: s.zoneId,
    offsetMinutes: s.order * 3, // estimation grossière, le chauffeur peut ajuster
  }));

  return ok(res, {
    data: {
      transitLineId: line.id,
      departureZoneId: line.stops[0].zoneId,
      arrivalZoneId: line.stops.at(-1).zoneId,
      departureCity: line.stops[0].zone.city ?? 'Dakar',
      arrivalCity: line.stops.at(-1).zone.city ?? 'Dakar',
      itinerary: { serviceType: 'shuttle', lineNumber: line.number, stops },
    },
  });
});
