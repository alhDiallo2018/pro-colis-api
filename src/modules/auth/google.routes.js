import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.middleware.js';
import { authRateLimit } from '../../middlewares/rate-limit.middleware.js';
import { ok, fail } from '../../utils/api-response.js';
import { normalizeError } from '../../utils/errors.js';
import * as google from './google.service.js';

const token = z.string().regex(/^[a-f0-9]{64}$/);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Numéro international invalide');
const pin = z.string().regex(/^\d{6}$/, 'Le PIN doit contenir six chiffres');
const schema = body => z.object({ body: z.object(body), params: z.object({}).default({}), query: z.object({}).default({}) });

/** Chaque controleur critique passe ici : erreur publique normalisee et
 * diagnostic structure, sans corps HTTP, jeton Google, OTP ni PIN.
 */
const handle = (action, operation) => async (req, res) => {
  try {
    return ok(res, { data: await operation(req.validated?.body || {}) });
  } catch (error) {
    const normalized = normalizeError(error);
    req.log?.error({ action, requestId: req.requestId, errorType: error.name, errorCode: normalized?.code || 'INTERNAL_ERROR' }, 'Google authentication failed');
    return fail(res, { status: normalized?.statusCode || 500,
      message: normalized?.publicMessage || 'Connexion impossible. Veuillez réessayer.',
      code: normalized?.code || 'INTERNAL_ERROR' });
  }
};

export const googleRouter = Router();
googleRouter.get('/config', (req, res) => { res.set('Cache-Control', 'no-store'); return ok(res, { data: google.googleConfiguration() }); });
googleRouter.use(authRateLimit);
googleRouter.post('/', validate(schema({ idToken: z.string().min(20).max(12000) })), handle('auth.google', google.startGoogle));
googleRouter.post('/link', validate(schema({ challengeToken: token, identifier: z.string().trim().min(3).max(254), pin })), handle('auth.google.link', google.linkGoogle));
googleRouter.post('/phone-otp', validate(schema({ challengeToken: token, phone })), handle('auth.google.otp', google.sendGooglePhoneOtp));
googleRouter.post('/register', validate(schema({ challengeToken: token, phone, otpCode: pin,
  fullName: z.string().trim().min(2).max(100), pin, role: z.enum(['client', 'driver']), acceptedTerms: z.literal(true)
})), handle('auth.google.register', google.registerGoogle));
