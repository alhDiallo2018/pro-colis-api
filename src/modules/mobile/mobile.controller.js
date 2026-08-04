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
  serializeDriverWalletTransaction,
  serializeGarage,
  serializeParcel,
  serializeParcelEvent,
  serializePayment,
  serializeScoreTransaction,
  serializeUser
} from '../../utils/mobile-serializers.js';
import { getPagination, paginationMeta } from '../../utils/pagination.js';
import { phoneSearchVariants } from '../../utils/phone-normalizer.js';
import { generateTrackingNumber } from '../../utils/tracking-number.js';
import { attemptDisbursement, toClientWithdrawalStatus } from '../../utils/withdrawal-flow.js';

// Relations a charger des qu'un chauffeur est renvoye au client : le vehicule
// vit dans sa propre table, il est absent de la reponse sans cet include et
// les ecrans affichent « plaque non renseignee » alors qu'elle existe.
const driverInclude = {
  garage: true,
  vehicles: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1
  }
};

// Le vehicule etant une table a part, les formulaires admin qui envoient
// `vehiclePlate` / `vehicleModel` doivent ecrire ici : sans cela ces champs
// etaient silencieusement ignores et l'admin croyait avoir enregistre.
async function syncDriverVehicle(client, user, body) {
  const plateNumber = (body.vehiclePlate || '').trim();
  const model = (body.vehicleModel || '').trim();
  const type = (body.vehicleType || '').trim();
  const hasCapacity = body.vehicleCapacity !== undefined && body.vehicleCapacity !== null;

  if (!plateNumber && !model && !type && !hasCapacity) return;

  const existing = await client.vehicle.findFirst({
    where: { driverId: user.id, deletedAt: null },
    orderBy: { createdAt: 'desc' }
  });

  // La plaque est unique : refuser explicitement plutot que de laisser
  // l'erreur Prisma faire echouer toute l'operation sans message clair.
  if (plateNumber) {
    const clash = await client.vehicle.findFirst({
      where: { plateNumber, deletedAt: null, NOT: { driverId: user.id } }
    });
    if (clash) {
      throw new ConflictError('Cette plaque est deja attribuee a un autre vehicule');
    }
  }

  if (existing) {
    await client.vehicle.update({
      where: { id: existing.id },
      data: cleanUndefined({
        plateNumber: plateNumber || undefined,
        model: model || undefined,
        type: type || undefined,
        capacity: hasCapacity ? Number(body.vehicleCapacity) || 0 : undefined
      })
    });
    return;
  }

  // Creation : plaque et modele sont obligatoires cote schema.
  if (plateNumber && model) {
    await client.vehicle.create({
      data: {
        plateNumber,
        model,
        type: type || 'van',
        capacity: hasCapacity ? Number(body.vehicleCapacity) || 0 : 0,
        garageId: user.garageId || null,
        driverId: user.id
      }
    });
  }
}

const parcelInclude = {
  departureGarage: true,
  arrivalGarage: true,
  departureZone: true,
  arrivalZone: true,
  driver: { include: { garage: true } },
  bids: { 
    include: { 
      driver: true,
      negotiationMessages: {
        orderBy: { createdAt: 'asc' }
      }
    }, 
    orderBy: { createdAt: 'desc' } 
  },
  events: { orderBy: { createdAt: 'asc' } },
  media: { orderBy: { createdAt: 'asc' } }
};

// Les files cash affichent aussi le trajet du colis. Charger uniquement les
// deux garages évite le graphe complet (offres, événements, médias) de
// parcelInclude sur chaque ligne de paiement.
const cashPaymentInclude = {
  user: true,
  parcel: {
    include: {
      departureGarage: true,
      arrivalGarage: true
    }
  }
};

const ACTIVE_PARCEL_STATUSES = ['pending', 'free', 'confirmed', 'picked_up', 'in_transit', 'arrived', 'out_for_delivery'];
const CASH_PAYMENT_STATUSES = ['processing', 'completed', 'failed'];

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
  // ✅ Récupérer TOUS les admins ET supports (technique et commercial)
  const admins = await tx.user.findMany({
    where: {
      role: { 
        in: [
          'super_admin', 
          'admin', 
          'support_technique', 
          'support_commercial',
          'support'  // Gardé pour compatibilité
        ] 
      },
      status: 'active'
    },
    select: { id: true, email: true, phone: true }
  });
  
  // Si aucun admin/support trouvé, on ne fait rien
  if (admins.length === 0) return;

  // Créer les notifications pour chaque admin/support
  const notifs = admins.map((a) =>
    tx.notification.create({ 
      data: { 
        userId: a.id, 
        type, 
        title, 
        body, 
        data 
      } 
    })
  );
  await Promise.all(notifs);

  // Envoyer les emails/SMS si Brevo est configuré
  if (isBrevoConfigured()) {
    for (const admin of admins) {
      if (admin.email) {
        sendNotificationEmail({ 
          email: admin.email, 
          subject: title, 
          message: body 
        }).catch(() => {});
      }
      if (admin.phone) {
        const smsContent = body.length > 300 
          ? `[Admin] ${title}: ${body.substring(0, 300)}...` 
          : `[Admin] ${title}: ${body}`;
        sendNotificationSms({ 
          phone: admin.phone, 
          message: smsContent, 
          tag: type 
        }).catch(() => {});
      }
    }
  }
}

async function notifySupportTeam(tx, title, body, data = {}, senderId, senderName) {
  // Récupérer TOUS les utilisateurs support
  const supportUsers = await tx.user.findMany({
    where: {
      role: { 
        in: ['support_technique', 'support_commercial', 'super_admin', 'admin', 'support'] 
      },
      status: 'active'
    },
    select: { id: true, email: true, phone: true }
  });

  if (supportUsers.length === 0) return;

  // Créer une notification pour chaque support
  const notifs = supportUsers.map((user) =>
    tx.notification.create({
      data: {
        userId: user.id,
        senderId: senderId || null,
        senderName: senderName || 'PRO COLIS',
        type: 'support_message',
        title,
        body,
        data,
        priority: 'high'
      }
    })
  );
  await Promise.all(notifs);

  // Envoyer les emails/SMS si configuré
  if (isBrevoConfigured()) {
    for (const user of supportUsers) {
      if (user.email) {
        sendNotificationEmail({ 
          email: user.email, 
          subject: title, 
          message: body 
        }).catch(() => {});
      }
      if (user.phone) {
        sendNotificationSms({ 
          phone: user.phone, 
          message: body, 
          tag: 'support' 
        }).catch(() => {});
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
      const log = !normalized || (normalized.statusCode || 500) >= 500
        ? req.log.error.bind(req.log)
        : req.log.warn.bind(req.log);
      log(
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
  // `support` est le compte partage historique, co-equivalent de super_admin
  // sur toutes les routes /super-admin/*.
  if (user.role === 'support') return { id: parcelId };
  // Le support instruit tickets et reclamations : il lit n'importe quel colis.
  // L'ecriture reste refusee, aucune route de modification n'etant exposee
  // sous les prefixes /support-technique et /support-commercial.
  if (user.role === 'support_technique' || user.role === 'support_commercial') {
    return { id: parcelId };
  }
  if (user.role === 'client') return { id: parcelId, senderId: user.id };
  if (user.role === 'driver') return { id: parcelId, driverId: user.id };
  if (user.role === 'admin') {
    return {
      id: parcelId,
      OR: [{ departureGarageId: user.garageId }, { arrivalGarageId: user.garageId }]
    };
  }
  // Refus par defaut : un role non traite ne doit pas heriter d'un acces large.
  return { id: parcelId, senderId: '__none__' };
}

/**
 * Étend uniquement la lecture client aux colis dont son téléphone est celui
 * du destinataire. Les mutations continuent d'utiliser `parcelAccessWhere`,
 * afin qu'un destinataire ne puisse ni annuler ni modifier l'envoi.
 */
function parcelReadAccessWhere(user, parcelId) {
  if (user.role !== 'client') return parcelAccessWhere(user, parcelId);

  const ownership = [{ senderId: user.id }];
  // Ne jamais ajouter un téléphone vide : Prisma pourrait réduire un filtre
  // `undefined` à un objet vide dans le OR et élargir involontairement l'accès.
  if (user.phone) ownership.push({ receiverPhone: user.phone });

  return {
    id: parcelId,
    OR: ownership
  };
}

async function findAccessibleParcel(user, parcelId) {
  const parcel = await prisma.parcel.findFirst({
    where: { ...parcelAccessWhere(user, parcelId), deletedAt: null },
    include: parcelInclude
  });
  if (!parcel) throw new NotFoundError('Colis introuvable');
  return parcel;
}

async function findReadableParcel(user, parcelId) {
  const parcel = await prisma.parcel.findFirst({
    where: { ...parcelReadAccessWhere(user, parcelId), deletedAt: null },
    include: parcelInclude
  });
  if (!parcel) throw new NotFoundError('Colis introuvable');
  return parcel;
}

// ============================================================
// ✅ NOUVELLE FONCTION : Récupère un colis pour un chauffeur
// avec accès aux colis en statut 'free' où il a fait une offre
// ============================================================
async function findAccessibleParcelForDriver(user, parcelId) {
  const parcel = await prisma.parcel.findFirst({
    where: {
      id: parcelId,
      deletedAt: null
    },
    include: parcelInclude
  });

  if (!parcel) throw new NotFoundError('Colis introuvable');

  // ✅ Vérifier si le chauffeur a accès à ce colis
  const isAssigned = parcel.driverId === user.id;
  const hasBid = parcel.bids?.some(bid => bid.driverId === user.id);
  const isFree = parcel.status === 'free';

  // ✅ ACCÈS AUTORISÉ SI :
  // 1. Le chauffeur est assigné au colis
  // 2. Le chauffeur a fait une offre sur le colis
  // 3. Le colis est en statut "free" (libre pour tous)
  if (isAssigned || hasBid || isFree) {
    return parcel;
  }

  // ❌ ACCÈS REFUSÉ
  throw new NotFoundError('Colis introuvable');
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
      sendNotificationEmail({ email: user.email, subject: title, message: body }).catch(() => { });
    }
    if (user.phone) {
      const smsContent = body.length > 300 ? `${title}: ${body.substring(0, 300)}...` : `${title}: ${body}`;
      sendNotificationSms({ phone: user.phone, message: smsContent, tag: type }).catch(() => { });
    }
  }

  return notification;
}

/**
 * Gating KYC : si REQUIRE_DRIVER_VERIFICATION est actif, le chauffeur doit avoir
 * son identité vérifiée (isVerified) pour enchérir / publier une annonce.
 */
async function assertDriverVerified(req) {
  if (!env.REQUIRE_DRIVER_VERIFICATION) return;
  const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isVerified: true } });
  if (!me?.isVerified) {
    throw new ForbiddenError(
      "Votre identité doit être vérifiée pour cette action. Envoyez vos documents d'identité depuis votre profil."
    );
  }
}

function statusDescription(status) {
  return {
    pending: 'Colis cree',
    free: 'Colis ouvert aux offres chauffeurs',
    confirmed: 'Colis confirme',
    picked_up: 'Colis ramasse',
    in_transit: 'Colis en transit',
    arrived: 'Colis arrive a la zone destination',
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

    // Compteurs du chauffeur : ils alimentent le profil et les listes admin.
    // Sans cette mise a jour ils restent a 0 a vie, ce qui affiche « 0
    // livraison » a un chauffeur qui en a effectue plusieurs.
    // La garde sur `parcel.status !== status` evite le double comptage si la
    // meme transition est rejouee.
    const driverId = updated.driverId;
    if (driverId && parcel.status !== status) {
      if (status === 'delivered') {
        await tx.user.update({
          where: { id: driverId },
          data: {
            completedDeliveries: { increment: 1 },
            totalDeliveries: { increment: 1 }
          }
        });
      } else if (status === 'cancelled') {
        await tx.user.update({
          where: { id: driverId },
          data: {
            cancelledDeliveries: { increment: 1 },
            totalDeliveries: { increment: 1 }
          }
        });
      }
    }

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

    // P1 : lors d'une assignation (extra.driverId fourni), notifier aussi le
    // chauffeur assigné — l'acceptation d'enchère notifie déjà de son côté.
    if (extra.driverId) {
      await notify(tx, {
        userId: extra.driverId,
        parcelId: updated.id,
        senderId: req.user.id,
        senderName: req.user.fullName,
        type: 'driver_assigned',
        title: 'Nouveau colis assigné',
        body: `Le colis ${updated.trackingNumber} vous a été assigné${updated.arrivalGarage?.name ? ` (destination ${updated.arrivalGarage.name})` : ''}.`,
        data: { trackingNumber: updated.trackingNumber, parcelId: updated.id },
        priority: 'high'
      });
    }

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

// ============================================================
// PROFIL
// ============================================================

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

// ============================================================
// PARCELS
// ============================================================

// Valeurs des enums Prisma reprises ici pour refuser une saisie invalide par un
// 422 explicite. Sans ce controle, une valeur inconnue partait jusqu'a Prisma et
// remontait en 500 opaque.
const PARCEL_TYPES = ['document', 'package', 'fragile', 'perishable', 'valuable'];
const PAYMENT_METHODS = ['wave', 'freemMoney', 'orange_money', 'card', 'cash'];
const PAYMENT_CHANNELS = ['cash', 'platform'];
const CASH_COLLECTION_POINTS = ['sender_pickup', 'receiver_delivery'];

// Champs qu'un expediteur peut corriger sur un colis pas encore engage. La liste
// est explicite : `status`, `driverId`, `totalAmount`, `trackingNumber`,
// `negotiatedPrice` ou `senderId` n'y figurent pas — ils relevent du cycle de vie
// et non de la saisie. Un `data: req.body` laisserait au contraire le client
// reecrire n'importe quelle colonne de la table.
const PARCEL_EDITABLE_TEXT_FIELDS = [
  'senderName',
  'senderPhone',
  'senderEmail',
  'receiverName',
  'receiverPhone',
  'receiverEmail',
  'receiverAddress',
  'description',
  'notes',
  'paymentPhoneNumber'
];
const PARCEL_EDITABLE_DECIMAL_FIELDS = ['weight', 'length', 'width', 'height', 'price', 'proposedPrice'];
const PARCEL_EDITABLE_BOOLEAN_FIELDS = ['isInsured', 'isUrgent'];
const PARCEL_EDITABLE_ID_FIELDS = [
  'departureZoneId',
  'arrivalZoneId',
  'departureGarageId',
  'arrivalGarageId'
];
const PARCEL_EDITABLE_ENUM_FIELDS = {
  type: PARCEL_TYPES,
  paymentMethod: PAYMENT_METHODS,
  paymentChannel: PAYMENT_CHANNELS,
  cashCollectionPoint: CASH_COLLECTION_POINTS
};

// Obligatoires a la creation : une modification peut les corriger, jamais les
// vider — la colonne est NOT NULL cote base.
const PARCEL_REQUIRED_FIELDS = ['receiverName', 'receiverPhone', 'description', 'weight'];

// Modifier l'un de ces champs change l'offre que les chauffeurs ont chiffree :
// ceux qui ont une enchere en cours doivent pouvoir la revoir.
const PARCEL_BID_SENSITIVE_FIELDS = [
  'weight',
  'length',
  'width',
  'height',
  'description',
  'type',
  'price',
  'proposedPrice',
  'isUrgent',
  'departureZoneId',
  'arrivalZoneId',
  'departureGarageId',
  'arrivalGarageId'
];

// Un colis n'est modifiable que tant qu'aucun chauffeur ne s'est engage dessus.
const PARCEL_EDITABLE_STATUSES = ['pending', 'free'];

function pickAuditFields(source, fields) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = source[field];
      if (value === null || value === undefined) return [field, null];
      if (typeof value === 'boolean') return [field, value];
      if (Array.isArray(value)) return [field, value.map(String)];
      // Les Decimal Prisma et les dates sont normalises en texte pour rester
      // lisibles dans le journal d'audit.
      return [field, String(value)];
    })
  );
}

/**
 * Traduit le corps de requete en donnees Prisma, champ par champ. Une chaine
 * vidée devient `null` : c'est ainsi qu'un client efface une adresse ou une note
 * facultative. Les champs obligatoires sont verifies ensuite.
 */
function buildParcelUpdateData(body) {
  const data = {};

  for (const field of PARCEL_EDITABLE_TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    const value = body[field] === null ? null : String(body[field]).trim();
    data[field] = value === '' ? null : value;
  }

  for (const field of PARCEL_EDITABLE_DECIMAL_FIELDS) {
    if (body[field] === undefined) continue;
    const value = decimal(body[field]);
    if (value !== null && !Number.isFinite(Number(value))) {
      throw new ValidationError([{ path: field, message: 'Valeur numerique attendue' }]);
    }
    if (value !== null && Number(value) < 0) {
      throw new ValidationError([{ path: field, message: 'Valeur negative refusee' }]);
    }
    data[field] = value;
  }

  for (const field of PARCEL_EDITABLE_BOOLEAN_FIELDS) {
    if (body[field] === undefined) continue;
    data[field] = Boolean(body[field]);
  }

  for (const field of PARCEL_EDITABLE_ID_FIELDS) {
    if (body[field] === undefined) continue;
    data[field] = body[field] || null;
  }

  for (const [field, allowed] of Object.entries(PARCEL_EDITABLE_ENUM_FIELDS)) {
    if (body[field] === undefined) continue;
    if (body[field] === null || body[field] === '') {
      data[field] = null;
      continue;
    }
    if (!allowed.includes(body[field])) {
      throw new ValidationError([
        { path: field, message: `Valeur attendue parmi : ${allowed.join(', ')}` }
      ]);
    }
    data[field] = body[field];
  }

  if (body.acceptedPaymentChannels !== undefined) {
    if (!Array.isArray(body.acceptedPaymentChannels)) {
      throw new ValidationError([
        { path: 'acceptedPaymentChannels', message: 'Liste de canaux attendue' }
      ]);
    }
    const invalid = body.acceptedPaymentChannels.filter((channel) => !PAYMENT_CHANNELS.includes(channel));
    if (invalid.length) {
      throw new ValidationError([
        { path: 'acceptedPaymentChannels', message: `Canaux inconnus : ${invalid.join(', ')}` }
      ]);
    }
    data.acceptedPaymentChannels = body.acceptedPaymentChannels;
  }

  const emptied = PARCEL_REQUIRED_FIELDS.filter((field) => field in data && data[field] === null);
  if (emptied.length) {
    throw new ValidationError(
      emptied.map((field) => ({ path: field, message: 'Ce champ ne peut pas etre vide' }))
    );
  }
  if (data.weight !== undefined && Number(data.weight) <= 0) {
    throw new ValidationError([{ path: 'weight', message: 'Poids superieur a zero requis' }]);
  }

  return data;
}

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
    status: body.status || (isDriver ? 'confirmed' : isFree ? 'free' : 'pending'),
    // Le mobile envoie des zones ; les garages restent alimentés quand le
    // client les fournit encore (écrans garage-admin non migrés).
    departureGarageId: body.departureGarageId || user.garageId || null,
    arrivalGarageId: body.arrivalGarageId || null,
    departureZoneId: body.departureZoneId || null,
    arrivalZoneId: body.arrivalZoneId || null,
    driverId: body.driverId || (isDriver ? user.id : null),
    price: decimal(body.price),
    proposedPrice: decimal(body.proposedPrice),
    totalAmount: decimal(baseAmount, '0'),
    isInsured: Boolean(body.isInsured),
    isUrgent: Boolean(body.isUrgent),
    isFreeForBidding: isFree,
    paymentMethod: body.paymentMethod,
    paymentChannel: body.paymentChannel,
    acceptedPaymentChannels: Array.isArray(body.acceptedPaymentChannels)
      ? body.acceptedPaymentChannels
      : undefined,
    cashCollectionPoint: body.cashCollectionPoint,
    paymentPhoneNumber: body.paymentPhoneNumber,
    notes: body.notes,
    createdBy: user.id
  });
}

export const createParcel = handle('parcel.create', async (req, res) => {
  if (!req.body.receiverName || !req.body.receiverPhone || !req.body.description || !req.body.weight) {
    throw new ValidationError([{ path: 'body', message: 'Champs colis obligatoires manquants' }]);
  }

  // Les deux référentiels cohabitent : on exige un lieu de départ, sans imposer
  // lequel. Sans ce garde-fou, un colis serait créé sans origine du tout depuis
  // que `departure_garage_id` est nullable.
  if (!req.body.departureZoneId && !req.body.departureGarageId && !req.user.garageId) {
    throw new ValidationError([
      { path: 'departureZoneId', message: 'Zone de départ requise' }
    ]);
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

/**
 * Correction d'un colis par son expediteur. `findAccessibleParcel` restreint
 * deja l'acces au createur (un destinataire lit le colis mais ne le modifie
 * pas) ; les gardes ci-dessous refusent la modification des qu'un engagement
 * existe — chauffeur assigne, offre acceptee ou paiement entame.
 */
export const updateParcel = handle('parcel.update', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);

  if (!PARCEL_EDITABLE_STATUSES.includes(parcel.status)) {
    throw new ConflictError('Ce colis est deja engage : son contenu n\'est plus modifiable');
  }
  if (parcel.driverId) {
    throw new ConflictError('Un chauffeur est deja assigne a ce colis');
  }
  // Le statut devrait suffire, mais une enchere acceptee ou un prix negocie
  // restent les seuls signaux fiables qu'un accord de prix existe deja : un
  // colis reste techniquement en `pending` entre l'acceptation et la confirmation.
  const hasAcceptedBid = (parcel.bids || []).some((bid) => bid.status === 'accepted');
  if (hasAcceptedBid || parcel.selectedBidId || parcel.negotiatedPrice) {
    throw new ConflictError('Une offre a deja ete acceptee pour ce colis');
  }
  const settledPayment = await prisma.payment.findFirst({
    where: { parcelId: parcel.id, status: { in: ['processing', 'completed'] } },
    select: { id: true }
  });
  if (settledPayment) {
    throw new ConflictError('Un paiement est deja engage sur ce colis');
  }

  const data = buildParcelUpdateData(req.body);
  if (Object.keys(data).length === 0) {
    throw new ValidationError([{ path: 'body', message: 'Aucun champ modifiable fourni' }]);
  }

  // Le lieu de depart reste obligatoire apres fusion, comme a la creation :
  // sinon une modification laisserait un colis sans origine.
  const departureZoneId = 'departureZoneId' in data ? data.departureZoneId : parcel.departureZoneId;
  const departureGarageId = 'departureGarageId' in data ? data.departureGarageId : parcel.departureGarageId;
  if (!departureZoneId && !departureGarageId) {
    throw new ValidationError([{ path: 'departureZoneId', message: 'Zone de depart requise' }]);
  }

  // Tant qu'aucun prix n'est negocie — ce que les gardes ci-dessus garantissent —
  // le montant total suit le prix demande, comme a la creation.
  if (data.price !== undefined || data.proposedPrice !== undefined) {
    const proposed = 'proposedPrice' in data ? data.proposedPrice : parcel.proposedPrice;
    const price = 'price' in data ? data.price : parcel.price;
    data.totalAmount = decimal(proposed ?? price, '0');
  }

  const changedFields = Object.keys(data).filter(
    (field) => String(parcel[field] ?? '') !== String(data[field] ?? '')
  );
  if (changedFields.length === 0) {
    return ok(res, { message: 'Colis inchange', data: { parcel: serializeParcel(parcel) } });
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data,
      include: parcelInclude
    });

    // La modification apparait dans la chronologie du colis : le destinataire et
    // le support doivent pouvoir constater qu'une correction a eu lieu.
    const event = await tx.parcelEvent.create({
      data: {
        parcelId: parcel.id,
        status: updated.status,
        description: 'Colis modifie par l\'expediteur',
        userId: req.user.id,
        userName: req.user.fullName,
        userRole: req.user.role,
        metadata: { changedFields }
      }
    });

    await audit(tx, req, {
      action: 'parcel.update',
      entityType: 'parcel',
      entityId: parcel.id,
      beforeData: pickAuditFields(parcel, changedFields),
      afterData: pickAuditFields(updated, changedFields)
    });

    // Les chauffeurs ayant une enchere en cours ont chiffre l'ancienne annonce.
    // Sans avertissement, leur offre porterait sur un colis qui n'est plus celui
    // qu'ils ont evalue.
    const materialChanges = changedFields.filter((field) => PARCEL_BID_SENSITIVE_FIELDS.includes(field));
    if (materialChanges.length) {
      const pendingBids = (parcel.bids || []).filter((bid) =>
        ['pending', 'countered'].includes(bid.status)
      );
      for (const bid of pendingBids) {
        await notify(tx, {
          userId: bid.driverId,
          parcelId: parcel.id,
          bidId: bid.id,
          senderId: req.user.id,
          senderName: req.user.fullName,
          type: 'parcel_updated',
          title: 'Colis modifie',
          body: `Le colis ${updated.trackingNumber} a ete modifie par l'expediteur. Verifiez votre offre.`,
          data: { parcelId: parcel.id, bidId: bid.id, changedFields: materialChanges },
          priority: 'high'
        });
      }
    }

    return { parcel: updated, event };
  });

  return ok(res, {
    message: 'Colis mis a jour',
    data: {
      parcel: serializeParcel(result.parcel),
      event: serializeParcelEvent(result.event)
    }
  });
});

// ============================================================
// ✅ CLIENT PARCELS - CORRIGÉ avec normalisation téléphone/email
// ============================================================
export const clientParcels = handle('client.parcels', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  let ownership;

  if (req.query.filter === 'received') {
    // ✅ CORRECTION : Pour les colis reçus, on cherche par téléphone/email
    // Sans exclure ceux que l'utilisateur a envoyés (car il peut être à la fois
    // expéditeur et destinataire)
    const phoneVariants = req.user.phone ? phoneSearchVariants(req.user.phone) : [];
    const emailVariants = req.user.email 
      ? [req.user.email.toLowerCase(), req.user.email.toUpperCase()]
      : [];

    ownership = {
      OR: [
        ...(phoneVariants.length > 0 ? [{ receiverPhone: { in: phoneVariants } }] : []),
        ...(emailVariants.length > 0 ? [{ receiverEmail: { in: emailVariants } }] : [])
      ]
    };
    // ✅ On ne filtre PAS sur senderId - un colis peut avoir le même expéditeur ET destinataire
  } else if (req.query.filter === 'sent') {
    ownership = { senderId: req.user.id };
  } else {
    // Tous les colis : envoyés OU reçus
    const phoneVariants = req.user.phone ? phoneSearchVariants(req.user.phone) : [];
    const emailVariants = req.user.email 
      ? [req.user.email.toLowerCase(), req.user.email.toUpperCase()]
      : [];

    ownership = {
      OR: [
        { senderId: req.user.id },
        ...(phoneVariants.length > 0 ? [{ receiverPhone: { in: phoneVariants } }] : []),
        ...(emailVariants.length > 0 ? [{ receiverEmail: { in: emailVariants } }] : [])
      ]
    };
  }

  const where = cleanUndefined({
    ...ownership,
    status: req.query.status,
    deletedAt: null
  });

  const [total, parcels] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ 
      where, 
      include: parcelInclude, 
      orderBy: { createdAt: 'desc' }, 
      skip, 
      take: limit 
    })
  ]);

  return ok(res, { 
    message: 'Colis client', 
    data: { parcels: parcels.map(serializeParcel) }, 
    meta: paginationMeta({ page, limit, total }) 
  });
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
  return ok(res, { message: 'Colis zone', data: { parcels: parcels.map(serializeParcel) }, meta: paginationMeta({ page, limit, total }) });
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
  const parcel = await findReadableParcel(req.user, req.params.parcelId);
  return ok(res, { message: 'Detail colis', data: { parcel: serializeParcel(parcel) } });
});

export const getDriverParcelDetail = handle('driver.parcel.detail', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  return ok(res, { message: 'Detail colis', data: { parcel: serializeParcel(parcel) } });
});

export const cancelParcel = handle('parcel.cancel', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'cancelled', { reason: req.body.reason || 'Annulation' });

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

// --- Delivery OTP ---
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
    sendOtpSms({ phone, code, purpose: 'livraison' }).catch(() => { });
  }
  return ok(res, { message: 'Code de livraison', data: { code } });
});

export const driverConfirm = handle('driver.confirm', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'confirmed', {
    ...req.body,
    description: 'Prise en charge confirmee par le chauffeur'
  });
  return ok(res, { message: 'Colis confirme', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverPickup = handle('driver.pickup', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'picked_up', req.body);
  return ok(res, { message: 'Colis ramasse', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverTransit = handle('driver.transit', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'in_transit', req.body);
  return ok(res, { message: 'Colis en transit', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverArrived = handle('driver.arrived', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'arrived', req.body);
  return ok(res, { message: 'Colis arrive a la zone', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverOutForDelivery = handle('driver.outForDelivery', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  const result = await changeParcelStatus(req, parcel, 'out_for_delivery', req.body);
  const { code, phone } = await getOrCreateDeliveryCode(parcel.id, parcel.receiverPhone);
  if (isBrevoConfigured() && phone) {
    sendOtpSms({ phone, code, purpose: 'livraison' }).catch(() => { });
  }
  return ok(res, { message: 'Colis en livraison finale', data: { parcel: serializeParcel(result.parcel), event: serializeParcelEvent(result.event) } });
});

export const driverDeliver = handle('driver.deliver', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);

  const {
    otp,
    deliveryPoints = null,
    signature = null,
    proofImage = null,
    recipientNote = null,
    location = null,
    locationLat = null,
    locationLng = null
  } = req.body;

  // Vérifier le code OTP
  const otpRow = await prisma.otpCode.findFirst({
    where: { type: `delivery:${parcel.id}`, isUsed: false }
  });
  const submitted = String(otp || '').trim();
  if (!otpRow || !submitted || submitted !== otpRow.codeHash) {
    if (otpRow) {
      await prisma.otpCode.update({
        where: { id: otpRow.id },
        data: { attempts: { increment: 1 } }
      });
    }
    throw new ValidationError(
      [{ path: 'otp', message: 'Code de livraison incorrect' }],
      'Code de livraison incorrect'
    );
  }
  await prisma.otpCode.update({
    where: { id: otpRow.id },
    data: { isUsed: true }
  });

  // Mettre à jour le statut
  const result = await changeParcelStatus(req, parcel, 'delivered', {
    signature,
    proofImage,
    location,
    locationLat,
    locationLng,
    notes: recipientNote,
    description: recipientNote
      ? `Livraison confirmée (code OTP) — ${recipientNote}`
      : 'Livraison confirmée par code OTP'
  });

  const parcelPrice = Number(parcel.price || parcel.totalAmount || 0);
  const isPaid = parcel.paymentStatus === 'completed';
  let commission = 0;
  let driverEarning = 0;

  if (isPaid && parcelPrice > 0) {
    commission = await calculateCommission(parcelPrice);
    driverEarning = Math.max(0, parcelPrice - commission);
  }

  let points = 0;

  await prisma.$transaction(async (tx) => {
    points = await getDeliveryPoints(tx);

    await tx.score.upsert({
      where: { userId: req.user.id },
      update: {
        points: { increment: points },
        totalEarned: { increment: points },
        lastUpdated: new Date()
      },
      create: {
        userId: req.user.id,
        points: points,
        totalEarned: points
      }
    });

    await tx.scoreTransaction.create({
      data: {
        userId: req.user.id,
        amount: points,
        type: 'delivery_completed',
        source: 'system',
        parcelId: parcel.id,
        description: `Points chauffeur pour livraison terminée (${points} pts)`
      }
    });

    if (deliveryPoints) {
      await tx.parcel.update({
        where: { id: parcel.id },
        data: { deliveryPoints: deliveryPoints }
      });
    }

    if (isPaid && driverEarning > 0) {
      const wallet = await tx.wallet.upsert({
        where: { userId: req.user.id },
        update: {
          balance: { increment: driverEarning },
          totalDeposited: { increment: driverEarning },
          lastActivityAt: new Date(),
          lastDepositAt: new Date()
        },
        create: {
          userId: req.user.id,
          balance: driverEarning,
          totalDeposited: driverEarning,
          lastDepositAt: new Date(),
          lastActivityAt: new Date()
        }
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

    const notifBody = isPaid
      ? `+${points} pts · +${driverEarning} FCFA (colis ${parcel.trackingNumber}). Commission: ${commission} FCFA.`
      : `+${points} pts (colis ${parcel.trackingNumber}). Paiement en attente — le gain sera crédité après confirmation.`;

    await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'delivery_completed',
        title: 'Livraison terminée',
        body: notifBody,
        data: {
          parcelId: parcel.id,
          points: points,
          earning: driverEarning,
          commission: commission,
          paid: isPaid
        }
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
    message: 'Livraison confirmée',
    data: {
      parcel: serializeParcel(result.parcel),
      score: { credited: points },
      wallet: isPaid ? { earning: driverEarning, commission } : { pending: true },
      deliveryPoints: deliveryPoints
    }
  });
});

// ============================================================
// PUBLIC
// ============================================================

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
  await findReadableParcel(req.user, req.params.parcelId);
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

/**
 * Bareme de l'estimation, lu dans `SystemConfig`.
 *
 * Ces quatre cles sont editables par le super administrateur (groupe
 * « Tarification » de l'ecran de configuration, web et mobile). Elles etaient
 * codees en dur ici : un administrateur pouvait changer le tarif sans qu'aucune
 * estimation ne bouge. Les valeurs de repli reprennent les anciennes
 * constantes, pour qu'une base sans ces cles se comporte comme avant.
 */
async function pricingConfig() {
  const [baseFee, pricePerKg, urgentFee, insuranceFee] = await Promise.all([
    getConfigValue('pricing.baseFee', 1000),
    getConfigValue('pricing.pricePerKg', 500),
    getConfigValue('pricing.urgentFee', 1000),
    getConfigValue('pricing.insuranceFee', 1000)
  ]);
  return {
    baseFee: number(baseFee, 1000),
    pricePerKg: number(pricePerKg, 500),
    urgentFee: number(urgentFee, 1000),
    insuranceFee: number(insuranceFee, 1000)
  };
}

export const estimateParcel = handle('parcel.estimate', async (req, res) => {
  const weight = number(req.body.weight, 1);
  const pricing = await pricingConfig();
  const urgentFee = req.body.isUrgent ? pricing.urgentFee : 0;
  const insuranceFee = req.body.isInsured ? pricing.insuranceFee : 0;
  const total = pricing.baseFee + weight * pricing.pricePerKg + urgentFee + insuranceFee;
  return ok(res, {
    message: 'Estimation prix',
    data: {
      estimate: {
        amount: total,
        currency: 'XOF',
        baseFee: pricing.baseFee,
        pricePerKg: pricing.pricePerKg,
        urgentFee,
        insuranceFee
      }
    }
  });
});

// ============================================================
// BIDS - Offres
// ============================================================

export const createBid = handle('bid.create', async (req, res) => {
  await assertDriverVerified(req);
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
    prisma.bid.findMany({
      where,
      include: {
        driver: true,
        parcel: true,
        negotiationMessages: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);
  const data = bids.map((b) => ({
    ...serializeBid(b),
    parcel: b.parcel
      ? { id: b.parcel.id, trackingNumber: b.parcel.trackingNumber, status: b.parcel.status, receiverName: b.parcel.receiverName }
      : null
  }));
  return ok(res, { message: 'Offres recues', data: { bids: data }, meta: paginationMeta({ page, limit, total }) });
});

export const driverBidsSent = handle('bid.driverSent', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = { driverId: req.user.id };
  const [total, bids] = await Promise.all([
    prisma.bid.count({ where }),
    prisma.bid.findMany({
      where,
      include: {
        driver: true,
        parcel: true,
        negotiationMessages: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);
  return ok(res, { message: 'Offres envoyees', data: { bids: bids.map(serializeBid) }, meta: paginationMeta({ page, limit, total }) });
});

// ============================================================
// NEGOCIATION - Contre-offres
// ============================================================

/**
 * Récupère les détails de négociation d'une offre
 * GET /client/bids/:bidId/negotiation
 */
export const getBidNegotiation = handle('bid.negotiation.get', async (req, res) => {
  const { bidId } = req.params;

  const bid = await prisma.bid.findFirst({
    where: {
      id: bidId,
      OR: [
        { parcel: { senderId: req.user.id } },
        { driverId: req.user.id }
      ]
    },
    include: {
      driver: {
        select: {
          id: true,
          fullName: true,
          profilePhoto: true,
          phone: true,
          rating: true
        }
      },
      parcel: {
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          departureCity: true,
          arrivalCity: true,
          price: true,
          proposedPrice: true,
          description: true,
          weight: true,
          senderId: true,
          senderName: true
        }
      },
      negotiationMessages: {
        include: {
          fromUser: {
            select: {
              id: true,
              fullName: true,
              profilePhoto: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!bid) {
    throw new NotFoundError('Offre introuvable ou non autorisée');
  }

  const isClient = req.user.role === 'client';

  return ok(res, {
    message: 'Détails de la négociation',
    data: {
      bid: {
        id: bid.id,
        price: Number(bid.price),
        message: bid.message,
        status: bid.status,
        createdAt: bid.createdAt,
        updatedAt: bid.updatedAt,
        driver: {
          id: bid.driver.id,
          fullName: bid.driver.fullName,
          profilePhoto: bid.driver.profilePhoto,
          phone: bid.driver.phone,
          rating: bid.driver.rating
        },
        parcel: {
          id: bid.parcel.id,
          trackingNumber: bid.parcel.trackingNumber,
          status: bid.parcel.status,
          departureCity: bid.parcel.departureCity,
          arrivalCity: bid.parcel.arrivalCity,
          price: Number(bid.parcel.price),
          proposedPrice: Number(bid.parcel.proposedPrice),
          description: bid.parcel.description,
          weight: Number(bid.parcel.weight),
          senderName: bid.parcel.senderName
        },
        negotiationHistory: bid.negotiationMessages.map(msg => ({
          id: msg.id,
          fromUserId: msg.fromUserId,
          fromUserRole: msg.fromUserRole,
          price: Number(msg.price),
          message: msg.message,
          createdAt: msg.createdAt,
          sender: msg.fromUser ? {
            id: msg.fromUser.id,
            fullName: msg.fromUser.fullName,
            profilePhoto: msg.fromUser.profilePhoto
          } : null
        })),
        canNegotiate: bid.status === 'pending' || bid.status === 'countered'
      }
    }
  });
});

/**
 * Client: Envoyer une contre-offre
 * POST /client/bids/:bidId/counter
 */
export const clientCounterBid = handle('bid.counter', async (req, res) => {
  const { bidId } = req.params;
  const { price, message } = req.body;

  if (!price || Number(price) <= 0) {
    throw new ValidationError([{ path: 'price', message: 'Un prix valide est requis' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const bid = await tx.bid.findFirst({
      where: {
        id: bidId,
        parcel: { senderId: req.user.id }
      },
      include: { parcel: true, driver: true }
    });

    if (!bid) {
      throw new NotFoundError('Offre introuvable ou non autorisée');
    }

    if (bid.status !== 'pending' && bid.status !== 'countered') {
      throw new ConflictError('Cette offre n\'est plus négociable');
    }

    const updatedBid = await tx.bid.update({
      where: { id: bidId },
      data: {
        price: decimal(price, '0'),
        responseMessage: message || `Contre-offre à ${price} FCFA`,
        status: 'countered',
        respondedAt: new Date()
      },
      include: { driver: true, parcel: true }
    });

    await tx.negotiationMessage.create({
      data: {
        bidId: bidId,
        fromUserId: req.user.id,
        fromUserRole: 'client',
        price: decimal(price, '0'),
        message: message || `Contre-offre à ${price} FCFA`
      }
    });

    await notify(tx, {
      userId: bid.driverId,
      parcelId: bid.parcelId,
      bidId: bidId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'bid_countered',
      title: 'Contre-offre reçue',
      body: `${req.user.fullName} propose ${price} FCFA pour votre offre.`,
      data: { bidId, price, parcelId: bid.parcelId },
      priority: 'high'
    });

    return updatedBid;
  });

  return ok(res, {
    message: 'Contre-offre envoyée',
    data: {
      bid: {
        id: result.id,
        price: Number(result.price),
        status: result.status,
        message: result.responseMessage,
        updatedAt: result.updatedAt
      }
    }
  });
});

/**
 * Driver: Répondre à une contre-offre
 * POST /driver/bids/:bidId/respond-counter
 */
export const driverRespondCounter = handle('bid.respondCounter', async (req, res) => {
  const { bidId } = req.params;
  const { action, price, message } = req.body;

  // Les premiers builds envoyaient { action: "accept" | "counter" } alors
  // que la nouvelle API attendait { accept: boolean }. Normaliser ici garde
  // les deux plateformes compatibles pendant leur mise a jour.
  if (action !== undefined && !['accept', 'counter'].includes(action)) {
    throw new ValidationError([{ path: 'action', message: 'Action invalide (accept ou counter)' }]);
  }
  const accept = req.body.accept === true || action === 'accept';

  const result = await prisma.$transaction(async (tx) => {
    const bid = await tx.bid.findFirst({
      where: {
        id: bidId,
        driverId: req.user.id
      },
      include: { parcel: true, driver: true }
    });

    if (!bid) {
      throw new NotFoundError('Offre introuvable ou non autorisée');
    }

    if (bid.status !== 'countered') {
      throw new ConflictError('Cette offre n\'est plus négociable');
    }

    let updatedBid;

    if (accept) {
      updatedBid = await tx.bid.update({
        where: { id: bidId },
        data: {
          status: 'accepted',
          responseMessage: message || 'Contre-offre acceptée',
          respondedAt: new Date()
        },
        include: { driver: true, parcel: true }
      });

      await tx.parcel.update({
        where: { id: bid.parcelId },
        data: {
          status: 'confirmed',
          driverId: req.user.id,
          selectedBidId: bidId,
          negotiatedPrice: bid.price,
          totalAmount: bid.price
        }
      });

      await tx.bid.updateMany({
        where: {
          parcelId: bid.parcelId,
          id: { not: bidId }
        },
        data: {
          status: 'rejected',
          respondedAt: new Date()
        }
      });

      await notify(tx, {
        userId: bid.parcel.senderId,
        parcelId: bid.parcelId,
        bidId: bidId,
        senderId: req.user.id,
        senderName: req.user.fullName,
        type: 'bid_accepted',
        title: 'Offre acceptée',
        body: `${req.user.fullName} a accepté votre contre-offre de ${bid.price} FCFA.`,
        data: { bidId, price: Number(bid.price), parcelId: bid.parcelId },
        priority: 'high'
      });

    } else if (price) {
      updatedBid = await tx.bid.update({
        where: { id: bidId },
        data: {
          price: decimal(price, '0'),
          responseMessage: message || `Contre-offre à ${price} FCFA`,
          status: 'countered',
          respondedAt: new Date()
        },
        include: { driver: true, parcel: true }
      });

      await tx.negotiationMessage.create({
        data: {
          bidId: bidId,
          fromUserId: req.user.id,
          fromUserRole: 'driver',
          price: decimal(price, '0'),
          message: message || `Contre-offre à ${price} FCFA`
        }
      });

      await notify(tx, {
        userId: bid.parcel.senderId,
        parcelId: bid.parcelId,
        bidId: bidId,
        senderId: req.user.id,
        senderName: req.user.fullName,
        type: 'bid_countered',
        title: 'Nouvelle proposition',
        body: `${req.user.fullName} propose ${price} FCFA.`,
        data: { bidId, price, parcelId: bid.parcelId },
        priority: 'high'
      });
    } else {
      throw new ValidationError([{ path: 'price', message: 'Un prix est requis pour la contre-offre' }]);
    }

    return updatedBid;
  });

  return ok(res, {
    message: accept ? 'Offre acceptée' : 'Contre-offre envoyée',
    data: {
      bid: {
        id: result.id,
        price: Number(result.price),
        status: result.status,
        message: result.responseMessage,
        updatedAt: result.updatedAt
      }
    }
  });
});

/**
 * Client: Accepter une offre (après négociation)
 * POST /client/bids/:bidId/accept
 */
export const clientAcceptBid = handle('bid.clientAccept', async (req, res) => {
  const { bidId } = req.params;

  const result = await prisma.$transaction(async (tx) => {
    const bid = await tx.bid.findFirst({
      where: {
        id: bidId,
        parcel: { senderId: req.user.id }
      },
      include: { parcel: true, driver: true }
    });

    if (!bid) {
      throw new NotFoundError('Offre introuvable ou non autorisée');
    }

    if (bid.status === 'accepted') {
      throw new ConflictError('Cette offre est déjà acceptée');
    }

    if (bid.status === 'rejected') {
      throw new ConflictError('Cette offre a été rejetée');
    }

    const updatedBid = await tx.bid.update({
      where: { id: bidId },
      data: {
        status: 'accepted',
        respondedAt: new Date()
      },
      include: { driver: true, parcel: true }
    });

    await tx.parcel.update({
      where: { id: bid.parcelId },
      data: {
        status: 'confirmed',
        driverId: bid.driverId,
        selectedBidId: bidId,
        negotiatedPrice: bid.price,
        totalAmount: bid.price
      }
    });

    await tx.bid.updateMany({
      where: {
        parcelId: bid.parcelId,
        id: { not: bidId }
      },
      data: {
        status: 'rejected',
        respondedAt: new Date()
      }
    });

    await notify(tx, {
      userId: bid.driverId,
      parcelId: bid.parcelId,
      bidId: bidId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'bid_accepted',
      title: 'Offre acceptée',
      body: `Votre offre de ${bid.price} FCFA a été acceptée.`,
      data: { bidId, price: Number(bid.price), parcelId: bid.parcelId },
      priority: 'high'
    });

    return updatedBid;
  });

  return ok(res, {
    message: 'Offre acceptée',
    data: {
      bid: {
        id: result.id,
        price: Number(result.price),
        status: result.status,
        parcelId: result.parcelId,
        driverId: result.driverId
      }
    }
  });
});

// ============================================================
// NEGOCIATION - Fin
// ============================================================

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

    if (updated.userId) {
      await notify(tx, {
        userId: updated.userId,
        parcelId: updated.parcelId ?? undefined,
        senderId: req.user.id,
        senderName: req.user.fullName,
        type: 'payment_confirmed',
        title: 'Paiement confirmé',
        body: `Votre paiement de ${Number(updated.amount)} FCFA${updated.parcel?.trackingNumber ? ` pour le colis ${updated.parcel.trackingNumber}` : ''} a été confirmé.`,
        data: { paymentId: updated.id, parcelId: updated.parcelId, amount: Number(updated.amount) }
      });
    }
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

// ============================================================
// CASH COLLECTION - Encaissements espèces
// ============================================================

export const declareCashCollection = handle('payment.declareCash', async (req, res) => {
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
  const amount = Number(req.body.amount);
  const collectionPoint = req.body.collectionPoint || parcel.cashCollectionPoint;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError([{ path: 'amount', message: 'Le montant encaissé doit être supérieur à zéro' }]);
  }
  if (!['sender_pickup', 'receiver_delivery'].includes(collectionPoint)) {
    throw new ValidationError([{ path: 'collectionPoint', message: 'Point d\'encaissement invalide' }]);
  }

  const resolvedChannel = parcel.paymentChannel || (parcel.paymentMethod === 'cash' ? 'cash' : null);
  if (resolvedChannel !== 'cash') {
    throw new ValidationError([{ path: 'parcelId', message: 'Ce colis n\'est pas réglé en espèces' }]);
  }

  const pickedUpStatuses = ['picked_up', 'in_transit', 'arrived', 'out_for_delivery', 'delivered'];
  const milestoneReached = collectionPoint === 'sender_pickup'
    ? Boolean(parcel.pickupDate) || pickedUpStatuses.includes(parcel.status)
    : parcel.status === 'delivered';
  if (!milestoneReached) {
    throw new ValidationError([{ path: 'parcelId', message: 'Le jalon d\'encaissement de ce colis n\'est pas encore atteint' }]);
  }

  const current = await prisma.payment.findFirst({
    where: { parcelId: parcel.id, method: 'cash', status: { in: ['processing', 'completed'] } },
    include: cashPaymentInclude,
    orderBy: { createdAt: 'desc' }
  });
  if (current?.status === 'completed') {
    throw new ConflictError('Cet encaissement a déjà été validé');
  }
  if (current) {
    return ok(res, { message: 'Encaissement déjà déclaré', data: { payment: serializePayment(current) } });
  }

  const declaredAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const metadata = {
      channel: 'cash',
      cashCollectionPoint: collectionPoint,
      declaredBy: req.user.id,
      declaredByName: req.user.fullName,
      declaredAt: declaredAt.toISOString(),
      declarationNote: req.body.note || null,
      declarationProofUrl: req.body.proofUrl || null
    };
    const payment = await tx.payment.create({
      data: {
        userId: req.user.id,
        parcelId: parcel.id,
        amount: decimal(amount, '0'),
        currency: 'XOF',
        method: 'cash',
        status: 'processing',
        reference: `CASH-${parcel.trackingNumber}-${Date.now()}`,
        receiptUrl: req.body.proofUrl || null,
        metadata
      },
      include: cashPaymentInclude
    });
    await tx.parcel.update({
      where: { id: parcel.id },
      data: {
        paymentMethod: 'cash',
        paymentChannel: 'cash',
        cashCollectionPoint: collectionPoint,
        cashCollectedAmount: decimal(amount, '0'),
        cashCollectedAt: declaredAt,
        paymentStatus: 'processing'
      }
    });
    await audit(tx, req, {
      action: 'payment.cash.declare',
      entityType: 'payment',
      entityId: payment.id,
      afterData: { parcelId: parcel.id, amount, collectionPoint, status: 'processing' }
    });
    await notifyAdmins(
      tx,
      'payment_cash',
      'Nouvel encaissement espèces',
      `${req.user.fullName} a déclaré ${amount} FCFA pour le colis ${parcel.trackingNumber}.`,
      { paymentId: payment.id, parcelId: parcel.id, amount, collectionPoint }
    );
    return payment;
  });

  return ok(res, { status: 201, message: 'Encaissement déclaré', data: { payment: serializePayment(result) } });
});

export const driverCashDeclarations = handle('payment.driverCashDeclarations', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  if (req.query.status && !CASH_PAYMENT_STATUSES.includes(req.query.status)) {
    throw new ValidationError([{ path: 'status', message: 'Statut de déclaration invalide' }]);
  }
  const where = {
    userId: req.user.id,
    method: 'cash',
    ...(req.query.status ? { status: req.query.status } : {})
  };
  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: cashPaymentInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);
  return ok(res, {
    message: 'Déclarations espèces chauffeur',
    data: { declarations: payments.map(serializePayment) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const pendingCashDeclarations = handle('payment.pendingCashDeclarations', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  if (req.query.status && !CASH_PAYMENT_STATUSES.includes(req.query.status)) {
    throw new ValidationError([{ path: 'status', message: 'Statut de déclaration invalide' }]);
  }
  const where = { method: 'cash', status: req.query.status || 'processing' };
  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: cashPaymentInclude,
      orderBy: { createdAt: 'asc' },
      skip,
      take: limit
    })
  ]);
  return ok(res, {
    message: 'Encaissements espèces à réconcilier',
    data: { declarations: payments.map(serializePayment) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const validateCashDeclaration = handle('payment.validateCashDeclaration', async (req, res) => {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: req.params.paymentId, method: 'cash' },
      include: cashPaymentInclude
    });
    if (!payment) throw new NotFoundError('Déclaration espèces introuvable');
    if (payment.status !== 'processing') {
      throw new ConflictError('Cette déclaration a déjà été traitée');
    }

    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'processing' },
      data: {
        status: 'completed',
        validatedBy: req.user.id,
        validatedAt: new Date(),
        completedAt: new Date()
      }
    });
    if (claimed.count !== 1) throw new ConflictError('Cette déclaration vient d\'être traitée');

    if (payment.parcelId) {
      await tx.parcel.update({
        where: { id: payment.parcelId },
        data: {
          paymentStatus: 'completed',
          paymentChannel: 'cash',
          cashCollectedAmount: payment.amount,
          cashCollectedAt: payment.parcel?.cashCollectedAt || payment.createdAt
        }
      });
    }
    await audit(tx, req, {
      action: 'payment.cash.validate',
      entityType: 'payment',
      entityId: payment.id,
      beforeData: { status: 'processing' },
      afterData: { status: 'completed' }
    });
    await notify(tx, {
      userId: payment.userId,
      parcelId: payment.parcelId || undefined,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'payment_confirmed',
      title: 'Encaissement espèces validé',
      body: `Votre déclaration de ${Number(payment.amount)} FCFA a été validée.`,
      data: { paymentId: payment.id, parcelId: payment.parcelId }
    });
    return tx.payment.findUnique({
      where: { id: payment.id },
      include: cashPaymentInclude
    });
  });
  return ok(res, { message: 'Encaissement espèces validé', data: { payment: serializePayment(result) } });
});

export const rejectCashDeclaration = handle('payment.rejectCashDeclaration', async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) {
    throw new ValidationError([{ path: 'reason', message: 'Le motif du rejet est obligatoire' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: req.params.paymentId, method: 'cash' },
      include: cashPaymentInclude
    });
    if (!payment) throw new NotFoundError('Déclaration espèces introuvable');
    if (payment.status !== 'processing') {
      throw new ConflictError('Cette déclaration a déjà été traitée');
    }

    const rejectedAt = new Date();
    const metadata = payment.metadata && typeof payment.metadata === 'object'
      ? payment.metadata
      : {};
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        validatedBy: req.user.id,
        validatedAt: rejectedAt,
        metadata: {
          ...metadata,
          rejectionReason: reason,
          rejectedAt: rejectedAt.toISOString(),
          rejectedBy: req.user.id
        }
      },
      include: cashPaymentInclude
    });
    if (payment.parcelId) {
      await tx.parcel.update({
        where: { id: payment.parcelId },
        data: {
          paymentStatus: 'failed',
          cashCollectedAmount: null,
          cashCollectedAt: null
        }
      });
    }
    await audit(tx, req, {
      action: 'payment.cash.reject',
      entityType: 'payment',
      entityId: payment.id,
      beforeData: { status: 'processing' },
      afterData: { status: 'failed', reason }
    });
    await notify(tx, {
      userId: payment.userId,
      parcelId: payment.parcelId || undefined,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'payment_cash',
      title: 'Déclaration espèces rejetée',
      body: `Votre déclaration de ${Number(payment.amount)} FCFA a été rejetée : ${reason}`,
      data: { paymentId: payment.id, parcelId: payment.parcelId, reason },
      priority: 'high'
    });
    return updated;
  });
  return ok(res, { message: 'Déclaration espèces rejetée', data: { payment: serializePayment(result) } });
});

export const setParcelPaymentChannel = handle('parcel.setPaymentChannel', async (req, res) => {
  const parcel = await findAccessibleParcel(req.user, req.params.parcelId);
  const channel = req.body.paymentChannel;
  const collectionPoint = req.body.cashCollectionPoint;
  if (!['cash', 'platform'].includes(channel)) {
    throw new ValidationError([{ path: 'paymentChannel', message: 'Canal de paiement invalide' }]);
  }
  if (channel === 'cash' && !['sender_pickup', 'receiver_delivery'].includes(collectionPoint)) {
    throw new ValidationError([{ path: 'cashCollectionPoint', message: 'Point d\'encaissement obligatoire pour un paiement espèces' }]);
  }
  if (parcel.paymentStatus === 'completed') {
    throw new ConflictError('Le canal d\'un colis déjà payé ne peut plus être modifié');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const value = await tx.parcel.update({
      where: { id: parcel.id },
      data: {
        paymentChannel: channel,
        paymentMethod: channel === 'cash'
          ? 'cash'
          : parcel.paymentMethod === 'cash' ? null : parcel.paymentMethod,
        cashCollectionPoint: channel === 'cash' ? collectionPoint : null
      },
      include: parcelInclude
    });
    await audit(tx, req, {
      action: 'parcel.paymentChannel.update',
      entityType: 'parcel',
      entityId: parcel.id,
      beforeData: {
        paymentChannel: parcel.paymentChannel,
        cashCollectionPoint: parcel.cashCollectionPoint
      },
      afterData: {
        paymentChannel: channel,
        cashCollectionPoint: channel === 'cash' ? collectionPoint : null
      }
    });
    return value;
  });
  return ok(res, { message: 'Canal de paiement mis à jour', data: { parcel: serializeParcel(updated) } });
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

// ============================================================
// SCORE - Points
// ============================================================

export const getScore = handle('score.get', async (req, res) => {
  const { score, transactions } = await scoreSnapshot(req.user.id);
  return ok(res, { message: 'Score utilisateur', data: { score, history: transactions.map(serializeScoreTransaction) } });
});

export const getScoreBalance = handle('score.balance', async (req, res) => {
  const { score } = await scoreSnapshot(req.user.id);
  return ok(res, { message: 'Solde points', data: { balance: score.points } });
});

export const getDriverWallet = handle('driver.wallet', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const wallet = await prisma.wallet.upsert({
    where: { userId: req.user.id },
    update: {},
    create: { userId: req.user.id }
  });

  // Charger l'historique separement garde l'upsert simple et permet une vraie
  // pagination sans renvoyer un portefeuille volumineux au mobile.
  const where = { walletUserId: req.user.id };
  const [total, transactionRows] = await Promise.all([
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.findMany({
      where,
      include: {
        parcel: { select: { trackingNumber: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);
  const transactions = transactionRows.map(serializeDriverWalletTransaction);
  const serializedWallet = {
    id: wallet.userId,
    userId: wallet.userId,
    balance: number(wallet.balance),
    pendingBalance: number(wallet.pendingBalance),
    totalDeposited: number(wallet.totalDeposited),
    totalConsumed: number(wallet.totalSpent),
    totalSpent: number(wallet.totalSpent),
    totalRefunded: number(wallet.totalRefunded),
    totalWithdrawn: number(wallet.totalWithdrawn),
    totalCommissionsPaid: number(wallet.totalCommissionsPaid),
    isActive: wallet.status === 'active',
    status: wallet.status,
    lastDepositAt: wallet.lastDepositAt,
    lastActivityAt: wallet.lastActivityAt,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    transactions
  };

  return ok(res, {
    message: 'Portefeuille',
    data: {
      wallet: serializedWallet,
      // Champ a plat conserve pour ApiService.getWallet, tandis que la copie
      // imbriquee permet aux autres consommateurs d'utiliser wallet seul.
      transactions
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const withdrawWallet = handle('driver.withdraw', async (req, res) => {
  const amount = Number(req.body.amount || 0);
  const minWithdrawal = env.PAYDUNYA_MIN_WITHDRAWAL;
  if (!amount || amount < minWithdrawal) {
    throw new ValidationError([{ path: 'body.amount', message: `Montant minimum ${minWithdrawal} FCFA` }]);
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

// ============================================================
// ADDRESSES - Adresses
// ============================================================

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

// ============================================================
// FAVORITES - Favoris
// ============================================================

export const addFavoriteGarage = handle('favorites.addGarage', async (req, res) => {
  await prisma.favoriteGarage.upsert({
    where: { userId_garageId: { userId: req.user.id, garageId: req.params.garageId } },
    update: {},
    create: { userId: req.user.id, garageId: req.params.garageId }
  });
  return ok(res, { message: 'Zone ajoutee aux favoris' });
});

export const removeFavoriteGarage = handle('favorites.removeGarage', async (req, res) => {
  await prisma.favoriteGarage.deleteMany({ where: { userId: req.user.id, garageId: req.params.garageId } });
  return ok(res, { message: 'Zone retiree des favoris' });
});

export const favoriteGarages = handle('favorites.garages', async (req, res) => {
  const favorites = await prisma.favoriteGarage.findMany({ where: { userId: req.user.id }, include: { garage: true } });
  return ok(res, { message: 'Zones favorites', data: { garages: favorites.map((favorite) => serializeGarage(favorite.garage)) } });
});

// ============================================================
// MESSAGES - Messages
// ============================================================

// Un message reste modifiable un quart d'heure. Au-dela, le destinataire a eu
// le temps de le lire et d'agir dessus : le reecrire fausserait l'echange.
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MESSAGE_BODY_MAX_LENGTH = 4000;

// Les propositions de prix circulent dans le fil de discussion sous ce prefixe
// (widget de negociation cote mobile). Elles engagent une negociation
// commerciale : leur auteur ne peut donc ni les reecrire ni les effacer, sinon
// l'historique d'un accord deviendrait incoherent. Seule la moderation peut les
// supprimer.
const PRICE_PROPOSAL_PREFIX = '__PRIX__';

// Roles autorises a supprimer le message d'un tiers, au titre de la moderation.
const MESSAGE_MODERATOR_ROLES = ['super_admin', 'support'];

function isPriceProposal(message) {
  return (message.body || '').startsWith(PRICE_PROPOSAL_PREFIX);
}

function serializeMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    senderId: m.senderId,
    receiverId: m.receiverId,
    parcelId: m.parcelId,
    body: m.body,
    audioUrl: m.audioUrl,
    photoUrl: m.photoUrl,
    videoUrl: m.videoUrl,
    isRead: m.isRead,
    createdAt: m.createdAt,
    // `createdAt` reste la date d'envoi : les clients affichent le marqueur
    // « modifie » a partir de `editedAt`, sans reordonner le fil.
    editedAt: m.editedAt || null,
    isEdited: Boolean(m.editedAt)
  };
}

function messagePreview(message) {
  if (message.photoUrl) return '📷 Photo';
  if (message.videoUrl) return '🎥 Vidéo';
  if (message.audioUrl) return '🎤 Message vocal';
  if (isPriceProposal(message)) return '💰 Proposition de prix';
  return (message.body || '').slice(0, 80) || 'Nouveau message';
}

/**
 * Rattacher un message a un colis le fait apparaitre dans le fil de ce colis.
 * On exige donc un lien reel avec le colis, sans reprendre le filtre strict de
 * lecture : un chauffeur qui a seulement enchéri sur un colis libre doit
 * pouvoir en discuter avec le client, exactement comme il peut en consulter le
 * detail.
 */
async function assertParcelConversationAccess(user, parcelId) {
  if (user.role === 'driver') {
    await findAccessibleParcelForDriver(user, parcelId);
    return;
  }
  await findReadableParcel(user, parcelId);
}

/**
 * Charge un message encore vivant et verifie que l'utilisateur en est bien
 * l'auteur. L'edition n'est jamais deleguee a la moderation : reecrire les mots
 * d'un tiers n'est pas une operation legitime.
 */
async function findEditableMessage(user, messageId) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) throw new NotFoundError('Message introuvable');
  if (message.senderId !== user.id) {
    throw new ForbiddenError('Seul l\'auteur peut modifier son message');
  }
  return message;
}

export const sendMessage = handle('messages.send', async (req, res) => {
  const receiverId = req.body.receiverId;
  if (!receiverId) throw new ValidationError([{ path: 'receiverId', message: 'Destinataire requis' }]);
  if (receiverId === req.user.id) {
    throw new ValidationError([
      { path: 'receiverId', message: 'Impossible de s\'envoyer un message a soi-meme' }
    ]);
  }

  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  const hasMedia = Boolean(req.body.audioUrl || req.body.photoUrl || req.body.videoUrl);
  if (!body && !hasMedia) {
    throw new ValidationError([{ path: 'body', message: 'Message vide' }]);
  }
  if (body.length > MESSAGE_BODY_MAX_LENGTH) {
    throw new ValidationError([
      { path: 'body', message: `Message limite a ${MESSAGE_BODY_MAX_LENGTH} caracteres` }
    ]);
  }

  // ✅ Récupérer le destinataire original pour connaître son rôle
  const originalReceiver = await prisma.user.findFirst({
    where: { id: receiverId, deletedAt: null },
    select: { id: true, role: true, fullName: true }
  });

  if (!originalReceiver) throw new NotFoundError('Destinataire introuvable');

  // ✅ Vérifier si c'est un message support (le destinataire est un support)
  const isSupportTarget = ['support_technique', 'support_commercial', 'support', 'admin', 'super_admin'].includes(originalReceiver.role);
  
  // ✅ Le client peut forcer le type via 'type' ou 'isSupportMessage'
  const supportType = req.body.type || '';
  const isSupportMessage = req.body.isSupportMessage === true || 
                           req.body.isSupport === true ||
                           supportType === 'support' ||
                           supportType === 'support_technique' ||
                           supportType === 'support_commercial' ||
                           (isSupportTarget && !req.body.isPrivate);

  // ✅ Si c'est un message support
  if (isSupportMessage) {
    // ✅ Déterminer le type de support cible
    let targetRole = supportType;
    
    // Si le type n'est pas spécifié, on utilise le rôle du destinataire
    if (!targetRole || targetRole === '') {
      if (originalReceiver.role === 'support_technique') {
        targetRole = 'support_technique';
      } else if (originalReceiver.role === 'support_commercial') {
        targetRole = 'support_commercial';
      } else {
        // Si le destinataire est admin/super_admin, on envoie à tous
        targetRole = 'support';
      }
    }

    // ✅ Récupérer TOUS les agents du même type de support
    const roleMap = {
      'support': ['support_technique', 'support_commercial', 'support'],
      'support_technique': ['support_technique'],
      'support_commercial': ['support_commercial']
    };

    const roles = roleMap[targetRole] || ['support_technique', 'support_commercial', 'support'];

    const supportUsers = await prisma.user.findMany({
      where: {
        role: { in: roles },
        status: 'active'
      },
      select: { id: true, email: true, phone: true, fullName: true, role: true }
    });

    if (supportUsers.length === 0) {
      throw new NotFoundError(`Aucun support disponible pour le type: ${targetRole}`);
    }

    // ✅ Créer un message pour CHAQUE agent support
    const messages = await prisma.$transaction(async (tx) => {
      const createdMessages = [];
      for (const user of supportUsers) {
        const msg = await tx.message.create({
          data: {
            senderId: req.user.id,
            receiverId: user.id,
            parcelId: req.body.parcelId || null,
            body: body,
            audioUrl: req.body.audioUrl || null,
            photoUrl: req.body.photoUrl || null,
            videoUrl: req.body.videoUrl || null,
            isRead: false
          }
        });
        createdMessages.push(msg);
      }
      return createdMessages;
    });

    // ✅ Créer une notification pour CHAQUE agent support
    await prisma.$transaction(async (tx) => {
      for (const user of supportUsers) {
        const sender = req.user;
        const typeLabel = targetRole === 'support_technique' ? 'technique' 
                        : targetRole === 'support_commercial' ? 'commercial' 
                        : 'support';
        
        await tx.notification.create({
          data: {
            userId: user.id,
            senderId: sender.id,
            senderName: sender.fullName || 'PRO COLIS',
            parcelId: req.body.parcelId || null,
            type: `support_message_${targetRole}`,
            title: `Nouveau message ${typeLabel} de ${sender.fullName}`,
            body: body?.slice(0, 100) || 'Nouveau message support',
            data: { 
              messageId: messages.find(m => m.receiverId === user.id)?.id,
              supportUserId: user.id,
              parcelId: req.body.parcelId,
              senderId: sender.id,
              targetRole: targetRole
            },
            priority: 'high'
          }
        });
      }
    });

    // ✅ Envoyer les emails/SMS à CHAQUE agent support
    if (isBrevoConfigured()) {
      const sender = req.user;
      for (const user of supportUsers) {
        if (user.email) {
          sendNotificationEmail({
            email: user.email,
            subject: `[SUPPORT] Nouveau message de ${sender.fullName}`,
            message: body?.slice(0, 500) || 'Nouveau message support'
          }).catch(() => {});
        }
        if (user.phone) {
          sendNotificationSms({
            phone: user.phone,
            message: `[SUPPORT] ${sender.fullName}: ${body?.slice(0, 150) || 'Nouveau message'}`,
            tag: 'support'
          }).catch(() => {});
        }
      }
    }

    const typeLabel = targetRole === 'support_technique' ? 'technique' 
                    : targetRole === 'support_commercial' ? 'commercial' 
                    : 'support';

    return ok(res, {
      status: 201,
      message: `Message ${typeLabel} envoyé à ${supportUsers.length} agent(s)`,
      data: { 
        messages: messages.map(serializeMessage),
        supportUsers: supportUsers.map(u => ({ 
          id: u.id, 
          fullName: u.fullName, 
          role: u.role 
        })),
        targetRole: targetRole
      }
    });
  }

  // Sinon, comportement normal (message privé)
  // ✅ Vérifier que le destinataire existe et est actif
  const receiver = await prisma.user.findFirst({
    where: { id: receiverId, deletedAt: null },
    select: { id: true, status: true }
  });
  if (!receiver) throw new NotFoundError('Destinataire introuvable');
  if (receiver.status !== 'active') {
    throw new ConflictError('Ce compte ne peut plus recevoir de messages');
  }

  const parcelId = req.body.parcelId || null;
  if (parcelId) await assertParcelConversationAccess(req.user, parcelId);

  const message = await prisma.message.create({
    data: {
      senderId: req.user.id,
      receiverId,
      parcelId,
      body,
      audioUrl: req.body.audioUrl || null,
      photoUrl: req.body.photoUrl || null,
      videoUrl: req.body.videoUrl || null
    }
  });

  try {
    const sender = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { fullName: true }
    });
    await prisma.notification.create({
      data: {
        userId: receiverId,
        senderId: req.user.id,
        senderName: sender?.fullName || 'PRO COLIS',
        parcelId,
        type: 'message',
        title: sender?.fullName ? `Nouveau message de ${sender.fullName}` : 'Nouveau message',
        body: messagePreview(message),
        data: { messageId: message.id, parcelId }
      }
    });
  } catch {
    /* noop */
  }

  return ok(res, { 
    status: 201, 
    message: 'Message envoye', 
    data: { message: serializeMessage(message) } 
  });
});

export const updateMessage = handle('messages.update', async (req, res) => {
  const existing = await findEditableMessage(req.user, req.params.messageId);

  if (isPriceProposal(existing)) {
    throw new ConflictError('Une proposition de prix ne peut pas etre modifiee');
  }

  const elapsed = Date.now() - new Date(existing.createdAt).getTime();
  if (elapsed > MESSAGE_EDIT_WINDOW_MS) {
    throw new ConflictError('Le delai de modification de ce message est depasse');
  }

  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) {
    throw new ValidationError([{ path: 'body', message: 'Le texte du message est requis' }]);
  }
  if (body.length > MESSAGE_BODY_MAX_LENGTH) {
    throw new ValidationError([
      { path: 'body', message: `Message limite a ${MESSAGE_BODY_MAX_LENGTH} caracteres` }
    ]);
  }
  // Une edition qui ne change rien ne doit pas poser de marqueur « modifie ».
  if (body === existing.body) {
    return ok(res, { message: 'Message inchange', data: { message: serializeMessage(existing) } });
  }

  const message = await prisma.$transaction(async (tx) => {
    const updated = await tx.message.update({
      where: { id: existing.id },
      data: { body, editedAt: new Date() }
    });

    // Le contenu des echanges est verse aux litiges de livraison : la version
    // precedente doit rester consultable meme apres reecriture.
    await audit(tx, req, {
      action: 'message.update',
      entityType: 'message',
      entityId: updated.id,
      beforeData: { body: existing.body },
      afterData: { body: updated.body }
    });

    return updated;
  });

  return ok(res, { message: 'Message modifie', data: { message: serializeMessage(message) } });
});

export const deleteMessage = handle('messages.delete', async (req, res) => {
  const existing = await prisma.message.findUnique({ where: { id: req.params.messageId } });
  if (!existing) throw new NotFoundError('Message introuvable');

  const isAuthor = existing.senderId === req.user.id;
  const isModerator = MESSAGE_MODERATOR_ROLES.includes(req.user.role);
  if (!isAuthor && !isModerator) {
    throw new ForbiddenError('Seul l\'auteur peut supprimer son message');
  }
  if (isAuthor && !isModerator && isPriceProposal(existing)) {
    throw new ConflictError('Une proposition de prix ne peut pas etre supprimee');
  }
  // Rejouer la suppression renvoie l'etat courant : le mobile peut relancer la
  // requete apres une coupure reseau sans traiter un 404 trompeur.
  if (existing.deletedAt) {
    return ok(res, { message: 'Message deja supprime' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() }
    });

    // Un message supprime avant lecture laissait une notification qui ouvrait un
    // fil vide. On retire donc la pastille non lue qui le designe.
    if (!existing.isRead) {
      await tx.notification.deleteMany({
        where: {
          type: 'message',
          userId: existing.receiverId,
          isRead: false,
          data: { path: ['messageId'], equals: existing.id }
        }
      });
    }

    await audit(tx, req, {
      action: 'message.delete',
      entityType: 'message',
      entityId: existing.id,
      beforeData: { body: existing.body, senderId: existing.senderId, isRead: existing.isRead },
      afterData: { deleted: true, moderated: !isAuthor }
    });
  });

  return ok(res, { message: 'Message supprime' });
});

export const messageThread = handle('messages.thread', async (req, res) => {
  const peerId = req.query.peerId;
  const parcelId = req.query.parcelId || null;
  if (!peerId) throw new ValidationError([{ path: 'peerId', message: 'peerId requis' }]);
  res.setHeader('Cache-Control', 'private, no-store');

  const where = {
    // Un message supprime par son auteur disparait du fil des deux cotes.
    deletedAt: null,
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

  // Marquer puis relire dans une transaction garantit que le web et le
  // mobile recoivent immédiatement le même état de lecture.
  const [, messages] = await prisma.$transaction([
    prisma.message.updateMany({
      where: {
        receiverId: req.user.id,
        senderId: peerId,
        parcelId: parcelId === null ? null : parcelId,
        isRead: false,
        deletedAt: null
      },
      data: { isRead: true, readAt: new Date() }
    }),
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    })
  ]);

  return ok(res, { message: 'Conversation', data: { messages: messages.map(serializeMessage) } });
});

export const conversations = handle('messages.conversations', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  const messages = await prisma.message.findMany({
    where: {
      deletedAt: null,
      OR: [{ senderId: req.user.id }, { receiverId: req.user.id }]
    },
    include: {
      sender: { select: { id: true, fullName: true, profilePhoto: true, role: true } },
      receiver: { select: { id: true, fullName: true, profilePhoto: true, role: true } },
      parcel: { select: { id: true, trackingNumber: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 500
  });

  // Un seul contrat agrege alimente desormais les listes web et mobile.
  // La cle pair + colis evite de melanger deux negociations avec la meme
  // personne, tandis que unreadCount ne compte jamais les messages emis.
  const conversationMap = new Map();
  for (const message of messages) {
    const isIncoming = message.receiverId === req.user.id;
    const otherUser = isIncoming ? message.sender : message.receiver;
    const key = `${otherUser.id}::${message.parcelId || '_'}`;
    const existing = conversationMap.get(key);

    if (existing) {
      if (isIncoming && !message.isRead) existing.unreadCount += 1;
      continue;
    }

    conversationMap.set(key, {
      ...serializeMessage(message),
      // Un message emis n'est jamais "non lu" pour son auteur dans la liste.
      isRead: isIncoming ? message.isRead : true,
      unreadCount: isIncoming && !message.isRead ? 1 : 0,
      trackingNumber: message.parcel?.trackingNumber || null,
      otherUser
    });
  }

  return ok(res, {
    message: 'Conversations',
    data: { conversations: Array.from(conversationMap.values()) }
  });
});

export const readMessage = handle('messages.read', async (req, res) => {
  // Seul le destinataire marque un message comme lu. Le filtre servait deja de
  // garde d'autorisation, mais son resultat etait ignore : un identifiant
  // inconnu ou le message d'un tiers renvoyait un succes trompeur.
  const marked = await prisma.message.updateMany({
    where: { id: req.params.messageId, receiverId: req.user.id, deletedAt: null },
    data: { isRead: true, readAt: new Date() }
  });
  if (marked.count === 0) {
    const exists = await prisma.message.findFirst({
      where: { id: req.params.messageId, receiverId: req.user.id, deletedAt: null },
      select: { id: true }
    });
    // Le message existe et m'est bien adresse : il etait simplement deja lu.
    if (!exists) throw new NotFoundError('Message introuvable');
  }
  return ok(res, { message: 'Message lu' });
});

// ============================================================
// SUPPORT - Support
// ============================================================

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

// ============================================================
// RATINGS - Notes
// ============================================================

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

// ============================================================
// COUPONS - Coupons
// ============================================================

export const availableCoupons = handle('coupons.available', async (_req, res) => {
  return ok(res, { message: 'Coupons disponibles', data: { coupons: [] } });
});

// ============================================================
// SEARCH - Recherche
// ============================================================

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
    include: driverInclude,
    take: Number(req.query.limit || 100)
  });
  return ok(res, { message: 'Chauffeurs', data: { drivers: drivers.map(serializeUser) } });
});

export const publicDriverDetail = handle('drivers.detail', async (req, res) => {
  const driver = await prisma.user.findFirst({ where: { id: req.params.driverId, role: 'driver' }, include: driverInclude });
  if (!driver) throw new NotFoundError('Chauffeur introuvable');
  return ok(res, { message: 'Detail chauffeur', data: { driver: serializeUser(driver) } });
});

export const garagePublicDrivers = handle('drivers.garage', async (req, res) => {
  const drivers = await prisma.user.findMany({ where: { role: 'driver', garageId: req.params.garageId, status: 'active' }, include: driverInclude });
  return ok(res, { message: 'Chauffeurs zone', data: { drivers: drivers.map(serializeUser) } });
});

// ============================================================
// DRIVER LOCATION - Localisation chauffeur
// ============================================================

export const saveDriverLocation = handle('driver.location', async (req, res) => {
  const location = await prisma.driverLocation.create({
    data: { driverId: req.user.id, parcelId: req.body.parcelId, latitude: decimal(req.body.latitude, '0'), longitude: decimal(req.body.longitude, '0'), accuracy: decimal(req.body.accuracy) }
  });
  return ok(res, { status: 201, message: 'Position enregistree', data: { location } });
});

// ============================================================
// IDENTITY - Vérification d'identité
// ============================================================

export const createIdentityVerification = handle('identity.verify', async (req, res) => {
  const identity = await prisma.identityVerification.create({ data: { userId: req.user.id, documentType: req.body.documentType } });
  return ok(res, { status: 201, message: 'Verification identite creee', data: { identity } });
});

export const identityUpload = handle('identity.upload', async (req, res) => {
  const url = req.body.url || null;
  const documentType = req.body.documentType;
  const side = req.body.side === 'back' ? 'documentBackUrl' : 'documentFrontUrl';

  if (!documentType) {
    throw new ValidationError([{ path: 'body.documentType', message: 'Type de document requis' }]);
  }

  let identity;

  if (documentType === 'vehicle_photo') {
    identity = await prisma.identityVerification.create({
      data: { userId: req.user.id, documentType, [side]: url }
    });
  } else {
    const existing = await prisma.identityVerification.findFirst({
      where: { userId: req.user.id, documentType },
      orderBy: { createdAt: 'desc' }
    });

    identity = existing
      ? await prisma.identityVerification.update({
        where: { id: existing.id },
        data: { [side]: url, status: 'pending', rejectionReason: null }
      })
      : await prisma.identityVerification.create({
        data: { userId: req.user.id, documentType, [side]: url }
      });
  }

  return ok(res, { message: 'Document identite enregistre', data: { url, identity } });
});

export const identityStatus = handle('identity.status', async (req, res) => {
  const documents = await prisma.identityVerification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' }
  });

  const identity = documents[0] || null;

  let status = 'pending';
  if (documents.length) {
    if (documents.some((doc) => doc.status === 'rejected')) {
      status = 'rejected';
    } else if (documents.every((doc) => doc.status === 'approved')) {
      status = 'approved';
    }
  }

  return ok(res, { message: 'Statut identite', data: { status, identity, documents } });
});

// ============================================================
// ADVERTISEMENTS - Annonces
// ============================================================

// Champs qu'un chauffeur peut corriger sur son annonce. Le `data: req.body` qui
// precedait laissait passer n'importe quelle colonne — `driverId`, `status`,
// `createdAt` compris — et n'appliquait aucune conversion : une date ou un poids
// transmis en texte partaient tels quels vers Prisma.
const ADVERTISEMENT_EDITABLE_TEXT_FIELDS = ['departureCity', 'arrivalCity', 'description', 'audioUrl'];
const ADVERTISEMENT_EDITABLE_DECIMAL_FIELDS = ['availableWeight', 'proposedPrice'];
const ADVERTISEMENT_EDITABLE_ID_FIELDS = [
  'departureGarageId',
  'arrivalGarageId',
  'departureZoneId',
  'arrivalZoneId'
];

// Une annonce fermee ou annulee est une trace : elle n'est plus modifiable.
const ADVERTISEMENT_EDITABLE_STATUSES = ['open'];
// Offres encore en jeu : a avertir ou a refuser selon l'action sur l'annonce.
const ADVERTISEMENT_LIVE_OFFER_STATUSES = ['pending', 'countered'];
// Statuts de colis encore rattachables a une offre de trajet.
const PARCEL_OFFERABLE_STATUSES = ['pending', 'free'];

/**
 * Charge une annonce et verifie que l'appelant en est le chauffeur proprietaire.
 * Les routes annonces etaient montees avec `authenticate` seul : fermeture, refus
 * et negociation d'offre s'executaient sans aucun controle de propriete.
 */
async function findOwnedAdvertisement(user, advertisementId, include) {
  const advertisement = await prisma.advertisement.findUnique({
    where: { id: advertisementId },
    ...(include ? { include } : {})
  });
  if (!advertisement) throw new NotFoundError('Annonce introuvable');
  if (user.role !== 'super_admin' && advertisement.driverId !== user.id) {
    throw new ForbiddenError('Annonce non autorisee');
  }
  return advertisement;
}

// Publier un trajet dont le depart est passe reviendrait a annoncer un vehicule
// deja parti : les clients y deposeraient des offres inexploitables.
function parseFutureDate(value, path) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ path, message: 'Date invalide' }]);
  }
  if (date.getTime() <= Date.now()) {
    throw new ValidationError([{ path, message: 'La date de depart doit etre future' }]);
  }
  return date;
}

// `decimal` accepte n'importe quelle entree ; ce garde-fou refuse en plus une
// valeur non numerique ou negative avant qu'elle n'atteigne la base.
function positiveDecimal(value, path) {
  const parsed = decimal(value);
  if (parsed === null) return null;
  if (!Number.isFinite(Number(parsed)) || Number(parsed) < 0) {
    throw new ValidationError([{ path, message: 'Valeur numerique positive attendue' }]);
  }
  return parsed;
}

// Une annonce doit garder une origine et une destination, quel que soit le
// referentiel utilise : les zones et les villes libres cohabitent encore.
function assertAdvertisementRoute(source) {
  if (!source.departureZoneId && !source.departureGarageId && !source.departureCity) {
    throw new ValidationError([{ path: 'departureZoneId', message: 'Lieu de depart requis' }]);
  }
  if (!source.arrivalZoneId && !source.arrivalGarageId && !source.arrivalCity) {
    throw new ValidationError([{ path: 'arrivalZoneId', message: 'Lieu d\'arrivee requis' }]);
  }
}

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
  await assertDriverVerified(req);
  assertAdvertisementRoute(req.body);

  const advertisement = await prisma.$transaction(async (tx) => {
    const created = await tx.advertisement.create({
      data: {
        driverId: req.user.id,
        departureGarageId: req.body.departureGarageId || null,
        arrivalGarageId: req.body.arrivalGarageId || null,
        departureZoneId: req.body.departureZoneId || null,
        arrivalZoneId: req.body.arrivalZoneId || null,
        departureCity: req.body.departureCity,
        arrivalCity: req.body.arrivalCity,
        departureAt: req.body.departureAt ? parseFutureDate(req.body.departureAt, 'departureAt') : null,
        availableWeight: positiveDecimal(req.body.availableWeight, 'availableWeight'),
        proposedPrice: positiveDecimal(req.body.proposedPrice, 'proposedPrice'),
        description: req.body.description,
        audioUrl: req.body.audioUrl
      },
      include: { driver: true, offers: true }
    });

    await audit(tx, req, {
      action: 'advertisement.create',
      entityType: 'advertisement',
      entityId: created.id,
      afterData: {
        status: created.status,
        departureAt: created.departureAt ? created.departureAt.toISOString() : null,
        proposedPrice: created.proposedPrice ? String(created.proposedPrice) : null
      }
    });

    return created;
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
  const advertisement = await findOwnedAdvertisement(req.user, req.params.advertisementId, { offers: true });

  if (!ADVERTISEMENT_EDITABLE_STATUSES.includes(advertisement.status)) {
    throw new ConflictError('Une annonce fermee ou annulee n\'est plus modifiable');
  }
  // Une offre acceptee vaut engagement sur le trajet publie : en changer la date
  // ou l'itineraire apres coup tromperait le client dont le colis est deja pris
  // en charge.
  if (advertisement.offers.some((offer) => offer.status === 'accepted')) {
    throw new ConflictError('Une offre a deja ete acceptee sur cette annonce');
  }

  const data = {};
  for (const field of ADVERTISEMENT_EDITABLE_TEXT_FIELDS) {
    if (req.body[field] === undefined) continue;
    const value = req.body[field] === null ? null : String(req.body[field]).trim();
    data[field] = value === '' ? null : value;
  }
  for (const field of ADVERTISEMENT_EDITABLE_DECIMAL_FIELDS) {
    if (req.body[field] === undefined) continue;
    data[field] = positiveDecimal(req.body[field], field);
  }
  for (const field of ADVERTISEMENT_EDITABLE_ID_FIELDS) {
    if (req.body[field] === undefined) continue;
    data[field] = req.body[field] || null;
  }
  if (req.body.departureAt !== undefined) {
    data.departureAt = req.body.departureAt ? parseFutureDate(req.body.departureAt, 'departureAt') : null;
  }

  if (Object.keys(data).length === 0) {
    throw new ValidationError([{ path: 'body', message: 'Aucun champ modifiable fourni' }]);
  }

  // Le trajet doit rester complet apres fusion : une modification ne peut pas
  // laisser l'annonce sans origine ni sans destination.
  assertAdvertisementRoute({ ...advertisement, ...data });

  const changedFields = Object.keys(data).filter(
    (field) => String(advertisement[field] ?? '') !== String(data[field] ?? '')
  );
  if (changedFields.length === 0) {
    return ok(res, {
      message: 'Annonce inchangee',
      data: { advertisement: serializeAdvertisement(advertisement) }
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.advertisement.update({
      where: { id: advertisement.id },
      data,
      include: { driver: true, offers: true }
    });

    await audit(tx, req, {
      action: 'advertisement.update',
      entityType: 'advertisement',
      entityId: advertisement.id,
      beforeData: pickAuditFields(advertisement, changedFields),
      afterData: pickAuditFields(result, changedFields)
    });

    // Les clients qui ont une offre en cours l'ont calee sur le trajet publie :
    // ils doivent savoir que la date, le prix ou l'itineraire a bouge.
    const liveOffers = advertisement.offers.filter((offer) =>
      ADVERTISEMENT_LIVE_OFFER_STATUSES.includes(offer.status)
    );
    for (const offer of liveOffers) {
      await notify(tx, {
        userId: offer.clientId,
        senderId: req.user.id,
        senderName: req.user.fullName,
        type: 'ad_updated',
        title: 'Annonce modifiee',
        body: 'Le chauffeur a modifie son annonce. Verifiez votre offre en cours.',
        data: { advertisementId: advertisement.id, offerId: offer.id, changedFields },
        priority: 'high'
      });
    }

    return result;
  });

  return ok(res, { message: 'Annonce mise a jour', data: { advertisement: serializeAdvertisement(updated) } });
});

export const deleteAdvertisement = handle('advertisements.delete', async (req, res) => {
  const advertisement = await findOwnedAdvertisement(req.user, req.params.advertisementId, { offers: true });

  // La suppression efface les offres en cascade, donc la trace d'un accord et le
  // lien vers le colis engage. On la refuse dans ce cas : fermer l'annonce est
  // l'operation qui conserve l'historique.
  if (advertisement.offers.some((offer) => offer.status === 'accepted')) {
    throw new ConflictError(
      'Une offre acceptee est rattachee a cette annonce : fermez-la au lieu de la supprimer'
    );
  }

  await prisma.$transaction(async (tx) => {
    const liveOffers = advertisement.offers.filter((offer) =>
      ADVERTISEMENT_LIVE_OFFER_STATUSES.includes(offer.status)
    );
    // Les offres partent en cascade : sans ce message, le client verrait son
    // offre disparaitre sans explication.
    for (const offer of liveOffers) {
      await notify(tx, {
        userId: offer.clientId,
        senderId: req.user.id,
        senderName: req.user.fullName,
        type: 'ad_offer_rejected',
        title: 'Annonce retiree',
        body: 'Le chauffeur a retire son annonce. Votre offre n\'est plus en jeu.',
        data: { advertisementId: advertisement.id, offerId: offer.id }
      });
    }

    await audit(tx, req, {
      action: 'advertisement.delete',
      entityType: 'advertisement',
      entityId: advertisement.id,
      beforeData: {
        status: advertisement.status,
        driverId: advertisement.driverId,
        offerCount: advertisement.offers.length
      }
    });

    await tx.advertisement.delete({ where: { id: advertisement.id } });
  });

  return ok(res, { message: 'Annonce supprimee' });
});

export const closeAdvertisement = handle('advertisements.close', async (req, res) => {
  const advertisement = await findOwnedAdvertisement(req.user, req.params.advertisementId, {
    driver: true,
    offers: true
  });

  // Rejouer la fermeture renvoie l'etat courant : le mobile peut relancer
  // l'appel apres une coupure reseau sans traiter un conflit.
  if (advertisement.status !== 'open') {
    return ok(res, {
      message: 'Annonce deja fermee',
      data: { advertisement: serializeAdvertisement(advertisement) }
    });
  }

  const reason = req.body.reason ? String(req.body.reason).trim() : null;

  const closed = await prisma.$transaction(async (tx) => {
    // Une annonce fermee ne peut plus rien accepter : laisser des offres en
    // attente ferait patienter les clients indefiniment. Ce refus precede la
    // mise a jour de l'annonce pour que son `include: { offers }` renvoie l'etat
    // final — sinon la reponse porterait encore les offres en attente.
    const liveOffers = advertisement.offers.filter((offer) =>
      ADVERTISEMENT_LIVE_OFFER_STATUSES.includes(offer.status)
    );
    if (liveOffers.length) {
      await tx.advertisementOffer.updateMany({
        where: { id: { in: liveOffers.map((offer) => offer.id) } },
        data: {
          status: 'rejected',
          responseMessage: reason || 'L\'annonce a ete fermee par le chauffeur',
          respondedAt: new Date()
        }
      });
      for (const offer of liveOffers) {
        await notify(tx, {
          userId: offer.clientId,
          senderId: req.user.id,
          senderName: req.user.fullName,
          type: 'ad_offer_rejected',
          title: 'Annonce fermee',
          body: 'Le chauffeur a ferme son annonce. Votre offre n\'a pas ete retenue.',
          data: { advertisementId: advertisement.id, offerId: offer.id }
        });
      }
    }

    const result = await tx.advertisement.update({
      where: { id: advertisement.id },
      data: {
        status: 'closed',
        // `metadata` etait ecrase par `{ reason }`, ce qui perdait tout ce que
        // l'annonce portait deja.
        metadata: {
          ...(advertisement.metadata && typeof advertisement.metadata === 'object'
            ? advertisement.metadata
            : {}),
          closedReason: reason,
          closedAt: new Date().toISOString()
        }
      },
      include: { driver: true, offers: true }
    });

    await audit(tx, req, {
      action: 'advertisement.close',
      entityType: 'advertisement',
      entityId: advertisement.id,
      beforeData: { status: advertisement.status },
      afterData: { status: 'closed', reason, rejectedOffers: liveOffers.length }
    });

    return result;
  });

  return ok(res, { message: 'Annonce fermee', data: { advertisement: serializeAdvertisement(closed) } });
});

export const createAdvertisementOffer = handle('advertisements.offerCreate', async (req, res) => {
  const ad = await prisma.advertisement.findUnique({ where: { id: req.params.advertisementId } });
  if (!ad) throw new NotFoundError('Annonce introuvable');
  if (ad.status !== 'open') {
    throw new ConflictError('Cette annonce n\'accepte plus d\'offres');
  }
  if (ad.driverId === req.user.id) {
    throw new ForbiddenError('Impossible de faire une offre sur sa propre annonce');
  }
  if (ad.departureAt && new Date(ad.departureAt).getTime() <= Date.now()) {
    throw new ConflictError('Le depart de cette annonce est deja passe');
  }

  const price = positiveDecimal(req.body.price, 'price');
  if (price === null || Number(price) <= 0) {
    throw new ValidationError([{ path: 'price', message: 'Prix superieur a zero requis' }]);
  }

  // Le colis reste facultatif : l'ecran d'offre propose explicitement de
  // negocier avant d'avoir cree le colis. Quand il est fourni, il doit
  // appartenir au client et etre encore disponible, sinon l'acceptation
  // echouerait plus tard cote chauffeur.
  const parcelId = req.body.parcelId || null;
  if (parcelId) {
    const parcel = await prisma.parcel.findFirst({
      where: { id: parcelId, senderId: req.user.id, deletedAt: null },
      select: { id: true, status: true, driverId: true }
    });
    if (!parcel) throw new NotFoundError('Colis introuvable');
    if (parcel.driverId) throw new ConflictError('Ce colis est deja assigne a un chauffeur');
    if (!PARCEL_OFFERABLE_STATUSES.includes(parcel.status)) {
      throw new ConflictError('Ce colis n\'est plus disponible pour une offre de trajet');
    }

    // Deux offres vivantes du meme client sur la meme annonce pour le meme colis
    // laisseraient le chauffeur sans savoir laquelle traiter.
    const duplicate = await prisma.advertisementOffer.findFirst({
      where: {
        advertisementId: ad.id,
        clientId: req.user.id,
        parcelId,
        status: { in: ADVERTISEMENT_LIVE_OFFER_STATUSES }
      },
      select: { id: true }
    });
    if (duplicate) {
      throw new ConflictError('Une offre est deja en cours pour ce colis sur cette annonce');
    }
  }

  const offer = await prisma.$transaction(async (tx) => {
    const created = await tx.advertisementOffer.create({
      data: { advertisementId: ad.id, clientId: req.user.id, parcelId, price, message: req.body.message },
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
  const result = await prisma.$transaction(async (tx) => {
    const advertisement = await tx.advertisement.findUnique({
      where: { id: req.params.advertisementId },
      select: { id: true, driverId: true, status: true }
    });
    if (!advertisement) throw new NotFoundError('Annonce introuvable');

    // Seul le chauffeur proprietaire de l'annonce (ou un super admin) peut
    // engager le colis. Le controle est fait dans la transaction pour eviter
    // qu'une modification concurrente contourne l'autorisation.
    if (req.user.role !== 'super_admin' && advertisement.driverId !== req.user.id) {
      throw new ForbiddenError('Vous ne pouvez accepter que les offres de vos propres annonces');
    }

    const currentOffer = await tx.advertisementOffer.findFirst({
      where: {
        id: req.params.offerId,
        advertisementId: advertisement.id
      },
      include: {
        client: true,
        parcel: { include: parcelInclude }
      }
    });
    if (!currentOffer) {
      throw new NotFoundError('Offre introuvable pour cette annonce');
    }
    if (!currentOffer.parcel) {
      throw new ValidationError(
        [{ path: 'offer.parcelId', message: 'Un colis doit etre associe a l\'offre avant son acceptation' }],
        'Offre sans colis'
      );
    }

    const parcel = currentOffer.parcel;
    if (parcel.senderId !== currentOffer.clientId) {
      throw new ForbiddenError('Le colis associe n\'appartient pas au client ayant emis l\'offre');
    }
    if (currentOffer.status === 'rejected') {
      throw new ConflictError('Cette offre a deja ete refusee');
    }
    if (advertisement.status !== 'open' && currentOffer.status !== 'accepted') {
      throw new ConflictError('Cette annonce n\'accepte plus de nouvelles offres');
    }
    if (parcel.driverId && parcel.driverId !== advertisement.driverId) {
      throw new ConflictError('Ce colis est deja assigne a un autre chauffeur');
    }
    const competingAcceptance = await tx.advertisementOffer.findFirst({
      where: {
        parcelId: parcel.id,
        id: { not: currentOffer.id },
        status: 'accepted'
      },
      select: { id: true }
    });
    if (competingAcceptance) {
      throw new ConflictError('Une autre offre est deja acceptee pour ce colis');
    }

    // Un retry apres succes doit rester idempotent : il renvoie l'etat courant
    // sans dupliquer evenement, notification ou audit.
    const alreadyApplied =
      currentOffer.status === 'accepted' &&
      parcel.driverId === advertisement.driverId &&
      !['pending', 'free'].includes(parcel.status);
    if (alreadyApplied) {
      return { offer: currentOffer, parcel, event: null };
    }

    // Une acceptation initiale ou la reparation d'une ancienne acceptation
    // partielle ne peut partir que d'un colis encore disponible. Cela empeche
    // une offre tardive de faire regresser un colis deja collecte ou en route.
    if (!['pending', 'free'].includes(parcel.status)) {
      throw new ConflictError('Le statut actuel du colis ne permet plus cette acceptation');
    }

    const respondedAt = new Date();
    // La condition est reevaluee par PostgreSQL au moment de l'UPDATE. Deux
    // chauffeurs concurrents ne peuvent donc pas tous deux revendiquer le meme
    // colis apres avoir lu simultanement son ancien etat disponible.
    const parcelClaim = await tx.parcel.updateMany({
      where: {
        id: parcel.id,
        senderId: currentOffer.clientId,
        status: { in: ['pending', 'free'] },
        OR: [
          { driverId: null },
          { driverId: advertisement.driverId }
        ]
      },
      data: {
        driverId: advertisement.driverId,
        status: 'confirmed',
        negotiatedPrice: currentOffer.price,
        totalAmount: currentOffer.price,
        isFreeForBidding: false
      }
    });
    if (parcelClaim.count !== 1) {
      throw new ConflictError('Ce colis vient d\'etre assigne ou son statut a change');
    }

    const updatedParcel = await tx.parcel.findUnique({
      where: { id: parcel.id },
      include: parcelInclude
    });

    const event = await tx.parcelEvent.create({
      data: {
        parcelId: parcel.id,
        status: 'confirmed',
        description: 'Offre de trajet acceptee et chauffeur assigne',
        userId: req.user.id,
        userName: req.user.fullName,
        userRole: req.user.role,
        metadata: {
          advertisementId: advertisement.id,
          offerId: currentOffer.id,
          negotiatedPrice: Number(currentOffer.price)
        }
      }
    });

    const updatedOffer = await tx.advertisementOffer.update({
      where: { id: currentOffer.id },
      data: {
        status: 'accepted',
        responseMessage: req.body.responseMessage,
        respondedAt
      },
      include: {
        client: true,
        advertisement: true,
        parcel: { include: parcelInclude }
      }
    });

    // Un colis ne peut pas rester negociable sur plusieurs trajets une fois
    // qu'un chauffeur est assigne.
    await tx.advertisementOffer.updateMany({
      where: {
        parcelId: parcel.id,
        id: { not: currentOffer.id },
        status: { in: ['pending', 'countered'] }
      },
      data: {
        status: 'rejected',
        responseMessage: 'Une autre offre a ete acceptee pour ce colis',
        respondedAt
      }
    });

    await audit(tx, req, {
      action: 'advertisement.offer.accept',
      entityType: 'advertisement_offer',
      entityId: updatedOffer.id,
      beforeData: {
        offerStatus: currentOffer.status,
        parcelStatus: parcel.status,
        parcelDriverId: parcel.driverId
      },
      afterData: {
        offerStatus: 'accepted',
        parcelStatus: 'confirmed',
        parcelDriverId: advertisement.driverId,
        negotiatedPrice: Number(currentOffer.price)
      }
    });

    await notify(tx, {
      userId: updatedOffer.clientId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'ad_offer_accepted',
      title: 'Offre acceptee',
      body: `Votre offre de ${Number(updatedOffer.price)} FCFA pour le colis ${updatedParcel.trackingNumber} a ete acceptee.`,
      data: {
        advertisementId: updatedOffer.advertisementId,
        offerId: updatedOffer.id,
        parcelId: updatedParcel.id,
        driverId: advertisement.driverId,
        price: Number(updatedOffer.price)
      },
      priority: 'high'
    });

    return { offer: updatedOffer, parcel: updatedParcel, event };
  });

  return ok(res, {
    message: 'Offre acceptee et colis assigne au chauffeur',
    data: {
      offer: serializeAdvertisementOffer(result.offer),
      parcel: serializeParcel(result.parcel),
      event: serializeParcelEvent(result.event)
    }
  });
});

export const rejectAdvertisementOffer = handle('advertisements.offerReject', async (req, res) => {
  // Le refus appartient au chauffeur proprietaire de l'annonce. Sans ce
  // controle, n'importe quel compte authentifie pouvait refuser l'offre d'un
  // tiers en connaissant son identifiant.
  const advertisement = await findOwnedAdvertisement(req.user, req.params.advertisementId);

  const offer = await prisma.$transaction(async (tx) => {
    const current = await tx.advertisementOffer.findFirst({
      where: { id: req.params.offerId, advertisementId: advertisement.id },
      include: { client: true }
    });
    if (!current) throw new NotFoundError('Offre introuvable pour cette annonce');
    if (current.status === 'accepted') {
      throw new ConflictError(
        'Cette offre est deja acceptee : annulez le colis pour revenir en arriere'
      );
    }
    // Rejouer le refus renvoie l'etat courant sans redeclencher de notification.
    if (current.status === 'rejected') return current;

    const updated = await tx.advertisementOffer.update({
      where: { id: current.id },
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

    await audit(tx, req, {
      action: 'advertisement.offer.reject',
      entityType: 'advertisement_offer',
      entityId: updated.id,
      beforeData: { status: current.status },
      afterData: { status: 'rejected' }
    });

    return updated;
  });
  return ok(res, { message: 'Offre traitee', data: { offer: serializeAdvertisementOffer(offer) } });
});

export const negotiateAdvertisementOffer = handle('advertisements.offerNegotiate', async (req, res) => {
  const price = positiveDecimal(req.body.price, 'price');
  if (price === null || Number(price) <= 0) {
    throw new ValidationError([{ path: 'price', message: 'Prix superieur a zero requis' }]);
  }

  const offer = await prisma.$transaction(async (tx) => {
    const current = await tx.advertisementOffer.findFirst({
      where: { id: req.params.offerId, advertisementId: req.params.advertisementId },
      include: { advertisement: { select: { driverId: true, status: true } } }
    });
    if (!current) throw new NotFoundError('Offre introuvable pour cette annonce');

    // La negociation va dans les deux sens : le chauffeur propose un contre-prix,
    // le client revise le sien. Le widget de discussion appelle cette route pour
    // les deux roles. Seuls ces deux comptes — et le super admin — y ont droit :
    // aucun controle n'existait auparavant.
    const isDriver = current.advertisement.driverId === req.user.id;
    const isClient = current.clientId === req.user.id;
    if (!isDriver && !isClient && req.user.role !== 'super_admin') {
      throw new ForbiddenError('Negociation non autorisee');
    }

    if (current.status === 'accepted') {
      throw new ConflictError('Cette offre est deja acceptee : son prix est fige');
    }
    if (current.status === 'rejected') {
      throw new ConflictError('Cette offre a ete refusee : elle ne peut plus etre negociee');
    }
    if (current.advertisement.status !== 'open') {
      throw new ConflictError('Cette annonce n\'est plus ouverte a la negociation');
    }

    const updated = await tx.advertisementOffer.update({
      where: { id: current.id },
      data: {
        price,
        responseMessage: req.body.message,
        // Le statut restait a `pending` apres un contre-prix : rien ne
        // distinguait une offre initiale d'une offre deja negociee.
        status: 'countered',
        respondedAt: new Date()
      },
      include: { client: true, parcel: { include: { media: true } } }
    });

    // On avertit la partie d'en face, jamais l'auteur du contre-prix.
    await notify(tx, {
      userId: isDriver ? current.clientId : current.advertisement.driverId,
      senderId: req.user.id,
      senderName: req.user.fullName,
      type: 'ad_offer_countered',
      title: 'Contre-proposition de prix',
      body: `${req.user.fullName} propose ${Number(price)} FCFA.`,
      data: { advertisementId: req.params.advertisementId, offerId: updated.id, price: Number(price) },
      priority: 'high'
    });

    await audit(tx, req, {
      action: 'advertisement.offer.negotiate',
      entityType: 'advertisement_offer',
      entityId: updated.id,
      beforeData: { status: current.status, price: String(current.price) },
      afterData: { status: 'countered', price: String(price) }
    });

    return updated;
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

// ============================================================
// VEHICLES - Véhicules
// ============================================================

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

  const data = { plateNumber, model, type, capacity: Number(req.body.capacity || 0), garageId: req.user.garageId || null, driverId: req.user.id };
  const existing = await prisma.vehicle.findFirst({ where: { driverId: req.user.id, deletedAt: null } });

  try {
    const vehicle = existing
      ? await prisma.vehicle.update({ where: { id: existing.id }, data })
      : await prisma.vehicle.create({ data });
    return ok(res, { status: existing ? 200 : 201, message: 'Vehicule enregistre', data: { vehicle } });
  } catch (error) {
    if (error && error.code === 'P2002') {
      throw new ConflictError('Cette plaque est deja enregistree');
    }
    throw error;
  }
});

// ============================================================
// GARAGE - Zone
// ============================================================

export const garageDrivers = handle('garage.drivers', async (req, res) => {
  const drivers = await prisma.user.findMany({ where: { role: 'driver', garageId: req.user.garageId, status: 'active' }, include: driverInclude });
  return ok(res, { message: 'Chauffeurs zone', data: { drivers: drivers.map(serializeUser) } });
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
  return ok(res, { message: 'Stats zone', data: { stats: { garageId, totalParcels, activeParcels, deliveredToday, activeDrivers, revenue: revenue._sum.amount?.toString() || '0', parcelsByStatus } } });
});

// ============================================================
// RAPPORTS - Agregation par periode
// ============================================================

/**
 * Perimetre d'une zone : un colis compte des qu'il part d'elle ou y arrive.
 * Le rapport d'un admin de zone ne doit jamais retomber sur des chiffres
 * plateforme — c'est ce que faisaient les anciennes implementations.
 */
function garageScopeWhere(garageId) {
  if (!garageId) return { id: '00000000-0000-0000-0000-000000000000' };
  return { OR: [{ departureGarageId: garageId }, { arrivalGarageId: garageId }] };
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Minuit local du jour demande (defaut : aujourd'hui) et minuit du lendemain. */
function dayRange(value) {
  const parsed = value ? new Date(value) : new Date();
  const day = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to, bucket: 'hour', date: isoDate(from) };
}

function monthRange(yearValue, monthValue) {
  const now = new Date();
  const year = Number(yearValue) || now.getFullYear();
  // Les clients envoient le mois en base 1 ; `Date` l'attend en base 0.
  const month = Number(monthValue) || now.getMonth() + 1;
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);
  return { from, to, bucket: 'day', year, month };
}

/** Clé de regroupement de la série temporelle (heure du jour ou date ISO). */
function bucketKey(date, bucket) {
  const value = new Date(date);
  if (bucket === 'hour') return String(value.getHours()).padStart(2, '0');
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function emptySeries(from, to, bucket) {
  const keys = [];
  if (bucket === 'hour') {
    for (let hour = 0; hour < 24; hour += 1) keys.push(String(hour).padStart(2, '0'));
  } else {
    const cursor = new Date(from);
    while (cursor < to) {
      keys.push(bucketKey(cursor, 'day'));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return keys.map((key) => ({ key, created: 0, delivered: 0, revenue: 0 }));
}

/**
 * Rapport d'activite sur une periode : totaux, repartition par statut, serie
 * temporelle et top chauffeurs. `scope` restreint le perimetre (zone ou
 * plateforme entiere).
 */
async function buildPeriodReport({ scope, from, to, bucket }) {
  const createdWhere = { ...scope, deletedAt: null, createdAt: { gte: from, lt: to } };
  const deliveredWhere = { ...scope, deletedAt: null, status: 'delivered', deliveryDate: { gte: from, lt: to } };

  const [created, delivered, cancelled, grouped, payments, topDrivers] = await Promise.all([
    prisma.parcel.findMany({ where: createdWhere, select: { createdAt: true } }),
    prisma.parcel.findMany({
      where: deliveredWhere,
      select: { deliveryDate: true, totalAmount: true, price: true, driverId: true }
    }),
    prisma.parcel.count({ where: { ...scope, deletedAt: null, status: 'cancelled', updatedAt: { gte: from, lt: to } } }),
    prisma.parcel.groupBy({ by: ['status'], where: createdWhere, _count: { status: true } }),
    prisma.payment.aggregate({
      where: {
        ...(Object.keys(scope).length ? { parcel: scope } : {}),
        status: 'completed',
        createdAt: { gte: from, lt: to }
      },
      _sum: { amount: true }
    }),
    prisma.parcel.groupBy({
      by: ['driverId'],
      where: { ...deliveredWhere, driverId: { not: null } },
      _count: { driverId: true },
      orderBy: { _count: { driverId: 'desc' } },
      take: 5
    })
  ]);

  const series = emptySeries(from, to, bucket);
  const index = new Map(series.map((point) => [point.key, point]));

  for (const parcel of created) {
    const point = index.get(bucketKey(parcel.createdAt, bucket));
    if (point) point.created += 1;
  }
  for (const parcel of delivered) {
    const point = index.get(bucketKey(parcel.deliveryDate, bucket));
    if (!point) continue;
    point.delivered += 1;
    point.revenue += Number(parcel.totalAmount ?? parcel.price ?? 0);
  }

  const driverNames = topDrivers.length
    ? await prisma.user.findMany({
        where: { id: { in: topDrivers.map((row) => row.driverId) } },
        select: { id: true, fullName: true }
      })
    : [];
  const nameById = new Map(driverNames.map((driver) => [driver.id, driver.fullName]));

  const totalCreated = created.length;
  const totalDelivered = delivered.length;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    bucket,
    totals: {
      created: totalCreated,
      delivered: totalDelivered,
      cancelled,
      // Taux calcule sur les livraisons effectuees dans la periode, rapportees
      // aux colis qui y sont nes : c'est la lecture attendue d'un rapport.
      deliveryRate: totalCreated ? Math.round((totalDelivered / totalCreated) * 100) : 0,
      revenue: Number(payments._sum.amount || 0),
      deliveredAmount: delivered.reduce((sum, parcel) => sum + Number(parcel.totalAmount ?? parcel.price ?? 0), 0)
    },
    parcelsByStatus: Object.fromEntries(grouped.map((row) => [row.status, row._count.status])),
    series,
    topDrivers: topDrivers.map((row) => ({
      driverId: row.driverId,
      fullName: nameById.get(row.driverId) ?? null,
      delivered: row._count.driverId
    }))
  };
}

// ============================================================
// STATS - Statistiques globales
// ============================================================

async function globalStats() {
  const startOfDay = new Date(new Date().toDateString());
  const [totalUsers, totalDrivers, totalClients, totalGarages, totalZones, totalVehicles, totalParcels, parcelsInTransit, parcelsDeliveredToday, parcelsPending, totalRevenue] =
    await Promise.all([
      prisma.user.count({ where: { status: { not: 'deleted' } } }),
      prisma.user.count({ where: { role: 'driver', status: 'active' } }),
      prisma.user.count({ where: { role: 'client', status: 'active' } }),
      prisma.garage.count({ where: { deletedAt: null } }),
      // Le référentiel de lieux est désormais `zones` ; `totalGarages` compte
      // encore la table héritée et reste exposé pour l'app mobile.
      prisma.zone.count(),
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
    totalZones,
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

// ============================================================
// REPORTS - Rapports
// ============================================================

export const garageDailyReport = handle('garage.reportDaily', async (req, res) => {
  const range = dayRange(req.query.date);
  const report = await buildPeriodReport({ scope: garageScopeWhere(req.user.garageId), ...range });
  return ok(res, { message: 'Rapport journalier', data: { report: { date: range.date, ...report } } });
});

export const garageMonthlyReport = handle('garage.reportMonthly', async (req, res) => {
  const range = monthRange(req.query.year, req.query.month);
  const report = await buildPeriodReport({ scope: garageScopeWhere(req.user.garageId), ...range });
  return ok(res, {
    message: 'Rapport mensuel',
    data: { report: { year: range.year, month: range.month, ...report } }
  });
});

export const garageExport = handle('garage.export', async (req, res) => {
  const parcels = await prisma.parcel.findMany({ where: { OR: [{ departureGarageId: req.user.garageId }, { arrivalGarageId: req.user.garageId }] }, include: parcelInclude });
  return ok(res, { message: 'Export zone', data: { data: parcels.map(serializeParcel) } });
});

export const superAdminDailyReport = handle('super.reportDaily', async (req, res) => {
  const range = dayRange(req.query.date);
  const report = await buildPeriodReport({ scope: {}, ...range });
  return ok(res, { message: 'Rapport journalier', data: { report: { date: range.date, ...report } } });
});

export const superAdminMonthlyReport = handle('super.reportMonthly', async (req, res) => {
  const range = monthRange(req.query.year, req.query.month);
  const report = await buildPeriodReport({ scope: {}, ...range });
  return ok(res, {
    message: 'Rapport mensuel',
    data: { report: { year: range.year, month: range.month, ...report } }
  });
});

export const superAdminExport = handle('super.export', async (req, res) => {
  const type = req.query.type || 'parcels';
  const data = type === 'users'
    ? (await prisma.user.findMany({ include: { garage: true } })).map(serializeUser)
    : (await prisma.parcel.findMany({ include: parcelInclude })).map(serializeParcel);
  return ok(res, { message: 'Export', data: { data } });
});

// ============================================================
// SUPER ADMIN - Utilisateurs
// ============================================================

export const superAdminUsers = handle('super.users', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ role: req.query.role, status: req.query.status });
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, include: { ...driverInclude, score: true }, orderBy: { createdAt: 'desc' }, skip, take: limit })
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
      include: driverInclude
    });
    await tx.score.create({ data: { userId: created.id } });
    if (created.role === 'driver') {
      await syncDriverVehicle(tx, created, req.body);
    }
    await audit(tx, req, { action: 'user.create', entityType: 'user', entityId: created.id, afterData: { role: created.role } });
    return created;
  });

  const created = await prisma.user.findUnique({ where: { id: user.id }, include: driverInclude });
  return ok(res, { status: 201, message: 'Utilisateur cree', data: { user: serializeUser(created) } });
});

export const superAdminUserDetail = handle('super.userDetail', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, include: { ...driverInclude, score: true } });
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
    include: driverInclude
  });

  if (user.role === 'driver') {
    await syncDriverVehicle(prisma, user, req.body);
  }

  const updated = await prisma.user.findUnique({ where: { id: user.id }, include: driverInclude });
  return ok(res, { message: 'Utilisateur mis a jour', data: { user: serializeUser(updated) } });
});

const ASSIGNABLE_ROLES = [
  'client',
  'driver',
  'admin',
  'super_admin',
  'support',
  'support_technique',
  'support_commercial'
];

export const superAdminUpdateUserRole = handle('super.userRole', async (req, res) => {
  const role = req.body.role;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new ValidationError([{ path: 'body.role', message: 'Role inconnu' }]);
  }
  // Se retirer soi-meme ses droits ferme la porte de l'interieur : un dernier
  // super admin degrade ne pourrait plus la rouvrir.
  if (req.params.userId === req.user.id && role !== req.user.role) {
    throw new ForbiddenError('Impossible de modifier son propre role');
  }

  const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!existing || existing.status === 'deleted') throw new NotFoundError('Utilisateur introuvable');

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: { role },
      include: { garage: true }
    });

    // Un changement de role redistribue des droits : il doit laisser une trace.
    await audit(tx, req, {
      action: 'user.role.update',
      entityType: 'user',
      entityId: updated.id,
      beforeData: { role: existing.role },
      afterData: { role: updated.role }
    });

    return updated;
  });

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

export const superAdminResetUserPin = handle('super.userResetPin', async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status === 'deleted') throw new NotFoundError('Utilisateur introuvable');

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
      }).catch(() => { });
    }
    if (user.email) {
      sendNotificationEmail({
        email: user.email,
        subject: '[PRO COLIS] Votre code PIN a ete reinitialise',
        message: `Votre code PIN a ete reinitialise par un administrateur. Nouveau code : ${pin}. Ne le partagez avec personne.`
      }).catch(() => { });
    }
  }

  return ok(res, { message: 'PIN reinitialise', data: { pin, newPin: pin } });
});

// ============================================================
// SUPER ADMIN - Garages
// ============================================================

export const superAdminGarages = handle('super.garages', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = cleanUndefined({ city: req.query.city, deletedAt: null });
  const [total, garages] = await Promise.all([
    prisma.garage.count({ where }),
    prisma.garage.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })
  ]);
  return ok(res, { message: 'Zones', data: { garages: garages.map(serializeGarage) }, meta: paginationMeta({ page, limit, total }) });
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
  return ok(res, { status: 201, message: 'Zone creee', data: { garage: serializeGarage(garage) } });
});

export const superAdminGarageDetail = handle('super.garageDetail', async (req, res) => {
  const garage = await prisma.garage.findUnique({
    where: { id: req.params.garageId },
    include: { users: true, vehicles: true }
  });
  if (!garage) throw new NotFoundError('Zone introuvable');
  return ok(res, { message: 'Detail zone', data: { garage: { ...serializeGarage(garage), drivers: garage.users.filter((user) => user.role === 'driver').map(serializeUser), vehicles: garage.vehicles, stats: { drivers: garage.users.length, vehicles: garage.vehicles.length } } } });
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
  return ok(res, { message: 'Zone mise a jour', data: { garage: serializeGarage(garage) } });
});

export const superAdminDeleteGarage = handle('super.garageDelete', async (req, res) => {
  const garage = await prisma.garage.update({ where: { id: req.params.garageId }, data: { deletedAt: new Date(), isActive: false } });
  return ok(res, { message: 'Zone supprimee', data: { garage: serializeGarage(garage) } });
});

// ============================================================
// SUPER ADMIN - Parcels
// ============================================================

export const superAdminUpdateParcel = handle('super.parcelUpdate', async (req, res) => {
  const allowed = ['receiverAddress', 'receiverName', 'receiverPhone', 'notes', 'price', 'totalAmount', 'driverId', 'arrivalGarageId', 'departureGarageId'];
  const parcel = await prisma.parcel.update({
    where: { id: req.params.parcelId },
    data: cleanUndefined(Object.fromEntries(allowed.map((key) => [key, req.body[key]]))),
    include: parcelInclude
  });
  return ok(res, { message: 'Colis mis a jour', data: { parcel: serializeParcel(parcel) } });
});

// ============================================================
// AUDIT LOGS - Journaux d'audit
// ============================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un identifiant non-UUID ferait remonter une erreur Prisma en 500 alors que la
// faute vient du filtre : on la traite comme une erreur de validation.
function auditUuidFilter(value, path) {
  if (value === undefined || value === '') return undefined;
  if (!UUID_PATTERN.test(String(value))) {
    throw new ValidationError([{ path, message: 'Identifiant invalide' }], 'Filtre d audit invalide');
  }
  return String(value);
}

function auditDateFilter(from, to) {
  const range = cleanUndefined({
    gte: from ? new Date(from) : undefined,
    lte: to ? new Date(to) : undefined
  });
  if (Object.values(range).some((date) => Number.isNaN(date.getTime()))) {
    throw new ValidationError([{ path: 'query.from', message: 'Date ISO invalide' }], 'Filtre d audit invalide');
  }
  return Object.keys(range).length ? range : undefined;
}

export const auditLogs = handle('super.auditLogs', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const search = String(req.query.search || '').trim();

  const where = cleanUndefined({
    actorId: auditUuidFilter(req.query.actorId, 'query.actorId'),
    actorRole: req.query.actorRole || undefined,
    action: req.query.action || undefined,
    entityType: req.query.entityType || undefined,
    entityId: auditUuidFilter(req.query.entityId, 'query.entityId'),
    createdAt: auditDateFilter(req.query.from, req.query.to),
    // La recherche libre porte sur le nom de l'action et le type d'entite :
    // ce sont les deux colonnes lisibles par un humain dans la liste.
    OR: search
      ? [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } }
      ]
      : undefined
  });

  const [total, auditLogsRows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      // Sans l'acteur, l'ecran n'affiche qu'un UUID : le nom est charge ici
      // plutot que par un appel par ligne cote client.
      include: { actor: { select: { id: true, fullName: true, phone: true, role: true } } }
    })
  ]);

  // `beforeData` / `afterData` transportent des valeurs metier completes
  // (montants, coordonnees). Le support voit qui a fait quoi, sans le detail.
  const detailed = req.user.role === 'super_admin';

  return ok(res, {
    message: 'Audit logs',
    data: { auditLogs: auditLogsRows.map((row) => serializeAuditLog(row, { detailed })) },
    meta: paginationMeta({ page, limit, total })
  });
});

// ============================================================
// SYSTEM CONFIG - Configuration système
// ============================================================

export const getSystemConfig = handle('super.configGet', async (_req, res) => {
  const rows = await prisma.systemConfig.findMany();
  const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return ok(res, { message: 'Configuration', data: { config } });
});

export const getPublicBroadcasts = handle('config.broadcasts', async (_req, res) => {
  const row = await prisma.systemConfig.findUnique({ where: { key: 'broadcasts' } });
  const broadcasts = Array.isArray(row?.value) ? row.value : [];
  return ok(res, { message: 'Annonces', data: { broadcasts } });
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

// ============================================================
// BACKUP - Sauvegardes
// ============================================================

// Les sauvegardes vivent desormais dans `modules/backups` : elles pilotent
// `pg_dump` / `pg_restore` et n'ont plus leur place dans ce controleur.

// ============================================================
// WEBHOOKS - Webhooks
// ============================================================

/**
 * Le secret signe les livraisons sortantes : il est ecrit une fois et ne
 * ressort jamais des lectures, seule sa presence est exposee.
 */
function serializeWebhook(webhook) {
  if (!webhook) return null;
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    hasSecret: Boolean(webhook.secret),
    isActive: webhook.isActive,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt
  };
}

export const listWebhooks = handle('webhooks.list', async (_req, res) => {
  const webhooks = await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } });
  return ok(res, { message: 'Webhooks', data: { webhooks: webhooks.map(serializeWebhook) } });
});

export const createWebhook = handle('webhooks.create', async (req, res) => {
  const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
  // Une URL invalide ne serait decouverte qu'a la premiere livraison, cote
  // worker, sans retour a l'administrateur : on la refuse a l'ecriture.
  if (!/^https?:\/\/\S+$/i.test(url)) {
    throw new ValidationError([{ path: 'body.url', message: 'URL http(s) valide requise' }]);
  }
  const events = Array.isArray(req.body.events) ? req.body.events.filter((event) => typeof event === 'string') : [];
  if (events.length === 0) {
    throw new ValidationError([{ path: 'body.events', message: 'Au moins un evenement est requis' }]);
  }

  const webhook = await prisma.webhook.create({
    data: { url, events, secret: req.body.secret || null, createdBy: req.user.id }
  });
  return ok(res, { status: 201, message: 'Webhook cree', data: { webhook: serializeWebhook(webhook) } });
});

export const deleteWebhook = handle('webhooks.delete', async (req, res) => {
  // `delete` sur un identifiant deja retire leve une P2025 rendue en 500 :
  // `deleteMany` rend l'appel rejouable apres une coupure reseau.
  const removed = await prisma.webhook.deleteMany({ where: { id: req.params.webhookId } });
  if (removed.count === 0) throw new NotFoundError('Webhook introuvable');
  return ok(res, { message: 'Webhook supprime' });
});

// ============================================================
// SYSTEM HEALTH - Santé du système
// ============================================================

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

// ============================================================
// COMMISSIONS - Commissions
// ============================================================

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
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
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
  const parcel = await findAccessibleParcelForDriver(req.user, req.params.parcelId);
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
// ADMIN SUPPORT FUNCTIONS - Support admin
// ============================================================

export const adminSupportConversations = async (req, res) => {
  try {
    console.log('📨 adminSupportConversations - Début');

    const supportRoles = ['admin', 'super_admin', 'support', 'support_technique', 'support_commercial'];

    const supportMessages = await prisma.message.findMany({
      where: {
        parcelId: null,
        OR: [
          { sender: { role: { in: supportRoles } } },
          { receiver: { role: { in: supportRoles } } }
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
        },
        handledBy: {
          select: { id: true, fullName: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`📨 ${supportMessages.length} messages de support trouvés`);

    const conversationMap = new Map();

    for (const msg of supportMessages) {
      const isSupportSender = supportRoles.includes(msg.sender.role);
      const isSupportReceiver = supportRoles.includes(msg.receiver.role);
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
            role: supportUser.role,
            email: supportUser.email,
            phone: supportUser.phone
          },
          lastMessage: msg.body,
          lastMessageDate: msg.createdAt,
          messageCount: 1,
          agents: [],
          lastAgent: null
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

      if (isSupportSender && msg.handledBy) {
        const entry = conversationMap.get(user.id);
        const agent = { id: msg.handledBy.id, fullName: msg.handledBy.fullName };
        if (!entry.lastAgent) entry.lastAgent = agent;
        if (!entry.agents.some((a) => a.id === agent.id)) entry.agents.push(agent);
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
        },
        handledBy: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log('📨 Messages trouvés:', messages.length);

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
          photoUrl: m.photoUrl,
          videoUrl: m.videoUrl,
          handledById: m.handledById,
          handledBy: m.handledBy
            ? { id: m.handledBy.id, fullName: m.handledBy.fullName, role: m.handledBy.role }
            : null,
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

export const adminSupportReply = async (req, res) => {
  try {
    const { supportUserId, receiverId, body, audioUrl, photoUrl, videoUrl } = req.body;

    console.log('📨 adminSupportReply - supportUserId:', supportUserId);
    console.log('📨 adminSupportReply - receiverId:', receiverId);

    const hasContent = Boolean(body || audioUrl || photoUrl || videoUrl);
    if (!supportUserId || !receiverId || !hasContent) {
      return res.status(400).json({
        success: false,
        message: 'Données manquantes',
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            !supportUserId ? { path: 'supportUserId', message: 'supportUserId est requis' } : null,
            !receiverId ? { path: 'receiverId', message: 'receiverId est requis' } : null,
            !hasContent ? { path: 'body', message: 'Message vide (texte ou pièce jointe requis)' } : null
          ].filter(Boolean)
        }
      });
    }

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

    if (!['admin', 'super_admin', 'support', 'support_technique', 'support_commercial'].includes(support.role)) {
      return res.status(403).json({
        success: false,
        message: 'L\'utilisateur n\'est pas un support valide',
        error: {
          code: 'FORBIDDEN',
          details: [{ path: 'supportUserId', message: `Rôle: ${support.role}` }]
        }
      });
    }

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

    // ✅ Récupérer tous les supports pour les notifier aussi
    const supportUsers = await prisma.user.findMany({
      where: {
        role: { 
          in: ['admin', 'super_admin', 'support', 'support_technique', 'support_commercial'] 
        },
        status: 'active'
      },
      select: { id: true, fullName: true, phone: true, email: true }
    });

    // Créer le message pour le destinataire
    const message = await prisma.message.create({
      data: {
        senderId: supportUserId,
        receiverId: receiverId,
        body: body || '',
        audioUrl: audioUrl || null,
        photoUrl: photoUrl || null,
        videoUrl: videoUrl || null,
        handledById: req.user?.id || null,
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
        audioUrl: true,
        photoUrl: true,
        videoUrl: true,
        handledById: true,
        handledBy: { select: { id: true, fullName: true, role: true } }
      }
    });

    console.log('✅ Message créé:', message.id);

    // ✅ Notifier le destinataire
    await prisma.notification.create({
      data: {
        userId: receiverId,
        type: 'support_reply',
        title: 'Nouvelle réponse du support',
        body: body
          ? `Le support vous a répondu: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`
          : photoUrl
            ? 'Le support vous a envoyé une photo'
            : videoUrl
              ? 'Le support vous a envoyé une vidéo'
              : 'Le support vous a envoyé un message vocal',
        data: { supportUserId, messageId: message.id },
        priority: 'high'
      }
    });

    // ✅ Notifier tous les autres supports de la réponse
    const supportNotifs = supportUsers
      .filter(u => u.id !== supportUserId && u.id !== receiverId)
      .map((user) =>
        prisma.notification.create({
          data: {
            userId: user.id,
            type: 'support_reply_to_team',
            title: `Réponse support de ${support.fullName}`,
            body: body
              ? `Le support a répondu à ${receiver.fullName}: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`
              : 'Le support a répondu à un utilisateur',
            data: { 
              supportUserId, 
              receiverId, 
              messageId: message.id,
              repliedTo: receiver.fullName
            },
            priority: 'normal'
          }
        })
      );
    await Promise.all(supportNotifs);

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

// ============================================================
// Récupérer le colis depuis une annonce
// GET /advertisements/:advertisementId/parcel
// ============================================================

export const getParcelFromAdvertisement = handle('advertisements.getParcel', async (req, res) => {
  const { advertisementId } = req.params;

  const advertisement = await prisma.advertisement.findUnique({
    where: { id: advertisementId },
    include: {
      offers: {
        include: {
          parcel: {
            include: parcelInclude
          }
        }
      }
    }
  });

  if (!advertisement) {
    throw new NotFoundError('Annonce introuvable');
  }

  if (req.user.role === 'driver' && advertisement.driverId !== req.user.id) {
    throw new ForbiddenError('Vous n\'êtes pas autorisé à voir cette annonce');
  }

  const acceptedOffer = advertisement.offers.find(o => o.status === 'accepted');
  const targetOffer = acceptedOffer || advertisement.offers[0];

  if (!targetOffer || !targetOffer.parcel) {
    throw new NotFoundError('Aucun colis associé à cette annonce');
  }

  const parcel = targetOffer.parcel;
  if (req.user.role === 'client' && parcel.senderId !== req.user.id) {
    throw new ForbiddenError('Vous n\'êtes pas autorisé à voir ce colis');
  }
  if (req.user.role === 'driver' && parcel.driverId !== req.user.id) {
    throw new ForbiddenError('Vous n\'êtes pas autorisé à voir ce colis');
  }

  return ok(res, {
    message: 'Colis récupéré',
    data: { parcel: serializeParcel(parcel) }
  });
});