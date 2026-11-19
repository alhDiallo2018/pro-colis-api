// CRUD referentiel des categories de depenses (loyer, salaires, carburant...).
//
// La depense elle-meme stocke un libelle (`category` String), ce qui laisse
// l'historique intact si une categorie est renommee ou desactivee.
import {
  makeReferenceController,
  baseCreateSchema,
  baseUpdateSchema
} from './reference-data.service.js';

const controller = makeReferenceController({
  entityType: 'expense_category',
  modelName: 'expenseCategory',
  createSchema: baseCreateSchema,
  updateSchema: baseUpdateSchema
});

export const list = controller.list;
export const get = controller.get;
export const create = controller.create;
export const update = controller.update;
export const remove = controller.remove;
export const publicList = controller.publicList;
