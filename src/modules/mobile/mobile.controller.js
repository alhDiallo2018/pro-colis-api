import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { fail, ok } from '../../utils/api-response.js';
import { isBrevoConfigured, sendNotificationEmail, sendNotificationSms, sendOtpSms } from '../../utils/brevo.js';
import { calculateCommission, calculateCommissionSync, deductCashCommission, getCfaPerPoint, getCommitmentFee, getDeliveryPoints } from '../../utils/commission.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, normalizeError } from '../../utils/errors.js';
import {
  serializeAdvertisement,
  serializeAdvertisementOffer,
  serializeAuditLog,
  serializeBid,
  serializeGarage,
  serializeParcel,
  serializeParcelEvent,
  serializePayment,
  serializeScoreTransaction,
  serializeUser
} from '../../utils/mobile-serializers.js';
import { getPagination, paginationMeta } from '../../utils/pagination.js';
import { generateTrackingNumber } from '../../utils/tracking-number.js';
import { attemptDisbursement, toClientWithdrawalStatus } from '../../utils/withdrawal-flow.js';

const parcelInclude = {
  departureGarage: true,
  arrivalGarage: true,
  driver: { include: { garage: true } },
  bids: { include: { driver: true }, orderBy: { createdAt: 'desc' } },
  events: { orderBy: { createdAt: 'asc' } },
  media: { orderBy: { createdAt: 'asc' } }
};

const ACTIVE_PARCEL_STATUSES = ['pending', 'free', 'confirmed', 'picked_up', 'in_transit', 'arrived', 'out_for_delivery'];

function decimal(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number(value);
}

function cleanUndefined(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

async function getConfigValue(key, fallback) {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value != null ? row.value : fallback;
}

async function notifyAdmins(tx, type, title, body, data = {}) {
  const admins = await tx.user.findMany({
    where: { role: 'super_admin', status: 'active' },
    select: { id: true, email: true, phone: true }
  });
  const notifs = admins.map((a) =>
    tx.notification.create({ data: { userId: a.id, type, title, body, data } })
  );
  await Promise.all(notifs);

  if (isBrevoConfigured()) {
    for (const admin of admins) {
      if (admin.email) {
        sendNotificationEmail({ email: admin.email, subject: title, message: body }).catch(() => {});
      }
      if (admin.phone) {
        const smsContent = body.length > 300 ? `[Admin] ${title}: ${body.substring(0, 300)}...` : `[Admin] ${title}: ${body}`;
        sendNotificationSms({ phone: admin.phone, message: smsContent, tag: type }).catch(() => {});
      }
    }
  }
}

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log.error(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Mobile endpoint failed: ${action}`
      );

      return fail(res, {
        status: normalized?.statusCode || 500,
        message:
          normalized?.publicMessage ||
          (env.NODE_ENV === 'production' ? 'Operation impossible' : error.message),
        code: normalized?.code || 'INTERNAL_ERROR',
        details: normalized?.details || []
      });
    }
  };
}

function parcelAccessWhere(user, parcelId) {
  if (user.role === 'super_admin') return { id: parcelId };
  if (user.role === 'client') return { id: parcelId, senderId: user.id };
  if (user.role === 'driver') return { id: parcelId, driverId: user.id };
  if (user.role === 'admin') {
    return {
      id: parcelId,
      OR: [{ departureGarageId: user.garageId }, { arrivalGarageId: user.garageId }]
    };
  }
  return { id: parcelId, senderId: '__none__' };
}

async function findAccessibleParcel(user, parcelId) {
  const parcel = await prisma.parcel.findFirst({
    where: { ...parcelAccessWhere(user, parcelId), deletedAt: null },
    include: parcelInclude
  });
  if (!parcel) throw new NotFoundError('Colis introuvable');
  return parcel;
}

async function audit(tx, req, { action, entityType, entityId, beforeData, afterData }) {
  await tx.auditLog.create({
    data: {
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action,
      entityType,
      entityId,
      beforeData,
      afterData,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId
    }
  });
}

async function notify(tx, { userId, parcelId, bidId, senderId, senderName = 'PRO COLIS', type, title, body, data = {}, priority = 'normal' }) {
  if (!userId) return null;

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true }
  });

  const notification = await tx.notification.create({
    data: { userId, parcelId, bidId, senderId, senderName, type, title, body, data, priority }
  });

  if (isBrevoConfigured() && user) {
    if (user.email) {
      sendNotificationEmail({ email: user.email, subject: title, message: body }).catch(() => {});
    }
    if (user.phone) {
      const smsContent = body.length > 300 ? `${title}: ${body.substring(0, 300)}...` : `${title}: ${body}`;
      sendNotificationSms({ phone: user.phone, message: smsContent, tag: type }).catch(() => {});
    }
  }

  return notification;
}

function statusDescription(status) {
  return {
    pending: 'Colis cree',
    free: 'Colis ouvert aux offres chauffeurs',
    confirmed: 'Colis confirme',
    picked_up: 'Colis ramasse',
    in_transit: 'Colis en transit',
    arrived: 'Colis arrive au garage destination',
    out_for_delivery: 'Colis en livraison finale',
    delivered: 'Livraison confirmee',
    cancelled: 'Colis annule'
  }[status] || 'Statut mis a jour';
}

async function changeParcelStatus(req, parcel, status, extra = {}) {
  // La transition de statut touche plusieurs tables : colis, evenement, audit et notifications.
  return prisma.$transaction(async (tx) => {
    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data: cleanUndefined({
        status,
        pickupDate: status === 'picked_up' ? new Date() : undefined,
        deliveryDate: status === 'delivered' ? new Date() : undefined,
        cancelledBy: status === 'cancelled' ? req.user.id : undefined,
        cancellationReason: status === 'cancelled' ? extra.reason : undefined,
        cancelledAt: status === 'cancelled' ? new Date() : undefined,
        signatureUrl: extra.signatureUrl,
        driverId: extra.driverId
      }),
      include: parcelInclude
    });

    const event = await tx.parcelEvent.create({
      data: {
        parcelId: parcel.id,
        status,
        description: extra.description || statusDescription(status),
        location: extra.location,
        locationLat: decimal(extra.locationLat),
        locationLng: decimal(extra.locationLng),
        photoUrl: extra.photoUrl,
        userId: req.user.id,
        userName: req.user.fullName,
        userRole: req.user.role,
        metadata: { notes: extra.notes, reason: extra.reason }
      }
    });

    await audit(tx, req, {
      action: 'parcel.status_update',
      entityType: 'parcel',
      entityId: parcel.id,
      beforeData: { status: parcel.status },
      afterData: { status }
    });

    await notify(tx, {
      userId: updated.senderId,
      parcelId: updated.id,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: status === 'delivered' ? 'delivery_confirmed' : 'parcel_status',
      title: statusDescription(status),
      body: `Votre colis ${updated.trackingNumber} : ${statusDescription(status)}.`,
      data: { trackingNumber: updated.trackingNumber, status }
    });

    return { parcel: updated, event };
  });
}

async function scoreSnapshot(userId) {
  const score = await prisma.score.upsert({
    where: { userId },
    update: {},
    create: { userId }
  });
  const transactions = await prisma.scoreTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  return { score, transactions };
}

export const updateProfile = handle('profile.update', async (req, res) => {
  const allowed = ['fullName', 'email', 'phone', 'address', 'city', 'region', 'gender', 'driverStatus', 'garageId', 'profilePhoto'];
  const data = cleanUndefined(Object.fromEntries(allowed.map((key) => [key, req.body[key]])));

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    include: { garage: true }
  });

  return ok(res, { message: 'Profil mis a jour', data: { user: serializeUser(user) } });
});

export const deleteAccount = handle('users.deleteAccount', async (req, res) => {
  const timestamp = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: req.user.id },
      data: {
        status: 'deleted',
        deletedAt: timestamp
      }
    }),
    prisma.refreshToken.updateMany({
      where: { userId: req.user.id, revokedAt: null },
      data: { revokedAt: timestamp }
    }),
    prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'user.deleteAccount',
        entityType: 'user',
        entityId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.requestId
      }
    })
  ]);

  return ok(res, { message: 'Compte supprime' });
});

export const updateProfilePhoto = handle('users.updateProfilePhoto', async (req, res) => {
  const { profilePhoto } = req.body;

  if (!profilePhoto) {
    throw new ValidationError([{ path: 'body.profilePhoto', message: 'La photo de profil est requise' }]);
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePhoto },
    include: { garage: true }
  });

  return ok(res, { message: 'Photo de profil mise a jour', data: { user: serializeUser(user) } });
});

export const updatePin = handle('users.updatePin', async (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!/^\d{6}$/.test(newPin || '')) {
    throw new ValidationError([{ path: 'body.newPin', message: 'Le code PIN doit contenir exactement 6 chiffres' }]);
  }
  if (!req.user.pinHash || !(await bcrypt.compare(currentPin || '', req.user.pinHash))) {
    throw new ForbiddenError('Code PIN actuel incorrect');
  }
  await prisma.user.update({ where: { id: req.user.id }, data: { pinHash: await bcrypt.hash(newPin, 12) } });
  return ok(res, { message: 'Code PIN mis a jour' });
});

export const userStats = handle('users.stats', async (req, res) => {
  const parcelWhere =
    req.user.role === 'driver'
      ? { driverId: req.user.id, deletedAt: null }
      : req.user.role === 'admin'
        ? { OR: [{ departureGarageId: req.user.garageId }, { arrivalGarageId: req.user.garageId }], deletedAt: null }
        : { senderId: req.user.id, deletedAt: null };

  const [totalParcels, activeParcels, deliveredParcels, pendingBids, unreadNotifications, score] = await Promise.all([
    prisma.parcel.count({ where: parcelWhere }),
    prisma.parcel.count({ where: { ...parcelWhere, status: { in: ACTIVE_PARCEL_STATUSES } } }),
    prisma.parcel.count({ where: { ...parcelWhere, status: 'delivered' } }),
    req.user.role === 'driver'
      ? prisma.bid.count({ where: { driverId: req.user.id, status: 'pending' } })
      : prisma.bid.count({ where: { parcel: { senderId: req.user.id }, status: 'pending' } }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    prisma.score.findUnique({ where: { userId: req.user.id } })
  ]);

  return ok(res, {
    message: 'Stats personnelles',
    data: {
      stats: {
        totalParcels,
        activeParcels,
        deliveredParcels,
        pendingBids,
        unreadNotifications,
        scoreBalance: score?.points || 0
      }
    }
  });
});

function buildParcelData(user, body) {
  const isDriver = user.role === 'driver';
  const isFree = Boolean(body.isFreeForBidding);
  const baseAmount = body.totalAmount ?? body.proposedPrice ?? body.price ?? 0;

  return cleanUndefined({
    trackingNumber: generateTrackingNumber(),
    senderId: isDriver ? body.senderId || null : body.senderId || user.id,
    senderName: body.senderName || user.fullName,
    senderPhone: body.senderPhone || user.phone,
    senderEmail: body.senderEmail || user.email,
    receiverName: body.receiverName,
    receiverPhone: body.receiverPhone,
    receiverEmail: body.receiverEmail,
    receiverAddress: body.receiverAddress,
    description: body.description,
    weight: decimal(body.weight, '0'),
    length: decimal(body.length),
    width: decimal(body.width),
    height: decimal(body.height),
    type: body.type || 'package',
    // A client picking a driver only pre-assigns them: the parcel stays "pending"
    // until the driver confirms. Drivers creating their own parcel are confirmed.
    status: body.status || (isDriver ? 'confirmed' : isFree ? 'free' : 'pending'),
    departureGarageId: body.departureGarageId || user.garageId,
    arrivalGarageId: body.arrivalGarageId,
    driverId: body.driverId || (isDriver ? user.id : null),
    price: decimal(body.price),
    proposedPrice: decimal(body.proposedPrice),
    totalAmount: decimal(baseAmount, '0'),
    isInsured: Boolean(body.isInsured),
    isUrgent: Boolean(body.isUrgent),
    isFreeForBidding: isFree,
    paymentMethod: body.paymentMethod,
    paymentPhoneNumber: body.paymentPhoneNumber,
    notes: body.notes,
    createdBy: user.id
  });
}

export const createParcel = handle('parcel.create', async (req, res) => {
  if (!req.body.receiverName || !req.body.receiverPhone || !req.body.description || !req.body.weight) {
    throw new ValidationError([{ path: 'body', message: 'Champs colis obligatoires manquants' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const parcel = await tx.parcel.create({
      data: buildParcelData(req.user, req.body),
      include: parcelInclude
    });

    await tx.parcelEvent.create({
      data: {
        parcelId: parcel.id,
        status: parcel.status,
        description: statusDescription(parcel.status),
        userId: req.user.id,
        userName: req.user.fullName,
        userRole: req.user.role
      }
    });

    await audit(tx, req, {
      action: 'parcel.create',
      entityType: 'parcel',
      entityId: parcel.id,
      afterData: { status: parcel.status, trackingNumber: parcel.trackingNumber }
    });

    return parcel;
  });

  return ok(res, { status: 201, message: 'Colis cree', data: { parcel: serializeParcel(result) } });
});

export const clientParcels = handle('client.parcels', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ senderId: req.user.id, status: req.query.status, deletedAt: null });
  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ where, include: parcelInclude, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Colis client', data: { parcels: parcels.map(serializeParcel) }, meta: paginationMeta({ page, limit, total }) });
});

export const driverParcels = handle('driver.parcels', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ driverId: req.user.id, status: req.query.status, deletedAt: null });
  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ where, include: parcelInclude, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Colis chauffeur', data: { parcels: parcels.map(serializeParcel) }, meta: paginationMeta({ page, limit, total }) });
});

export const garageParcels = handle('garage.parcels', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({
    OR: [{ departureGarageId: req.user.garageId }, { arrivalGarageId: req.user.garageId }],
    status: req.query.status,
    deletedAt: null
  });
  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ where, include: parcelInclude, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Colis garage', data: { parcels: parcels.map(serializeParcel) }, meta: paginationMeta({ page, limit, total }) });
});

export const superAdminParcels = handle('super.parcels', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ status: req.query.status, deletedAt: null });
  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ where, include: parcelInclude, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Colis', data: { parcels: parcels.map(serializeParcel) }, meta: paginationMeta({ page, limit, total }) });
});

export const getParcelDetail = handle('parcel.detail', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  return ok(res, { message: 'Detail colis', data: { parcel: serializeParcel(parcel) } });
});

export const cancelParcel = handle('parcel.cancel', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'cancelled', { reason: req.body.reason || 'Annulation' });

  // Si un chauffeur etait assigne, on lui credite son point d'engagement.
  if (parcel.driverId) {
    await prisma.$transaction(async (tx) => {
      const commitmentFee = await getCommitmentFee(tx);
      if (commitmentFee > 0) {
        await tx.score.upsert({
          where: { userId: parcel.driverId },
          update: { points: { increment: commitmentFee }, lastUpdated: new Date() },
          create: { userId: parcel.driverId, points: commitmentFee }
        });
        await tx.scoreTransaction.create({
          data: { userId: parcel.driverId, amount: commitmentFee, type: 'commitment_refund', source: 'system', parcelId: parcel.id, description: 'Remboursement engagement (colis annule)' }
        });
      }
    });
  }

  return ok(res, { message: 'Colis annule', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const updateParcelStatus = handle('parcel.updateStatus', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, req.body.status, req.body);
  return ok(res, { message: 'Statut mis a jour', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const assignDriver = handle('parcel.assignDriver', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const driver = await prisma.user.findFirst({ where: { id: req.body.driverId, role: 'driver', status: 'active' } });
  if (!driver) throw new NotFoundError('Chauffeur introuvable');
  const result = await changeParcelStatus(req, parcel, 'confirmed', { driverId: driver.id, description: 'Chauffeur assigne' });
  return ok(res, { message: 'Chauffeur assigne', data: { parcel: serializeParcel(result.parcel) } });
});

export const bulkAssignDriver = handle('parcel.bulkAssign', async (req, res) => {
  const failed = [];
  let assigned = 0;
  for (const parcelId of req.body.parcelIds || []) {
    try {
      const parcel = await findAccessibleParcel(req.user, parcelId);
      await changeParcelStatus(req, parcel, 'confirmed', { driverId: req.body.driverId, description: req.body.message || 'Chauffeur assigne' });
      assigned += 1;
    } catch (error) {
      failed.push({ parcelId, message: error.publicMessage || error.message });
    }
  }
  return ok(res, { message: 'Colis assignes', data: { assigned, failed } });
});

// --- Delivery OTP (proof of receipt) ---
// The code is stored on the generic OtpCode table keyed by parcel id.
// When Brevo is configured, the code is sent via SMS to the recipient's phone.
// Otherwise, the sender/recipient reads it from their parcel page and
// hands it to the driver, who must enter it to confirm delivery.
function generateDeliveryCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function getOrCreateDeliveryCode(parcelId, phone) {
  const type = `delivery:${parcelId}`;
  const existing = await prisma.otpCode.findFirst({ where: { type, isUsed: false } });
  if (existing) return { code: existing.codeHash, phone };
  const code = generateDeliveryCode();
  await prisma.otpCode.create({
    data: { type, phone, codeHash: code, isUsed: false, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
  });
  return { code, phone };
}

export const clientDeliveryCode = handle('parcel.deliveryCode', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const { code, phone } = await getOrCreateDeliveryCode(parcel.id, parcel.receiverPhone);
  if (isBrevoConfigured() && phone) {
    sendOtpSms({ phone, code, purpose: 'livraison' }).catch(() => {});
  }
  return ok(res, { message: 'Code de livraison', data: { code } });
});

export const driverConfirm = handle('driver.confirm', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'confirmed', {
    ...req.body,
    description: 'Prise en charge confirmee par le chauffeur'
  });
  return ok(res, { message: 'Colis confirme', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverPickup = handle('driver.pickup', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'picked_up', req.body);
  return ok(res, { message: 'Colis ramasse', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverTransit = handle('driver.transit', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'in_transit', req.body);
  return ok(res, { message: 'Colis en transit', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverArrived = handle('driver.arrived', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'arrived', req.body);
  return ok(res, { message: 'Colis arrive au garage', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverOutForDelivery = handle('driver.outForDelivery', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'out_for_delivery', req.body);
  const { code, phone } = await getOrCreateDeliveryCode(parcel.id, parcel.receiverPhone);
  if (isBrevoConfigured() && phone) {
    sendOtpSms({ phone, code, purpose: 'livraison' }).catch(() => {});
  }
  return ok(res, { message: 'Colis en livraison finale', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverDeliver = handle('driver.deliver', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);

  // Verify the recipient's delivery code (proof of receipt) before completing.
  const otpRow = await prisma.otpCode.findFirst({ where: { type: `delivery:${parcel.id}`, isUsed: false } });
  const submitted = String(req.body.otp ?? '').trim();
  if (!otpRow || !submitted || submitted !== otpRow.codeHash) {
    if (otpRow) await prisma.otpCode.update({ where: { id: otpRow.id }, data: { attempts: { increment: 1 } } });
    throw new ValidationError([{ path: 'otp', message: 'Code de livraison incorrect' }], 'Code de livraison incorrect');
  }
  await prisma.otpCode.update({ where: { id: otpRow.id }, data: { isUsed: true } });

  const recipientNote = req.body.recipientNote;
  const result = await changeParcelStatus(req, parcel, 'delivered', {
    ...req.body,
    description: recipientNote ? `Livraison confirmee (code OTP) — ${recipientNote}` : 'Livraison confirmee par code OTP'
  });

  const parcelPrice = Number(parcel.price || parcel.totalAmount || 0);
  const isPaid = parcel.paymentStatus === 'completed';

  let commission = 0;
  let driverEarning = 0;
  if (isPaid && parcelPrice > 0) {
    commission = await calculateCommission(parcelPrice);
    driverEarning = Math.max(0, parcelPrice - commission);
  }

  await prisma.$transaction(async (tx) => {
    const deliveryPoints = await getDeliveryPoints(tx);

    // Points (toujours attribués)
    await tx.score.upsert({
      where: { userId: req.user.id },
      update: { points: { increment: deliveryPoints }, totalEarned: { increment: deliveryPoints }, lastUpdated: new Date() },
      create: { userId: req.user.id, points: deliveryPoints, totalEarned: deliveryPoints }
    });
    await tx.scoreTransaction.create({
      data: { userId: req.user.id, amount: deliveryPoints, type: 'delivery_completed', source: 'system', parcelId: parcel.id, description: 'Points chauffeur pour livraison terminee' }
    });

    // Portefeuille (uniquement si payé)
    if (isPaid && driverEarning > 0) {
      const wallet = await tx.wallet.upsert({
        where: { userId: req.user.id },
        update: { balance: { increment: driverEarning }, totalDeposited: { increment: driverEarning }, lastActivityAt: new Date(), lastDepositAt: new Date() },
        create: { userId: req.user.id, balance: driverEarning, totalDeposited: driverEarning, lastDepositAt: new Date(), lastActivityAt: new Date() }
      });
      await tx.walletTransaction.create({
        data: {
          walletUserId: req.user.id,
          type: 'deposit',
          amount: driverEarning,
          balanceBefore: Number(wallet.balance) - driverEarning,
          balanceAfter: Number(wallet.balance),
          parcelId: parcel.id,
          description: `Gain colis ${parcel.trackingNumber} (${driverEarning} FCFA, comm. ${commission} FCFA)`,
          origin: 'delivery',
          status: 'completed'
        }
      });
    }

    // Notifications
    const notifBody = isPaid
      ? `+${deliveryPoints} pts · +${driverEarning} FCFA (colis ${parcel.trackingNumber}). Commission: ${commission} FCFA.`
      : `+${deliveryPoints} pts (colis ${parcel.trackingNumber}). Paiement en attente — le gain sera crédité après confirmation.`;

    await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'delivery_completed',
        title: 'Livraison terminée',
        body: notifBody,
        data: { parcelId: parcel.id, points: deliveryPoints, earning: driverEarning, commission, paid: isPaid }
      }
    });

    if (parcel.senderId) {
      await tx.notification.create({
        data: {
          userId: parcel.senderId,
          type: 'parcel_delivered',
          title: 'Colis livré',
          body: `Votre colis ${parcel.trackingNumber} a été livré avec succès.`,
          data: { parcelId: parcel.id }
        }
      });
    }

    // Notifier les admins
    if (isPaid) {
      await notifyAdmins(tx, 'delivery_completed',
        `Livraison + paiement : ${parcel.trackingNumber}`,
        `Chauffeur: ${driverEarning} FCFA crédités. Commission: ${commission} FCFA.`,
        { parcelId: parcel.id, driverEarning, commission }
      );
    } else {
      await notifyAdmins(tx, 'delivery_unpaid',
        `Livraison non payée : ${parcel.trackingNumber}`,
        `Colis livré mais paiement en attente (${parcelPrice} FCFA). Confirmer le paiement espèces.`,
        { parcelId: parcel.id, amount: parcelPrice }
      );
    }
  });

  return ok(res, {
    message: 'Livraison confirmee',
    data: { parcel: serializeParcel(result.parcel), score: { credited: deliveryPoints }, wallet: isPaid ? { earning: driverEarning, commission } : { pending: true } }
  });
});

export const freeParcels = handle('public.freeParcels', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { status: 'free', isFreeForBidding: true, deletedAt: null };
  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ where, include: parcelInclude, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Annonces', data: { parcels: parcels.map(serializeParcel) }, meta: paginationMeta({ page, limit, total }) });
});

export const trackParcel = handle('public.trackParcel', async (req, res) => {
  const parcel = await prisma.parcel.findUnique({
    where: { trackingNumber: req.params.trackingNumber },
    include: parcelInclude
  });
  if (!parcel || parcel.deletedAt) throw new NotFoundError('Colis introuvable');
  return ok(res, { message: 'Suivi colis', data: { parcel: serializeParcel(parcel), events: parcel.events.map(serializeParcelEvent) } });
});

export const publicParcelEvents = handle('public.parcelEvents', async (req, res) => {
  const events = await prisma.parcelEvent.findMany({ where: { parcelId: req.params.parcelId }, orderBy: { createdAt: 'asc' } });
  return ok(res, { message: 'Evenements colis', data: { events: events.map(serializeParcelEvent) } });
});

export const publicParcelBids = handle('public.parcelBids', async (req, res) => {
  const bids = await prisma.bid.findMany({ where: { parcelId: req.params.parcelId }, include: { driver: true }, orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Offres colis', data: { bids: bids.map(serializeBid) } });
});

export const parcelTimeline = handle('parcel.timeline', async (req, res) => {
  await findAccessibleParcel(req.user, req.params.parcelId);
  const events = await prisma.parcelEvent.findMany({ where: { parcelId: req.params.parcelId }, orderBy: { createdAt: 'asc' } });
  return ok(res, { message: 'Timeline colis', data: { events: events.map(serializeParcelEvent) } });
});

export const addParcelNote = handle('parcel.addNote', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const notes = [parcel.notes, req.body.note].filter(Boolean).join('\n');
  const updated = await prisma.parcel.update({ where: { id: parcel.id }, data: { notes }, include: parcelInclude });
  return ok(res, { message: 'Note ajoutee', data: { parcel: serializeParcel(updated), note: req.body.note } });
});

export const getParcelNotes = handle('parcel.notes', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const notes = parcel.notes ? parcel.notes.split('\n').map((note, index) => ({ id: `${parcel.id}-${index}`, note })) : [];
  return ok(res, { message: 'Notes colis', data: { notes } });
});

export const deliveryProof = handle('parcel.proof', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  return ok(res, { message: 'Preuve livraison', data: { proof: { signatureUrl: parcel.signatureUrl, photoUrls: serializeParcel(parcel).photoUrls } } });
});

export const estimateParcel = handle('parcel.estimate', async (req, res) => {
  const weight = number(req.body.weight, 1);
  const baseFee = 1000;
  const pricePerKg = 500;
  const urgentFee = req.body.isUrgent ? 1000 : 0;
  const insuranceFee = req.body.isInsured ? 1000 : 0;
  const total = baseFee + weight * pricePerKg + urgentFee + insuranceFee;
  return ok(res, { message: 'Estimation prix', data: { estimate: { amount: total, currency: 'XOF', baseFee, pricePerKg, urgentFee, insuranceFee } } });
});

export const createBid = handle('bid.create', async (req, res) => {
  const parcel = await prisma.parcel.findFirst({ where: { id: req.body.parcelId, status: 'free', isFreeForBidding: true } });
  if (!parcel) throw new NotFoundError('Annonce introuvable');
  const bid = await prisma.$transaction(async (tx) => {
    const created = await tx.bid.upsert({
      where: { parcelId_driverId: { parcelId: parcel.id, driverId: req.user.id } },
      update: { price: decimal(req.body.price, '0'), message: req.body.message, audioUrl: req.body.audioUrl, status: 'pending' },
      create: { parcelId: parcel.id, driverId: req.user.id, price: decimal(req.body.price, '0'), message: req.body.message, audioUrl: req.body.audioUrl },
      include: { driver: true }
    });
    await notify(tx, {
      userId: parcel.senderId,
      parcelId: parcel.id,
      bidId: created.id,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'bid_created',
      title: 'Nouvelle offre chauffeur',
      body: `${req.user.fullName} propose ${created.price} XOF pour votre colis.`,
      priority: 'high'
    });
    return created;
  });
  return ok(res, { status: 201, message: 'Offre envoyee', data: { bid: serializeBid(bid) } });
});

export const acceptBid = handle('bid.accept', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const bid = await prisma.bid.findFirst({ where: { id: req.params.bidId, parcelId: parcel.id }, include: { driver: true } });
  if (!bid) throw new NotFoundError('Offre introuvable');

  const result = await prisma.$transaction(async (tx) => {
    await tx.bid.updateMany({ where: { parcelId: parcel.id, id: { not: bid.id } }, data: { status: 'rejected', respondedAt: new Date() } });
    const accepted = await tx.bid.update({
      where: { id: bid.id },
      data: { status: 'accepted', responseMessage: req.body.responseMessage, respondedAt: new Date() },
      include: { driver: true }
    });
    const updatedParcel = await tx.parcel.update({
      where: { id: parcel.id },
      data: { status: 'confirmed', driverId: bid.driverId, selectedBidId: bid.id, negotiatedPrice: bid.price, totalAmount: bid.price },
      include: parcelInclude
    });
    await tx.parcelEvent.create({
      data: { parcelId: parcel.id, status: 'confirmed', description: 'Offre chauffeur acceptee', userId: req.user.id, userName: req.user.fullName, userRole: req.user.role }
    });
    await audit(tx, req, { action: 'bid.accept', entityType: 'bid', entityId: bid.id, afterData: { status: 'accepted' } });

    const commitmentFee = await getCommitmentFee(tx);
    if (commitmentFee > 0) {
      await tx.score.upsert({
        where: { userId: bid.driverId },
        update: { points: { decrement: commitmentFee }, totalSpent: { increment: commitmentFee }, lastUpdated: new Date() },
        create: { userId: bid.driverId, points: 0, totalSpent: commitmentFee }
      });
      await tx.scoreTransaction.create({
        data: { userId: bid.driverId, amount: -commitmentFee, type: 'commitment_fee', source: 'system', parcelId: parcel.id, description: 'Engagement chauffeur sur le colis' }
      });
    }

    await notify(tx, {
      userId: bid.driverId,
      parcelId: parcel.id,
      bidId: bid.id,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'bid_accepted',
      title: 'Offre acceptee',
      body: `Votre offre pour ${parcel.trackingNumber} a ete acceptee.`
    });
    return { parcel: updatedParcel, bid: accepted };
  });

  return ok(res, { message: 'Offre acceptee', data: { parcel: serializeParcel(result.parcel), bid: serializeBid(result.bid) } });
});

export const rejectBid = handle('bid.reject', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const bid = await prisma.bid.update({
    where: { id: req.params.bidId },
    data: { status: 'rejected', responseMessage: req.body.responseMessage, respondedAt: new Date() },
    include: { driver: true }
  });
  if (bid.parcelId !== parcel.id) throw new ForbiddenError('Offre invalide pour ce colis');
  return ok(res, { message: 'Offre rejetee', data: { bid: serializeBid(bid) } });
});

export const clientBidStats = handle('bid.clientStats', async (req, res) => {
  const where = { parcel: { senderId: req.user.id } };
  const [received, pending, accepted, rejected] = await Promise.all([
    prisma.bid.count({ where }),
    prisma.bid.count({ where: { ...where, status: 'pending' } }),
    prisma.bid.count({ where: { ...where, status: 'accepted' } }),
    prisma.bid.count({ where: { ...where, status: 'rejected' } })
  ]);
  return ok(res, { message: 'Stats offres', data: { stats: { received, pending, accepted, rejected } } });
});

export const clientBidsReceived = handle('bid.clientReceived', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { parcel: { senderId: req.user.id } };
  const [total, bids] = await Promise.all([
    prisma.bid.count({ where }),
    prisma.bid.findMany({ where, include: { driver: true, parcel: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  const data = bids.map((b) => ({
    ...serializeBid(b),
    parcel: b.parcel
      ? { id: b.parcel.id, trackingNumber: b.parcel.trackingNumber, status: b.parcel.status, receiverName: b.parcel.receiverName }
      : null
  }));
  return ok(res, { message: 'Offres recues', data: { bids: data }, meta: paginationMeta({ page, limit, total }) });
});

export const negotiateBid = handle('bid.negotiate', async (req, res) => {
  const bid = await prisma.bid.update({
    where: { id: req.params.bidId },
    data: { responseMessage: req.body.message, price: decimal(req.body.price, '0') },
    include: { driver: true }
  });
  return ok(res, { message: 'Contre-proposition envoyee', data: { bid: serializeBid(bid) } });
});

export const driverBidsSent = handle('bid.driverSent', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { driverId: req.user.id };
  const [total, bids] = await Promise.all([
    prisma.bid.count({ where }),
    prisma.bid.findMany({ where, include: { driver: true, parcel: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Offres envoyees', data: { bids: bids.map(serializeBid) }, meta: paginationMeta({ page, limit, total }) });
});

export const initiatePayment = handle('payment.initiate', async (req, res) => {
  const payment = await prisma.payment.create({
    data: {
      userId: req.user.id,
      parcelId: req.body.parcelId,
      amount: decimal(req.body.amount, '0'),
      currency: req.body.currency || 'XOF',
      method: req.body.method || 'cash',
      status: 'pending',
      phoneNumber: req.body.phoneNumber,
      reference: `PAY-${Date.now()}`
    },
    include: { parcel: true }
  });
  return ok(res, { status: 201, message: 'Paiement initie', data: { payment: serializePayment(payment) } });
});

export const confirmPayment = handle('payment.confirm', async (req, res) => {
  const payment = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: req.params.paymentId },
      data: { status: 'completed', transactionId: req.body.transactionId, validatedBy: req.user.id, validatedAt: new Date(), completedAt: new Date() },
      include: { parcel: true }
    });
    if (updated.parcelId) {
      await tx.parcel.update({ where: { id: updated.parcelId }, data: { paymentStatus: 'completed' } });
    }
    await audit(tx, req, { action: 'payment.confirm', entityType: 'payment', entityId: updated.id, afterData: { status: 'completed' } });
    return updated;
  });
  return ok(res, { message: 'Paiement confirme', data: { payment: serializePayment(payment) } });
});

export const paymentHistory = handle('payment.history', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = req.user.role === 'super_admin' ? {} : { userId: req.user.id };
  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, include: { parcel: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Historique paiements', data: { payments: payments.map(serializePayment) }, meta: paginationMeta({ page, limit, total }) });
});

export const confirmCashPayment = handle('payment.confirmCash', async (req, res) => {
  const parcelId = req.params.parcelId;
  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });
  if (!parcel) throw new NotFoundError('Colis introuvable');
  if (parcel.paymentStatus === 'completed') {
    throw new ValidationError([{ path: 'parcelId', message: 'Ce colis est déjà payé' }]);
  }

  const parcelPrice = Number(parcel.price || parcel.totalAmount || 0);
  const isDelivered = parcel.status === 'delivered';

  await prisma.$transaction([
    prisma.parcel.update({ where: { id: parcelId }, data: { paymentStatus: 'completed' } }),
    prisma.payment.create({
      data: {
        userId: parcel.senderId || req.user.id,
        parcelId,
        amount: parcelPrice,
        currency: 'XOF',
        method: 'cash',
        status: 'completed',
        validatedBy: req.user.id,
        validatedAt: new Date(),
        completedAt: new Date(),
        reference: `CASH-${Date.now()}`
      }
    }),
    prisma.notification.create({
      data: {
        userId: parcel.senderId || req.user.id,
        type: 'payment_cash',
        title: 'Paiement en especes confirme',
        body: `Le paiement de ${parcelPrice} FCFA pour le colis ${parcel.trackingNumber} a ete confirme en especes.`,
        data: { parcelId, amount: parcelPrice }
      }
    }),
    prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'admin_payment_confirmed',
        title: `Especes confirme : ${parcel.trackingNumber}`,
        body: `${parcelPrice} FCFA confirmes${isDelivered ? ` — chauffeur ${parcel.driverId} sera credite` : ''}.`,
        data: { parcelId, amount: parcelPrice, delivered: isDelivered }
      }
    })
  ]);

  if (isDelivered && parcel.driverId && parcelPrice > 0) {
    const commission = await calculateCommission(parcelPrice);

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: parcel.driverId },
        update: { balance: { increment: parcelPrice }, totalDeposited: { increment: parcelPrice }, lastActivityAt: new Date(), lastDepositAt: new Date() },
        create: { userId: parcel.driverId, balance: parcelPrice, totalDeposited: parcelPrice, lastDepositAt: new Date(), lastActivityAt: new Date() }
      });
      await tx.walletTransaction.create({
        data: {
          walletUserId: parcel.driverId,
          type: 'deposit',
          amount: parcelPrice,
          balanceBefore: Number(wallet.balance) - parcelPrice,
          balanceAfter: Number(wallet.balance),
          parcelId,
          description: `Gain brut colis ${parcel.trackingNumber} (paiement especes)`,
          origin: 'delivery',
          status: 'completed'
        }
      });

      let deductionResult = { walletDeducted: 0, pointsDeducted: 0 };
      if (commission > 0) {
        try {
          deductionResult = await deductCashCommission({
            parcelId,
            driverId: parcel.driverId,
            commission,
            tx,
            req
          });
        } catch (err) {
          if (err.code === 'INSUFFICIENT_FUNDS') {
            throw new ValidationError(
              [{ path: 'commission', message: 'Ressources insuffisantes. Wallet + Points ne couvrent pas la commission.' }],
              'Solde insuffisant pour la commission'
            );
          }
          throw err;
        }
      }

      const driverNet = parcelPrice - commission;
      const notifBody = `+${driverNet} FCFA nets pour le colis ${parcel.trackingNumber}.`
        + `${commission > 0 ? ` Commission: ${commission} FCFA (Wallet: ${deductionResult.walletDeducted} FCFA, Points: ${deductionResult.pointsDeducted} pts).` : ''}`;

      await tx.notification.create({
        data: {
          userId: parcel.driverId,
          type: 'delivery_paid',
          title: 'Paiement recu (especes)',
          body: notifBody,
          data: { parcelId, earning: driverNet, commission, gross: parcelPrice, ...deductionResult }
        }
      });
      await tx.notification.create({
        data: {
          userId: req.user.id,
          type: 'admin_driver_credited',
          title: `Especes - ${parcel.trackingNumber}`,
          body: `Chauffeur: +${driverNet} FCFA nets. Commission: ${commission} FCFA (Wallet: ${deductionResult.walletDeducted}, Points: ${deductionResult.pointsDeducted}).`,
          data: { parcelId, driverId: parcel.driverId, earning: driverNet, commission, ...deductionResult }
        }
      });
    });
  }

  return ok(res, { message: 'Paiement especes confirme', data: { driverCredited: isDelivered && !!parcel.driverId } });
});

export const getScore = handle('score.get', async (req, res) => {
  const { score, transactions } = await scoreSnapshot(req.user.id);
  return ok(res, { message: 'Score utilisateur', data: { score, history: transactions.map(serializeScoreTransaction) } });
});

export const getScoreBalance = handle('score.balance', async (req, res) => {
  const { score } = await scoreSnapshot(req.user.id);
  return ok(res, { message: 'Solde points', data: { balance: score.points } });
});

export const getDriverWallet = handle('driver.wallet', async (req, res) => {
  const wallet = await prisma.wallet.upsert({
    where: { userId: req.user.id },
    update: {},
    create: { userId: req.user.id }
  });
  return ok(res, {
    message: 'Portefeuille',
    data: {
      wallet: {
        balance: number(wallet.balance),
        pendingBalance: number(wallet.pendingBalance),
        totalDeposited: number(wallet.totalDeposited),
        totalSpent: number(wallet.totalSpent),
        totalWithdrawn: number(wallet.totalWithdrawn),
        totalCommissionsPaid: number(wallet.totalCommissionsPaid),
        status: wallet.status,
        lastDepositAt: wallet.lastDepositAt,
        lastActivityAt: wallet.lastActivityAt
      }
    }
  });
});

export const withdrawWallet = handle('driver.withdraw', async (req, res) => {
  const amount = Number(req.body.amount || 0);
  if (!amount || amount < 500) {
    throw new ValidationError([{ path: 'body.amount', message: 'Montant minimum 500 FCFA' }]);
  }

  const method = req.body.method || 'wave';
  const phone = req.body.phone || req.user.phone;

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
  const availableBalance = Number(wallet?.balance || 0);
  if (availableBalance < amount) {
    throw new ValidationError([{ path: 'body.amount', message: `Solde insuffisant. Disponible: ${availableBalance} FCFA` }]);
  }

  const reference = `WTH-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const result = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId: req.user.id },
      data: {
        balance: { decrement: amount },
        pendingBalance: { increment: amount },
        lastActivityAt: new Date()
      }
    });

    const withdrawal = await tx.withdrawal.create({
      data: {
        walletUserId: req.user.id,
        amount,
        method,
        phone,
        status: 'pending',
        reference
      }
    });

    await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'withdrawal_requested',
        title: 'Demande de retrait',
        body: `Votre demande de retrait de ${amount} FCFA a ete enregistree. Reference: ${reference}`,
        data: { amount, reference, method, withdrawalId: withdrawal.id }
      }
    });

    await notifyAdmins(tx, 'admin_withdrawal_request',
      `Nouveau retrait - ${amount} FCFA`,
      `${req.user.fullName} demande un retrait de ${amount} FCFA via ${method}${phone ? ` (${phone})` : ''}. Reference: ${reference}`,
      { userId: req.user.id, amount, method, phone, reference, withdrawalId: withdrawal.id }
    );

    return withdrawal;
  });

  // Retrait libre-service : déboursement PayDunya immédiat (API PUSH) quand configuré.
  // Sans clés PayDunya, le retrait reste en attente de traitement admin.
  const disbursed = await attemptDisbursement(result.id, req.log);
  const final = disbursed ?? result;

  return ok(res, {
    status: 201,
    message:
      final.status === 'completed'
        ? 'Retrait effectue — votre argent est en route'
        : final.status === 'failed'
          ? `Retrait echoue : ${final.failureReason ?? 'erreur du prestataire'} (montant recredite)`
          : 'Demande de retrait enregistree',
    data: {
      withdrawal: {
        id: final.id,
        amount: number(final.amount),
        method: final.method,
        phone: final.phone,
        phoneNumber: final.phone,
        status: toClientWithdrawalStatus(final.status),
        reference: final.reference,
        failureReason: final.failureReason ?? null,
        requestedAt: final.requestedAt
      }
    }
  });
});

export const getDriverWithdrawals = handle('driver.withdrawals.list', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { walletUserId: req.user.id };

  const [total, withdrawals] = await Promise.all([
    prisma.withdrawal.count({ where }),
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Historique des retraits',
    data: {
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        amount: number(w.amount),
        method: w.method,
        phone: w.phone,
        phoneNumber: w.phone,
        status: toClientWithdrawalStatus(w.status),
        reference: w.reference,
        failureReason: w.failureReason,
        requestedAt: w.requestedAt,
        processedAt: w.processedAt,
        completedAt: w.completedAt,
        createdAt: w.createdAt
      }))
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const cancelWithdrawal = handle('driver.withdrawal.cancel', async (req, res) => {
  const withdrawalId = req.params.withdrawalId || req.body.withdrawalId;

  const withdrawal = await prisma.withdrawal.findFirst({
    where: { id: withdrawalId, walletUserId: req.user.id }
  });

  if (!withdrawal) throw new NotFoundError('Retrait introuvable');
  if (withdrawal.status !== 'pending') {
    throw new ValidationError([{ path: 'status', message: 'Seuls les retraits en attente peuvent etre annules' }]);
  }

  await prisma.$transaction(async (tx) => {
    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'cancelled' }
    });

    await tx.wallet.update({
      where: { userId: req.user.id },
      data: {
        balance: { increment: Number(withdrawal.amount) },
        pendingBalance: { decrement: Number(withdrawal.amount) },
        lastActivityAt: new Date()
      }
    });

    await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'withdrawal_cancelled',
        title: 'Retrait annule',
        body: `Votre demande de retrait de ${withdrawal.amount} FCFA a ete annulee. Le montant est de nouveau disponible.`,
        data: { withdrawalId, amount: number(withdrawal.amount) }
      }
    });
  });

  return ok(res, { message: 'Retrait annule', data: { status: 'CANCELLED', withdrawal: { id: withdrawalId, status: 'CANCELLED' } } });
});

export const getScoreHistory = handle('score.history', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { userId: req.user.id };
  const [total, transactions] = await Promise.all([
    prisma.scoreTransaction.count({ where }),
    prisma.scoreTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Historique points', data: { transactions: transactions.map(serializeScoreTransaction) }, meta: paginationMeta({ page, limit, total }) });
});

export const purchaseScore = handle('score.purchase', async (req, res) => {
  const pointsRequested = Number(req.body.points || req.body.amount || 0);
  if (pointsRequested <= 0) throw new ValidationError([{ path: 'body.points', message: 'Le nombre de points doit etre positif' }]);
  const result = await prisma.$transaction(async (tx) => {
    const cfaPerPoint = await getCfaPerPoint(tx);
    const cfaAmount = Math.round(pointsRequested * cfaPerPoint);

    await tx.score.upsert({
      where: { userId: req.user.id },
      update: { points: { increment: pointsRequested }, totalEarned: { increment: pointsRequested }, lastUpdated: new Date() },
      create: { userId: req.user.id, points: pointsRequested, totalEarned: pointsRequested }
    });
    const payment = await tx.payment.create({
      data: { userId: req.user.id, amount: decimal(cfaAmount, '0'), method: req.body.method || req.body.paymentMethod || 'cash', status: 'completed', phoneNumber: req.body.phoneNumber, reference: `SCORE-${Date.now()}`, completedAt: new Date() }
    });
    const transaction = await tx.scoreTransaction.create({
      data: { userId: req.user.id, amount: pointsRequested, type: 'purchase', source: req.body.source || 'driver_recharge', description: `Achat de ${pointsRequested} points (${cfaAmount} FCFA)`, metadata: { paymentId: payment.id, cfaPerPoint, cfaAmount } }
    });
    return { payment, transaction };
  });
  return ok(res, { message: 'Points achetes', data: { payment: serializePayment(result.payment), transaction: serializeScoreTransaction(result.transaction) } });
});

export const purchaseScoreWithWallet = handle('score.purchaseWallet', async (req, res) => {
  const pointsRequested = Number(req.body.points || req.body.amount || 0);
  if (pointsRequested <= 0) throw new ValidationError([{ path: 'body.points', message: 'Le nombre de points doit etre positif' }]);

  const result = await prisma.$transaction(async (tx) => {
    const cfaPerPoint = await getCfaPerPoint(tx);
    const cfaAmount = Math.round(pointsRequested * cfaPerPoint);

    const wallet = await tx.wallet.findUnique({ where: { userId: req.user.id } });
    const balance = Number(wallet?.balance || 0);
    if (balance < cfaAmount) {
      throw new ValidationError([{ path: 'wallet', message: `Solde insuffisant. Disponible: ${balance} FCFA, requis: ${cfaAmount} FCFA (${pointsRequested} pts × ${cfaPerPoint} FCFA/pt)` }]);
    }

    await tx.wallet.update({
      where: { userId: req.user.id },
      data: { balance: { decrement: cfaAmount }, totalSpent: { increment: cfaAmount }, lastActivityAt: new Date() }
    });
    await tx.walletTransaction.create({
      data: {
        walletUserId: req.user.id,
        type: 'commission',
        amount: cfaAmount,
        balanceBefore: balance,
        balanceAfter: balance - cfaAmount,
        description: `Achat de ${pointsRequested} points (${cfaPerPoint} FCFA/pt)`,
        origin: 'score_purchase',
        status: 'completed'
      }
    });

    await tx.score.upsert({
      where: { userId: req.user.id },
      update: { points: { increment: pointsRequested }, totalEarned: { increment: pointsRequested }, lastUpdated: new Date() },
      create: { userId: req.user.id, points: pointsRequested, totalEarned: pointsRequested }
    });
    const transaction = await tx.scoreTransaction.create({
      data: { userId: req.user.id, amount: pointsRequested, type: 'purchase', source: 'wallet', description: `Achat de ${pointsRequested} points via portefeuille (${cfaAmount} FCFA)`, metadata: { cfaPerPoint, cfaAmount } }
    });

    return { transaction };
  });

  return ok(res, { message: 'Points achetes via portefeuille', data: { transaction: serializeScoreTransaction(result.transaction) } });
});

async function mutateScore({ userId, amount, type, description, parcelId, metadata = {}, direction }) {
  const delta = direction === 'debit' ? -Math.abs(amount) : Math.abs(amount);
  return prisma.$transaction(async (tx) => {
    const score = await tx.score.upsert({
      where: { userId },
      update: {
        points: { increment: delta },
        totalEarned: direction === 'credit' ? { increment: Math.abs(amount) } : undefined,
        totalSpent: direction === 'debit' ? { increment: Math.abs(amount) } : undefined,
        lastUpdated: new Date()
      },
      create: {
        userId,
        points: Math.max(delta, 0),
        totalEarned: direction === 'credit' ? Math.abs(amount) : 0,
        totalSpent: direction === 'debit' ? Math.abs(amount) : 0
      }
    });
    const transaction = await tx.scoreTransaction.create({ data: { userId, amount: delta, type, parcelId, description, metadata } });
    return { score, transaction };
  });
}

export const debitScore = handle('score.debit', async (req, res) => {
  const result = await mutateScore({ userId: req.body.userId || req.user.id, amount: Number(req.body.amount), type: req.body.type || 'debit', description: req.body.description || 'Debit points', parcelId: req.body.parcelId, direction: 'debit' });
  return ok(res, { message: 'Points debites', data: { score: result.score, transaction: serializeScoreTransaction(result.transaction) } });
});

export const creditScore = handle('score.credit', async (req, res) => {
  const result = await mutateScore({ userId: req.body.userId || req.user.id, amount: Number(req.body.amount), type: req.body.type || 'credit', description: req.body.description || 'Credit points', parcelId: req.body.parcelId, direction: 'credit' });
  return ok(res, { message: 'Points credites', data: { score: result.score, transaction: serializeScoreTransaction(result.transaction) } });
});

export const refundScore = handle('score.refund', async (req, res) => {
  const result = await mutateScore({ userId: req.body.userId || req.user.id, amount: Number(req.body.amount || 0), type: 'refund', description: req.body.reason || 'Remboursement points', direction: 'credit' });
  return ok(res, { message: 'Points rembourses', data: { score: result.score, transaction: serializeScoreTransaction(result.transaction) } });
});

export const scoreStats = handle('score.stats', async (req, res) => {
  const [totalUsers, totalPoints, transactions] = await Promise.all([
    prisma.score.count(),
    prisma.score.aggregate({ _sum: { points: true, totalEarned: true, totalSpent: true } }),
    prisma.scoreTransaction.count()
  ]);
  return ok(res, { message: 'Stats score', data: { stats: { totalUsers, transactions, sums: totalPoints._sum } } });
});

export const listAddresses = handle('addresses.list', async (req, res) => {
  const addresses = await prisma.address.findMany({ where: { userId: req.user.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  return ok(res, { message: 'Adresses', data: { addresses } });
});

export const createAddress = handle('addresses.create', async (req, res) => {
  const address = await prisma.$transaction(async (tx) => {
    if (req.body.isDefault) await tx.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    return tx.address.create({ data: { ...req.body, userId: req.user.id } });
  });
  return ok(res, { status: 201, message: 'Adresse creee', data: { address } });
});

export const updateAddress = handle('addresses.update', async (req, res) => {
  const address = await prisma.address.update({ where: { id: req.params.addressId }, data: req.body });
  if (address.userId !== req.user.id) throw new ForbiddenError('Adresse non autorisee');
  return ok(res, { message: 'Adresse mise a jour', data: { address } });
});

export const deleteAddress = handle('addresses.delete', async (req, res) => {
  const address = await prisma.address.findUnique({ where: { id: req.params.addressId } });
  if (!address || address.userId !== req.user.id) throw new NotFoundError('Adresse introuvable');
  await prisma.address.delete({ where: { id: address.id } });
  return ok(res, { message: 'Adresse supprimee' });
});

export const setDefaultAddress = handle('addresses.default', async (req, res) => {
  const address = await prisma.address.findUnique({ where: { id: req.params.addressId } });
  if (!address || address.userId !== req.user.id) throw new NotFoundError('Adresse introuvable');
  await prisma.$transaction([
    prisma.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } }),
    prisma.address.update({ where: { id: address.id }, data: { isDefault: true } })
  ]);
  return ok(res, { message: 'Adresse par defaut mise a jour' });
});

export const addFavoriteGarage = handle('favorites.addGarage', async (req, res) => {
  await prisma.favoriteGarage.upsert({
    where: { userId_garageId: { userId: req.user.id, garageId: req.params.garageId } },
    update: {},
    create: { userId: req.user.id, garageId: req.params.garageId }
  });
  return ok(res, { message: 'Garage ajoute aux favoris' });
});

export const removeFavoriteGarage = handle('favorites.removeGarage', async (req, res) => {
  await prisma.favoriteGarage.deleteMany({ where: { userId: req.user.id, garageId: req.params.garageId } });
  return ok(res, { message: 'Garage retire des favoris' });
});

export const favoriteGarages = handle('favorites.garages', async (req, res) => {
  const favorites = await prisma.favoriteGarage.findMany({ where: { userId: req.user.id }, include: { garage: true } });
  return ok(res, { message: 'Garages favoris', data: { garages: favorites.map((favorite) => serializeGarage(favorite.garage)) } });
});

function serializeMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    senderId: m.senderId,
    receiverId: m.receiverId,
    parcelId: m.parcelId,
    body: m.body,
    audioUrl: m.audioUrl,
    isRead: m.isRead,
    createdAt: m.createdAt
  };
}

export const sendMessage = handle('messages.send', async (req, res) => {
  if (!req.body.receiverId) throw new ValidationError([{ path: 'receiverId', message: 'Destinataire requis' }]);
  if (!req.body.body && !req.body.audioUrl) throw new ValidationError([{ path: 'body', message: 'Message vide' }]);
  const message = await prisma.message.create({
    data: {
      senderId: req.user.id,
      receiverId: req.body.receiverId,
      parcelId: req.body.parcelId || null,
      body: req.body.body || '',
      audioUrl: req.body.audioUrl || null
    }
  });
  return ok(res, { status: 201, message: 'Message envoye', data: { message: serializeMessage(message) } });
});

export const messageThread = handle('messages.thread', async (req, res) => {
  const peerId = req.query.peerId;
  const parcelId = req.query.parcelId || null;
  if (!peerId) throw new ValidationError([{ path: 'peerId', message: 'peerId requis' }]);
  const where = {
    OR: [
      { senderId: req.user.id, receiverId: peerId },
      { senderId: peerId, receiverId: req.user.id }
    ]
  };
  if (parcelId === null) {
    where.parcelId = null;
  } else {
    where.parcelId = parcelId;
  }
  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'asc' }
  });
  await prisma.message.updateMany({
    where: { receiverId: req.user.id, senderId: peerId, parcelId: parcelId === null ? null : parcelId, isRead: false },
    data: { isRead: true, readAt: new Date() }
  });
  return ok(res, { message: 'Conversation', data: { messages: messages.map(serializeMessage) } });
});

export const conversations = handle('messages.conversations', async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }] },
    include: { sender: true, receiver: true, parcel: { include: { media: true, departureGarage: true, arrivalGarage: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return ok(res, { message: 'Conversations', data: { conversations: messages } });
});

export const readMessage = handle('messages.read', async (req, res) => {
  await prisma.message.updateMany({ where: { id: req.params.messageId, receiverId: req.user.id }, data: { isRead: true, readAt: new Date() } });
  return ok(res, { message: 'Message lu' });
});

export const createSupportMessage = handle('support.create', async (req, res) => {
  const supportMessage = await prisma.supportMessage.create({
    data: { userId: req.user.id, subject: req.body.subject, message: req.body.message, metadata: req.body.metadata || {} }
  });
  return ok(res, { status: 201, message: 'Message support envoye', data: { supportMessage } });
});

export const listSupportMessages = handle('support.list', async (req, res) => {
  const where = req.user.role === 'super_admin' || req.user.role === 'admin' ? {} : { userId: req.user.id };
  const supportMessages = await prisma.supportMessage.findMany({ where, orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Messages support', data: { supportMessages } });
});

export const createRating = handle('ratings.create', async (req, res) => {
  const driverId = req.body.driverId;
  const ratingValue = Number(req.body.rating);

  if (!driverId) throw new ValidationError([{ path: 'body.driverId', message: 'Chauffeur requis' }]);
  if (!ratingValue || ratingValue < 1 || ratingValue > 5) {
    throw new ValidationError([{ path: 'body.rating', message: 'Note entre 1 et 5 requise' }]);
  }

  const rating = await prisma.rating.create({
    data: { parcelId: req.body.parcelId, driverId, ratedBy: req.user.id, rating: ratingValue, comment: req.body.comment }
  });

  const avg = await prisma.rating.aggregate({
    where: { driverId },
    _avg: { rating: true }
  });

  await prisma.user.update({
    where: { id: driverId },
    data: { rating: avg._avg.rating ? Math.round(avg._avg.rating * 100) / 100 : 0 }
  });

  return ok(res, { status: 201, message: 'Note enregistree', data: { rating } });
});

export const driverRatings = handle('ratings.driver', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { driverId: req.params.driverId };
  const [total, ratings] = await Promise.all([
    prisma.rating.count({ where }),
    prisma.rating.findMany({ where, include: { author: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Notes chauffeur', data: { ratings }, meta: paginationMeta({ page, limit, total }) });
});

export const availableCoupons = handle('coupons.available', async (_req, res) => {
  return ok(res, { message: 'Coupons disponibles', data: { coupons: [] } });
});

export const searchParcels = handle('search.parcels', async (req, res) => {
  const where = {
    deletedAt: null,
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.q
      ? {
          OR: [
            { trackingNumber: { contains: req.query.q, mode: 'insensitive' } },
            { receiverName: { contains: req.query.q, mode: 'insensitive' } },
            { senderName: { contains: req.query.q, mode: 'insensitive' } }
          ]
        }
      : {})
  };
  if (req.user.role === 'client') where.senderId = req.user.id;
  if (req.user.role === 'driver') where.driverId = req.user.id;
  const parcels = await prisma.parcel.findMany({ where, include: parcelInclude, orderBy: { createdAt: 'desc' }, take: 50 });
  return ok(res, { message: 'Recherche colis', data: { parcels: parcels.map(serializeParcel) } });
});

export const searchDrivers = handle('drivers.search', async (req, res) => {
  const drivers = await prisma.user.findMany({
    where: cleanUndefined({ role: 'driver', status: 'active', city: req.query.city, garageId: req.query.garageId }),
    include: { garage: true },
    take: Number(req.query.limit || 100)
  });
  return ok(res, { message: 'Chauffeurs', data: { drivers: drivers.map(serializeUser) } });
});

export const publicDriverDetail = handle('drivers.detail', async (req, res) => {
  const driver = await prisma.user.findFirst({ where: { id: req.params.driverId, role: 'driver' }, include: { garage: true } });
  if (!driver) throw new NotFoundError('Chauffeur introuvable');
  return ok(res, { message: 'Detail chauffeur', data: { driver: serializeUser(driver) } });
});

export const garagePublicDrivers = handle('drivers.garage', async (req, res) => {
  const drivers = await prisma.user.findMany({ where: { role: 'driver', garageId: req.params.garageId, status: 'active' }, include: { garage: true } });
  return ok(res, { message: 'Chauffeurs garage', data: { drivers: drivers.map(serializeUser) } });
});

export const saveDriverLocation = handle('driver.location', async (req, res) => {
  const location = await prisma.driverLocation.create({
    data: { driverId: req.user.id, parcelId: req.body.parcelId, latitude: decimal(req.body.latitude, '0'), longitude: decimal(req.body.longitude, '0'), accuracy: decimal(req.body.accuracy) }
  });
  return ok(res, { status: 201, message: 'Position enregistree', data: { location } });
});

export const createIdentityVerification = handle('identity.verify', async (req, res) => {
  const identity = await prisma.identityVerification.create({ data: { userId: req.user.id, documentType: req.body.documentType } });
  return ok(res, { status: 201, message: 'Verification identite creee', data: { identity } });
});

export const identityUploadPlaceholder = handle('identity.upload', async (req, res) => {
  const url = req.body.url || null;
  const side = req.body.side === 'back' ? 'documentBackUrl' : 'documentFrontUrl';
  const identity = await prisma.identityVerification.upsert({
    where: { id: req.body.identityId || '00000000-0000-4000-8000-000000000000' },
    update: { [side]: url },
    create: { userId: req.user.id, documentType: req.body.documentType, [side]: url }
  }).catch(async () => prisma.identityVerification.create({ data: { userId: req.user.id, documentType: req.body.documentType, [side]: url } }));
  return ok(res, { message: 'Document identite enregistre', data: { url, identity } });
});

export const identityStatus = handle('identity.status', async (req, res) => {
  const identity = await prisma.identityVerification.findFirst({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Statut identite', data: { status: identity?.status || 'pending', identity } });
});

export const listAdvertisements = handle('advertisements.list', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ status: req.query.status });
  const [total, advertisements] = await Promise.all([
    prisma.advertisement.count({ where }),
    prisma.advertisement.findMany({ where, include: { driver: { include: { garage: true } }, offers: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Annonces', data: { advertisements: advertisements.map(serializeAdvertisement) }, meta: paginationMeta({ page, limit, total }) });
});

export const myAdvertisements = handle('advertisements.my', async (req, res) => {
  const advertisements = await prisma.advertisement.findMany({ where: { driverId: req.user.id }, include: { driver: true, offers: { include: { client: true, parcel: { include: { media: true } } } } }, orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Mes annonces', data: { advertisements: advertisements.map(serializeAdvertisement) } });
});

export const createAdvertisement = handle('advertisements.create', async (req, res) => {
  const advertisement = await prisma.advertisement.create({
    data: {
      driverId: req.user.id,
      departureGarageId: req.body.departureGarageId,
      arrivalGarageId: req.body.arrivalGarageId,
      departureCity: req.body.departureCity,
      arrivalCity: req.body.arrivalCity,
      departureAt: req.body.departureAt ? new Date(req.body.departureAt) : null,
      availableWeight: decimal(req.body.availableWeight),
      proposedPrice: decimal(req.body.proposedPrice),
      description: req.body.description,
      audioUrl: req.body.audioUrl
    },
    include: { driver: true, offers: true }
  });
  return ok(res, { status: 201, message: 'Annonce creee', data: { advertisement: serializeAdvertisement(advertisement) } });
});

export const advertisementDetail = handle('advertisements.detail', async (req, res) => {
  const advertisement = await prisma.advertisement.findUnique({
    where: { id: req.params.advertisementId },
    include: {
      driver: { include: { garage: true } },
      offers: { include: { client: true, parcel: { include: { media: true } } } }
    }
  });
  if (!advertisement) throw new NotFoundError('Annonce introuvable');
  return ok(res, { message: 'Detail annonce', data: { advertisement: serializeAdvertisement(advertisement) } });
});

export const updateAdvertisement = handle('advertisements.update', async (req, res) => {
  const advertisement = await prisma.advertisement.findUnique({ where: { id: req.params.advertisementId } });
  if (!advertisement) throw new NotFoundError('Annonce introuvable');
  if (req.user.role !== 'super_admin' && advertisement.driverId !== req.user.id) throw new ForbiddenError('Annonce non autorisee');
  const updated = await prisma.advertisement.update({ where: { id: advertisement.id }, data: req.body, include: { driver: true, offers: true } });
  return ok(res, { message: 'Annonce mise a jour', data: { advertisement: serializeAdvertisement(updated) } });
});

export const deleteAdvertisement = handle('advertisements.delete', async (req, res) => {
  const advertisement = await prisma.advertisement.findUnique({ where: { id: req.params.advertisementId } });
  if (!advertisement) throw new NotFoundError('Annonce introuvable');
  if (req.user.role !== 'super_admin' && advertisement.driverId !== req.user.id) throw new ForbiddenError('Annonce non autorisee');
  await prisma.advertisement.delete({ where: { id: advertisement.id } });
  return ok(res, { message: 'Annonce supprimee' });
});

export const closeAdvertisement = handle('advertisements.close', async (req, res) => {
  const advertisement = await prisma.advertisement.update({ where: { id: req.params.advertisementId }, data: { status: 'closed', metadata: { reason: req.body.reason } }, include: { driver: true, offers: true } });
  return ok(res, { message: 'Annonce fermee', data: { advertisement: serializeAdvertisement(advertisement) } });
});

export const createAdvertisementOffer = handle('advertisements.offerCreate', async (req, res) => {
  const ad = await prisma.advertisement.findUnique({ where: { id: req.params.advertisementId } });
  if (!ad) throw new NotFoundError('Annonce introuvable');

  const offer = await prisma.$transaction(async (tx) => {
    const created = await tx.advertisementOffer.create({
      data: { advertisementId: ad.id, clientId: req.user.id, parcelId: req.body.parcelId, price: decimal(req.body.price, '0'), message: req.body.message },
      include: { client: true, parcel: { include: { media: true } } }
    });
    await notify(tx, {
      userId: ad.driverId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'ad_offer',
      title: 'Nouvelle offre client',
      body: `${req.user.fullName} propose ${created.price} FCFA pour votre annonce.`,
      data: { advertisementId: ad.id, offerId: created.id, price: Number(created.price) },
      priority: 'high'
    });
    return created;
  });
  return ok(res, { status: 201, message: 'Offre envoyee', data: { offer: serializeAdvertisementOffer(offer) } });
});

export const advertisementOffers = handle('advertisements.offers', async (req, res) => {
  const advertisement = await prisma.advertisement.findUnique({ where: { id: req.params.advertisementId } });
  if (!advertisement) throw new NotFoundError('Annonce introuvable');
  if (req.user.role !== 'super_admin' && advertisement.driverId !== req.user.id) throw new ForbiddenError('Annonce non autorisee');
  const offers = await prisma.advertisementOffer.findMany({ where: { advertisementId: advertisement.id }, include: { client: true, parcel: true }, orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Offres annonce', data: { offers: offers.map(serializeAdvertisementOffer) } });
});

export const acceptAdvertisementOffer = handle('advertisements.offerAccept', async (req, res) => {
  const offer = await prisma.$transaction(async (tx) => {
    const updated = await tx.advertisementOffer.update({
      where: { id: req.params.offerId },
      data: { status: 'accepted', responseMessage: req.body.responseMessage, respondedAt: new Date() },
      include: { client: true, advertisement: true }
    });
    await notify(tx, {
      userId: updated.clientId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'ad_offer_accepted',
      title: 'Offre acceptee',
      body: `Votre offre pour l'annonce a ete acceptee.`,
      data: { advertisementId: updated.advertisementId, offerId: updated.id },
      priority: 'high'
    });
    return updated;
  });
  return ok(res, { message: 'Offre traitee', data: { offer: serializeAdvertisementOffer(offer) } });
});

export const rejectAdvertisementOffer = handle('advertisements.offerReject', async (req, res) => {
  const offer = await prisma.$transaction(async (tx) => {
    const updated = await tx.advertisementOffer.update({
      where: { id: req.params.offerId },
      data: { status: 'rejected', responseMessage: req.body.responseMessage, respondedAt: new Date() },
      include: { client: true }
    });
    await notify(tx, {
      userId: updated.clientId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'ad_offer_rejected',
      title: 'Offre refusee',
      body: `Votre offre pour l'annonce a ete refusee.`,
      data: { advertisementId: updated.advertisementId, offerId: updated.id }
    });
    return updated;
  });
  return ok(res, { message: 'Offre traitee', data: { offer: serializeAdvertisementOffer(offer) } });
});

export const negotiateAdvertisementOffer = handle('advertisements.offerNegotiate', async (req, res) => {
  const offer = await prisma.advertisementOffer.update({
    where: { id: req.params.offerId },
    data: { price: decimal(req.body.price, '0'), responseMessage: req.body.message },
    include: { client: true, parcel: { include: { media: true } } }
  });
  return ok(res, { message: 'Prix negocie', data: { offer: serializeAdvertisementOffer(offer) } });
});

export const advertisementStats = handle('advertisements.stats', async (req, res) => {
  const where = req.user.role === 'driver' ? { driverId: req.user.id } : {};
  const [total, open, closed] = await Promise.all([
    prisma.advertisement.count({ where }),
    prisma.advertisement.count({ where: { ...where, status: 'open' } }),
    prisma.advertisement.count({ where: { ...where, status: 'closed' } })
  ]);
  return ok(res, { message: 'Stats annonces', data: { stats: { total, open, closed } } });
});

export const createVehicle = handle('vehicles.create', async (req, res) => {
  const garageId = req.user.role === 'admin' ? req.user.garageId : req.body.garageId;
  const vehicle = await prisma.vehicle.create({
    data: { plateNumber: req.body.plateNumber, model: req.body.model, type: req.body.type, capacity: Number(req.body.capacity || 0), garageId, driverId: req.body.driverId }
  });
  return ok(res, { status: 201, message: 'Vehicule cree', data: { vehicle } });
});

export const listVehicles = handle('vehicles.list', async (req, res) => {
  const where = req.user.role === 'admin' ? { garageId: req.user.garageId, deletedAt: null } : { deletedAt: null };
  const vehicles = await prisma.vehicle.findMany({ where, include: { garage: true, driver: true }, orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Vehicules', data: { vehicles } });
});

export const updateVehicleStatus = handle('vehicles.status', async (req, res) => {
  const vehicle = await prisma.vehicle.update({ where: { id: req.params.vehicleId }, data: { isAvailable: Boolean(req.body.isAvailable) } });
  return ok(res, { message: 'Vehicule mis a jour', data: { vehicle } });
});

export const deleteVehicle = handle('vehicles.delete', async (req, res) => {
  await prisma.vehicle.update({ where: { id: req.params.vehicleId }, data: { deletedAt: new Date() } });
  return ok(res, { message: 'Vehicule supprime' });
});

export const getDriverVehicle = handle('driver.vehicle.get', async (req, res) => {
  // A driver owns at most one active vehicle (the one they drive).
  const vehicle = await prisma.vehicle.findFirst({
    where: { driverId: req.user.id, deletedAt: null },
    orderBy: { createdAt: 'desc' }
  });
  return ok(res, { message: 'Vehicule du chauffeur', data: { vehicle: vehicle || null } });
});

export const upsertDriverVehicle = handle('driver.vehicle.upsert', async (req, res) => {
  const plateNumber = (req.body.plateNumber || '').trim();
  const model = (req.body.model || '').trim();
  const type = (req.body.type || '').trim();
  const errors = [];
  if (plateNumber.length < 2) errors.push({ path: 'body.plateNumber', message: "Plaque d'immatriculation requise" });
  if (model.length < 1) errors.push({ path: 'body.model', message: 'Modele requis' });
  if (type.length < 1) errors.push({ path: 'body.type', message: 'Type de vehicule requis' });
  if (errors.length) throw new ValidationError(errors);

  // A driver may not belong to a garage: garageId is optional on vehicles.
  const data = { plateNumber, model, type, capacity: Number(req.body.capacity || 0), garageId: req.user.garageId || null, driverId: req.user.id };
  const existing = await prisma.vehicle.findFirst({ where: { driverId: req.user.id, deletedAt: null } });

  try {
    const vehicle = existing
      ? await prisma.vehicle.update({ where: { id: existing.id }, data })
      : await prisma.vehicle.create({ data });
    return ok(res, { status: existing ? 200 : 201, message: 'Vehicule enregistre', data: { vehicle } });
  } catch (error) {
    // Unique constraint on plate_number -> another vehicle already uses it.
    if (error && error.code === 'P2002') {
      throw new ConflictError('Cette plaque est deja enregistree');
    }
    throw error;
  }
});

export const garageDrivers = handle('garage.drivers', async (req, res) => {
  const drivers = await prisma.user.findMany({ where: { role: 'driver', garageId: req.user.garageId, status: 'active' }, include: { garage: true } });
  return ok(res, { message: 'Chauffeurs garage', data: { drivers: drivers.map(serializeUser) } });
});

export const garageStats = handle('garage.stats', async (req, res) => {
  const garageId = req.user.garageId;
  const baseWhere = { OR: [{ departureGarageId: garageId }, { arrivalGarageId: garageId }], deletedAt: null };
  const [totalParcels, activeParcels, deliveredToday, activeDrivers, revenue, grouped] = await Promise.all([
    prisma.parcel.count({ where: baseWhere }),
    prisma.parcel.count({ where: { ...baseWhere, status: { in: ACTIVE_PARCEL_STATUSES } } }),
    prisma.parcel.count({ where: { ...baseWhere, status: 'delivered', deliveryDate: { gte: new Date(new Date().toDateString()) } } }),
    prisma.user.count({ where: { garageId, role: 'driver', driverStatus: 'available' } }),
    prisma.payment.aggregate({ where: { parcel: baseWhere, status: 'completed' }, _sum: { amount: true } }),
    prisma.parcel.groupBy({ by: ['status'], where: baseWhere, _count: { status: true } })
  ]);
  const parcelsByStatus = Object.fromEntries(grouped.map((row) => [row.status, row._count.status]));
  return ok(res, { message: 'Stats garage', data: { stats: { garageId, totalParcels, activeParcels, deliveredToday, activeDrivers, revenue: revenue._sum.amount?.toString() || '0', parcelsByStatus } } });
});

async function globalStats() {
  const startOfDay = new Date(new Date().toDateString());
  const [totalUsers, totalDrivers, totalClients, totalGarages, totalVehicles, totalParcels, parcelsInTransit, parcelsDeliveredToday, parcelsPending, totalRevenue] =
    await Promise.all([
      prisma.user.count({ where: { status: { not: 'deleted' } } }),
      prisma.user.count({ where: { role: 'driver', status: 'active' } }),
      prisma.user.count({ where: { role: 'client', status: 'active' } }),
      prisma.garage.count({ where: { deletedAt: null } }),
      prisma.vehicle.count({ where: { deletedAt: null } }),
      prisma.parcel.count({ where: { deletedAt: null } }),
      prisma.parcel.count({ where: { status: 'in_transit' } }),
      prisma.parcel.count({ where: { status: 'delivered', deliveryDate: { gte: startOfDay } } }),
      prisma.parcel.count({ where: { status: 'pending' } }),
      prisma.payment.aggregate({ where: { status: 'completed' }, _sum: { amount: true } })
    ]);
  return {
    totalUsers,
    totalDrivers,
    totalClients,
    totalGarages,
    totalVehicles,
    totalParcels,
    parcelsInTransit,
    parcelsDeliveredToday,
    parcelsPending,
    totalRevenue: Number(totalRevenue._sum.amount || 0),
    revenueThisMonth: Number(totalRevenue._sum.amount || 0),
    revenueLastMonth: 0,
    parcelsByRegion: {},
    dailyStats: [],
    garagePerformance: []
  };
}

export const superAdminStats = handle('super.stats', async (_req, res) => {
  return ok(res, { message: 'Stats globales', data: { stats: await globalStats() } });
});

export const driverStats = handle('driver.stats', async (req, res) => {
  const [assignedParcels, activeParcels, completedDeliveries, score, pendingBids, openAdvertisements] = await Promise.all([
    prisma.parcel.count({ where: { driverId: req.user.id } }),
    prisma.parcel.count({ where: { driverId: req.user.id, status: { in: ACTIVE_PARCEL_STATUSES } } }),
    prisma.parcel.count({ where: { driverId: req.user.id, status: 'delivered' } }),
    prisma.score.findUnique({ where: { userId: req.user.id } }),
    prisma.bid.count({ where: { driverId: req.user.id, status: 'pending' } }),
    prisma.advertisement.count({ where: { driverId: req.user.id, status: 'open' } })
  ]);
  return ok(res, { message: 'Stats chauffeur', data: { stats: { assignedParcels, activeParcels, completedDeliveries, rating: Number(req.user.rating || 0), scoreBalance: score?.points || 0, pendingBids, openAdvertisements } } });
});

export const garageDailyReport = handle('garage.reportDaily', async (req, res) => {
  return ok(res, { message: 'Rapport journalier', data: { report: { date: req.query.date, stats: await globalStats() } } });
});

export const garageMonthlyReport = handle('garage.reportMonthly', async (req, res) => {
  return ok(res, { message: 'Rapport mensuel', data: { report: { year: req.query.year, month: req.query.month, stats: await globalStats() } } });
});

export const garageExport = handle('garage.export', async (req, res) => {
  const parcels = await prisma.parcel.findMany({ where: { OR: [{ departureGarageId: req.user.garageId }, { arrivalGarageId: req.user.garageId }] }, include: parcelInclude });
  return ok(res, { message: 'Export garage', data: { data: parcels.map(serializeParcel) } });
});

export const superAdminDailyReport = handle('super.reportDaily', async (req, res) => {
  return ok(res, { message: 'Rapport journalier', data: { report: { date: req.query.date, stats: await globalStats() } } });
});

export const superAdminMonthlyReport = handle('super.reportMonthly', async (req, res) => {
  return ok(res, { message: 'Rapport mensuel', data: { report: { year: req.query.year, month: req.query.month, stats: await globalStats() } } });
});

export const superAdminExport = handle('super.export', async (req, res) => {
  const type = req.query.type || 'parcels';
  const data = type === 'users'
    ? (await prisma.user.findMany({ include: { garage: true } })).map(serializeUser)
    : (await prisma.parcel.findMany({ include: parcelInclude })).map(serializeParcel);
  return ok(res, { message: 'Export', data: { data } });
});

export const superAdminUsers = handle('super.users', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ role: req.query.role, status: req.query.status });
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, include: { garage: true, score: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Utilisateurs', data: { users: users.map(serializeUser) }, meta: paginationMeta({ page, limit, total }) });
});

export const superAdminCreateUser = handle('super.userCreate', async (req, res) => {
  const pinHash = req.body.pin ? await bcrypt.hash(req.body.pin, 12) : null;
  const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 12) : null;
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: req.body.email,
        phone: req.body.phone,
        fullName: req.body.fullName,
        passwordHash,
        pinHash,
        role: req.body.role,
        status: req.body.status || 'active',
        garageId: req.body.garageId,
        city: req.body.city,
        region: req.body.region,
        isProfileComplete: true
      },
      include: { garage: true }
    });
    await tx.score.create({ data: { userId: created.id } });
    await audit(tx, req, { action: 'user.create', entityType: 'user', entityId: created.id, afterData: { role: created.role } });
    return created;
  });
  return ok(res, { status: 201, message: 'Utilisateur cree', data: { user: serializeUser(user) } });
});

export const superAdminUserDetail = handle('super.userDetail', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, include: { garage: true, score: true } });
  if (!user) throw new NotFoundError('Utilisateur introuvable');
  const stats = {
    parcels: await prisma.parcel.count({ where: { OR: [{ senderId: user.id }, { driverId: user.id }] } }),
    payments: await prisma.payment.count({ where: { userId: user.id } })
  };
  return ok(res, { message: 'Detail utilisateur', data: { user: { ...serializeUser(user), score: user.score, garage: serializeGarage(user.garage), stats } } });
});

export const superAdminUpdateUser = handle('super.userUpdate', async (req, res) => {
  const allowed = ['fullName', 'email', 'phone', 'garageId', 'city', 'region', 'address', 'driverStatus'];
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: cleanUndefined(Object.fromEntries(allowed.map((key) => [key, req.body[key]]))),
    include: { garage: true }
  });
  return ok(res, { message: 'Utilisateur mis a jour', data: { user: serializeUser(user) } });
});

export const superAdminUpdateUserRole = handle('super.userRole', async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.params.userId }, data: { role: req.body.role }, include: { garage: true } });
  return ok(res, { message: 'Role mis a jour', data: { user: serializeUser(user) } });
});

export const superAdminUpdateUserStatus = handle('super.userStatus', async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.params.userId }, data: { status: req.body.status }, include: { garage: true } });
  return ok(res, { message: 'Statut mis a jour', data: { user: serializeUser(user) } });
});

export const superAdminDeleteUser = handle('super.userDelete', async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.params.userId }, data: { status: 'deleted', deletedAt: new Date() }, include: { garage: true } });
  return ok(res, { message: 'Utilisateur supprime', data: { user: serializeUser(user) } });
});

export const superAdminGarages = handle('super.garages', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ city: req.query.city, deletedAt: null });
  const [total, garages] = await Promise.all([
    prisma.garage.count({ where }),
    prisma.garage.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Garages', data: { garages: garages.map(serializeGarage) }, meta: paginationMeta({ page, limit, total }) });
});

export const superAdminCreateGarage = handle('super.garageCreate', async (req, res) => {
  const garage = await prisma.garage.create({
    data: {
      name: req.body.name,
      city: req.body.city,
      region: req.body.region,
      address: req.body.address,
      phone: req.body.phone,
      latitude: decimal(req.body.latitude),
      longitude: decimal(req.body.longitude),
      isActive: req.body.isActive ?? true
    }
  });
  return ok(res, { status: 201, message: 'Garage cree', data: { garage: serializeGarage(garage) } });
});

export const superAdminGarageDetail = handle('super.garageDetail', async (req, res) => {
  const garage = await prisma.garage.findUnique({
    where: { id: req.params.garageId },
    include: { users: true, vehicles: true }
  });
  if (!garage) throw new NotFoundError('Garage introuvable');
  return ok(res, { message: 'Detail garage', data: { garage: { ...serializeGarage(garage), drivers: garage.users.filter((user) => user.role === 'driver').map(serializeUser), vehicles: garage.vehicles, stats: { drivers: garage.users.length, vehicles: garage.vehicles.length } } } });
});

export const superAdminUpdateGarage = handle('super.garageUpdate', async (req, res) => {
  const garage = await prisma.garage.update({
    where: { id: req.params.garageId },
    data: cleanUndefined({
      name: req.body.name,
      city: req.body.city,
      region: req.body.region,
      address: req.body.address,
      phone: req.body.phone,
      latitude: decimal(req.body.latitude),
      longitude: decimal(req.body.longitude),
      isActive: req.body.isActive
    })
  });
  return ok(res, { message: 'Garage mis a jour', data: { garage: serializeGarage(garage) } });
});

export const superAdminDeleteGarage = handle('super.garageDelete', async (req, res) => {
  const garage = await prisma.garage.update({ where: { id: req.params.garageId }, data: { deletedAt: new Date(), isActive: false } });
  return ok(res, { message: 'Garage supprime', data: { garage: serializeGarage(garage) } });
});

export const superAdminUpdateParcel = handle('super.parcelUpdate', async (req, res) => {
  const allowed = ['receiverAddress', 'receiverName', 'receiverPhone', 'notes', 'price', 'totalAmount', 'driverId', 'arrivalGarageId', 'departureGarageId'];
  const parcel = await prisma.parcel.update({
    where: { id: req.params.parcelId },
    data: cleanUndefined(Object.fromEntries(allowed.map((key) => [key, req.body[key]]))),
    include: parcelInclude
  });
  return ok(res, { message: 'Colis mis a jour', data: { parcel: serializeParcel(parcel) } });
});

export const auditLogs = handle('super.auditLogs', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({
    actorId: req.query.actorId,
    action: req.query.action,
    entityType: req.query.entityType,
    entityId: req.query.entityId
  });
  const [total, auditLogsRows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Audit logs', data: { auditLogs: auditLogsRows.map(serializeAuditLog) }, meta: paginationMeta({ page, limit, total }) });
});

export const getSystemConfig = handle('super.configGet', async (_req, res) => {
  const rows = await prisma.systemConfig.findMany();
  const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return ok(res, { message: 'Configuration', data: { config } });
});

export const updateSystemConfig = handle('super.configUpdate', async (req, res) => {
  const entries = Object.entries(req.body);
  if (entries.length === 0) throw new ValidationError([{ path: 'body', message: 'Au moins un parametre requis' }]);

  for (const [key, value] of entries) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy: req.user.id, updatedAt: new Date() },
      create: { key, value, updatedBy: req.user.id }
    });
  }

  return ok(res, { message: 'Configuration mise a jour' });
});

export const createBackup = handle('super.backupCreate', async (req, res) => {
  const backup = await prisma.backup.create({ data: { status: 'completed', requestedBy: req.user.id, fileUrl: `local://${Date.now()}-${req.body.storage || 'local'}`, completedAt: new Date() } });
  return ok(res, { status: 201, message: 'Backup cree', data: { backup } });
});

export const listBackups = handle('super.backups', async (_req, res) => {
  const backups = await prisma.backup.findMany({ orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Backups', data: { backups } });
});

export const restoreBackup = handle('super.restore', async (req, res) => {
  if (req.body.confirmation !== 'RESTORE') throw new ValidationError([{ path: 'body.confirmation', message: 'Confirmation RESTORE requise' }]);
  return ok(res, { message: 'Restauration lancee', data: { restore: { status: 'running', backupId: req.body.backupId } } });
});

export const listWebhooks = handle('webhooks.list', async (_req, res) => {
  const webhooks = await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Webhooks', data: { webhooks } });
});

export const createWebhook = handle('webhooks.create', async (req, res) => {
  const webhook = await prisma.webhook.create({ data: { url: req.body.url, events: req.body.events || [], secret: req.body.secret, createdBy: req.user.id } });
  return ok(res, { status: 201, message: 'Webhook cree', data: { webhook } });
});

export const deleteWebhook = handle('webhooks.delete', async (req, res) => {
  await prisma.webhook.delete({ where: { id: req.params.webhookId } });
  return ok(res, { message: 'Webhook supprime' });
});

export const systemHealth = handle('system.health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return ok(res, {
      message: 'Systeme operationnel',
      data: {
        status: 'healthy',
        database: 'connected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  } catch {
    return fail(res, {
      status: 503,
      message: 'Systeme degrade',
      code: 'SERVICE_UNAVAILABLE',
      data: { status: 'degraded', database: 'disconnected' }
    });
  }
});


// ------------------------------------------------------------------
// Super Admin – Reinitialisation du PIN d'un utilisateur
// ------------------------------------------------------------------

export const superAdminResetUserPin = handle('super.userResetPin', async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status === 'deleted') throw new NotFoundError('Utilisateur introuvable');

  // PIN aleatoire a 6 chiffres, hashe comme a l'inscription (bcrypt, cout 12).
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const pinHash = await bcrypt.hash(pin, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { pinHash } });

    await tx.notification.create({
      data: {
        userId,
        type: 'pin_reset',
        title: 'Code PIN reinitialise',
        body: 'Votre code PIN a ete reinitialise par un administrateur. Utilisez le nouveau code qui vous a ete communique pour vous connecter.',
        data: { resetBy: req.user.id },
        priority: 'high'
      }
    });

    await audit(tx, req, {
      action: 'user.resetPin',
      entityType: 'user',
      entityId: userId,
      afterData: { resetBy: req.user.id }
    });
  });

  if (isBrevoConfigured()) {
    if (user.phone) {
      sendNotificationSms({
        phone: user.phone,
        message: `[PRO COLIS] Votre code PIN a ete reinitialise. Nouveau code : ${pin}. Ne le partagez avec personne.`,
        tag: 'pin_reset'
      }).catch(() => {});
    }
    if (user.email) {
      sendNotificationEmail({
        email: user.email,
        subject: '[PRO COLIS] Votre code PIN a ete reinitialise',
        message: `Votre code PIN a ete reinitialise par un administrateur. Nouveau code : ${pin}. Ne le partagez avec personne.`
      }).catch(() => {});
    }
  }

  // Le PIN en clair est renvoye une seule fois pour affichage a l'administrateur.
  return ok(res, { message: 'PIN reinitialise', data: { pin, newPin: pin } });
});

// ------------------------------------------------------------------
// Commissions cote chauffeur
// ------------------------------------------------------------------

async function activeCommissionConfig(profile = 'local') {
  const configs = await prisma.commissionConfig.findMany({ where: { isActive: true } });
  const cfg = configs.find((c) => c.profile === profile) || configs[0];
  if (!cfg) return { profile, percentage: 5, minAmount: 100, maxAmount: 500 };
  return {
    profile: cfg.profile,
    percentage: Number(cfg.percentage),
    minAmount: Number(cfg.minAmount),
    maxAmount: Number(cfg.maxAmount)
  };
}

function commissionBreakdown(amount, cfg) {
  const commission = calculateCommissionSync(amount, cfg.percentage, cfg.minAmount, cfg.maxAmount);
  return {
    amount,
    commission,
    netAmount: amount - commission,
    percentage: cfg.percentage,
    minAmount: cfg.minAmount,
    maxAmount: cfg.maxAmount,
    profile: cfg.profile
  };
}

export const estimateCommission = handle('commission.estimate', async (req, res) => {
  const amount = number(req.body.amount);
  if (amount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Le montant doit etre positif' }]);
  }

  const cfg = await activeCommissionConfig(req.body.profile || 'local');
  return ok(res, {
    message: 'Estimation commission',
    data: { commission: commissionBreakdown(amount, cfg) }
  });
});

export const driverParcelCommission = handle('driver.parcelCommission', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const amount = Number(parcel.price || parcel.totalAmount || 0);
  const cfg = await activeCommissionConfig('local');
  const breakdown = amount > 0
    ? commissionBreakdown(amount, cfg)
    : { amount: 0, commission: 0, netAmount: 0, percentage: cfg.percentage, minAmount: cfg.minAmount, maxAmount: cfg.maxAmount, profile: cfg.profile };

  const alreadyPaid = await prisma.walletTransaction.findFirst({
    where: { parcelId: parcel.id, walletUserId: req.user.id, type: 'commission', status: 'completed' }
  });
  const paidWithPoints = alreadyPaid
    ? null
    : await prisma.scoreTransaction.findFirst({
        where: { parcelId: parcel.id, userId: req.user.id, type: 'commission_deduction' }
      });

  return ok(res, {
    message: 'Commission du colis',
    data: {
      commission: {
        parcelId: parcel.id,
        trackingNumber: parcel.trackingNumber,
        deliveryAmount: breakdown.amount,
        ...breakdown,
        alreadyPaid: Boolean(alreadyPaid || paidWithPoints)
      }
    }
  });
});

export const driverPayCommission = handle('driver.payCommission', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const source = req.body.source || 'auto';
  if (!['auto', 'wallet', 'score'].includes(source)) {
    throw new ValidationError([{ path: 'body.source', message: 'Source invalide (wallet, score ou auto)' }]);
  }

  const baseAmount = number(req.body.amount) || Number(parcel.price || parcel.totalAmount || 0);
  if (baseAmount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Montant de livraison introuvable pour ce colis' }]);
  }

  const cfg = await activeCommissionConfig('local');
  const commission = calculateCommissionSync(baseAmount, cfg.percentage, cfg.minAmount, cfg.maxAmount);

  const [paidWallet, paidScore] = await Promise.all([
    prisma.walletTransaction.findFirst({
      where: { parcelId: parcel.id, walletUserId: req.user.id, type: 'commission', status: 'completed' }
    }),
    prisma.scoreTransaction.findFirst({
      where: { parcelId: parcel.id, userId: req.user.id, type: 'commission_deduction' }
    })
  ]);
  if (paidWallet || paidScore) {
    throw new ConflictError('La commission de ce colis a deja ete payee');
  }

  const outcome = await prisma.$transaction(async (tx) => {
    let walletDebited = 0;
    let pointsDebited = 0;
    let transaction = null;

    if (source === 'auto') {
      let deduction;
      try {
        deduction = await deductCashCommission({
          parcelId: parcel.id,
          driverId: req.user.id,
          commission,
          tx,
          req
        });
      } catch (err) {
        if (err.code === 'INSUFFICIENT_FUNDS') {
          throw new ValidationError(
            [{ path: 'commission', message: 'Ressources insuffisantes. Wallet + Points ne couvrent pas la commission.' }],
            'Solde insuffisant pour la commission'
          );
        }
        throw err;
      }
      walletDebited = deduction.walletDeducted;
      pointsDebited = deduction.pointsDeducted;
    } else if (source === 'wallet') {
      const wallet = await tx.wallet.upsert({
        where: { userId: req.user.id },
        update: {},
        create: { userId: req.user.id }
      });
      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < commission) {
        throw new ValidationError(
          [{ path: 'body.source', message: `Solde wallet insuffisant (${balanceBefore} FCFA disponibles)` }],
          'Solde insuffisant pour la commission'
        );
      }

      await tx.wallet.update({
        where: { userId: req.user.id },
        data: {
          balance: { decrement: commission },
          totalSpent: { increment: commission },
          totalCommissionsPaid: { increment: commission },
          lastActivityAt: new Date()
        }
      });
      transaction = await tx.walletTransaction.create({
        data: {
          walletUserId: req.user.id,
          type: 'commission',
          amount: commission,
          balanceBefore,
          balanceAfter: balanceBefore - commission,
          parcelId: parcel.id,
          description: `Commission colis ${parcel.trackingNumber} (${commission} FCFA)`,
          origin: 'driver_payment',
          status: 'completed'
        }
      });
      walletDebited = commission;
    } else {
      // source === 'score' : la commission est convertie en points.
      const cfaPerPoint = await getCfaPerPoint(tx);
      const pointsNeeded = Math.ceil(commission / cfaPerPoint);
      const score = await tx.score.upsert({
        where: { userId: req.user.id },
        update: {},
        create: { userId: req.user.id }
      });
      if (score.points < pointsNeeded) {
        throw new ValidationError(
          [{ path: 'body.source', message: `Points insuffisants (${score.points} disponibles, ${pointsNeeded} requis)` }],
          'Points insuffisants pour la commission'
        );
      }

      await tx.score.update({
        where: { userId: req.user.id },
        data: { points: { decrement: pointsNeeded }, totalSpent: { increment: pointsNeeded }, lastUpdated: new Date() }
      });
      await tx.scoreTransaction.create({
        data: {
          userId: req.user.id,
          amount: -pointsNeeded,
          type: 'commission_deduction',
          source: 'driver_payment',
          parcelId: parcel.id,
          description: `Commission colis ${parcel.trackingNumber} (${pointsNeeded} pts = ${commission} FCFA)`,
          metadata: { commission, cfaPerPoint }
        }
      });
      pointsDebited = pointsNeeded;
    }

    await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'commission_paid',
        title: 'Commission payee',
        body: `Commission de ${commission} FCFA payee pour le colis ${parcel.trackingNumber}`
          + ` (Wallet: ${walletDebited} FCFA, Points: ${pointsDebited} pts).`,
        data: { parcelId: parcel.id, commission, walletDebited, pointsDebited }
      }
    });

    await audit(tx, req, {
      action: 'commission.pay',
      entityType: 'parcel',
      entityId: parcel.id,
      afterData: { commission, source, walletDebited, pointsDebited }
    });

    return { walletDebited, pointsDebited, transaction };
  });

  const [walletAfter, scoreAfter] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId: req.user.id } }),
    prisma.score.findUnique({ where: { userId: req.user.id } })
  ]);

  return ok(res, {
    message: 'Commission payee',
    data: {
      result: {
        success: true,
        message: 'Commission payee',
        commission,
        walletDebited: outcome.walletDebited,
        pointsDebited: outcome.pointsDebited,
        newWalletBalance: walletAfter ? Number(walletAfter.balance) : 0,
        newScoreBalance: scoreAfter ? scoreAfter.points : 0,
        debt: null,
        transaction: outcome.transaction
          ? { id: outcome.transaction.id, type: outcome.transaction.type, amount: Number(outcome.transaction.amount) }
          : null
      }
    }
  });
});
// ============================================================
// ADMIN SUPPORT FUNCTIONS - Version corrigée (Prisma)
// ============================================================

/**
 * Admin: Récupérer toutes les conversations de support
 * GET /messages/admin/support/conversations
 */
export const adminSupportConversations = async (req, res) => {
  try {
    console.log('📨 adminSupportConversations - Début');

    // Récupérer les messages de support (parcel_id IS NULL)
    // où au moins un participant est admin/super_admin/support
    const supportMessages = await prisma.message.findMany({
      where: {
        parcelId: null,
        OR: [
          { sender: { role: { in: ['admin', 'super_admin', 'support'] } } },
          { receiver: { role: { in: ['admin', 'super_admin', 'support'] } } }
        ]
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,      // ✅ Prisma utilise fullName (camelCase)
            profilePhoto: true,   // ✅ Prisma utilise profilePhoto
            role: true,
            email: true,
            phone: true
          }
        },
        receiver: {
          select: {
            id: true,
            fullName: true,      // ✅ Prisma utilise fullName
            profilePhoto: true,   // ✅ Prisma utilise profilePhoto
            role: true,
            email: true,
            phone: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`📨 ${supportMessages.length} messages de support trouvés`);

    // Grouper par utilisateur (non-support)
    const conversationMap = new Map();

    for (const msg of supportMessages) {
      const isSupportSender = ['admin', 'super_admin', 'support'].includes(msg.sender.role);
      const isSupportReceiver = ['admin', 'super_admin', 'support'].includes(msg.receiver.role);
      const isSupport = isSupportSender || isSupportReceiver;

      if (!isSupport) continue;

      const user = isSupportSender ? msg.receiver : msg.sender;
      const supportUser = isSupportSender ? msg.sender : msg.receiver;

      if (!conversationMap.has(user.id)) {
        conversationMap.set(user.id, {
          id: user.id,
          body: msg.body,
          createdAt: msg.createdAt,
          senderId: msg.senderId,
          receiverId: msg.receiverId,
          user: {
            id: user.id,
            fullName: user.fullName,
            profilePhoto: user.profilePhoto,
            role: user.role,
            email: user.email,
            phone: user.phone
          },
          supportUser: {
            id: supportUser.id,
            fullName: supportUser.fullName,
            profilePhoto: supportUser.profilePhoto,
            role: supportUser.role
          },
          lastMessage: msg.body,
          lastMessageDate: msg.createdAt,
          messageCount: 1
        });
      } else {
        const existing = conversationMap.get(user.id);
        existing.messageCount += 1;
        if (new Date(msg.createdAt) > new Date(existing.lastMessageDate)) {
          existing.lastMessage = msg.body;
          existing.lastMessageDate = msg.createdAt;
          existing.body = msg.body;
          existing.createdAt = msg.createdAt;
        }
      }
    }

    const result = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastMessageDate) - new Date(a.lastMessageDate));

    console.log(`📨 ${result.length} conversations trouvées`);

    return res.status(200).json({
      success: true,
      message: 'Conversations support',
      data: result
    });
  } catch (error) {
    console.error('❌ Erreur adminSupportConversations:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des conversations',
      error: {
        code: 'INTERNAL_ERROR',
        details: [{ message: error.message }]
      }
    });
  }
};

/**
 * Admin: Récupérer une conversation spécifique
 * GET /messages/admin/support/conversations/:supportUserId/:userId
 */
export const adminSupportThread = async (req, res) => {
  try {
    const { supportUserId, userId } = req.params;

    console.log('📨 adminSupportThread - supportUserId:', supportUserId);
    console.log('📨 adminSupportThread - userId:', userId);

    if (!supportUserId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres manquants',
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            !supportUserId ? { path: 'supportUserId', message: 'supportUserId est requis' } : null,
            !userId ? { path: 'userId', message: 'userId est requis' } : null
          ].filter(Boolean)
        }
      });
    }

    // Vérifier que le support existe
    const support = await prisma.user.findUnique({
      where: { id: supportUserId },
      select: {
        id: true,
        fullName: true,
        role: true,
        profilePhoto: true,
        email: true,
        phone: true
      }
    });

    if (!support) {
      return res.status(404).json({
        success: false,
        message: 'Support utilisateur introuvable',
        error: {
          code: 'NOT_FOUND',
          details: [{ path: 'supportUserId', message: `Utilisateur ${supportUserId} non trouvé` }]
        }
      });
    }

    if (!['admin', 'super_admin', 'support'].includes(support.role)) {
      return res.status(403).json({
        success: false,
        message: 'L\'utilisateur n\'est pas un support valide',
        error: {
          code: 'FORBIDDEN',
          details: [{ path: 'supportUserId', message: `Rôle: ${support.role}` }]
        }
      });
    }

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        profilePhoto: true,
        role: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
        error: {
          code: 'NOT_FOUND',
          details: [{ path: 'userId', message: `Utilisateur ${userId} non trouvé` }]
        }
      });
    }

    console.log('✅ Support trouvé:', support.fullName);
    console.log('✅ Utilisateur trouvé:', user.fullName);

    // Récupérer les messages entre les deux utilisateurs
    const messages = await prisma.message.findMany({
      where: {
        parcelId: null,
        OR: [
          { senderId: userId, receiverId: supportUserId },
          { senderId: supportUserId, receiverId: userId }
        ]
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            profilePhoto: true,
            role: true,
            email: true,
            phone: true
          }
        },
        receiver: {
          select: {
            id: true,
            fullName: true,
            profilePhoto: true,
            role: true,
            email: true,
            phone: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log('📨 Messages trouvés:', messages.length);

    // Marquer les messages non lus comme lus
    if (messages.length > 0) {
      await prisma.message.updateMany({
        where: {
          receiverId: supportUserId,
          senderId: userId,
          parcelId: null,
          isRead: false
        },
        data: {
          isRead: true,
          readAt: new Date()
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation support',
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          profilePhoto: user.profilePhoto,
          role: user.role,
          email: user.email,
          phone: user.phone
        },
        support: {
          id: support.id,
          fullName: support.fullName,
          profilePhoto: support.profilePhoto,
          role: support.role,
          email: support.email,
          phone: support.phone
        },
        messages: messages.map(m => ({
          id: m.id,
          body: m.body,
          isRead: m.isRead,
          readAt: m.readAt,
          createdAt: m.createdAt,
          senderId: m.senderId,
          receiverId: m.receiverId,
          parcelId: m.parcelId,
          audioUrl: m.audioUrl,
          sender: m.sender ? {
            id: m.sender.id,
            fullName: m.sender.fullName,
            profilePhoto: m.sender.profilePhoto,
            role: m.sender.role,
            email: m.sender.email,
            phone: m.sender.phone
          } : null,
          receiver: m.receiver ? {
            id: m.receiver.id,
            fullName: m.receiver.fullName,
            profilePhoto: m.receiver.profilePhoto,
            role: m.receiver.role,
            email: m.receiver.email,
            phone: m.receiver.phone
          } : null
        }))
      }
    });
  } catch (error) {
    console.error('❌ Erreur adminSupportThread:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: {
        code: 'INTERNAL_ERROR',
        details: [{ message: error.message }]
      }
    });
  }
};

/**
 * Admin: Répondre en tant que support
 * POST /messages/admin/support/reply
 */
export const adminSupportReply = async (req, res) => {
  try {
    const { supportUserId, receiverId, body } = req.body;

    console.log('📨 adminSupportReply - supportUserId:', supportUserId);
    console.log('📨 adminSupportReply - receiverId:', receiverId);

    if (!supportUserId || !receiverId || !body) {
      return res.status(400).json({
        success: false,
        message: 'Données manquantes',
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            !supportUserId ? { path: 'supportUserId', message: 'supportUserId est requis' } : null,
            !receiverId ? { path: 'receiverId', message: 'receiverId est requis' } : null,
            !body ? { path: 'body', message: 'body est requis' } : null
          ].filter(Boolean)
        }
      });
    }

    // Vérifier que le support existe
    const support = await prisma.user.findUnique({
      where: { id: supportUserId },
      select: { id: true, fullName: true, role: true }
    });

    if (!support) {
      return res.status(404).json({
        success: false,
        message: 'Support utilisateur introuvable',
        error: {
          code: 'NOT_FOUND',
          details: [{ path: 'supportUserId', message: `Utilisateur ${supportUserId} non trouvé` }]
        }
      });
    }

    if (!['admin', 'super_admin', 'support'].includes(support.role)) {
      return res.status(403).json({
        success: false,
        message: 'L\'utilisateur n\'est pas un support valide',
        error: {
          code: 'FORBIDDEN',
          details: [{ path: 'supportUserId', message: `Rôle: ${support.role}` }]
        }
      });
    }

    // Vérifier que le destinataire existe
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, fullName: true, phone: true, email: true }
    });

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Destinataire introuvable',
        error: {
          code: 'NOT_FOUND',
          details: [{ path: 'receiverId', message: `Utilisateur ${receiverId} non trouvé` }]
        }
      });
    }

    // Créer le message
    const message = await prisma.message.create({
      data: {
        senderId: supportUserId,
        receiverId: receiverId,
        body: body,
        parcelId: null,
        isRead: false
      },
      select: {
        id: true,
        body: true,
        senderId: true,
        receiverId: true,
        isRead: true,
        createdAt: true,
        audioUrl: true
      }
    });

    console.log('✅ Message créé:', message.id);

    // Créer une notification
    await prisma.notification.create({
      data: {
        userId: receiverId,
        type: 'support_reply',
        title: 'Nouvelle réponse du support',
        body: `Le support vous a répondu: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`,
        data: { supportUserId, messageId: message.id },
        priority: 'high'
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Réponse envoyée',
      data: message
    });
  } catch (error) {
    console.error('❌ Erreur adminSupportReply:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: {
        code: 'INTERNAL_ERROR',
        details: [{ message: error.message }]
      }
    });
  }
};
