import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as observabilityController from './observability.controller.js';

const consultationRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: {
    success: false,
    message: 'Trop de consultations des journaux',
    error: { code: 'TOO_MANY_REQUESTS', details: [] }
  }
});

const exportRateLimit = rateLimit({
  windowMs: 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: {
    success: false,
    message: 'Trop d exports de journaux',
    error: { code: 'TOO_MANY_REQUESTS', details: [] }
  }
});

export const observabilityRouter = Router();

// Les traces et stacks peuvent contenir du contexte sensible : contrairement
// aux autres ecrans de support, aucun role support n'est autorise ici.
observabilityRouter.use(authenticate, requireRoles('super_admin'));
observabilityRouter.get('/summary', consultationRateLimit, observabilityController.summary);
observabilityRouter.get('/logs', consultationRateLimit, observabilityController.list);
observabilityRouter.get('/services', consultationRateLimit, observabilityController.services);
observabilityRouter.get('/export', exportRateLimit, observabilityController.exportEntries);
