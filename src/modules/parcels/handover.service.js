import { prisma } from '../../config/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { generatePickupPin, generatePickupQrToken, hashProof, proofMatches } from '../../utils/handover-proofs.js';

// Statuts de colis dans lesquels une correspondance est autorisée. Avant
// prise en charge le colis n'a pas encore quitté l'expéditeur ; après
// livraison la responsabilité ne change plus.
const HANDOVERABLE_PARCEL_STATUSES = Object.freeze([
  'picked_up',
  'in_transit',
  'arrived'
]);

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseCoordinate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Le driver sortant initie un handover : le colis change de chauffeur dès
 * qu'un driver entrant confirme avec PIN + QR token.
 *
 * Contraintes :
 *  - Le colis doit être assigné au driver sortant.
 *  - Le statut du colis doit permettre un handover.
 *  - Aucun autre handover actif ne doit exister (contrainte unique partielle).
 *  - from_driver != to_driver.
 *
 * Retourne l'enregistrement + les secrets en clair, à ne JAMAIS re-sérialiser
 * ensuite (ils ne sont persistés qu'en hash).
 *
 * @returns {Promise<{handover: object, pickupPin: string, pickupQrToken: string}>}
 */
export async function initiateHandover({ parcelId, actor, body }) {
  if (!isUuid(parcelId)) throw new ValidationError([{ path: 'parcelId', message: 'Identifiant invalide' }]);
  const toDriverId = body?.toDriverId;
  if (!isUuid(toDriverId)) {
    throw new ValidationError([{ path: 'toDriverId', message: 'Chauffeur entrant requis' }]);
  }
  if (toDriverId === actor.id) {
    throw new ValidationError([{ path: 'toDriverId', message: 'Le chauffeur entrant doit être différent du sortant' }]);
  }
  const latitude = parseCoordinate(body?.latitude);
  const longitude = parseCoordinate(body?.longitude);
  const fromAdvertisementId = body?.fromAdvertisementId && isUuid(body.fromAdvertisementId) ? body.fromAdvertisementId : null;
  const toAdvertisementId = body?.toAdvertisementId && isUuid(body.toAdvertisementId) ? body.toAdvertisementId : null;

  const pin = generatePickupPin();
  const qr = generatePickupQrToken();

  return prisma.$transaction(async (tx) => {
    // Verrouille le colis pour empêcher la double initiation.
    await tx.$queryRaw`SELECT id FROM parcels WHERE id = ${parcelId}::uuid FOR UPDATE`;
    const parcel = await tx.parcel.findUnique({
      where: { id: parcelId },
      select: { id: true, assignedDriverId: true, status: true, deletedAt: true }
    });
    if (!parcel || parcel.deletedAt) throw new NotFoundError('Colis introuvable');
    if (parcel.assignedDriverId !== actor.id) {
      throw new ForbiddenError('Seul le chauffeur actuellement assigné peut initier une correspondance');
    }
    if (!HANDOVERABLE_PARCEL_STATUSES.includes(parcel.status)) {
      throw new ConflictError('Le colis n\'est pas en cours de transport, correspondance impossible');
    }

    // Driver entrant actif ?
    const toDriver = await tx.user.findUnique({
      where: { id: toDriverId },
      select: { id: true, role: true, status: true }
    });
    if (!toDriver || toDriver.role !== 'driver' || toDriver.status !== 'active') {
      throw new ValidationError([{ path: 'toDriverId', message: 'Chauffeur entrant inconnu ou inactif' }]);
    }

    try {
      const created = await tx.parcelHandover.create({
        data: {
          parcelId,
          fromDriverId: actor.id,
          toDriverId,
          fromAdvertisementId,
          toAdvertisementId,
          latitude,
          longitude,
          status: 'pending_pickup',
          pickupPinHash: hashProof(pin),
          pickupQrTokenHash: hashProof(qr),
          pickupPinLast4: pin.slice(-4)
        }
      });
      await notifyHandoverParties(tx, created, 'initiated');
      return { handover: created, pickupPin: pin, pickupQrToken: qr };
    } catch (err) {
      // Index unique partiel sur (parcel_id) WHERE status='pending_pickup'
      if (err.code === 'P2002') {
        throw new ConflictError('Une correspondance est déjà en cours pour ce colis');
      }
      throw err;
    }
  });
}

/**
 * Le driver entrant confirme la prise en charge en fournissant PIN + QR token.
 * Transfert atomique de `parcel.assignedDriverId` au driver entrant.
 */
export async function confirmHandover({ parcelId, handoverId, actor, body }) {
  if (!isUuid(parcelId)) throw new ValidationError([{ path: 'parcelId', message: 'Identifiant invalide' }]);
  if (!isUuid(handoverId)) throw new ValidationError([{ path: 'handoverId', message: 'Identifiant invalide' }]);
  const pin = body?.pin;
  const qrToken = body?.qrToken;
  if (typeof pin !== 'string' || typeof qrToken !== 'string' || !pin || !qrToken) {
    throw new ValidationError([{ path: 'pin', message: 'PIN et token QR requis' }]);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM parcels WHERE id = ${parcelId}::uuid FOR UPDATE`;
    const handover = await tx.parcelHandover.findUnique({ where: { id: handoverId } });
    if (!handover || handover.parcelId !== parcelId) throw new NotFoundError('Correspondance introuvable');
    if (handover.status !== 'pending_pickup') {
      throw new ConflictError('Cette correspondance n\'est plus en attente');
    }
    if (handover.toDriverId !== actor.id) {
      throw new ForbiddenError('Seul le chauffeur entrant désigné peut confirmer cette correspondance');
    }
    if (!proofMatches(pin, handover.pickupPinHash) || !proofMatches(qrToken, handover.pickupQrTokenHash)) {
      throw new ValidationError([{ path: 'pin', message: 'PIN ou token QR invalide' }]);
    }

    const parcel = await tx.parcel.findUnique({
      where: { id: parcelId },
      select: { id: true, assignedDriverId: true, deletedAt: true }
    });
    if (!parcel || parcel.deletedAt) throw new NotFoundError('Colis introuvable');
    if (parcel.assignedDriverId !== handover.fromDriverId) {
      throw new ConflictError('L\'assignation du colis a changé depuis l\'initiation');
    }

    const updated = await tx.parcelHandover.update({
      where: { id: handoverId },
      data: { status: 'completed', confirmedAt: new Date(), pickupProofType: 'qr+pin' }
    });
    await tx.parcel.update({
      where: { id: parcelId },
      data: { assignedDriverId: handover.toDriverId }
    });
    await notifyHandoverParties(tx, updated, 'completed');
    return updated;
  });
}

/**
 * Annulation : driver sortant OU admin. Le colis reste assigné au driver sortant.
 */
export async function cancelHandover({ parcelId, handoverId, actor, body }) {
  if (!isUuid(parcelId)) throw new ValidationError([{ path: 'parcelId', message: 'Identifiant invalide' }]);
  if (!isUuid(handoverId)) throw new ValidationError([{ path: 'handoverId', message: 'Identifiant invalide' }]);
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

  return prisma.$transaction(async (tx) => {
    const handover = await tx.parcelHandover.findUnique({ where: { id: handoverId } });
    if (!handover || handover.parcelId !== parcelId) throw new NotFoundError('Correspondance introuvable');
    if (handover.status !== 'pending_pickup') {
      throw new ConflictError('Cette correspondance ne peut plus être annulée');
    }
    const canCancel =
      actor.role === 'super_admin' ||
      handover.fromDriverId === actor.id ||
      handover.toDriverId === actor.id;
    if (!canCancel) {
      throw new ForbiddenError('Vous ne pouvez pas annuler cette correspondance');
    }
    const updated = await tx.parcelHandover.update({
      where: { id: handoverId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason
      }
    });
    await notifyHandoverParties(tx, updated, 'cancelled', { cancelledBy: actor.id });
    return updated;
  });
}

/**
 * Notifie les parties prenantes d'un handover (sender du colis, driver sortant,
 * driver entrant) de la transition qui vient de se produire. Non bloquant :
 * toute erreur est avalée.
 *
 * `event` ∈ { 'initiated', 'completed', 'cancelled' }.
 * - `initiated`     → sender + driver entrant.
 * - `completed`     → sender + driver sortant (+ driver entrant : courtoisie).
 * - `cancelled`     → les deux drivers + sender, sauf l'auteur du cancel.
 *
 * @returns {Promise<number>} nombre de notifications créées.
 */
export async function notifyHandoverParties(tx, handover, event, extra = {}) {
  try {
    const parcel = await tx.parcel.findUnique({
      where: { id: handover.parcelId },
      select: { id: true, senderId: true, trackingNumber: true, receiverName: true }
    });
    if (!parcel) return 0;

    const trackingLabel = parcel.trackingNumber ? ` (${parcel.trackingNumber})` : '';

    const targets = []; // Array<{ userId, type, title, body }>
    if (event === 'initiated') {
      targets.push({
        userId: handover.toDriverId,
        type: 'handover_initiated',
        title: 'Nouveau transfert de colis à prendre en charge',
        body: `Un colis${trackingLabel} vous attend. Scannez le QR et saisissez le PIN du chauffeur sortant pour confirmer.`
      });
      if (parcel.senderId) {
        targets.push({
          userId: parcel.senderId,
          type: 'handover_initiated',
          title: 'Correspondance initiée',
          body: `Votre colis${trackingLabel} est en cours de transfert vers un autre chauffeur.`
        });
      }
    } else if (event === 'completed') {
      targets.push({
        userId: handover.fromDriverId,
        type: 'handover_completed',
        title: 'Colis remis',
        body: `Le colis${trackingLabel} a bien été pris en charge par le chauffeur entrant.`
      });
      if (parcel.senderId) {
        targets.push({
          userId: parcel.senderId,
          type: 'handover_completed',
          title: 'Correspondance terminée',
          body: `Votre colis${trackingLabel} a changé de chauffeur et continue son trajet.`
        });
      }
    } else if (event === 'cancelled') {
      const cancelledBy = extra?.cancelledBy ?? null;
      const reasonSuffix = handover.cancellationReason ? ` Motif : ${handover.cancellationReason}.` : '';
      const notice = { title: 'Correspondance annulée', body: `La correspondance pour le colis${trackingLabel} a été annulée.${reasonSuffix}`, type: 'handover_cancelled' };
      if (handover.fromDriverId !== cancelledBy) targets.push({ userId: handover.fromDriverId, ...notice });
      if (handover.toDriverId !== cancelledBy) targets.push({ userId: handover.toDriverId, ...notice });
      if (parcel.senderId && parcel.senderId !== cancelledBy) targets.push({ userId: parcel.senderId, ...notice });
    }

    let created = 0;
    for (const t of targets) {
      try {
        await tx.notification.create({
          data: {
            userId: t.userId,
            parcelId: handover.parcelId,
            senderName: 'PRO COLIS',
            type: t.type,
            title: t.title,
            body: t.body,
            data: {
              handoverId: handover.id,
              parcelId: handover.parcelId,
              event,
              fromDriverId: handover.fromDriverId,
              toDriverId: handover.toDriverId
            },
            priority: 'high'
          }
        });
        created += 1;
      } catch { /* non bloquant : une notif en échec n'empêche pas la transition */ }
    }
    return created;
  } catch {
    return 0;
  }
}

/**
 * Liste des handovers d'un colis (lecture par driver sortant, entrant ou admin).
 */
export async function listParcelHandovers({ parcelId, actor }) {
  if (!isUuid(parcelId)) throw new ValidationError([{ path: 'parcelId', message: 'Identifiant invalide' }]);
  const parcel = await prisma.parcel.findUnique({
    where: { id: parcelId },
    select: { id: true, senderId: true, assignedDriverId: true, deletedAt: true }
  });
  if (!parcel || parcel.deletedAt) throw new NotFoundError('Colis introuvable');

  const rows = await prisma.parcelHandover.findMany({
    where: { parcelId },
    orderBy: { initiatedAt: 'desc' }
  });

  const authorized = actor.role === 'super_admin' ||
    parcel.senderId === actor.id ||
    parcel.assignedDriverId === actor.id ||
    rows.some((r) => r.fromDriverId === actor.id || r.toDriverId === actor.id);
  if (!authorized) throw new ForbiddenError('Accès refusé');

  return rows;
}

export const HANDOVER_PARCEL_STATUSES = HANDOVERABLE_PARCEL_STATUSES;

export function serializeHandover(h, { reveal = null } = {}) {
  if (!h) return null;
  return {
    id: h.id,
    parcelId: h.parcelId,
    fromDriverId: h.fromDriverId,
    toDriverId: h.toDriverId,
    fromAdvertisementId: h.fromAdvertisementId,
    toAdvertisementId: h.toAdvertisementId,
    latitude: h.latitude != null ? Number(h.latitude) : null,
    longitude: h.longitude != null ? Number(h.longitude) : null,
    status: h.status,
    pickupPinLast4: h.pickupPinLast4,
    pickupProofType: h.pickupProofType,
    cancellationReason: h.cancellationReason,
    initiatedAt: h.initiatedAt?.toISOString() ?? null,
    confirmedAt: h.confirmedAt?.toISOString() ?? null,
    cancelledAt: h.cancelledAt?.toISOString() ?? null,
    // Secrets révélés UNE SEULE FOIS à l'initiateur, jamais sur un GET.
    pickupPin: reveal?.pickupPin ?? null,
    pickupQrToken: reveal?.pickupQrToken ?? null
  };
}
