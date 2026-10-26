import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.middleware.js';
import { ok, fail } from '../../utils/api-response.js';
import { normalizeError } from '../../utils/errors.js';
import * as places from './places.service.js';

export const placesRouter = Router();
// La recherche est également utilisée à l'inscription, avant connexion.
// Ce quota dédié limite les appels facturables indépendamment du quota global.
placesRouter.use(rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false }));
placesRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const sessionToken = z.string().regex(/^[a-zA-Z0-9_-]{1,36}$/).optional();
const schema = shape => z.object({ query: z.object(shape) });
const coordinate = (min, max) => z.string().trim().min(1).pipe(z.coerce.number().finite().min(min).max(max));

function handle(action, fn) {
  return async (req, res) => {
    try {
      return ok(res, { data: { data: await fn(req.validated.query) } });
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error({ action, providerStatus: error.providerStatus, code: normalized?.code ?? 'INTERNAL_ERROR', requestId: req.requestId }, 'Recherche de lieu impossible');
      return fail(res, { status: normalized?.statusCode ?? 500,
        code: normalized?.code ?? 'INTERNAL_ERROR', message: normalized?.publicMessage ?? 'Recherche de lieu impossible' });
    }
  };
}
placesRouter.get('/autocomplete', validate(schema({ input: z.string().trim().min(2).max(200), sessionToken })),
  handle('places.autocomplete', q => places.autocomplete(q.input, q.sessionToken)));
placesRouter.get('/details', validate(schema({ placeId: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/), sessionToken })),
  handle('places.details', q => places.placeDetails(q.placeId, q.sessionToken)));
placesRouter.get('/reverse', validate(schema({ latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) })),
  handle('places.reverse', q => places.reverseGeocode(q.latitude, q.longitude)));
