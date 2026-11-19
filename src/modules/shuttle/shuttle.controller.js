/**
 * Shuttle Operator CRUD — lignes de transit, flotte collective et horaires.
 *
 * Toutes les routes exigent le rôle `shuttle_operator` (ou `super_admin` pour
 * supervision). Chaque handler filtre les lignes/véhicules/horaires par
 * `operatorUserId = req.user.id`. Un opérateur ne peut jamais toucher les
 * ressources d'un autre : les tentatives sur une ressource détenue par
 * autrui renvoient 404 (pas 403) pour ne pas divulguer l'existence de la
 * ressource.
 *
 * Les lignes seedées historiques (catalogue public DDD/AFTU) n'ont pas
 * d'`operatorUserId` et restent accessibles en lecture via `/transit/*`,
 * pas depuis cet espace opérateur.
 */
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { ValidationError, NotFoundError, normalizeError } from '../../utils/errors.js';
import { LIVE_TTL_MS } from '../trips/live.service.js';

const TRANSIT_OPERATORS = ['ddd', 'aftu'];
const TRANSIT_DIRECTIONS = ['aller', 'retour'];
const VEHICLE_TYPES = ['bus', 'minibus', 'car', 'van'];
const VEHICLE_STATUSES = ['available', 'maintenance', 'retired'];
const SCHEDULE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.warn?.({ error, action, userId: req.user?.id }, `Shuttle endpoint failed: ${action}`);
      return fail(res, {
        status: normalized?.statusCode || 500,
        message: normalized?.publicMessage || (env.NODE_ENV === 'production' ? 'Opération impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || [],
      });
    }
  };
}

// ─── Serializers ────────────────────────────────────────────────────────────

function serializeLine(line) {
  return {
    id: line.id,
    operator: line.operator,
    number: line.number,
    direction: line.direction,
    name: line.name,
    origin: line.origin,
    destination: line.destination,
    operatorUserId: line.operatorUserId,
    stops: (line.stops ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(s => ({ order: s.order, label: s.label, zoneId: s.zoneId })),
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

function serializeVehicle(v) {
  return {
    id: v.id,
    operatorUserId: v.operatorUserId,
    plateNumber: v.plateNumber,
    model: v.model,
    type: v.type,
    capacity: v.capacity,
    status: v.status,
    notes: v.notes,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

function serializeSchedule(s) {
  return {
    id: s.id,
    operatorUserId: s.operatorUserId,
    transitLineId: s.transitLineId,
    daysOfWeek: s.daysOfWeek,
    departureTime: s.departureTime,
    activeFrom: s.activeFrom,
    activeUntil: s.activeUntil,
    notes: s.notes,
    transitLine: s.transitLine
      ? { id: s.transitLine.id, name: s.transitLine.name, number: s.transitLine.number, direction: s.transitLine.direction }
      : undefined,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// ─── Validation helpers ─────────────────────────────────────────────────────

function requireString(path, value, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new ValidationError([{ path, message: `Chaîne attendue (${min}-${max} caractères)` }]);
  }
  return value.trim();
}

function requireEnum(path, value, allowed) {
  if (!allowed.includes(value)) {
    throw new ValidationError([{ path, message: `Valeur invalide. Attendu : ${allowed.join(', ')}` }]);
  }
  return value;
}

function parseStops(raw) {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new ValidationError([{ path: 'stops', message: 'Au moins deux arrêts requis' }]);
  }
  const seenOrders = new Set();
  const out = raw.map((s, i) => {
    const order = Number(s?.order ?? i + 1);
    if (!Number.isInteger(order) || order < 1) {
      throw new ValidationError([{ path: `stops[${i}].order`, message: 'Ordre entier >= 1 requis' }]);
    }
    if (seenOrders.has(order)) {
      throw new ValidationError([{ path: `stops[${i}].order`, message: `Ordre ${order} dupliqué` }]);
    }
    seenOrders.add(order);
    const zoneId = requireString(`stops[${i}].zoneId`, s?.zoneId);
    const label = requireString(`stops[${i}].label`, s?.label, { min: 1, max: 120 });
    return { order, zoneId, label };
  });
  return out.sort((a, b) => a.order - b.order);
}

function parseDaysOfWeek(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError([{ path: 'daysOfWeek', message: 'Au moins un jour (0=dim .. 6=sam) requis' }]);
  }
  const normalized = [...new Set(raw.map(Number))].sort((a, b) => a - b);
  for (const d of normalized) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new ValidationError([{ path: 'daysOfWeek', message: 'Jour hors plage (0..6)' }]);
    }
  }
  return normalized;
}

// ─── Overview ───────────────────────────────────────────────────────────────

export const overview = handle('shuttle.overview', async (req, res) => {
  const where = { operatorUserId: req.user.id };
  const [lineCount, vehicleCount, scheduleCount, availableVehicleCount, activeScheduleCount] = await Promise.all([
    prisma.transitLine.count({ where }),
    prisma.shuttleVehicle.count({ where: { ...where, deletedAt: null } }),
    prisma.shuttleSchedule.count({ where }),
    prisma.shuttleVehicle.count({ where: { ...where, deletedAt: null, status: 'available' } }),
    prisma.shuttleSchedule.count({
      where: {
        ...where,
        OR: [{ activeUntil: null }, { activeUntil: { gte: new Date() } }],
      },
    }),
  ]);
  return ok(res, {
    message: 'Overview opérateur',
    data: {
      lineCount,
      vehicleCount,
      availableVehicleCount,
      scheduleCount,
      activeScheduleCount,
    },
  });
});

// ─── Lines ──────────────────────────────────────────────────────────────────

export const listLines = handle('shuttle.lines.list', async (req, res) => {
  const lines = await prisma.transitLine.findMany({
    where: { operatorUserId: req.user.id },
    include: { stops: true },
    orderBy: [{ operator: 'asc' }, { number: 'asc' }, { direction: 'asc' }],
  });
  return ok(res, { message: 'Lignes opérateur', data: { lines: lines.map(serializeLine) } });
});

export const createLine = handle('shuttle.lines.create', async (req, res) => {
  const operator = requireEnum('operator', req.body?.operator, TRANSIT_OPERATORS);
  const number = requireString('number', req.body?.number, { min: 1, max: 20 });
  const direction = requireEnum('direction', req.body?.direction, TRANSIT_DIRECTIONS);
  const name = requireString('name', req.body?.name, { min: 1, max: 120 });
  const origin = requireString('origin', req.body?.origin, { min: 1, max: 120 });
  const destination = requireString('destination', req.body?.destination, { min: 1, max: 120 });
  const stops = parseStops(req.body?.stops);
  const source = req.body?.source != null ? requireString('source', req.body.source, { min: 1, max: 60 }) : null;

  // Les zones référencées doivent exister (évite les FK orphelines). Un seul
  // round-trip DB pour toutes les zones demandées.
  const zoneIds = [...new Set(stops.map(s => s.zoneId))];
  const zones = await prisma.zone.findMany({ where: { id: { in: zoneIds } }, select: { id: true } });
  const foundZoneIds = new Set(zones.map(z => z.id));
  const missing = zoneIds.filter(id => !foundZoneIds.has(id));
  if (missing.length) {
    throw new ValidationError([{ path: 'stops', message: `Zones inconnues : ${missing.join(', ')}` }]);
  }

  try {
    const created = await prisma.transitLine.create({
      data: {
        operator,
        operatorUserId: req.user.id,
        number,
        direction,
        name,
        origin,
        destination,
        source,
        stops: { create: stops },
      },
      include: { stops: true },
    });
    return ok(res, { status: 201, message: 'Ligne créée', data: { line: serializeLine(created) } });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new ValidationError([{ path: 'number', message: 'Combinaison opérateur+numéro+direction déjà utilisée' }]);
    }
    throw error;
  }
});

async function requireOwnedLine(req, lineId) {
  const line = await prisma.transitLine.findFirst({
    where: { id: lineId, operatorUserId: req.user.id },
    include: { stops: true },
  });
  if (!line) throw new NotFoundError('Ligne introuvable');
  return line;
}

export const updateLine = handle('shuttle.lines.update', async (req, res) => {
  await requireOwnedLine(req, req.params.lineId);

  const data = {};
  if (req.body?.name != null) data.name = requireString('name', req.body.name, { min: 1, max: 120 });
  if (req.body?.origin != null) data.origin = requireString('origin', req.body.origin, { min: 1, max: 120 });
  if (req.body?.destination != null) data.destination = requireString('destination', req.body.destination, { min: 1, max: 120 });
  if (req.body?.number != null) data.number = requireString('number', req.body.number, { min: 1, max: 20 });
  if (req.body?.direction != null) data.direction = requireEnum('direction', req.body.direction, TRANSIT_DIRECTIONS);

  let stops = null;
  if (req.body?.stops != null) {
    stops = parseStops(req.body.stops);
    const zoneIds = [...new Set(stops.map(s => s.zoneId))];
    const zones = await prisma.zone.findMany({ where: { id: { in: zoneIds } }, select: { id: true } });
    const foundZoneIds = new Set(zones.map(z => z.id));
    const missing = zoneIds.filter(id => !foundZoneIds.has(id));
    if (missing.length) {
      throw new ValidationError([{ path: 'stops', message: `Zones inconnues : ${missing.join(', ')}` }]);
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (stops) {
        // Réécriture atomique de la composition d'arrêts : on supprime puis
        // on recrée pour simplifier la gestion des ordres modifiés.
        await tx.transitLineStop.deleteMany({ where: { transitLineId: req.params.lineId } });
        await tx.transitLineStop.createMany({
          data: stops.map(s => ({ transitLineId: req.params.lineId, order: s.order, label: s.label, zoneId: s.zoneId })),
        });
      }
      return tx.transitLine.update({
        where: { id: req.params.lineId },
        data,
        include: { stops: true },
      });
    });
    return ok(res, { message: 'Ligne modifiée', data: { line: serializeLine(updated) } });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new ValidationError([{ path: 'number', message: 'Combinaison opérateur+numéro+direction déjà utilisée' }]);
    }
    throw error;
  }
});

export const deleteLine = handle('shuttle.lines.delete', async (req, res) => {
  await requireOwnedLine(req, req.params.lineId);
  // Prisma cascade : stops et schedules associés sont supprimés automatiquement
  // via les FK onDelete. Les annonces (Advertisement.transitLineId) perdent
  // la référence mais restent (ne pas détruire les voyages passés).
  await prisma.transitLine.delete({ where: { id: req.params.lineId } });
  return ok(res, { message: 'Ligne supprimée', data: { deleted: true } });
});

// ─── Vehicles ───────────────────────────────────────────────────────────────

export const listVehicles = handle('shuttle.vehicles.list', async (req, res) => {
  const vehicles = await prisma.shuttleVehicle.findMany({
    where: { operatorUserId: req.user.id, deletedAt: null },
    orderBy: [{ status: 'asc' }, { plateNumber: 'asc' }],
  });
  return ok(res, { message: 'Flotte opérateur', data: { vehicles: vehicles.map(serializeVehicle) } });
});

export const createVehicle = handle('shuttle.vehicles.create', async (req, res) => {
  const plateNumber = requireString('plateNumber', req.body?.plateNumber, { min: 2, max: 30 });
  const model = requireString('model', req.body?.model, { min: 1, max: 80 });
  const type = requireEnum('type', req.body?.type, VEHICLE_TYPES);
  const capacityRaw = Number(req.body?.capacity);
  if (!Number.isInteger(capacityRaw) || capacityRaw < 1 || capacityRaw > 200) {
    throw new ValidationError([{ path: 'capacity', message: 'Capacité entier 1..200 requise' }]);
  }
  const status = req.body?.status != null ? requireEnum('status', req.body.status, VEHICLE_STATUSES) : 'available';
  const notes = req.body?.notes != null ? requireString('notes', req.body.notes, { min: 1, max: 500 }) : null;

  try {
    const created = await prisma.shuttleVehicle.create({
      data: {
        operatorUserId: req.user.id,
        plateNumber,
        model,
        type,
        capacity: capacityRaw,
        status,
        notes,
      },
    });
    return ok(res, { status: 201, message: 'Véhicule ajouté', data: { vehicle: serializeVehicle(created) } });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new ValidationError([{ path: 'plateNumber', message: 'Plaque déjà enregistrée dans votre flotte' }]);
    }
    throw error;
  }
});

async function requireOwnedVehicle(req, vehicleId) {
  const vehicle = await prisma.shuttleVehicle.findFirst({
    where: { id: vehicleId, operatorUserId: req.user.id, deletedAt: null },
  });
  if (!vehicle) throw new NotFoundError('Véhicule introuvable');
  return vehicle;
}

export const updateVehicle = handle('shuttle.vehicles.update', async (req, res) => {
  await requireOwnedVehicle(req, req.params.vehicleId);
  const data = {};
  if (req.body?.plateNumber != null) data.plateNumber = requireString('plateNumber', req.body.plateNumber, { min: 2, max: 30 });
  if (req.body?.model != null) data.model = requireString('model', req.body.model, { min: 1, max: 80 });
  if (req.body?.type != null) data.type = requireEnum('type', req.body.type, VEHICLE_TYPES);
  if (req.body?.capacity != null) {
    const c = Number(req.body.capacity);
    if (!Number.isInteger(c) || c < 1 || c > 200) {
      throw new ValidationError([{ path: 'capacity', message: 'Capacité entier 1..200 requise' }]);
    }
    data.capacity = c;
  }
  if (req.body?.status != null) data.status = requireEnum('status', req.body.status, VEHICLE_STATUSES);
  if (req.body?.notes != null) data.notes = req.body.notes === '' ? null : requireString('notes', req.body.notes, { min: 1, max: 500 });

  try {
    const updated = await prisma.shuttleVehicle.update({ where: { id: req.params.vehicleId }, data });
    return ok(res, { message: 'Véhicule modifié', data: { vehicle: serializeVehicle(updated) } });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new ValidationError([{ path: 'plateNumber', message: 'Plaque déjà enregistrée dans votre flotte' }]);
    }
    throw error;
  }
});

export const deleteVehicle = handle('shuttle.vehicles.delete', async (req, res) => {
  await requireOwnedVehicle(req, req.params.vehicleId);
  // Soft delete : la plaque reste bloquée pour éviter les réimports accidentels
  // mais n'apparaît plus dans la flotte active.
  await prisma.shuttleVehicle.update({
    where: { id: req.params.vehicleId },
    data: { deletedAt: new Date(), status: 'retired' },
  });
  return ok(res, { message: 'Véhicule retiré', data: { deleted: true } });
});

// ─── Schedules ──────────────────────────────────────────────────────────────

export const listSchedules = handle('shuttle.schedules.list', async (req, res) => {
  const schedules = await prisma.shuttleSchedule.findMany({
    where: { operatorUserId: req.user.id },
    include: { transitLine: true },
    orderBy: [{ transitLineId: 'asc' }, { departureTime: 'asc' }],
  });
  return ok(res, { message: 'Horaires opérateur', data: { schedules: schedules.map(serializeSchedule) } });
});

export const createSchedule = handle('shuttle.schedules.create', async (req, res) => {
  const transitLineId = requireString('transitLineId', req.body?.transitLineId);
  // On vérifie que la ligne appartient à l'opérateur courant.
  const line = await prisma.transitLine.findFirst({
    where: { id: transitLineId, operatorUserId: req.user.id },
    select: { id: true },
  });
  if (!line) throw new NotFoundError('Ligne introuvable dans votre espace');

  const daysOfWeek = parseDaysOfWeek(req.body?.daysOfWeek);
  const departureTime = requireString('departureTime', req.body?.departureTime, { min: 4, max: 5 });
  if (!SCHEDULE_TIME_RE.test(departureTime)) {
    throw new ValidationError([{ path: 'departureTime', message: 'Format HH:MM (00:00 – 23:59)' }]);
  }
  const activeFromRaw = req.body?.activeFrom != null ? new Date(req.body.activeFrom) : new Date();
  if (Number.isNaN(activeFromRaw.getTime())) {
    throw new ValidationError([{ path: 'activeFrom', message: 'Date ISO invalide' }]);
  }
  let activeUntil = null;
  if (req.body?.activeUntil != null) {
    activeUntil = new Date(req.body.activeUntil);
    if (Number.isNaN(activeUntil.getTime())) {
      throw new ValidationError([{ path: 'activeUntil', message: 'Date ISO invalide' }]);
    }
    if (activeUntil <= activeFromRaw) {
      throw new ValidationError([{ path: 'activeUntil', message: 'La fin doit être postérieure au début' }]);
    }
  }
  const notes = req.body?.notes != null ? requireString('notes', req.body.notes, { min: 1, max: 500 }) : null;

  const created = await prisma.shuttleSchedule.create({
    data: {
      operatorUserId: req.user.id,
      transitLineId,
      daysOfWeek,
      departureTime,
      activeFrom: activeFromRaw,
      activeUntil,
      notes,
    },
    include: { transitLine: true },
  });
  return ok(res, { status: 201, message: 'Horaire créé', data: { schedule: serializeSchedule(created) } });
});

async function requireOwnedSchedule(req, scheduleId) {
  const schedule = await prisma.shuttleSchedule.findFirst({
    where: { id: scheduleId, operatorUserId: req.user.id },
    include: { transitLine: true },
  });
  if (!schedule) throw new NotFoundError('Horaire introuvable');
  return schedule;
}

export const updateSchedule = handle('shuttle.schedules.update', async (req, res) => {
  const current = await requireOwnedSchedule(req, req.params.scheduleId);
  const data = {};
  if (req.body?.daysOfWeek != null) data.daysOfWeek = parseDaysOfWeek(req.body.daysOfWeek);
  if (req.body?.departureTime != null) {
    const t = requireString('departureTime', req.body.departureTime, { min: 4, max: 5 });
    if (!SCHEDULE_TIME_RE.test(t)) {
      throw new ValidationError([{ path: 'departureTime', message: 'Format HH:MM (00:00 – 23:59)' }]);
    }
    data.departureTime = t;
  }
  if (req.body?.activeFrom != null) {
    const d = new Date(req.body.activeFrom);
    if (Number.isNaN(d.getTime())) throw new ValidationError([{ path: 'activeFrom', message: 'Date ISO invalide' }]);
    data.activeFrom = d;
  }
  if (req.body?.activeUntil !== undefined) {
    if (req.body.activeUntil === null || req.body.activeUntil === '') {
      data.activeUntil = null;
    } else {
      const d = new Date(req.body.activeUntil);
      if (Number.isNaN(d.getTime())) throw new ValidationError([{ path: 'activeUntil', message: 'Date ISO invalide' }]);
      const ref = data.activeFrom ?? current.activeFrom;
      if (d <= ref) throw new ValidationError([{ path: 'activeUntil', message: 'La fin doit être postérieure au début' }]);
      data.activeUntil = d;
    }
  }
  if (req.body?.notes !== undefined) {
    data.notes = req.body.notes === null || req.body.notes === '' ? null : requireString('notes', req.body.notes, { min: 1, max: 500 });
  }

  const updated = await prisma.shuttleSchedule.update({
    where: { id: req.params.scheduleId },
    data,
    include: { transitLine: true },
  });
  return ok(res, { message: 'Horaire modifié', data: { schedule: serializeSchedule(updated) } });
});

export const deleteSchedule = handle('shuttle.schedules.delete', async (req, res) => {
  await requireOwnedSchedule(req, req.params.scheduleId);
  await prisma.shuttleSchedule.delete({ where: { id: req.params.scheduleId } });
  return ok(res, { message: 'Horaire supprimé', data: { deleted: true } });
});

// ─── Live supervision ───────────────────────────────────────────────────────
// SCP-006 (Phase 2 chantier 3) — Dashboard temps réel pour l'opérateur :
// liste les trajets actifs sur SES lignes avec position GPS récente, arrêts
// atteints, confirmations pickup/dropoff, et état de la flotte. Un trajet
// est « actif » = JourneyLive avec capturedAt > now - LIVE_TTL_MS.
export const live = handle('shuttle.live', async (req, res) => {
  const operatorUserId = req.user.id;

  // 1) Lignes de l'opérateur avec leurs arrêts (ordonnés) — clef du scoping.
  const lines = await prisma.transitLine.findMany({
    where: { operatorUserId },
    include: { stops: { orderBy: { order: 'asc' } } },
  });

  // 2) Comptages flotte (toujours renvoyés, même sans ligne).
  const fleetRows = await prisma.shuttleVehicle.groupBy({
    by: ['status'],
    where: { operatorUserId, deletedAt: null },
    _count: { _all: true },
  });
  const fleet = { available: 0, maintenance: 0, retired: 0 };
  for (const row of fleetRows) {
    if (row.status in fleet) fleet[row.status] = row._count._all;
  }

  if (lines.length === 0) {
    return ok(res, { message: 'Supervision temps réel', data: { activeJourneys: [], fleet, generatedAt: new Date().toISOString() } });
  }

  const lineIds = lines.map((l) => l.id);
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // 3) Annonces ouvertes sur ces lignes avec un JourneyLive récent. On filtre
  //    sur `advertisement.status = 'open'` et sur `journeyLive.capturedAt`
  //    récent pour ne jamais exposer un trajet « zombie ».
  const since = new Date(Date.now() - LIVE_TTL_MS);
  const advertisements = await prisma.advertisement.findMany({
    where: {
      transitLineId: { in: lineIds },
      status: 'open',
      journeyLive: { is: { capturedAt: { gte: since } } },
    },
    select: {
      id: true,
      transitLineId: true,
      departureAt: true,
      driver: { select: { id: true, fullName: true } },
      journeyLive: {
        select: { latitude: true, longitude: true, accuracyMeters: true, capturedAt: true, vehicleId: true },
      },
      offers: {
        where: { status: 'accepted' },
        select: { id: true, boardingStopOrder: true, dropOffStopOrder: true },
      },
    },
  });

  if (advertisements.length === 0) {
    return ok(res, { message: 'Supervision temps réel', data: { activeJourneys: [], fleet, generatedAt: new Date().toISOString() } });
  }

  const advertisementIds = advertisements.map((a) => a.id);

  // 4) Arrêts atteints + confirmations en un seul round trip par type.
  const [reachedRows, confirmationRows] = await Promise.all([
    prisma.journeyStopEvent.findMany({
      where: { advertisementId: { in: advertisementIds } },
      select: { advertisementId: true, stopOrder: true },
    }),
    prisma.shuttleStopConfirmation.findMany({
      where: { advertisementId: { in: advertisementIds } },
      select: { advertisementId: true, type: true },
    }),
  ]);

  const reachedByAd = new Map();
  for (const r of reachedRows) {
    const list = reachedByAd.get(r.advertisementId) ?? [];
    list.push(r.stopOrder);
    reachedByAd.set(r.advertisementId, list);
  }
  const confCountByAd = new Map();
  for (const c of confirmationRows) {
    const counts = confCountByAd.get(c.advertisementId) ?? { pickup: 0, dropoff: 0 };
    counts[c.type] = (counts[c.type] ?? 0) + 1;
    confCountByAd.set(c.advertisementId, counts);
  }

  const activeJourneys = advertisements.map((ad) => {
    const line = lineById.get(ad.transitLineId);
    const stops = line?.stops ?? [];
    const reached = reachedByAd.get(ad.id) ?? [];
    const maxReached = reached.length ? Math.max(...reached) : null;
    const nextStop = stops.find((s) => (maxReached == null ? true : s.order > maxReached)) ?? null;

    const pickupTotal = ad.offers.filter((o) => o.boardingStopOrder != null).length;
    const dropoffTotal = ad.offers.filter((o) => o.dropOffStopOrder != null).length;
    const confCounts = confCountByAd.get(ad.id) ?? { pickup: 0, dropoff: 0 };

    return {
      advertisementId: ad.id,
      departureAt: ad.departureAt ? ad.departureAt.toISOString() : null,
      driver: ad.driver,
      line: line ? { id: line.id, number: line.number, name: line.name, direction: line.direction } : null,
      position: ad.journeyLive
        ? {
            latitude: Number(ad.journeyLive.latitude),
            longitude: Number(ad.journeyLive.longitude),
            accuracyMeters: ad.journeyLive.accuracyMeters,
            capturedAt: ad.journeyLive.capturedAt.toISOString(),
            expiresAt: new Date(ad.journeyLive.capturedAt.getTime() + LIVE_TTL_MS).toISOString(),
          }
        : null,
      stopsTotal: stops.length,
      stopsReached: reached.length,
      nextStop: nextStop ? { order: nextStop.order, label: nextStop.label, zoneId: nextStop.zoneId } : null,
      confirmations: {
        pickupDone: confCounts.pickup,
        pickupTotal,
        dropoffDone: confCounts.dropoff,
        dropoffTotal,
      },
    };
  });

  return ok(res, {
    message: 'Supervision temps réel',
    data: { activeJourneys, fleet, generatedAt: new Date().toISOString() },
  });
});
