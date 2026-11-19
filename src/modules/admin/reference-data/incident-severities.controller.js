// CRUD referentiel des niveaux de severite incidents (low/medium/high/critical).
//
// `slaHours` exprime le delai de reponse attendu, utile pour les
// tableaux de bord Ops. L'enum Prisma `IncidentSeverity` (sev1..sev3) reste
// en place cote DB ; la table est un sur-ensemble editable pour l'UI.
import { z } from 'zod';
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const createSchema = baseCreateSchema.extend({
  color: z.string().trim().max(32).optional().nullable(),
  slaHours: z.number().int().nonnegative().optional().nullable()
});

const updateSchema = baseUpdateSchema.extend({
  color: z.string().trim().max(32).optional().nullable(),
  slaHours: z.number().int().nonnegative().optional().nullable()
});

const controller = makeReferenceController({
  entityType: 'incident_severity',
  modelName: 'incidentSeverityLevel',
  createSchema,
  updateSchema
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
