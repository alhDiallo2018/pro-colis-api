import { prisma } from '../../config/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const BATCH_STATUSES = Object.freeze(['draft', 'open', 'closed', 'cancelled']);
const BATCH_MUTABLE_STATUSES = Object.freeze(['draft', 'open']);

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Crée un batch commercial, vide par défaut. Le créateur devient propriétaire
 * et seul lui (+ admin + partenaire via api_key_id) peut le modifier.
 */
export async function createBatch({ actor, body }) {
  const reference = typeof body?.reference === 'string' && body.reference.trim() ? body.reference.trim().slice(0, 100) : null;
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 200) : null;
  const metadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {};
  const apiKeyId = typeof body?.apiKeyId === 'string' && body.apiKeyId.trim() ? body.apiKeyId.trim().slice(0, 100) : null;

  return prisma.shipmentBatch.create({
    data: {
      creatorId: actor.id,
      apiKeyId,
      reference,
      label,
      status: 'draft',
      metadata
    }
  });
}

/**
 * Attache un ensemble de colis à un batch. Les colis doivent appartenir au
 * même créateur (ou l'actor doit être admin). Met à jour totalParcels + totalWeightKg.
 */
export async function attachParcels({ batchId, actor, parcelIds }) {
  if (!isUuid(batchId)) throw new ValidationError([{ path: 'batchId', message: 'Identifiant invalide' }]);
  if (!Array.isArray(parcelIds) || !parcelIds.length) {
    throw new ValidationError([{ path: 'parcelIds', message: 'Liste de colis vide' }]);
  }
  for (const id of parcelIds) {
    if (!isUuid(id)) throw new ValidationError([{ path: 'parcelIds', message: `UUID colis invalide : ${id}` }]);
  }

  return prisma.$transaction(async (tx) => {
    const batch = await tx.shipmentBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundError('Lot introuvable');
    if (!BATCH_MUTABLE_STATUSES.includes(batch.status)) {
      throw new ConflictError(`Le lot est en statut ${batch.status}, modification refusée`);
    }
    if (actor.role !== 'super_admin' && batch.creatorId !== actor.id) {
      throw new ForbiddenError('Vous ne pouvez pas modifier ce lot');
    }

    const parcels = await tx.parcel.findMany({
      where: { id: { in: parcelIds }, deletedAt: null },
      select: { id: true, senderId: true, batchId: true, weight: true }
    });
    if (parcels.length !== parcelIds.length) {
      throw new NotFoundError('Un ou plusieurs colis introuvables');
    }
    if (actor.role !== 'super_admin') {
      const foreign = parcels.find((p) => p.senderId !== actor.id);
      if (foreign) throw new ForbiddenError('Un ou plusieurs colis ne vous appartiennent pas');
    }
    const alreadyInOther = parcels.find((p) => p.batchId && p.batchId !== batchId);
    if (alreadyInOther) {
      throw new ConflictError(`Le colis ${alreadyInOther.id} appartient déjà à un autre lot`);
    }

    await tx.parcel.updateMany({
      where: { id: { in: parcelIds } },
      data: { batchId }
    });

    const agg = await tx.parcel.aggregate({
      where: { batchId },
      _count: { _all: true },
      _sum: { weight: true }
    });

    return tx.shipmentBatch.update({
      where: { id: batchId },
      data: {
        totalParcels: agg._count._all,
        totalWeightKg: agg._sum.weight ?? 0,
        status: batch.status === 'draft' ? 'open' : batch.status
      }
    });
  });
}

/**
 * Détache un colis du batch (sans supprimer le colis). Recalcule les totaux.
 */
export async function detachParcel({ batchId, parcelId, actor }) {
  if (!isUuid(batchId)) throw new ValidationError([{ path: 'batchId', message: 'Identifiant invalide' }]);
  if (!isUuid(parcelId)) throw new ValidationError([{ path: 'parcelId', message: 'Identifiant invalide' }]);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.shipmentBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundError('Lot introuvable');
    if (!BATCH_MUTABLE_STATUSES.includes(batch.status)) {
      throw new ConflictError(`Le lot est en statut ${batch.status}, modification refusée`);
    }
    if (actor.role !== 'super_admin' && batch.creatorId !== actor.id) {
      throw new ForbiddenError('Vous ne pouvez pas modifier ce lot');
    }

    const parcel = await tx.parcel.findUnique({ where: { id: parcelId }, select: { batchId: true } });
    if (!parcel || parcel.batchId !== batchId) {
      throw new NotFoundError('Ce colis n\'appartient pas à ce lot');
    }
    await tx.parcel.update({ where: { id: parcelId }, data: { batchId: null } });

    const agg = await tx.parcel.aggregate({
      where: { batchId },
      _count: { _all: true },
      _sum: { weight: true }
    });
    return tx.shipmentBatch.update({
      where: { id: batchId },
      data: {
        totalParcels: agg._count._all,
        totalWeightKg: agg._sum.weight ?? 0
      }
    });
  });
}

/**
 * Ferme un batch : plus aucune modification possible. Le statut passe à closed.
 */
export async function closeBatch({ batchId, actor }) {
  if (!isUuid(batchId)) throw new ValidationError([{ path: 'batchId', message: 'Identifiant invalide' }]);
  return prisma.$transaction(async (tx) => {
    const batch = await tx.shipmentBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundError('Lot introuvable');
    if (batch.status === 'closed') throw new ConflictError('Lot déjà clôturé');
    if (batch.status === 'cancelled') throw new ConflictError('Lot annulé, impossible de clôturer');
    if (actor.role !== 'super_admin' && batch.creatorId !== actor.id) {
      throw new ForbiddenError('Vous ne pouvez pas clôturer ce lot');
    }
    return tx.shipmentBatch.update({
      where: { id: batchId },
      data: { status: 'closed', closedAt: new Date() }
    });
  });
}

export async function getBatch({ batchId, actor }) {
  if (!isUuid(batchId)) throw new ValidationError([{ path: 'batchId', message: 'Identifiant invalide' }]);
  const batch = await prisma.shipmentBatch.findUnique({
    where: { id: batchId },
    include: { parcels: { select: { id: true, trackingNumber: true, weight: true, status: true, receiverName: true } } }
  });
  if (!batch) throw new NotFoundError('Lot introuvable');
  if (actor.role !== 'super_admin' && batch.creatorId !== actor.id) {
    throw new ForbiddenError('Accès refusé');
  }
  return batch;
}

export async function listBatches({ actor, query = {} }) {
  const where = { creatorId: actor.role === 'super_admin' ? (query.creatorId && isUuid(query.creatorId) ? query.creatorId : undefined) : actor.id };
  if (query.status && BATCH_STATUSES.includes(query.status)) where.status = query.status;
  return prisma.shipmentBatch.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
}

export function serializeBatch(batch) {
  if (!batch) return null;
  return {
    id: batch.id,
    creatorId: batch.creatorId,
    apiKeyId: batch.apiKeyId,
    reference: batch.reference,
    label: batch.label,
    status: batch.status,
    totalParcels: batch.totalParcels,
    totalWeightKg: Number(batch.totalWeightKg ?? 0),
    totalAmount: batch.totalAmount != null ? Number(batch.totalAmount) : null,
    currency: batch.currency,
    metadata: batch.metadata ?? {},
    closedAt: batch.closedAt ? batch.closedAt.toISOString() : null,
    createdAt: batch.createdAt ? batch.createdAt.toISOString() : null,
    updatedAt: batch.updatedAt ? batch.updatedAt.toISOString() : null,
    parcels: batch.parcels ? batch.parcels.map((p) => ({
      id: p.id,
      trackingNumber: p.trackingNumber,
      weight: Number(p.weight ?? 0),
      status: p.status,
      receiverName: p.receiverName
    })) : undefined
  };
}

export const SHIPMENT_BATCH_STATUSES = BATCH_STATUSES;
