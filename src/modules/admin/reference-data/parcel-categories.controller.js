// CRUD referentiel des categories de colis (document, package, fragile...).
//
// Cette table complete (sans remplacer) l'enum Prisma `ParcelType` encore
// utilise par la colonne `parcels.type`. Le front peut deja consommer la
// liste pour alimenter les dropdowns et proposer de nouvelles categories
// (electronics, clothing...) sans migration de schema.
import { z } from 'zod';
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const createSchema = baseCreateSchema.extend({
  icon: z.string().trim().max(64).optional().nullable(),
  maxWeightKg: z.number().nonnegative().optional().nullable(),
  isFragile: z.boolean().optional()
});

const updateSchema = baseUpdateSchema.extend({
  icon: z.string().trim().max(64).optional().nullable(),
  maxWeightKg: z.number().nonnegative().optional().nullable(),
  isFragile: z.boolean().optional()
});

const controller = makeReferenceController({
  entityType: 'parcel_category',
  modelName: 'parcelCategory',
  createSchema,
  updateSchema
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
