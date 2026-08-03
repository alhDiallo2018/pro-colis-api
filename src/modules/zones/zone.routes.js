import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as zoneController from './zone.controller.js';

export const zoneRouter = Router();

const superAdmin = [authenticate, requireRoles('super_admin', 'support')];

zoneRouter.get('/public/zones', optionalAuthenticate, zoneController.listPublicZones);
// Déclarée ici plutôt que dans le module mobile : la résolution zone / garage
// miroir vit avec le référentiel. Le routeur zone étant monté avant le routeur
// mobile, ce chemin passe avant `/public/drivers/:driverId`.
zoneRouter.get('/public/drivers/zone/:zoneId', optionalAuthenticate, zoneController.zonePublicDrivers);
zoneRouter.get('/zones/detect', optionalAuthenticate, zoneController.detectZones);

// Favoris exprimés en zones. `/favorites/garages` (module mobile) reste servi
// pour les clients publiés avant la migration.
zoneRouter.get('/favorites/zones', authenticate, zoneController.listFavoriteZones);
zoneRouter.post('/favorites/zones/:zoneId', authenticate, zoneController.addFavoriteZone);
zoneRouter.delete('/favorites/zones/:zoneId', authenticate, zoneController.removeFavoriteZone);
// Résolution d'un lieu Google Places → zone (création à la volée en "pending").
zoneRouter.post('/zones/resolve', authenticate, zoneController.resolveZone);

zoneRouter.get('/super-admin/zones', ...superAdmin, zoneController.listZones);
zoneRouter.post('/super-admin/zones', ...superAdmin, zoneController.createZone);
zoneRouter.patch('/super-admin/zones/:zoneId/status', ...superAdmin, zoneController.setZoneStatus);
zoneRouter.post('/super-admin/zones/migrate', ...superAdmin, zoneController.migrateGarages);
zoneRouter.get('/super-admin/zones/:zoneId', ...superAdmin, zoneController.getZone);
zoneRouter.put('/super-admin/zones/:zoneId', ...superAdmin, zoneController.updateZone);
zoneRouter.delete('/super-admin/zones/:zoneId', ...superAdmin, zoneController.deleteZone);
zoneRouter.get('/super-admin/zones/:zoneId/drivers', ...superAdmin, zoneController.listZoneDrivers);
zoneRouter.post('/super-admin/zones/:zoneId/drivers', ...superAdmin, zoneController.assignDriver);
zoneRouter.post('/super-admin/zones/:zoneId/drivers/bulk', ...superAdmin, zoneController.bulkAssignDrivers);
zoneRouter.delete('/super-admin/zones/:zoneId/drivers', ...superAdmin, zoneController.removeDriver);
