import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { getPagination, paginationMeta } from '../../utils/pagination.js';
import { NotFoundError, ValidationError, normalizeError } from '../../utils/errors.js';

const DEFAULT_RADIUS_KM = 30;

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number(value);
}

function cleanUndefined(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Zone endpoint failed: ${action}`
      );

      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Operation impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

async function audit(tx, req, { action, entityType, entityId, beforeData, afterData }) {
  await tx.auditLog.create({
    data: {
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action,
      entityType,
      entityId,
      beforeData,
      afterData,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId
    }
  });
}

function serializeZoneDriver(link) {
  if (!link) return null;
  return {
    driverId: link.driverId,
    isPrimary: link.isPrimary,
    createdAt: link.createdAt.toISOString(),
    driver: link.driver
      ? {
          id: link.driver.id,
          fullName: link.driver.fullName,
          phone: link.driver.phone,
          driverStatus: link.driver.driverStatus ?? null,
          rating: link.driver.rating != null ? Number(link.driver.rating) : null,
          totalDeliveries: link.driver.totalDeliveries ?? 0,
          completedDeliveries: link.driver.completedDeliveries ?? 0
        }
      : null
  };
}

function serializeZone(zone, extra = {}) {
  if (!zone) return null;
  return {
    id: zone.id,
    name: zone.name,
    displayName: zone.displayName ?? null,
    placeId: zone.placeId ?? null,
    type: zone.type,
    country: zone.country ?? null,
    region: zone.region ?? null,
    city: zone.city ?? null,
    latitude: number(zone.latitude),
    longitude: number(zone.longitude),
    radius: zone.radiusKm != null ? number(zone.radiusKm) : DEFAULT_RADIUS_KM,
    radiusKm: zone.radiusKm != null ? number(zone.radiusKm) : DEFAULT_RADIUS_KM,
    boundary: zone.boundary ?? null,
    isActive: zone.isActive,
    status: zone.status ?? 'approved',
    source: zone.source ?? 'manual',
    parentId: zone.parentId ?? null,
    metadata: zone.metadata ?? {},
    _count: zone._count ? { driverZones: zone._count.driverZones ?? 0 } : undefined,
    driverZones: zone.driverZones ? zone.driverZones.map(serializeZoneDriver) : undefined,
    parent: zone.parent ? { id: zone.parent.id, name: zone.parent.name } : null,
    children: zone.children
      ? zone.children.map((child) => ({ id: child.id, name: child.name, type: child.type }))
      : undefined,
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
    ...extra
  };
}

/** Distance en kilometres entre deux points GPS (formule de haversine). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function zonePayload(body, { partial = false } = {}) {
  const data = cleanUndefined({
    name: body.name,
    displayName: body.displayName,
    placeId: body.placeId,
    type: body.type,
    country: body.country,
    region: body.region,
    city: body.city,
    latitude: body.latitude !== undefined ? String(body.latitude) : undefined,
    longitude: body.longitude !== undefined ? String(body.longitude) : undefined,
    radiusKm:
      body.radius !== undefined
        ? String(body.radius)
        : body.radiusKm !== undefined
          ? String(body.radiusKm)
          : undefined,
    boundary: body.boundary,
    isActive: body.isActive,
    status: body.status,
    source: body.source,
    parentId: body.parentId,
    metadata: body.metadata
  });

  if (!partial) {
    const details = [];
    if (!data.name) details.push({ path: 'body.name', message: 'Le nom de la zone est requis' });
    if (data.latitude === undefined || Number.isNaN(Number(data.latitude))) {
      details.push({ path: 'body.latitude', message: 'Latitude requise' });
    }
    if (data.longitude === undefined || Number.isNaN(Number(data.longitude))) {
      details.push({ path: 'body.longitude', message: 'Longitude requise' });
    }
    if (details.length) throw new ValidationError(details);
  }

  if (data.type && !['CIRCLE', 'POLYGON'].includes(data.type)) {
    throw new ValidationError([{ path: 'body.type', message: 'Type de zone invalide (CIRCLE ou POLYGON)' }]);
  }

  return data;
}

export const listPublicZones = handle('zones.public', async (_req, res) => {
  const zones = await prisma.zone.findMany({
    where: { isActive: true, status: 'approved' },
    orderBy: { name: 'asc' },
    include: { _count: { select: { driverZones: true } } }
  });

  return ok(res, {
    message: 'Zones actives',
    data: { data: zones.map((zone) => serializeZone(zone)) }
  });
});

export const detectZones = handle('zones.detect', async (req, res) => {
  // Le web et le mobile envoient latitude/longitude ; lat/lng accepte par tolerance.
  const latitude = number(req.query.latitude ?? req.query.lat, NaN);
  const longitude = number(req.query.longitude ?? req.query.lng, NaN);

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new ValidationError([
      { path: 'query.latitude', message: 'Parametres latitude et longitude requis' }
    ]);
  }

  const zones = await prisma.zone.findMany({
    where: { isActive: true, status: 'approved' },
    include: { _count: { select: { driverZones: true } } }
  });

  const matches = zones
    .map((zone) => ({
      zone,
      distanceKm: haversineKm(latitude, longitude, number(zone.latitude), number(zone.longitude))
    }))
    .filter(({ zone, distanceKm }) => {
      const radius = zone.radiusKm != null ? number(zone.radiusKm) : DEFAULT_RADIUS_KM;
      return distanceKm <= radius;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ zone, distanceKm }) =>
      serializeZone(zone, { distanceKm: Math.round(distanceKm * 100) / 100 })
    );

  return ok(res, {
    message: 'Zones detectees',
    data: { data: matches, zones: matches }
  });
});

/**
 * Résout un lieu Google Places en zone, en la créant à la volée si besoin.
 * Idempotent : keyé par placeId (contrainte unique) puis par proximité.
 * Une zone créée automatiquement est en statut "pending" (à valider par un admin)
 * et n'est donc pas encore proposée publiquement.
 * Body : { placeId?, name, displayName?, latitude, longitude, country?, region?, city? }
 */
export const resolveZone = handle('zones.resolve', async (req, res) => {
  const { placeId, name, displayName, country, region, city } = req.body;
  const latitude = number(req.body.latitude, NaN);
  const longitude = number(req.body.longitude, NaN);

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new ValidationError([{ path: 'body.latitude', message: 'Latitude et longitude requises' }]);
  }
  if (!placeId && !name) {
    throw new ValidationError([{ path: 'body.placeId', message: 'placeId ou name requis' }]);
  }

  // 1) Correspondance exacte par Google Place ID (idempotence).
  if (placeId) {
    const byPlace = await prisma.zone.findUnique({
      where: { placeId },
      include: { _count: { select: { driverZones: true } }, parent: { select: { id: true, name: true } } }
    });
    if (byPlace) {
      return ok(res, {
        message: 'Zone existante',
        data: { data: serializeZone(byPlace), created: false, matchedBy: 'placeId' }
      });
    }
  }

  // 2) Sinon, une zone approuvée couvre-t-elle déjà ce point ? (évite les doublons)
  const approved = await prisma.zone.findMany({
    where: { isActive: true, status: 'approved' },
    include: { _count: { select: { driverZones: true } }, parent: { select: { id: true, name: true } } }
  });
  let nearestContainer = null;
  let nearestContainerDist = Infinity;
  let nearestAny = null;
  let nearestAnyDist = Infinity;
  for (const z of approved) {
    const d = haversineKm(latitude, longitude, number(z.latitude), number(z.longitude));
    const radius = z.radiusKm != null ? number(z.radiusKm) : DEFAULT_RADIUS_KM;
    if (d <= radius && d < nearestContainerDist) { nearestContainer = z; nearestContainerDist = d; }
    if (d < nearestAnyDist) { nearestAny = z; nearestAnyDist = d; }
  }
  if (nearestContainer) {
    return ok(res, {
      message: 'Zone existante (proximité)',
      data: { data: serializeZone(nearestContainer, { distanceKm: Math.round(nearestContainerDist * 100) / 100 }), created: false, matchedBy: 'proximity' }
    });
  }

  // 3) Création à la volée en attente de validation. Rattachement best-effort au
  // plus proche parent approuvé (≤ 150 km) pour amorcer la hiérarchie.
  const parentId = nearestAny && nearestAnyDist <= 150 ? nearestAny.id : undefined;
  const created = await prisma.$transaction(async (tx) => {
    const zone = await tx.zone.create({
      data: cleanUndefined({
        name: name || displayName || city || 'Zone',
        displayName: displayName || name,
        placeId: placeId || undefined,
        type: 'CIRCLE',
        country,
        region,
        city,
        latitude: String(latitude),
        longitude: String(longitude),
        radiusKm: String(DEFAULT_RADIUS_KM),
        isActive: true,
        status: 'pending',
        source: 'places',
        parentId,
        metadata: { createdBy: req.user?.id ?? null }
      }),
      include: { _count: { select: { driverZones: true } }, parent: { select: { id: true, name: true } } }
    });
    await audit(tx, req, {
      action: 'zone.autocreate',
      entityType: 'zone',
      entityId: zone.id,
      afterData: { name: zone.name, placeId: zone.placeId, status: 'pending', source: 'places' }
    });
    return zone;
  });

  return ok(res, {
    status: 201,
    message: 'Zone créée (en attente de validation)',
    data: { data: serializeZone(created), created: true, pending: true }
  });
});

export const listZones = handle('zones.list', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { country, city, type, search, status, source } = req.query;
  const isActive =
    req.query.isActive === undefined ? undefined : String(req.query.isActive) === 'true';

  const where = cleanUndefined({
    country: country ? { contains: country, mode: 'insensitive' } : undefined,
    city: city ? { contains: city, mode: 'insensitive' } : undefined,
    type: type || undefined,
    isActive,
    status: status && ['approved', 'pending', 'rejected'].includes(status) ? status : undefined,
    source: source || undefined,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } }
          ]
        }
      : {})
  });

  const [total, zones] = await Promise.all([
    prisma.zone.count({ where }),
    prisma.zone.findMany({
      where,
      include: {
        _count: { select: { driverZones: true } },
        parent: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Zones',
    data: { data: zones.map((zone) => serializeZone(zone)) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getZone = handle('zones.get', async (req, res) => {
  const zone = await prisma.zone.findUnique({
    where: { id: req.params.zoneId },
    include: {
      _count: { select: { driverZones: true } },
      parent: { select: { id: true, name: true } },
      children: { select: { id: true, name: true, type: true } },
      driverZones: { include: { driver: true }, orderBy: { createdAt: 'asc' } }
    }
  });

  if (!zone) throw new NotFoundError('Zone introuvable');

  return ok(res, { message: 'Detail zone', data: { data: serializeZone(zone) } });
});

export const createZone = handle('zones.create', async (req, res) => {
  const data = zonePayload(req.body);

  const zone = await prisma.$transaction(async (tx) => {
    const created = await tx.zone.create({
      data,
      include: { _count: { select: { driverZones: true } } }
    });

    await audit(tx, req, {
      action: 'zone.create',
      entityType: 'zone',
      entityId: created.id,
      afterData: { name: created.name, city: created.city, isActive: created.isActive }
    });

    return created;
  });

  return ok(res, { status: 201, message: 'Zone creee', data: { data: serializeZone(zone) } });
});

/** Admin : approuver / rejeter une zone en attente (status = approved | rejected). */
export const setZoneStatus = handle('zones.setStatus', async (req, res) => {
  const status = String(req.body.status || '').toLowerCase();
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw new ValidationError([{ path: 'body.status', message: 'Statut invalide (approved, rejected, pending)' }]);
  }
  const existing = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
  if (!existing) throw new NotFoundError('Zone introuvable');

  const zone = await prisma.$transaction(async (tx) => {
    const updated = await tx.zone.update({
      where: { id: existing.id },
      data: cleanUndefined({
        status,
        // Une zone rejetée est désactivée ; une zone approuvée est (ré)activée.
        isActive: status === 'rejected' ? false : status === 'approved' ? true : undefined
      }),
      include: { _count: { select: { driverZones: true } }, parent: { select: { id: true, name: true } } }
    });
    await audit(tx, req, {
      action: 'zone.setStatus',
      entityType: 'zone',
      entityId: existing.id,
      beforeData: { status: existing.status },
      afterData: { status }
    });
    return updated;
  });

  return ok(res, { message: 'Statut de la zone mis à jour', data: { data: serializeZone(zone) } });
});

export const updateZone = handle('zones.update', async (req, res) => {
  const existing = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
  if (!existing) throw new NotFoundError('Zone introuvable');

  const data = zonePayload(req.body, { partial: true });

  const zone = await prisma.$transaction(async (tx) => {
    const updated = await tx.zone.update({
      where: { id: existing.id },
      data,
      include: {
        _count: { select: { driverZones: true } },
        parent: { select: { id: true, name: true } }
      }
    });

    await audit(tx, req, {
      action: 'zone.update',
      entityType: 'zone',
      entityId: existing.id,
      beforeData: { name: existing.name, isActive: existing.isActive },
      afterData: data
    });

    return updated;
  });

  return ok(res, { message: 'Zone mise a jour', data: { data: serializeZone(zone) } });
});

export const deleteZone = handle('zones.delete', async (req, res) => {
  const existing = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
  if (!existing) throw new NotFoundError('Zone introuvable');

  await prisma.$transaction(async (tx) => {
    await tx.zone.delete({ where: { id: existing.id } });
    await audit(tx, req, {
      action: 'zone.delete',
      entityType: 'zone',
      entityId: existing.id,
      beforeData: { name: existing.name }
    });
  });

  return ok(res, { message: 'Zone supprimee' });
});

export const listZoneDrivers = handle('zones.drivers', async (req, res) => {
  const zone = await prisma.zone.findUnique({
    where: { id: req.params.zoneId },
    include: {
      driverZones: { include: { driver: true }, orderBy: { createdAt: 'asc' } }
    }
  });

  if (!zone) throw new NotFoundError('Zone introuvable');

  return ok(res, {
    message: 'Chauffeurs de la zone',
    data: { data: zone.driverZones.map(serializeZoneDriver) }
  });
});

async function assertDriver(driverId) {
  const driver = await prisma.user.findUnique({ where: { id: driverId } });
  if (!driver || driver.role !== 'driver' || driver.status !== 'active') {
    throw new ValidationError(
      [{ path: 'body.driverId', message: 'Chauffeur introuvable ou inactif' }],
      'Chauffeur invalide'
    );
  }
  return driver;
}

export const assignDriver = handle('zones.assignDriver', async (req, res) => {
  const { driverId, isPrimary = false } = req.body;
  if (!driverId) throw new ValidationError([{ path: 'body.driverId', message: 'driverId requis' }]);

  const zone = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
  if (!zone) throw new NotFoundError('Zone introuvable');

  await assertDriver(driverId);

  const link = await prisma.$transaction(async (tx) => {
    const upserted = await tx.zoneDriver.upsert({
      where: { zoneId_driverId: { zoneId: zone.id, driverId } },
      update: { isPrimary: Boolean(isPrimary) },
      create: { zoneId: zone.id, driverId, isPrimary: Boolean(isPrimary) },
      include: { driver: true }
    });

    await audit(tx, req, {
      action: 'zone.driver.assign',
      entityType: 'zone',
      entityId: zone.id,
      afterData: { driverId, isPrimary: Boolean(isPrimary) }
    });

    return upserted;
  });

  return ok(res, {
    status: 201,
    message: 'Chauffeur assigne a la zone',
    data: { data: serializeZoneDriver(link) }
  });
});

export const bulkAssignDrivers = handle('zones.bulkAssignDrivers', async (req, res) => {
  const { driverIds, isPrimary = false } = req.body;
  if (!Array.isArray(driverIds) || driverIds.length === 0) {
    throw new ValidationError([{ path: 'body.driverIds', message: 'driverIds (liste) requis' }]);
  }

  const zone = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
  if (!zone) throw new NotFoundError('Zone introuvable');

  const drivers = await prisma.user.findMany({
    where: { id: { in: driverIds }, role: 'driver', status: 'active' },
    select: { id: true }
  });
  const validIds = drivers.map((d) => d.id);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.zoneDriver.createMany({
      data: validIds.map((driverId) => ({
        zoneId: zone.id,
        driverId,
        isPrimary: Boolean(isPrimary)
      })),
      skipDuplicates: true
    });

    await audit(tx, req, {
      action: 'zone.driver.bulkAssign',
      entityType: 'zone',
      entityId: zone.id,
      afterData: { driverIds: validIds, isPrimary: Boolean(isPrimary) }
    });

    return created;
  });

  return ok(res, {
    status: 201,
    message: 'Chauffeurs assignes a la zone',
    data: {
      data: {
        assigned: result.count,
        requested: driverIds.length,
        invalid: driverIds.filter((id) => !validIds.includes(id))
      }
    }
  });
});

export const removeDriver = handle('zones.removeDriver', async (req, res) => {
  const driverId = req.body?.driverId || req.query?.driverId;
  if (!driverId) throw new ValidationError([{ path: 'body.driverId', message: 'driverId requis' }]);

  const zone = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
  if (!zone) throw new NotFoundError('Zone introuvable');

  await prisma.$transaction(async (tx) => {
    const removed = await tx.zoneDriver.deleteMany({ where: { zoneId: zone.id, driverId } });
    if (removed.count === 0) throw new NotFoundError('Chauffeur non assigne a cette zone');

    await audit(tx, req, {
      action: 'zone.driver.remove',
      entityType: 'zone',
      entityId: zone.id,
      beforeData: { driverId }
    });
  });

  return ok(res, { message: 'Chauffeur retire de la zone' });
});

export const migrateGarages = handle('zones.migrate', async (req, res) => {
  const garages = await prisma.garage.findMany({ where: { deletedAt: null } });

  let created = 0;
  let skipped = 0;

  for (const garage of garages) {
    const placeId = `garage:${garage.id}`;

    if (garage.latitude == null || garage.longitude == null) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.zone.findUnique({ where: { placeId } });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const zone = await tx.zone.create({
        data: {
          name: garage.name,
          displayName: garage.name,
          placeId,
          type: 'CIRCLE',
          region: garage.region,
          city: garage.city,
          latitude: String(garage.latitude),
          longitude: String(garage.longitude),
          radiusKm: String(DEFAULT_RADIUS_KM),
          isActive: garage.isActive,
          metadata: { migratedFromGarageId: garage.id, address: garage.address, phone: garage.phone }
        }
      });

      // Les chauffeurs rattaches au garage suivent dans la nouvelle zone.
      const drivers = await tx.user.findMany({
        where: { garageId: garage.id, role: 'driver', status: 'active' },
        select: { id: true }
      });
      if (drivers.length) {
        await tx.zoneDriver.createMany({
          data: drivers.map((d) => ({ zoneId: zone.id, driverId: d.id, isPrimary: true })),
          skipDuplicates: true
        });
      }

      await audit(tx, req, {
        action: 'zone.migrateGarage',
        entityType: 'zone',
        entityId: zone.id,
        afterData: { garageId: garage.id, drivers: drivers.length }
      });
    });

    created += 1;
  }

  return ok(res, {
    message: 'Migration des garages en zones terminee',
    data: { data: { created, skipped, total: garages.length } }
  });
});
