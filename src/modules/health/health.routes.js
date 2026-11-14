import { Router } from 'express';
import { ok } from '../../utils/api-response.js';
import { buildIntegrationsHealth } from '../../utils/integrations-health.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) =>
  ok(res, {
    message: 'API operationnelle',
    data: {
      data: {
        service: 'procolis-api',
        status: 'ok',
        timestamp: new Date().toISOString()
      }
    }
  })
);

// OPS-3 — Statut de configuration des intégrations tierces.
// Public (pas d'auth) : rend uniquement les flags de présence des secrets.
healthRouter.get('/integrations', (_req, res) => {
  const report = buildIntegrationsHealth();
  return ok(res, { message: 'Intégrations', data: report });
});
