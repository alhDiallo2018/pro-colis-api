// CRUD referentiel des moyens de paiement (wave, orange money, cash...).
//
// Le modele Prisma s'appelle `PaymentMethodOption` pour ne pas entrer en
// collision avec l'enum `PaymentMethod` deja utilise dans la colonne
// `parcels.payment_method`. Les routes publiques restent exposees sous
// `/reference/payment-methods` pour matcher la convention du front.
import { z } from 'zod';
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const createSchema = baseCreateSchema.extend({
  provider: z.string().trim().max(64).optional().nullable(),
  channel: z.string().trim().min(1).max(32)
});

const updateSchema = baseUpdateSchema.extend({
  provider: z.string().trim().max(64).optional().nullable(),
  channel: z.string().trim().min(1).max(32).optional()
});

const controller = makeReferenceController({
  entityType: 'payment_method',
  modelName: 'paymentMethodOption',
  createSchema,
  updateSchema,
  filterFields: ['channel']
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
