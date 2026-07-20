import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as zoneController from './zone.controller.js';

export const zoneRouter = Router();

const superAdmin = [authenticate, requireRoles('super_admin')];

zoneRouter.get('/public/zones', optionalAuthenticate, zoneController.listPublicZones);
zoneRouter.get('/zones/detect', optionalAuthenticate, zoneController.detectZones);

zoneRouter.get('/super-admin/zones', ...superAdmin, zoneController.listZones);
zoneRouter.post('/super-admin/zones', ...superAdmin, zoneController.createZone);
zoneRouter.post('/super-admin/zones/migrate', ...superAdmin, zoneController.migrateGarages);
zoneRouter.get('/super-admin/zones/:zoneId', ...superAdmin, zoneController.getZone);
zoneRouter.put('/super-admin/zones/:zoneId', ...superAdmin, zoneController.updateZone);
zoneRouter.delete('/super-admin/zones/:zoneId', ...superAdmin, zoneController.deleteZone);
zoneRouter.get('/super-admin/zones/:zoneId/drivers', ...superAdmin, zoneController.listZoneDrivers);
zoneRouter.post('/super-admin/zones/:zoneId/drivers', ...superAdmin, zoneController.assignDriver);
zoneRouter.post('/super-admin/zones/:zoneId/drivers/bulk', ...superAdmin, zoneController.bulkAssignDrivers);
zoneRouter.delete('/super-admin/zones/:zoneId/drivers', ...superAdmin, zoneController.removeDriver);
