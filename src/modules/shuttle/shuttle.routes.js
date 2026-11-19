/**
 * Shuttle Operator — CRUD lignes, flotte et horaires.
 *
 * Toutes les routes exigent :
 * 1. authenticate (JWT valide)
 * 2. requireRoles('shuttle_operator') — le rôle a été ajouté par la migration
 *    20261117_shuttle_operator_role.
 *
 * Monté sous `/shuttle-operator` dans app.js. Le catalogue public lecture
 * seule (lignes seedées DDD/AFTU) reste disponible via `/transit/*`.
 */
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/rbac.middleware.js';
import * as shuttleController from './shuttle.controller.js';

export const shuttleRouter = Router();

shuttleRouter.use(authenticate);
shuttleRouter.use(requireRoles('shuttle_operator'));

shuttleRouter.get('/overview', shuttleController.overview);
shuttleRouter.get('/live', shuttleController.live);

shuttleRouter.get('/lines', shuttleController.listLines);
shuttleRouter.post('/lines', shuttleController.createLine);
shuttleRouter.patch('/lines/:lineId', shuttleController.updateLine);
shuttleRouter.delete('/lines/:lineId', shuttleController.deleteLine);

shuttleRouter.get('/vehicles', shuttleController.listVehicles);
shuttleRouter.post('/vehicles', shuttleController.createVehicle);
shuttleRouter.patch('/vehicles/:vehicleId', shuttleController.updateVehicle);
shuttleRouter.delete('/vehicles/:vehicleId', shuttleController.deleteVehicle);

shuttleRouter.get('/schedules', shuttleController.listSchedules);
shuttleRouter.post('/schedules', shuttleController.createSchedule);
shuttleRouter.patch('/schedules/:scheduleId', shuttleController.updateSchedule);
shuttleRouter.delete('/schedules/:scheduleId', shuttleController.deleteSchedule);
