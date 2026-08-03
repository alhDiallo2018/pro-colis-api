import { prisma } from '../../config/prisma.js';
import { fail, ok } from '../../utils/api-response.js';
import { normalizeError } from '../../utils/errors.js';
import {
  exportLogs,
  getLogs,
  getServices,
  getSummary,
  parseObservabilityQuery
} from './observability.service.js';

function handleControllerError(req, res, error, action) {
  const normalized = normalizeError(error);
  const status = normalized?.statusCode || 500;

  // Une erreur de filtre est imputable au client et ne doit pas declencher une
  // alerte de production. Les pannes amont et erreurs inattendues sont loggees.
  if (status >= 500) {
    req.log.error(
      { error, action, userId: req.user?.id, requestId: req.requestId },
      `Observability endpoint failed: ${action}`
    );
  } else {
    req.log.warn(
      { action, code: normalized?.code, userId: req.user?.id, requestId: req.requestId },
      `Observability query rejected: ${action}`
    );
  }

  return fail(res, {
    status,
    message: normalized?.publicMessage || 'Impossible de consulter l observabilite',
    code: normalized?.code || 'INTERNAL_ERROR',
    details: normalized?.details || []
  });
}

export async function summary(req, res) {
  try {
    const filters = parseObservabilityQuery(req.query);
    const summaryData = await getSummary(filters);
    return ok(res, { message: 'Resume d observabilite', data: { summary: summaryData } });
  } catch (error) {
    return handleControllerError(req, res, error, 'observability.summary');
  }
}

export async function list(req, res) {
  try {
    const filters = parseObservabilityQuery(req.query);
    const result = await getLogs(filters);
    return ok(res, { message: 'Journaux techniques', data: result });
  } catch (error) {
    return handleControllerError(req, res, error, 'observability.list');
  }
}

export async function services(req, res) {
  try {
    const serviceRows = await getServices();
    return ok(res, { message: 'Etat des services', data: { services: serviceRows } });
  } catch (error) {
    return handleControllerError(req, res, error, 'observability.services');
  }
}

export async function exportEntries(req, res) {
  try {
    const filters = parseObservabilityQuery(req.query, { exportMode: true });
    const exported = await exportLogs(filters);

    // L'audit est ecrit avant la reponse : un export non audite ne doit jamais
    // etre livre, meme si Loki a deja renvoye son resultat.
    await prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'observability.export',
        entityType: 'observability',
        beforeData: null,
        afterData: {
          source: filters.source || null,
          levels: filters.levels,
          from: filters.from.toISOString(),
          to: filters.to.toISOString(),
          format: filters.format,
          count: exported.count
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="procolis-logs-${stamp}.${exported.extension}"`);
    res.setHeader('X-Exported-Entries', String(exported.count));
    return res.status(200).send(exported.content);
  } catch (error) {
    return handleControllerError(req, res, error, 'observability.export');
  }
}
