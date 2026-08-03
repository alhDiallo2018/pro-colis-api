import pinoHttp from 'pino-http';
import { logger, sanitizeForLog } from '../config/logger.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.requestId,
  customLogLevel(_req, res, error) {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req) => ({
    // L'identifiant de requete est deja serialise dans `req.id` par pino-http.
    // Le dupliquer ici produit deux cles JSON identiques dans le log final.
    userId: req.user?.id,
    role: req.user?.role
  }),
  serializers: {
    req(req) {
      return sanitizeForLog({
        id: req.id,
        method: req.method,
        url: req.url
      });
    }
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.originalUrl} completed with ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.originalUrl} failed with ${res.statusCode}`
});
