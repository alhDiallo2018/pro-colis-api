import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as supportController from './support.controller.js';
import * as mobileController from '../mobile/mobile.controller.js';

export const supportRouter = Router();

// Le support technique traite les tickets et les incidents ; le commercial suit
// son pipeline. Le super admin conserve un accès transverse aux deux espaces.
const technique = [authenticate, requireRoles('support_technique', 'super_admin')];
const commercial = [authenticate, requireRoles('support_commercial', 'super_admin')];

// --- Profils ---
supportRouter.put(
  '/support-technique/profile',
  authenticate,
  requireRoles('support_technique'),
  supportController.updateSupportProfile
);
supportRouter.put(
  '/support-commercial/profile',
  authenticate,
  requireRoles('support_commercial'),
  supportController.updateSupportProfile
);

// --- Support technique ---
supportRouter.get('/support-technique/stats', ...technique, supportController.supportTechniqueStats);
supportRouter.get('/support-technique/tickets', ...technique, supportController.listTickets);
supportRouter.get('/support-technique/tickets/:ticketId', ...technique, supportController.getTicket);
supportRouter.patch('/support-technique/tickets/:ticketId', ...technique, supportController.updateTicket);
supportRouter.get('/support-technique/incidents', ...technique, supportController.listIncidents);
supportRouter.post('/support-technique/incidents', ...technique, supportController.createIncident);
supportRouter.patch(
  '/support-technique/incidents/:incidentId',
  ...technique,
  supportController.updateIncident
);

// --- Support commercial ---
supportRouter.get('/support-commercial/stats', ...commercial, supportController.supportCommercialStats);
supportRouter.get('/support-commercial/leads', ...commercial, supportController.listLeads);
supportRouter.post('/support-commercial/leads', ...commercial, supportController.createLead);
supportRouter.patch('/support-commercial/leads/:leadId', ...commercial, supportController.updateLead);
supportRouter.get('/support-commercial/coverage', ...commercial, supportController.coverage);

// --- Lecture des colis ---
// Le support instruit des réclamations : il lit un colis mais ne le modifie
// pas. On réutilise le handler existant, qui ne fait que lire — aucune route
// d'écriture n'est exposée sous ces préfixes.
supportRouter.get('/support-technique/parcels/:parcelId', ...technique, mobileController.getParcelDetail);
supportRouter.get('/support-commercial/parcels/:parcelId', ...commercial, mobileController.getParcelDetail);
