// Fabrique un controleur CRUD generique pour un referentiel admin.
//
// Les trois tables (vehicle_types, document_types, expense_categories)
// partagent la meme signature : identifiant uuid, `code` metier unique,
// `label`, `isActive`, `sortOrder`. Les champs specifiques (`category`,
// `appliesTo`, `isRequired`, `maxWeightKg`, `maxVolumeM3`) sont declares par
// chaque module au moment de la creation du controleur, ce qui evite la
// duplication tout en restant explicite sur les colonnes valides.
import { z } from 'zod';
import { prisma } from '../../../config/prisma.js';
import { env } from '../../../config/env.js';
import { ok, fail } from '../../../utils/api-response.js';
import { getPagination, paginationMeta } from '../../../utils/pagination.js';
import { NotFoundError, ValidationError, normalizeError } from '../../../utils/errors.js';

/** Normalise un code metier (snake_case, lettres/chiffres). */
function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
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
      req.log?.error(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Reference-data endpoint failed: ${action}`
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
  try {
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
  } catch (error) {
    // Le journal d'audit est best-effort : ne pas casser la mutation si la
    // table AuditLog est indisponible.
    req.log?.warn({ error, action }, 'audit.write.failed');
  }
}

/**
 * @param {Object} options
 * @param {string} options.entityType       Pour l'audit log (ex: 'vehicle_type').
 * @param {string} options.modelName        Nom de la delegate Prisma (ex: 'vehicleType').
 * @param {z.ZodTypeAny} options.createSchema Schema zod decrivant le corps de creation.
 * @param {z.ZodTypeAny} options.updateSchema Schema zod decrivant le corps de mise a jour (tous champs optionnels).
 * @param {Array<string>} [options.filterFields] Champs autorises comme filtres (ex: ['category']).
 */
export function makeReferenceController({
  entityType,
  modelName,
  createSchema,
  updateSchema,
  filterFields = []
}) {
  const model = prisma[modelName];
  if (!model) {
    throw new Error(`Prisma model '${modelName}' introuvable`);
  }

  function parsePayload(schema, body) {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          path: `body.${issue.path.join('.')}`,
          message: issue.message
        }))
      );
    }
    const data = cleanUndefined(parsed.data);
    if (data.code !== undefined) data.code = normalizeCode(data.code);
    if (data.code === '') {
      throw new ValidationError([{ path: 'body.code', message: 'Code requis' }]);
    }
    return data;
  }

  function buildWhere(query) {
    const where = {};
    if (query.isActive !== undefined) {
      where.isActive = String(query.isActive) === 'true';
    }
    for (const field of filterFields) {
      if (query[field]) where[field] = String(query[field]);
    }
    if (query.search) {
      where.OR = [
        { code: { contains: String(query.search), mode: 'insensitive' } },
        { label: { contains: String(query.search), mode: 'insensitive' } }
      ];
    }
    return where;
  }

  const list = handle(`${entityType}.list`, async (req, res) => {
    const { page, limit, skip } = getPagination(req.query);
    const where = buildWhere(req.query || {});
    const [total, rows] = await Promise.all([
      model.count({ where }),
      model.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        skip,
        take: limit
      })
    ]);
    return ok(res, {
      message: 'Liste',
      data: { data: rows },
      meta: paginationMeta({ page, limit, total })
    });
  });

  const get = handle(`${entityType}.get`, async (req, res) => {
    const row = await model.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Element introuvable');
    return ok(res, { message: 'Detail', data: { data: row } });
  });

  const create = handle(`${entityType}.create`, async (req, res) => {
    const data = parsePayload(createSchema, req.body);
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx[modelName].create({ data });
      await audit(tx, req, { action: `${entityType}.create`, entityType, entityId: created.id, afterData: data });
      return created;
    });
    return ok(res, { status: 201, message: 'Element cree', data: { data: row } });
  });

  const update = handle(`${entityType}.update`, async (req, res) => {
    const existing = await model.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Element introuvable');
    const data = parsePayload(updateSchema, req.body);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx[modelName].update({ where: { id: existing.id }, data });
      await audit(tx, req, {
        action: `${entityType}.update`,
        entityType,
        entityId: existing.id,
        beforeData: existing,
        afterData: data
      });
      return updated;
    });
    return ok(res, { message: 'Element mis a jour', data: { data: row } });
  });

  // Suppression douce : on bascule `isActive` a false. Les enregistrements
  // historiques (vehicule a type ancien, par ex.) restent lisibles.
  const remove = handle(`${entityType}.delete`, async (req, res) => {
    const existing = await model.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Element introuvable');
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx[modelName].update({
        where: { id: existing.id },
        data: { isActive: false }
      });
      await audit(tx, req, {
        action: `${entityType}.deactivate`,
        entityType,
        entityId: existing.id,
        beforeData: { isActive: existing.isActive },
        afterData: { isActive: false }
      });
      return updated;
    });
    return ok(res, { message: 'Element desactive', data: { data: row } });
  });

  // Lecture publique en cache : seulement les lignes actives, triees pour les
  // dropdowns. 5 minutes couvrent les navigations usuelles sans empecher une
  // mise a jour admin de se propager.
  const publicList = handle(`${entityType}.public`, async (req, res) => {
    const where = { isActive: true };
    for (const field of filterFields) {
      if (req.query[field]) where[field] = String(req.query[field]);
    }
    const rows = await model.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }]
    });
    res.set('Cache-Control', 'public, max-age=300');
    return ok(res, { message: 'Referentiel', data: { data: rows } });
  });

  return { list, get, create, update, remove, publicList };
}

// Schemas Zod factorises pour les trois controleurs. Les specialisations
// (category, appliesTo...) sont ajoutees par chaque module.
export const baseCreateSchema = z.object({
  code: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(255),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

export const baseUpdateSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});
