import { prisma } from '../../config/prisma.js';
import { ValidationError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { normalizeVehicleType } from '../../utils/vehicle-types.js';
import { coordinate } from '../drivers/discovery.service.js';
function uuid(value, path) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ValidationError([{ path, message: 'Identifiant invalide' }]);
  return value;
}
export const LIVE_TTL_MS = 60000;
export const serviceForVehicle = type => type === 'bus' ? 'shuttle' : type === 'gp' ? 'gp' : 'trip';

// La catégorie vient exclusivement du véhicule déjà enregistré. Une annonce
// conserve son identité même si le chauffeur change ensuite de véhicule.
export async function registeredTransport(driverId, vehicleId, db = prisma) {
  const vehicle = await db.vehicle.findFirst({ where: { ...(vehicleId ? { id: vehicleId } : {}), driverId, deletedAt: null, isAvailable: true }, orderBy: { createdAt: 'desc' } });
  if (!vehicle) throw new ValidationError([{ path: 'vehicleId', message: 'Complétez votre véhicule dans le profil avant de publier ce départ' }]);
  const type = normalizeVehicleType(vehicle.type);
  return { vehicleId: vehicle.id, reference: vehicle.id.slice(0, 8).toUpperCase(), type,
    model: vehicle.model, capacity: vehicle.capacity, serviceType: serviceForVehicle(type) };
}

export function liveFix(body, now = Date.now()) {
  const latitude = coordinate(body.latitude, 'latitude', -90, 90);
  const longitude = coordinate(body.longitude, 'longitude', -180, 180);
  const accuracyMeters = coordinate(body.accuracyMeters, 'accuracyMeters', 0, 1000);
  const capturedAt = new Date(body.capturedAt);
  if (typeof body.capturedAt !== 'string' || !Number.isFinite(capturedAt.getTime()) || now - capturedAt.getTime() > LIVE_TTL_MS || capturedAt.getTime() > now + 5000) {
    throw new ValidationError([{ path: 'capturedAt', message: 'Une mesure GPS récente est requise' }]);
  }
  return { latitude, longitude, accuracyMeters, capturedAt };
}

async function ownedOpenJourney(id, actor, db) {
  uuid(id, 'advertisementId');
  const ad = await db.advertisement.findUnique({ where: { id } });
  if (!ad) throw new NotFoundError('Départ introuvable');
  if (actor.role !== 'driver' || ad.driverId !== actor.id) throw new ForbiddenError('Ce départ appartient à un autre chauffeur');
  if (ad.status !== 'open') throw new ConflictError('Ce départ est fermé');
  if (!ad.metadata?.itinerary || !ad.metadata?.transport?.vehicleId) throw new ConflictError('Ce départ doit être rattaché au véhicule enregistré');
  const transport = await registeredTransport(actor.id, ad.metadata.transport.vehicleId, db);
  return { ad, transport };
}

export async function startJourneyLive(id, actor, body) {
  if (body.enabled !== true) throw new ValidationError([{ path: 'enabled', message: 'Activez explicitement le partage GPS de ce départ' }]);
  const fix = liveFix(body);
  try {
    return await prisma.$transaction(async tx => {
      // Le verrou chauffeur et les contraintes uniques empêchent deux départs
      // simultanés du même véhicule, même depuis deux téléphones.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR UPDATE`;
      const { ad, transport } = await ownedOpenJourney(id, actor, tx);
      if (ad.departureAt && ad.departureAt.getTime() > Date.now() + 1800000) throw new ConflictError('Le suivi s’active au plus tôt 30 minutes avant le départ');
      await tx.journeyLive.deleteMany({ where: { OR: [{ driverId: actor.id }, { vehicleId: transport.vehicleId }], capturedAt: { lt: new Date(Date.now() - LIVE_TTL_MS) } } });
      const active = await tx.journeyLive.findFirst({ where: { OR: [{ driverId: actor.id }, { vehicleId: transport.vehicleId }] } });
      if (active) throw new ConflictError('Un départ est déjà suivi. Arrêtez son partage avant d’en démarrer un autre');
      return tx.journeyLive.create({ data: { advertisementId: id, driverId: actor.id, vehicleId: transport.vehicleId, ...fix } });
    });
  } catch (error) {
    if (error.code === 'P2002') throw new ConflictError('Ce véhicule est déjà suivi sur un départ');
    throw error;
  }
}

export async function updateJourneyLive(id, actor, body) {
  const fix = liveFix(body);
  const { transport } = await ownedOpenJourney(id, actor, prisma);
  // Le jeton de session interdit à un ancien flux GPS de réactiver une session
  // arrêtée ou de déplacer le véhicule du départ suivant.
  const result = await prisma.journeyLive.updateMany({ where: {
    id: uuid(body.sessionId, 'sessionId'), advertisementId: id, driverId: actor.id, vehicleId: transport.vehicleId,
    capturedAt: { lt: fix.capturedAt }
  }, data: fix });
  if (!result.count) throw new ConflictError('Session arrêtée ou mesure GPS déjà remplacée');
}

export async function stopJourneyLive(id, actor, sessionId) {
  uuid(sessionId, 'sessionId');
  uuid(id, 'advertisementId');
  // Idempotent, sans supprimer la session plus récente d’un autre appareil.
  await prisma.journeyLive.deleteMany({ where: { id: sessionId, advertisementId: id, driverId: actor.id } });
}

export async function liveJourneys(query, actor) {
  if (query.advertisementId) uuid(query.advertisementId, 'advertisementId');
  if (query.pickupZoneId || query.dropoffZoneId) { uuid(query.pickupZoneId, 'pickupZoneId'); uuid(query.dropoffZoneId, 'dropoffZoneId'); }
  const rows = await prisma.journeyLive.findMany({ where: {
    capturedAt: { gte: new Date(Date.now() - LIVE_TTL_MS) },
    advertisement: { status: 'open', ...(query.advertisementId ? { id: query.advertisementId } : {}) },
    driver: { status: 'active' }, vehicle: { deletedAt: null, isAvailable: true }
  }, include: { advertisement: true, vehicle: true, driver: { select: { fullName: true } } }, orderBy: { capturedAt: 'desc' } });
  return rows.flatMap(row => {
    const ad = row.advertisement, itinerary = ad.metadata?.itinerary;
    if (row.vehicle.driverId !== row.driverId || row.vehicleId !== ad.metadata?.transport?.vehicleId || !itinerary) return [];
    if (actor.role !== 'client' && actor.id !== row.driverId) return [];
    if (query.lineNumber && itinerary.lineNumber !== String(query.lineNumber).trim()) return [];
    if (query.pickupZoneId || query.dropoffZoneId) {
      const from = itinerary.stops.findIndex(s => s.zoneId === query.pickupZoneId);
      const to = itinerary.stops.findIndex(s => s.zoneId === query.dropoffZoneId);
      if (from < 0 || to <= from) return [];
    }
    return [{ advertisementId: ad.id, vehicleId: row.vehicleId, vehicleReference: ad.metadata.transport.reference,
      driverName: row.driver.fullName, vehicleModel: row.vehicle.model, vehicleType: ad.metadata.transport.type,
      serviceType: itinerary.serviceType, lineNumber: itinerary.lineNumber,
      departure: itinerary.stops[0], arrival: itinerary.stops.at(-1), departureAt: ad.departureAt,
      position: { latitude: Number(row.latitude), longitude: Number(row.longitude), accuracyMeters: row.accuracyMeters, capturedAt: row.capturedAt,
        expiresAt: new Date(row.capturedAt.getTime() + LIVE_TTL_MS) }
    }];
  });
}
