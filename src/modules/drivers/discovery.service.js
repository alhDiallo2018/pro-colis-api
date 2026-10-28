import { prisma } from '../../config/prisma.js';
import { ValidationError, ForbiddenError } from '../../utils/errors.js';
import { serializePublicDriver } from '../../utils/mobile-serializers.js';
import { VEHICLE_TYPES, normalizeVehicleType, vehicleTypeFilter } from '../../utils/vehicle-types.js';

export const POSITION_TTL_MS = 10 * 60 * 1000;
export function coordinate(value, path, min, max) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' ||
      !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new ValidationError([{ path, message: 'Coordonnée invalide' }]);
  }
  return Number(value);
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = value => value * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Filtre avant pagination ; la distance exacte ne sort jamais du serveur. */
export async function discoverDrivers(query, actor, scope = {}) {
  return discover(query, actor, scope, false);
}

// La carte ne renvoie que des positions volontairement partagées, fraîches et
// approximatives. Les anciens endpoints conservent leur contrat sans coordonnées.
export async function discoverDriverMap(query, actor) {
  if (actor?.role !== 'client') throw new ForbiddenError('Accès client requis');
  if (query.latitude === undefined || query.longitude === undefined) {
    throw new ValidationError([{ path: 'query', message: 'Choisissez un point de retrait' }]);
  }
  return discover(query, actor, {}, true);
}

async function discover(query, actor, scope, mapMode) {
  const near = query.latitude !== undefined || query.longitude !== undefined;
  if (near && !actor) throw new ForbiddenError('Connectez-vous pour rechercher les chauffeurs à proximité');
  const lat = near ? coordinate(query.latitude, 'query.latitude', -90, 90) : null;
  const lng = near ? coordinate(query.longitude, 'query.longitude', -180, 180) : null;
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ValidationError([{ path: 'query.limit', message: 'Limite comprise entre 1 et 200' }]);
  }
  const capacity = query.minCapacity === undefined ? null : Number(query.minCapacity);
  if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0)) {
    throw new ValidationError([{ path: 'query.minCapacity', message: 'Poids strictement positif requis' }]);
  }
  const radius = mapMode ? Number(query.radiusKm ?? 10) : null;
  if (mapMode && (!Number.isFinite(radius) || radius < 1 || radius > 100)) {
    throw new ValidationError([{ path: 'query.radiusKm', message: 'Rayon compris entre 1 et 100 km' }]);
  }
  const selectedType = query.vehicleType ? normalizeVehicleType(query.vehicleType, 'query.vehicleType') : null;
  const vehicleWhere = {
    deletedAt: null, isAvailable: true,
    ...(!mapMode && selectedType ? vehicleTypeFilter(selectedType) : {}),
    ...(capacity !== null ? { capacity: { gte: Math.ceil(capacity) } } : {})
  };
  const filteredVehicle = mapMode || selectedType || capacity !== null;
  const availableOnly = near || ['true', '1'].includes(String(query.availableOnly));
  const drivers = await prisma.user.findMany({
    where: {
      role: 'driver', status: 'active', ...scope,
      ...(query.city ? { city: query.city } : {}),
      ...(availableOnly ? { driverStatus: 'available' } : {}),
      ...(['true', '1'].includes(String(query.verifiedOnly)) ? { isVerified: true } : {}),
      ...(filteredVehicle ? { vehicles: { some: vehicleWhere } } : {})
    },
    select: {
      id: true, fullName: true, profilePhoto: true, city: true, region: true,
      driverStatus: true, isVerified: true, rating: true, completedDeliveries: true,
      vehicles: { where: vehicleWhere, orderBy: { createdAt: 'desc' }, take: 1,
        select: { type: true, model: true, capacity: true } },
      ...(near ? { discoveryPosition: { select: { latitude: true, longitude: true, updatedAt: true } } } : {})
    },
    orderBy: [{ isVerified: 'desc' }, { rating: 'desc' }, { fullName: 'asc' }],
    // En proximité, appliquer take avant le tri exclurait arbitrairement le
    // chauffeur le plus proche. Les profils sans GPS frais restent en fin.
    ...(!near ? { take: limit } : {})
  });
  const now = Date.now();
  let ranked = drivers.map(driver => {
    const position = driver.discoveryPosition;
    const age = position ? now - new Date(position.updatedAt).getTime() : Infinity;
    const fresh = near && position && age >= 0 && age <= POSITION_TTL_MS;
    const distance = fresh ? distanceKm(lat, lng, Number(position.latitude), Number(position.longitude)) : null;
    return { driver, distance, updatedAt: fresh ? position.updatedAt : null };
  });
  if (near) ranked.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  let categories;
  if (mapMode) {
    // La recherche se fait autour du retrait, pas du garage administratif du
    // chauffeur. Les comptes sans localisation ne deviennent pas de faux points.
    ranked = ranked.filter(item => item.distance !== null && item.distance <= radius);
    const codeFor = item => {
      try { return normalizeVehicleType(item.driver.vehicles[0]?.type); } catch { return null; }
    };
    ranked = ranked.filter(item => codeFor(item) !== null);
    categories = VEHICLE_TYPES.map(({ value, label }) => ({ value, label,
      availableCount: ranked.filter(item => codeFor(item) === value).length }));
    if (selectedType) ranked = ranked.filter(item => codeFor(item) === selectedType);
  }
  const total = ranked.length;
  const results = ranked.slice(0, limit).map(({ driver, distance, updatedAt }) => ({
    ...serializePublicDriver(driver),
    vehicleType: mapMode ? normalizeVehicleType(driver.vehicles[0]?.type) : driver.vehicles[0]?.type ?? null,
    vehicleModel: driver.vehicles[0]?.model ?? null,
    vehicleCapacity: driver.vehicles[0]?.capacity ?? null,
    ...(near ? { distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
      locationUpdatedAt: updatedAt } : {}),
    ...(mapMode ? { mapPosition: {
      // Grille d'environ 110 m : l'UI indique explicitement cette approximation
      // et n'expose jamais le point GPS original du chauffeur à la découverte.
      latitude: Math.round(Number(driver.discoveryPosition.latitude) * 1000) / 1000,
      longitude: Math.round(Number(driver.discoveryPosition.longitude) * 1000) / 1000,
      accuracyMeters: 150
    } } : {})
  }));
  return mapMode ? { drivers: results, categories, search: {
    radiusKm: radius, total, returned: results.length, updatedAt: new Date().toISOString(),
    distanceKind: 'straight_line', positionsApproximate: true
  } } : results;
}
