import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/api-response.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { ValidationError, NotFoundError, normalizeError } from '../utils/errors.js';

// Journal des assistances : chaque interaction où un utilisateur est assisté,
// avec le canal utilisé, pour tracer l'historique et faciliter le suivi.
// Aligné sur les conventions de admin-finance.controller.js.

const CHANNELS = ['email', 'chat', 'call'];
const STATUSES = ['open', 'in_progress', 'resolved'];

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.error?.(
        { error, action, userId: req.user?.id, requestId: req.requestId },
        `Admin assistance endpoint failed: ${action}`
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

/** Génère un code lisible ASS-000123 ; suffixe aléatoire en secours si collision. */
async function generateCode() {
  const count = await prisma.assistance.count();
  const base = `ASS-${String(count + 1).padStart(5, '0')}`;
  const existing = await prisma.assistance.findUnique({ where: { code: base } });
  if (!existing) return base;
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `ASS-${String(count + 1).padStart(5, '0')}-${suffix}`;
}

function serialize(a) {
  if (!a) return null;
  return {
    id: a.id,
    code: a.code,
    channel: a.channel,
    subject: a.subject,
    notes: a.notes ?? null,
    status: a.status,
    contactName: a.contactName ?? null,
    contactPhone: a.contactPhone ?? null,
    userId: a.userId ?? null,
    user: a.user
      ? { id: a.user.id, fullName: a.user.fullName, phone: a.user.phone, email: a.user.email, role: a.user.role }
      : null,
    handledById: a.handledById ?? null,
    handledBy: a.handledBy ? { id: a.handledBy.id, fullName: a.handledBy.fullName } : null,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    createdAt: a.createdAt?.toISOString() ?? null,
    updatedAt: a.updatedAt?.toISOString() ?? null
  };
}

const includeRelations = {
  user: { select: { id: true, fullName: true, phone: true, email: true, role: true } },
  handledBy: { select: { id: true, fullName: true } }
};

export const listAssistances = handle('assistance.list', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { search, channel, status } = req.query;

  const where = {
    ...(channel && CHANNELS.includes(channel) ? { channel } : {}),
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { subject: { contains: search, mode: 'insensitive' } },
            { contactName: { contains: search, mode: 'insensitive' } },
            { contactPhone: { contains: search, mode: 'insensitive' } },
            { user: { fullName: { contains: search, mode: 'insensitive' } } }
          ]
        }
      : {})
  };

  const [total, open, inProgress, resolved, rows] = await Promise.all([
    prisma.assistance.count({ where }),
    prisma.assistance.count({ where: { ...where, status: 'open' } }),
    prisma.assistance.count({ where: { ...where, status: 'in_progress' } }),
    prisma.assistance.count({ where: { ...where, status: 'resolved' } }),
    prisma.assistance.findMany({
      where,
      include: includeRelations,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Assistances',
    data: {
      assistances: rows.map(serialize),
      summary: { total, open, inProgress, resolved }
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getAssistance = handle('assistance.get', async (req, res) => {
  const assistance = await prisma.assistance.findUnique({
    where: { id: req.params.assistanceId },
    include: includeRelations
  });
  if (!assistance) throw new NotFoundError('Assistance introuvable');
  return ok(res, { message: 'Assistance', data: { assistance: serialize(assistance) } });
});

export const createAssistance = handle('assistance.create', async (req, res) => {
  const { channel, subject, notes, userId, contactName, contactPhone, status } = req.body;

  const errors = [];
  if (!channel || !CHANNELS.includes(channel)) {
    errors.push({ path: 'channel', message: 'Canal requis (email, chat ou call)' });
  }
  if (!subject || !String(subject).trim()) {
    errors.push({ path: 'subject', message: 'Motif requis' });
  }
  if (errors.length) throw new ValidationError(errors);

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new ValidationError([{ path: 'userId', message: 'Utilisateur introuvable' }]);
  }

  const finalStatus = STATUSES.includes(status) ? status : 'open';
  const code = await generateCode();

  const assistance = await prisma.assistance.create({
    data: {
      code,
      channel,
      subject: String(subject).trim(),
      notes: notes ? String(notes) : null,
      userId: userId || null,
      contactName: contactName ? String(contactName) : null,
      contactPhone: contactPhone ? String(contactPhone) : null,
      status: finalStatus,
      handledById: req.user?.id || null,
      resolvedAt: finalStatus === 'resolved' ? new Date() : null
    },
    include: includeRelations
  });

  return ok(res, {
    status: 201,
    message: 'Assistance enregistrée',
    data: { assistance: serialize(assistance) }
  });
});

export const updateAssistance = handle('assistance.update', async (req, res) => {
  const existing = await prisma.assistance.findUnique({ where: { id: req.params.assistanceId } });
  if (!existing) throw new NotFoundError('Assistance introuvable');

  const { channel, subject, notes, status, contactName, contactPhone, userId } = req.body;
  if (channel !== undefined && !CHANNELS.includes(channel)) {
    throw new ValidationError([{ path: 'channel', message: 'Canal invalide' }]);
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    throw new ValidationError([{ path: 'status', message: 'Statut invalide' }]);
  }

  const data = {
    ...(channel !== undefined ? { channel } : {}),
    ...(subject !== undefined ? { subject: String(subject).trim() } : {}),
    ...(notes !== undefined ? { notes: notes ? String(notes) : null } : {}),
    ...(contactName !== undefined ? { contactName: contactName ? String(contactName) : null } : {}),
    ...(contactPhone !== undefined ? { contactPhone: contactPhone ? String(contactPhone) : null } : {}),
    ...(userId !== undefined ? { userId: userId || null } : {})
  };

  if (status !== undefined && status !== existing.status) {
    data.status = status;
    data.resolvedAt = status === 'resolved' ? new Date() : null;
  }

  const assistance = await prisma.assistance.update({
    where: { id: req.params.assistanceId },
    data,
    include: includeRelations
  });

  return ok(res, { message: 'Assistance mise à jour', data: { assistance: serialize(assistance) } });
});

export const deleteAssistance = handle('assistance.delete', async (req, res) => {
  const existing = await prisma.assistance.findUnique({ where: { id: req.params.assistanceId } });
  if (!existing) throw new NotFoundError('Assistance introuvable');
  await prisma.assistance.delete({ where: { id: req.params.assistanceId } });
  return ok(res, { message: 'Assistance supprimée' });
});
