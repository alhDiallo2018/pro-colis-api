/**
 * Fraud module — routes montées sous `/super-admin/fraud`.
 *
 * Accès : `authenticate` + rôle `super_admin` uniquement. Note : le middleware
 * utilitaire local s'appelle `requireRoles`, pas `authorize` ; l'API publique
 * reste la même (liste de rôles autorisés).
 *
 * Montage attendu dans `src/app.js` :
 *   apiV1.use('/super-admin/fraud', fraudRouter);
 */
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as controller from './fraud.controller.js';

export const fraudRouter = Router();

fraudRouter.use(authenticate);
fraudRouter.use(requireRoles('super_admin'));

fraudRouter.get('/scores', controller.listFraudScores);
fraudRouter.get('/alerts', controller.listFraudAlerts);
fraudRouter.post('/alerts/:id/resolve', controller.resolveFraudAlert);
fraudRouter.post('/refresh', controller.refreshFraudAlertsHandler);
