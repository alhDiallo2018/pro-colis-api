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

// Les traces et stacks peuvent contenir du contexte sensible. Le support
// technique lit les journaux pour qualifier un incident, mais le controleur ne
// lui renvoie qu'une vue reduite (ni stack, ni contexte, ni userId) ; l'export,
// qui contient les entrees completes, reste reserve au super administrateur.
const readRoles = requireRoles('super_admin', 'support_technique');
const exportRoles = requireRoles('super_admin');

observabilityRouter.use(authenticate);
observabilityRouter.get('/summary', readRoles, consultationRateLimit, observabilityController.summary);
observabilityRouter.get('/logs', readRoles, consultationRateLimit, observabilityController.list);
observabilityRouter.get('/services', readRoles, consultationRateLimit, observabilityController.services);
observabilityRouter.get('/export', exportRoles, exportRateLimit, observabilityController.exportEntries);
