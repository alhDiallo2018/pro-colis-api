import { timingSafeEqual } from 'node:crypto';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { env } from '../config/env.js';

export const metricsRegistry = new Registry();

metricsRegistry.setDefaultLabels({
  service: 'api',
  environment: env.NODE_ENV,
  release: env.APP_RELEASE
});

collectDefaultMetrics({ register: metricsRegistry, prefix: 'procolis_' });

const httpRequests = new Counter({
  name: 'procolis_http_requests_total',
  help: 'Nombre de requetes HTTP traitees par l API',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry]
});

const httpDuration = new Histogram({
  name: 'procolis_http_request_duration_seconds',
  help: 'Duree des requetes HTTP traitees par l API',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry]
});

function normalizedRoute(req) {
  if (req.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }

  // Les routes 404 n'ont pas de pattern Express. Neutraliser les identifiants
  // et segments numeriques evite une serie Prometheus par URL utilisateur.
  return req.path
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[^/]{40,}(?=\/|$)/g, '/:token');
}

export function metricsMiddleware(req, res, next) {
  if (req.path === '/internal/metrics') return next();

  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const labels = {
      method: req.method,
      route: normalizedRoute(req),
      status_code: String(res.statusCode)
    };
    httpRequests.inc(labels);
    httpDuration.observe(labels, seconds);
  });

  return next();
}

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function metricsHandler(req, res) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!tokenMatches(token, env.METRICS_TOKEN)) {
    return res.status(401).json({
      success: false,
      message: 'Authentification metriques requise',
      error: { code: 'UNAUTHORIZED', details: [] }
    });
  }

  res.setHeader('Content-Type', metricsRegistry.contentType);
  return res.send(await metricsRegistry.metrics());
}
