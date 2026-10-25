import { ForbiddenError } from '../../utils/errors.js';

export const MESSAGE_ROLES = ['super_admin', 'admin', 'support', 'support_technique', 'support_commercial'];

/** Les admins de zone conservent leur périmètre, même si un ID est fourni
 * directement au point d'envoi au lieu d'être choisi dans le sélecteur. */
export function recipientScope(actor) {
  if (!MESSAGE_ROLES.includes(actor.role)) throw new ForbiddenError();
  if (actor.role !== 'admin') return {};
  if (!actor.garageId) return { id: '00000000-0000-0000-0000-000000000000' };
  return { garageId: actor.garageId, role: { in: ['client', 'driver'] } };
}
