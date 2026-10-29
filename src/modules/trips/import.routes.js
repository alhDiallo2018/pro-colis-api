import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import { normalizeError, ValidationError } from '../../utils/errors.js';
import { ok, fail } from '../../utils/api-response.js';
import { importShuttleRoutes, previewShuttleImport, shuttleImportPreview } from './import.service.js';

export const tripImportRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 128 * 1024, files: 1, fields: 0 } }).single('file');
const importLimit = rateLimit({ windowMs: 60000, limit: 10, keyGenerator: req => req.user.id,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Patientez une minute avant un nouvel import.', error: { code: 'RATE_LIMITED', details: [] } } });

function handleImport(preview) {
  return async (req, res) => {
    try {
      // Le parsing et toute la transaction restent dans le même try/catch ;
      // aucun contenu du CSV n’est envoyé dans les journaux.
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file || !/\.csv$/i.test(req.file.originalname)) throw new ValidationError([], 'Sélectionnez un fichier CSV');
      const templates = preview
        ? shuttleImportPreview(await previewShuttleImport(req.user, req.file.buffer))
        : await importShuttleRoutes(req.user, req.file.buffer);
      return ok(res, { data: { templates, count: templates.length } });
    } catch (error) {
      const normalized = error instanceof multer.MulterError
        ? new ValidationError([], 'Un seul fichier CSV de 128 Ko maximum est accepté') : normalizeError(error);
      const status = normalized?.statusCode ?? 500;
      req.log[status >= 500 ? 'error' : 'warn']({ action: 'route.templates.import', userId: req.user.id,
        requestId: req.requestId, code: normalized?.code ?? 'INTERNAL_ERROR', errorType: error.name,
        ...(status >= 500 ? { error } : {}) }, 'Import itinéraires impossible');
      return fail(res, { status, code: normalized?.code ?? 'INTERNAL_ERROR',
        message: normalized?.publicMessage ?? 'Import impossible. Réessayez.', details: normalized?.details ?? [] });
    }
  };
}
tripImportRouter.use(authenticate, requireRoles('driver'), importLimit);
tripImportRouter.post('/preview', handleImport(true));
tripImportRouter.post('/', handleImport(false));
