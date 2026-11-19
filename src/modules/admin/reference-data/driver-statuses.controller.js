// CRUD referentiel des statuts chauffeur (available, busy, offline, on_leave).
//
// Complete l'enum Prisma `DriverStatus` utilise par la colonne
// `users.driver_status`. Le referentiel permet d'ajouter des valeurs
// (ex: 'on_leave', 'training') sans migration tant qu'aucune logique
// interne ne se base sur le code.
import { z } from 'zod';
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const createSchema = baseCreateSchema.extend({
  color: z.string().trim().max(32).optional().nullable()
});

const updateSchema = baseUpdateSchema.extend({
  color: z.string().trim().max(32).optional().nullable()
});

const controller = makeReferenceController({
  entityType: 'driver_status',
  modelName: 'driverStatusOption',
  createSchema,
  updateSchema
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
