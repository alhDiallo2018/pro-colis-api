/**
 * Fraud module — controllers (super-admin uniquement).
 *
 * Quatre endpoints :
 *
 *   GET  /super-admin/fraud/scores        — scores live (top-N utilisateurs
 *                                           actifs, recalcul à la volée).
 *   GET  /super-admin/fraud/alerts        — liste des alertes persistées
 *                                           filtrables par statut.
 *   POST /super-admin/fraud/alerts/:id/resolve — clôt une alerte avec notes.
 *   POST /super-admin/fraud/refresh       — déclenche un recalcul global
 *                                           (crée les alertes manquantes).
 *
 * Aucun des endpoints n'écrit automatiquement dans la table hors
 * `/refresh` et `/resolve` : la liste `/scores` est **pure lecture** et ne
 * crée pas d'alerte, pour laisser le super-admin trier avant de persister.
 */
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/api-response.js';
import { NotFoundError, normalizeError } from '../../utils/errors.js';
import { buildSignalsForUser, refreshFraudAlerts } from './fraud.service.js';

const DAY_MS = 24 * 3600 * 1000;

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.warn?.({ error, action, userId: req.user?.id }, `Fraud endpoint failed: ${action}`);
      return fail(res, {
        status: normalized?.statusCode || 500,
        message: normalized?.publicMessage || (env.NODE_ENV === 'production' ? 'Opération impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || [],
      });
    }
  };
}

function parseLimit(raw, { def = 50, min = 1, max = 200 } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseLevel(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.toLowerCase();
  return ['safe', 'low', 'medium', 'high'].includes(v) ? v : null;
}

function serializeAlert(a) {
  return {
    id: a.id,
    userId: a.userId,
    user: a.user
      ? {
          id: a.user.id,
          fullName: a.user.fullName,
          email: a.user.email,
          phone: a.user.phone,
          role: a.user.role,
        }
      : null,
    score: a.score,
    level: a.level,
    flags: a.flags || [],
    notes: a.notes || null,
    resolvedAt: a.resolvedAt,
    resolvedById: a.resolvedById,
    resolvedBy: a.resolvedBy
      ? { id: a.resolvedBy.id, fullName: a.resolvedBy.fullName }
      : null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * GET /scores — recalcul live pour les utilisateurs actifs récemment.
 *
 * Query params :
 *   - `limit` (défaut 50, borne 1..200)
 *   - `level` optionnel : filtre sur safe|low|medium|high après calcul.
 *
 * Ordre : par score desc. L'ordre est stable grâce au tie-break sur userId.
 */
export const listFraudScores = handle('fraud.scores.list', async (req, res) => {
  const limit = parseLimit(req.query.limit, { def: 50, max: 200 });
  const levelFilter = parseLevel(req.query.level);
  const since = new Date(Date.now() - 30 * DAY_MS);

  // Candidats : utilisateurs public (client/driver), actifs récemment.
  // On prend un peu plus que `limit` pour filtrer post-calcul.
  const fetchLimit = Math.min(500, limit * 5 + 10);
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: { in: ['client', 'driver'] },
      OR: [
        { lastActiveAt: { gt: since } },
        { lastLogin: { gt: since } },
        { createdAt: { gt: since } },
        { sentParcels: { some: { updatedAt: { gt: since } } } },
      ],
    },
    select: { id: true },
    take: fetchLimit,
  });

  const scored = [];
  for (const { id } of candidates) {
    const built = await buildSignalsForUser(prisma, id);
    if (!built) continue;
    const { user, result } = built;
    if (levelFilter && result.level !== levelFilter) continue;
    scored.push({
      userId: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      score: result.score,
      level: result.level,
      flags: result.flags,
    });
  }

  scored.sort((a, b) => (b.score - a.score) || (a.userId < b.userId ? -1 : 1));
  const rows = scored.slice(0, limit);

  return ok(res, { message: 'Scores fraude', data: { scores: rows, total: rows.length } });
});

/**
 * GET /alerts — alertes persistées. `?status=open|resolved` (défaut: open).
 */
export const listFraudAlerts = handle('fraud.alerts.list', async (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const where = status === 'open' ? { resolvedAt: null } : { resolvedAt: { not: null } };

  const alerts = await prisma.fraudAlert.findMany({
    where,
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, role: true } },
      resolvedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return ok(res, {
    message: 'Alertes fraude',
    data: { alerts: alerts.map(serializeAlert), status },
  });
});

/**
 * POST /alerts/:id/resolve — clôt l'alerte avec notes libres.
 * 404 si inconnue. Idempotent sur une alerte déjà résolue : on écrase la
 * note et re-horodate, pour permettre la correction de commentaires.
 */
export const resolveFraudAlert = handle('fraud.alerts.resolve', async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.fraudAlert.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Alerte fraude introuvable');

  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) : null;

  const updated = await prisma.fraudAlert.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedById: req.user.id,
      notes: notes || existing.notes,
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, role: true } },
      resolvedBy: { select: { id: true, fullName: true } },
    },
  });
  return ok(res, { message: 'Alerte résolue', data: { alert: serializeAlert(updated) } });
});

/**
 * POST /refresh — déclenche un balayage et crée les alertes manquantes.
 * Renvoie `{ scanned, created, skipped }`.
 */
export const refreshFraudAlertsHandler = handle('fraud.refresh', async (_req, res) => {
  const counts = await refreshFraudAlerts(prisma);
  return ok(res, { message: 'Rafraîchissement effectué', data: counts });
});
