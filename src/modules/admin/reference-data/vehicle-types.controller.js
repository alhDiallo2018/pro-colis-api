// CRUD referentiel des types de vehicule.
//
// `category` distingue les familles exploitees cote clients (ex: 'shuttle'
// cache les bus/tata dans l'editeur de trajet, 'moto' vs 'car' vs 'truck'
// permettent le filtrage mobile). Les colonnes `maxWeightKg` /
// `maxVolumeM3` sont optionnelles pour accepter des types mal renseignes
// pendant la migration.
import { z } from 'zod';
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const createSchema = baseCreateSchema.extend({
  category: z.string().trim().min(1).max(32),
  maxWeightKg: z.number().nonnegative().optional().nullable(),
  maxVolumeM3: z.number().nonnegative().optional().nullable()
});

const updateSchema = baseUpdateSchema.extend({
  category: z.string().trim().min(1).max(32).optional(),
  maxWeightKg: z.number().nonnegative().optional().nullable(),
  maxVolumeM3: z.number().nonnegative().optional().nullable()
});

const controller = makeReferenceController({
  entityType: 'vehicle_type',
  modelName: 'vehicleType',
  createSchema,
  updateSchema,
  filterFields: ['category']
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
