/**
 * Routes consolidation / backhaul — monté sous `/drivers` dans app.js.
 *
 * - `authenticate` : JWT valide.
 * - `requireRoles('driver', 'shuttle_operator')` : seuls ces deux rôles ont
 *   besoin d'accéder au matching de colis contre une annonce chauffeur.
 */
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as controller from './consolidation.controller.js';

export const consolidationRouter = Router();

consolidationRouter.get(
  '/backhaul-matches/:advertisementId',
  authenticate,
  requireRoles('driver', 'shuttle_operator'),
  controller.listBackhaulMatches
);
