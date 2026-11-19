// CRUD referentiel des types de document (permis, carte grise, assurance...).
//
// `appliesTo` cible la population concernee ('driver', 'vehicle', 'user').
// Le front filtre la liste affichee a l'ecran selon le contexte.
import { z } from 'zod';
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const createSchema = baseCreateSchema.extend({
  appliesTo: z.string().trim().min(1).max(32),
  isRequired: z.boolean().optional()
});

const updateSchema = baseUpdateSchema.extend({
  appliesTo: z.string().trim().min(1).max(32).optional(),
  isRequired: z.boolean().optional()
});

const controller = makeReferenceController({
  entityType: 'document_type',
  modelName: 'documentType',
  createSchema,
  updateSchema,
  filterFields: ['appliesTo']
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
