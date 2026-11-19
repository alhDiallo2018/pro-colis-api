// Routes admin + routes publiques des referentiels.
//
// `adminReferenceRouter` est monte sous `/api/v1/admin/reference` et protege
// par authenticate + requireRoles('super_admin','admin'). `publicReferenceRouter`
// est monte sous `/api/v1/reference`, sans auth, filtre sur isActive=true.
import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth.middleware.js';
import { requireRoles } from '../../../middlewares/rbac.middleware.js';
import * as vehicleTypes from './vehicle-types.controller.js';
import * as documentTypes from './document-types.controller.js';
import * as expenseCategories from './expense-categories.controller.js';
// Phase 5 : 4 nouveaux referentiels editables.
import * as parcelCategories from './parcel-categories.controller.js';
import * as paymentMethods from './payment-methods.controller.js';
import * as driverStatuses from './driver-statuses.controller.js';
import * as incidentSeverities from './incident-severities.controller.js';

const admin = [authenticate, requireRoles('super_admin', 'admin')];

export const adminReferenceRouter = Router();
export const publicReferenceRouter = Router();

// Factorisation : chaque entite expose la meme famille de routes.
function mountAdmin(router, basePath, ctrl) {
  router.get(basePath, ...admin, ctrl.list);
  router.post(basePath, ...admin, ctrl.create);
  router.get(`${basePath}/:id`, ...admin, ctrl.get);
  router.put(`${basePath}/:id`, ...admin, ctrl.update);
  router.delete(`${basePath}/:id`, ...admin, ctrl.remove);
}

function mountPublic(router, basePath, ctrl) {
  router.get(basePath, ctrl.publicList);
}

mountAdmin(adminReferenceRouter, '/vehicle-types', vehicleTypes);
mountAdmin(adminReferenceRouter, '/document-types', documentTypes);
mountAdmin(adminReferenceRouter, '/expense-categories', expenseCategories);
mountAdmin(adminReferenceRouter, '/parcel-categories', parcelCategories);
mountAdmin(adminReferenceRouter, '/payment-methods', paymentMethods);
mountAdmin(adminReferenceRouter, '/driver-statuses', driverStatuses);
mountAdmin(adminReferenceRouter, '/incident-severities', incidentSeverities);

mountPublic(publicReferenceRouter, '/vehicle-types', vehicleTypes);
mountPublic(publicReferenceRouter, '/document-types', documentTypes);
mountPublic(publicReferenceRouter, '/expense-categories', expenseCategories);
mountPublic(publicReferenceRouter, '/parcel-categories', parcelCategories);
mountPublic(publicReferenceRouter, '/payment-methods', paymentMethods);
mountPublic(publicReferenceRouter, '/driver-statuses', driverStatuses);
mountPublic(publicReferenceRouter, '/incident-severities', incidentSeverities);
