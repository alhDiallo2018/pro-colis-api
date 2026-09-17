import { prisma } from '../config/prisma.js';
import { getConfigValue, getCfaPerPoint } from './commission.js';
import { isStaffRole } from './tokens.js';
import {
  CancellationConfigurationError,
  CancellationExemptReasonForbiddenError,
  CancellationNotAllowedError,
  InvalidCancellationReasonError,
  ParcelAlreadyCancelledError,
  ValidationError
} from './errors.js';

/**
 * Moteur central d'annulation d'un colis.
 *
 * Unique source de vérité pour le mobile et le web : responsabilité, pénalité,
 * frais, remboursement, impact client/chauffeur (wallet → points → dette),
 * notifications et audit. Aucun montant ni pourcentage métier n'est codé en dur :
 * toutes les règles proviennent du système de configuration (`systemConfig`
 * sous `cancellation.*`), avec des valeurs par défaut NEUTRES (0) afin qu'une
 * règle absente ne produise jamais d'argent inventé.
 */

// Statuts où l'annulation reste structurellement possible. Ce ne sont pas des
// règles financières : un colis livré (ou déjà annulé) ne peut simplement pas
// être annulé — invariant du cycle de vie.
const DEFAULT_ALLOWED_STATUSES = [
  'pending',
  'free',
  'proposal_sent',
  'negotiating',
  'confirmed',
  'picked_up',
  'in_transit',
  'arrived',
  'out_for_delivery'
];

// Statuts où une annulation du client est exonérée de pénalité (aucun chauffeur
// n'a encore été engagé). Valeur par défaut structurelle ; surchargeable par
// `cancellation.freeCancellationStatuses`.
const DEFAULT_FREE_STATUSES = ['pending', 'free', 'proposal_sent', 'negotiating'];

const RESPONSIBILITIES = ['client', 'driver', 'shared', 'exempt'];

function round(value) {
  return Math.round(Number(value) || 0);
}

function clamp(value, min, max) {
  let v = round(value);
  if (min > 0) v = Math.max(v, round(min));
  if (max > 0) v = Math.min(v, round(max));
  return v;
}

function toNumberList(raw, fallback) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.value)) return raw.value;
  return fallback;
}

function toNumber(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Lit la configuration d'annulation. Aucune valeur métier n'est codée en dur :
 * `getConfigValue` relit `systemConfig` à chaque appel et le fallback est
 * neutre (0 = « aucune pénalité / aucun frais »).
 */
export async function loadCancellationConfig(tx) {
  const [
    allowedStatusesRaw,
    freeStatusesRaw,
    reasonsRaw,
    penaltyPercentage,
    penaltyMinAmount,
    penaltyMaxAmount,
    clientSharePercent,
    paydunyaPercentage,
    technicalFixed,
    technicalPercentage
  ] = await Promise.all([
    getConfigValue(tx, 'cancellation.allowedStatuses', DEFAULT_ALLOWED_STATUSES),
    getConfigValue(tx, 'cancellation.freeCancellationStatuses', DEFAULT_FREE_STATUSES),
    getConfigValue(tx, 'cancellation.reasons', []),
    getConfigValue(tx, 'cancellation.penalty.percentage', 0),
    getConfigValue(tx, 'cancellation.penalty.minAmount', 0),
    getConfigValue(tx, 'cancellation.penalty.maxAmount', 0),
    getConfigValue(tx, 'cancellation.penalty.clientSharePercent', null),
    getConfigValue(tx, 'cancellation.fee.paydunyaPercentage', 0),
    getConfigValue(tx, 'cancellation.fee.technicalFixed', 0),
    getConfigValue(tx, 'cancellation.fee.technicalPercentage', 0)
  ]);

  const reasons = (Array.isArray(reasonsRaw) ? reasonsRaw : (Array.isArray(reasonsRaw?.value) ? reasonsRaw.value : []))
    .map((r) => ({
      value: String(r?.value ?? '').trim(),
      label: String(r?.label ?? r?.value ?? '').trim(),
      responsibility: RESPONSIBILITIES.includes(r?.responsibility) ? r.responsibility : null,
      exempt: r?.exempt === true || r?.responsibility === 'exempt'
    }))
    .filter((r) => r.value && r.label);

  return {
    allowedStatuses: toNumberList(allowedStatusesRaw, DEFAULT_ALLOWED_STATUSES).map(String),
    freeStatuses: toNumberList(freeStatusesRaw, DEFAULT_FREE_STATUSES).map(String),
    reasons,
    penalty: {
      percentage: Math.max(0, toNumber(penaltyPercentage, 0)),
      minAmount: Math.max(0, toNumber(penaltyMinAmount, 0)),
      maxAmount: Math.max(0, toNumber(penaltyMaxAmount, 0)),
      clientSharePercent: clientSharePercent == null || clientSharePercent === ''
        ? null
        : Math.min(100, Math.max(0, toNumber(clientSharePercent, null)))
    },
    fee: {
      paydunyaPercentage: Math.max(0, toNumber(paydunyaPercentage, 0)),
      technicalFixed: Math.max(0, toNumber(technicalFixed, 0)),
      technicalPercentage: Math.max(0, toNumber(technicalPercentage, 0))
    }
  };
}

const PERCENT_KEYS = [
  'cancellation.penalty.percentage',
  'cancellation.penalty.clientSharePercent',
  'cancellation.fee.paydunyaPercentage',
  'cancellation.fee.technicalPercentage'
];

const NON_NEGATIVE_KEYS = [
  'cancellation.penalty.minAmount',
  'cancellation.penalty.maxAmount',
  'cancellation.fee.technicalFixed',
  'cancellation.clientDebtLimit'
];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Valide structurellement une clé `cancellation.*` avant persistance.
 * Lève une `ValidationError` (422) sur toute valeur incohérente : responsabilité
 * hors enum, pourcentage hors 0–100, motif mal formé, clé inconnue…
 * Cette validation protège l'écriture admin (`PUT /super-admin/config`) afin
 * qu'aucune configuration invalide ne soit silencieusement réinterprétée à la
 * lecture du moteur.
 */
export function validateCancellationConfigValue(key, value) {
  const fail = (path, message) => {
    throw new ValidationError([{ path, message }]);
  };

  if (key === 'cancellation.allowedStatuses' || key === 'cancellation.freeCancellationStatuses') {
    if (!Array.isArray(value) || value.some((s) => typeof s !== 'string' || !s.trim())) {
      fail(key, 'Doit être un tableau de chaînes non vides.');
    }
    return;
  }

  if (key === 'cancellation.reasons') {
    if (!Array.isArray(value)) fail(key, 'Doit être un tableau de motifs.');
    value.forEach((r, i) => {
      const path = `${key}[${i}]`;
      if (!r || typeof r !== 'object' || Array.isArray(r)) fail(path, 'Motif invalide (objet attendu).');
      const v = typeof r.value === 'string' ? r.value.trim() : '';
      const label = typeof r.label === 'string' ? r.label.trim() : '';
      if (!v) fail(`${path}.value`, 'Identifiant stable (value) requis.');
      if (!label) fail(`${path}.label`, 'Libellé (label) requis.');
      if (!RESPONSIBILITIES.includes(r.responsibility)) {
        fail(`${path}.responsibility`, `Responsabilité invalide (attendu : ${RESPONSIBILITIES.join(' | ')}).`);
      }
      if (r.exempt !== undefined && typeof r.exempt !== 'boolean') {
        fail(`${path}.exempt`, 'exempt doit être un booléen.');
      }
    });
    return;
  }

  if (PERCENT_KEYS.includes(key)) {
    if (value != null && (!isFiniteNumber(value) || value < 0 || value > 100)) {
      fail(key, 'Doit être un nombre entre 0 et 100.');
    }
    return;
  }

  if (NON_NEGATIVE_KEYS.includes(key)) {
    if (value != null && (!isFiniteNumber(value) || value < 0)) {
      fail(key, 'Doit être un nombre positif ou nul.');
    }
    return;
  }

  if (key.startsWith('cancellation.')) {
    fail(key, 'Clé de configuration d’annulation inconnue.');
  }
}

/**
 * Vérifie la cohérence transversale d'un jeu de configuration d'annulation.
 * `merged` regroupe les valeurs déjà persistées et celles à écrire.
 */
export function validateCancellationConfigCoherence(merged) {
  const min = merged?.penaltyMinAmount;
  const max = merged?.penaltyMaxAmount;
  if (min != null && max != null && min > max) {
    throw new ValidationError([{ path: 'cancellation.penalty.minAmount', message: 'minAmount ne peut pas dépasser maxAmount.' }]);
  }

  const hasShared = Array.isArray(merged?.reasons) && merged.reasons.some((r) => r?.responsibility === 'shared');
  if (hasShared && merged?.clientSharePercent == null) {
    throw new ValidationError([{ path: 'cancellation.penalty.clientSharePercent', message: 'Requis dès qu’un motif à responsabilité partagée est configuré.' }]);
  }
}

/**
 * Montant réellement payé via la plateforme (PayDunya) pour ce colis.
 * Les paiements espèces ne sont pas remboursables automatiquement : ils ne
 * contribuent pas au remboursement. La somme des paiements terminés non-cash
 * est la seule source de vérité du montant initialement payé.
 */
export async function platformPaidAmount(tx, parcelId) {
  const payments = await tx.payment.findMany({
    where: { parcelId, status: 'completed', method: { not: 'cash' } }
  });
  return payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

/** Résout la responsabilité et l'exonération d'une annulation (côté serveur). */
export function resolveCancellationRule({ config, parcel, actorRole, reason, requireReason = true }) {
  const requested = typeof reason === 'string' ? reason.trim() : '';
  const configured = requested ? config.reasons.find((r) => r.value === requested) : null;

  // 1. Motif configuré → responsabilité configurée (source de vérité explicite).
  if (configured) {
    const responsibility = configured.responsibility || (configured.exempt ? 'exempt' : 'client');
    const exempt = configured.exempt || responsibility === 'exempt';

    // Anti auto-exonération : un motif exonérant (`force_majeure`,
    // `platform_issue`, ou tout motif `responsibility=exempt`) est réservé au
    // support/admin. CLIENT, DRIVER — et tout rôle indéfini/système (défaut
    // "deny") — sont refusés ici, quelle que soit la voie d'entrée (devis ou
    // annulation réelle). L'exonération structurelle (statut libre, sans motif)
    // reste possible en dessous (étape 2).
    if (exempt && !isStaffRole(actorRole)) {
      throw new CancellationExemptReasonForbiddenError();
    }

    return {
      reason: configured.value,
      label: configured.label,
      responsibility,
      exempt
    };
  }

  // 2. Annulation exonérée par le stade (aucun chauffeur engagé) : seule voie
  //    légitime sans motif valide (annulation précoce, colis libre…).
  if (config.freeStatuses.includes(parcel.status) && !parcel.assignedDriverId) {
    return { reason: requested, label: requested || 'Annulation', responsibility: 'exempt', exempt: true };
  }

  // 3. Motif absent ou inconnu alors qu'une pénalité est possible.
  //    - Annulation réelle (`requireReason`) : refus explicite, jamais de repli
  //      exonérant qui permettrait de contourner une pénalité.
  //    - Devis (`requireReason = false`) : aperçu neutre (responsabilité non
  //      déterminée, exonéré) afin que l'écran puisse afficher les motifs sans
  //      préjuger du coût — le motif sera exigé au moment de confirmer.
  if (requireReason) throw new InvalidCancellationReasonError();
  return { reason: '', label: '', responsibility: null, exempt: true };
}

/**
 * Motifs qu'un acteur a le droit de sélectionner. Les motifs exonérants
 * (`responsibility=exempt`, ex. `force_majeure`, `platform_issue`) sont retirés
 * pour les rôles non-staff (client/driver) : ils sont réservés au support/admin.
 * Le frontend n'a donc même pas la possibilité de les proposer, et le backend
 * rejette de toute façon toute tentative directe (voir `resolveCancellationRule`).
 */
export function selectableCancellationReasons(config, actorRole) {
  const reasons = Array.isArray(config?.reasons) ? config.reasons : [];
  if (isStaffRole(actorRole)) return reasons.map((r) => ({ value: r.value, label: r.label }));
  return reasons
    .filter((r) => !r.exempt && r.responsibility !== 'exempt')
    .map((r) => ({ value: r.value, label: r.label }));
}

/**
 * Calcule l'issue d'une annulation SANS rien modifier (devis / quote).
 * Retourne un objet canonique, source unique des deux contrats (web + mobile).
 */
export async function computeCancellation({ tx, parcel, actor, reason, requireReason = true }) {
  const config = await loadCancellationConfig(tx);

  if (parcel.status === 'cancelled') throw new ParcelAlreadyCancelledError();
  if (parcel.status === 'delivered' || !config.allowedStatuses.includes(parcel.status)) {
    throw new CancellationNotAllowedError();
  }

  const rule = resolveCancellationRule({ config, parcel, actorRole: actor?.role, reason, requireReason });

  const paidAmount = await platformPaidAmount(tx, parcel.id);

  // --- Pénalité (montant total) puis répartition par responsabilité ---
  let penaltyAmount = 0;
  let clientShare = 0;
  let driverShare = 0;

  if (!rule.exempt && config.penalty.percentage > 0) {
    const base = paidAmount > 0 ? paidAmount : Number(parcel.price || parcel.totalAmount || 0);
    penaltyAmount = clamp(base * config.penalty.percentage / 100, config.penalty.minAmount, config.penalty.maxAmount);

    if (penaltyAmount > 0) {
      if (rule.responsibility === 'client') {
        clientShare = penaltyAmount;
      } else if (rule.responsibility === 'driver') {
        driverShare = penaltyAmount;
      } else if (rule.responsibility === 'shared') {
        if (config.penalty.clientSharePercent == null) {
          throw new CancellationConfigurationError(
            'Responsabilité partagée sans règle de répartition : renseigner cancellation.penalty.clientSharePercent.'
          );
        }
        clientShare = round(penaltyAmount * config.penalty.clientSharePercent / 100);
        driverShare = penaltyAmount - clientShare;
      }
    }
  }

  // --- Frais ---
  let technicalFee = 0;
  if (paidAmount > 0) {
    technicalFee = round(config.fee.technicalFixed + paidAmount * config.fee.technicalPercentage / 100);
  }

  // --- Remboursement (uniquement la part plateforme payée) ---
  let paydunyaFee = 0;
  let refundAmount = 0;
  let refundStatus = 'none';
  if (paidAmount > 0) {
    const gross = paidAmount - clientShare - technicalFee;
    paydunyaFee = round(Math.max(0, gross) * config.fee.paydunyaPercentage / 100);
    refundAmount = Math.max(0, gross - paydunyaFee);
    refundStatus = refundAmount > 0 ? 'pending' : 'none';
  }

  const fees = paydunyaFee + technicalFee;

  // --- Dette de pénalité client ---
  // La pénalité client est prélevée en priorité sur le montant remboursable
  // (`paidAmount`, paiements plateforme non-cash). Le reliquat non couvert
  // (espèces, colis non payé, remboursement insuffisant ou nul) devient une
  // dette de pénalité client persistante (`ClientPenaltyDebt`), réglée ensuite
  // directement via PayDunya — jamais ignorée, jamais prélevée sur un wallet.
  const clientDebt = clientShare > 0 ? Math.max(0, clientShare - paidAmount) : 0;

  // --- Impact chauffeur : wallet → points → dette ---
  let walletBefore = 0;
  let walletDeduction = 0;
  let walletAfter = 0;
  let pointsBefore = 0;
  let pointsDeduction = 0;
  let pointsAfter = 0;
  let debtBefore = 0;
  let debtCreated = 0;
  let debtAfter = 0;

  const driverId = parcel.assignedDriverId;
  if (driverShare > 0 && driverId) {
    const cfaPerPoint = await getCfaPerPoint(tx);
    // Lecture seule : le devis ne crée jamais de ligne wallet/score.
    const wallet = await tx.wallet.findUnique({ where: { userId: driverId } });
    const score = await tx.score.findUnique({ where: { userId: driverId } });

    walletBefore = round(wallet?.balance ?? 0);
    pointsBefore = Number(score?.points ?? 0);
    debtBefore = round(wallet?.commissionDebt ?? 0);

    walletDeduction = Math.min(walletBefore, driverShare);
    const rest = driverShare - walletDeduction;
    if (rest > 0) {
      const pointsNeeded = Math.ceil(rest / cfaPerPoint);
      pointsDeduction = Math.min(pointsBefore, pointsNeeded);
    }
    const covered = walletDeduction + pointsDeduction * cfaPerPoint;
    debtCreated = Math.max(0, driverShare - round(covered));

    walletAfter = walletBefore - walletDeduction;
    pointsAfter = pointsBefore - pointsDeduction;
    debtAfter = debtBefore + debtCreated;
  }

  return {
    allowed: true,
    exempt: rule.exempt,
    penalized: !rule.exempt && penaltyAmount > 0,
    responsibility: rule.responsibility,
    reason: rule.reason,
    reasonLabel: rule.label,

    paidAmount,
    penaltyAmount,
    penaltyLabel: rule.exempt ? null : `Pénalité d'annulation (${rule.responsibility})`,
    clientShare,
    driverShare,

    paydunyaFee,
    technicalFee,
    fees,
    refundAmount,
    refundStatus,
    refundMethod: parcel.paymentMethod || null,
    refundPhone: parcel.paymentPhoneNumber || parcel.senderPhone || null,

    clientDebt,
    clientDebtReference: clientDebt > 0 ? `PD-${parcel.trackingNumber}` : null,
    // UUID de la ligne `ClientPenaltyDebt`. Absent au stade du devis : la dette
    // n'est créée qu'à l'application (`applyCancellation`), qui renseigne ce
    // champ à partir de l'enregistrement réellement persisté.
    clientDebtId: null,

    wallet: { before: walletBefore, deduction: walletDeduction, after: walletAfter },
    points: { before: pointsBefore, deduction: pointsDeduction, after: pointsAfter },
    debt: { before: debtBefore, created: debtCreated, after: debtAfter },

    driverId,
    config
  };
}

/**
 * Applique les conséquences d'une annulation déjà calculée, de façon atomique.
 * Le colis doit être re-verrouillé par l'appelant via la garde de statut ; cette
 * fonction ne relit pas le statut et présuppose que `computeCancellation` a été
 * appelé sur la même transaction.
 */
export async function applyCancellation({ tx, req, parcel, outcome, include }) {
  // Garde atomique contre l'annulation concurrente (double clic, rejeu réseau) :
  // la transition de statut est conditionnelle ; une seconde tentative ne
  // matchera aucune ligne et sera rejetée sans aucune écriture financière.
  const guard = await tx.parcel.updateMany({
    where: { id: parcel.id, status: { notIn: ['cancelled', 'delivered'] } },
    data: { status: 'cancelled' }
  });
  if (guard.count === 0) throw new ParcelAlreadyCancelledError();

  // 1. Prélèvement chauffeur : wallet → points → dette (source de vérité serveur).
  if (outcome.driverId && outcome.driverShare > 0) {
    // Garantit l'existence des lignes avant les écritures atomiques.
    await tx.wallet.upsert({ where: { userId: outcome.driverId }, update: {}, create: { userId: outcome.driverId } });
    await tx.score.upsert({ where: { userId: outcome.driverId }, update: {}, create: { userId: outcome.driverId } });

    if (outcome.wallet.deduction > 0) {
      await tx.wallet.update({
        where: { userId: outcome.driverId },
        data: {
          balance: { decrement: outcome.wallet.deduction },
          totalSpent: { increment: outcome.wallet.deduction },
          lastActivityAt: new Date()
        }
      });
      await tx.walletTransaction.create({
        data: {
          walletUserId: outcome.driverId,
          type: 'penalty',
          amount: outcome.wallet.deduction,
          balanceBefore: outcome.wallet.before,
          balanceAfter: outcome.wallet.after,
          parcelId: parcel.id,
          description: `Pénalité annulation ${parcel.trackingNumber} (${outcome.wallet.deduction} FCFA)`,
          origin: 'cancellation_penalty',
          status: 'completed'
        }
      });
    }

    if (outcome.points.deduction > 0) {
      await tx.score.update({
        where: { userId: outcome.driverId },
        data: {
          points: { decrement: outcome.points.deduction },
          totalSpent: { increment: outcome.points.deduction },
          lastUpdated: new Date()
        }
      });
      await tx.scoreTransaction.create({
        data: {
          userId: outcome.driverId,
          amount: -outcome.points.deduction,
          type: 'cancellation_penalty',
          source: 'system',
          parcelId: parcel.id,
          description: `Pénalité annulation ${parcel.trackingNumber} (${outcome.points.deduction} pts)`,
          metadata: { penalty: outcome.driverShare, pointsDeducted: outcome.points.deduction }
        }
      });
    }

    if (outcome.debt.created > 0) {
      await tx.wallet.update({
        where: { userId: outcome.driverId },
        data: {
          commissionDebt: { increment: outcome.debt.created },
          lastActivityAt: new Date()
        }
      });
      await tx.scoreTransaction.create({
        data: {
          userId: outcome.driverId,
          amount: 0,
          type: 'cancellation_debt',
          source: 'system',
          parcelId: parcel.id,
          description: `Pénalité annulation impayée ${parcel.trackingNumber} (${outcome.debt.created} FCFA)`,
          metadata: { penalty: outcome.driverShare, debt: outcome.debt.created }
        }
      });
    }
  }

  // 1bis. Dette de pénalité client (persistée, réglée ensuite via PayDunya).
  //        Un colis = une annulation = une seule dette : la garde de statut
  //        ci-dessus empêche toute création en double.
  if (outcome.clientDebt > 0 && parcel.senderId) {
    const created = await tx.clientPenaltyDebt.create({
      data: {
        userId: parcel.senderId,
        parcelId: parcel.id,
        amount: outcome.clientDebt,
        remaining: outcome.clientDebt,
        status: 'pending',
        reference: outcome.clientDebtReference,
        reason: outcome.reason || null,
        metadata: {
          penalty: outcome.penaltyAmount,
          clientShare: outcome.clientShare,
          responsibility: outcome.responsibility
        }
      }
    });
    // Expose l'identifiant réellement persisté (UUID de `ClientPenaltyDebt`) au
    // contrat mobile, afin que le client puisse régler sa dette via PayDunya.
    // Jamais un identifiant d'un autre objet : c'est bien l'`id` de la ligne créée.
    outcome.clientDebtId = created.id;
  }

  // 2. Statut du colis + instantané immuable de la décision.
  const snapshot = cancellationSnapshot(outcome);
  const updated = await tx.parcel.update({
    where: { id: parcel.id },
    data: {
      status: 'cancelled',
      cancelledBy: req.user.id,
      cancellationReason: outcome.reason || 'Annulation',
      cancelledAt: new Date(),
      cancellationData: snapshot
    },
    include: include || { assignedDriver: true }
  });

  // 3. Le chauffeur voit sa mission annulée.
  if (outcome.driverId && parcel.status !== 'cancelled') {
    await tx.user.update({
      where: { id: outcome.driverId },
      data: { cancelledDeliveries: { increment: 1 }, totalDeliveries: { increment: 1 } }
    });
  }

  // 4. Événement + audit.
  const event = await tx.parcelEvent.create({
    data: {
      parcelId: parcel.id,
      status: 'cancelled',
      description: `Colis annulé — ${outcome.reasonLabel || 'Annulation'}`,
      userId: req.user.id,
      userName: req.user.fullName,
      userRole: req.user.role,
      metadata: { reason: outcome.reason, snapshot }
    }
  });

  return { parcel: updated, event, snapshot };
}

/**
 * Instantané persisté dans `parcel.cancellation_data` : contient la décision
 * financière complète pour l'audit et la ré-exposition sans recalcul.
 */
export function cancellationSnapshot(outcome) {
  return {
    allowed: outcome.allowed,
    penalized: outcome.penalized,
    exempt: outcome.exempt,
    responsibility: outcome.responsibility,
    reason: outcome.reason,
    reasonLabel: outcome.reasonLabel,
    paidAmount: outcome.paidAmount,
    penalty: outcome.penaltyAmount,
    penaltyLabel: outcome.penaltyLabel,
    clientShare: outcome.clientShare,
    driverShare: outcome.driverShare,
    clientDebt: outcome.clientDebt,
    clientDebtReference: outcome.clientDebtReference,
    clientDebtId: outcome.clientDebtId,
    paydunyaFee: outcome.paydunyaFee,
    technicalFee: outcome.technicalFee,
    fees: outcome.fees,
    refundAmount: outcome.refundAmount,
    refundStatus: outcome.refundStatus,
    refundMethod: outcome.refundMethod,
    refundPhone: outcome.refundPhone,
    wallet: outcome.wallet,
    points: outcome.points,
    debt: outcome.debt,
    driverId: outcome.driverId,
    createdAt: new Date().toISOString()
  };
}

// ============================================================
// REMBOURSEMENT PayDunya — réutilise l'API PUSH existante (paydunya-disburse).
// ============================================================

/**
 * Tente le remboursement d'une annulation déjà persistée (statut `pending`).
 * Réutilise le flux de déboursement existant (get-invoice → submit-invoice).
 * Idempotent : relit l'instantané persisté, ne re-soumet jamais un remboursement
 * déjà `completed`/`failed`/`processing`. Aucune réussite n'est simulée.
 *
 * Retourne l'instantané à jour (`cancellation_data`).
 */
export async function executeCancellationRefund({ parcelId, log, disburse }) {
  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });
  const snapshot = parcel?.cancellationData;
  if (!snapshot || snapshot.refundStatus !== 'pending') return snapshot ?? null;
  if (!snapshot.refundAmount || Number(snapshot.refundAmount) <= 0) return snapshot;

  const pd = disburse || (await import('./paydunya-disburse.js'));
  const { isPaydunyaConfigured, getInvoice, submitInvoice, checkStatus, toAccountAlias, withdrawModeFor } = pd;

  // PayDunya absent ou méthode non déboursable (carte, etc.) : le remboursement
  // reste `pending` pour un traitement manuel — on ne simule rien.
  if (!isPaydunyaConfigured()) return snapshot;

  const method = String(snapshot.refundMethod || '').replace('freemMoney', 'freeMoney');
  const mode = withdrawModeFor(method);
  const phone = snapshot.refundPhone;
  if (!mode || !phone) return snapshot;

  const reference = `RFN-${parcel.trackingNumber || parcelId}-${Date.now()}`;
  const accountAlias = method === 'paydunya' ? phone : toAccountAlias(phone);

  try {
    const invoice = await getInvoice({
      accountAlias,
      amount: Number(snapshot.refundAmount),
      withdrawMode: mode,
      callbackUrl: null
    });
    if (!invoice.ok) {
      log?.warn?.({ parcelId, error: invoice.error }, 'Cancellation refund get-invoice failed');
      return markRefundStatus(parcelId, snapshot, 'failed', { reference, error: invoice.error.message });
    }

    const submitted = await submitInvoice({ disburseToken: invoice.disburseToken, disburseId: reference });
    if (submitted.ok && submitted.status === 'success') {
      return markRefundStatus(parcelId, snapshot, 'completed', {
        reference,
        transactionId: submitted.transactionId ?? null,
        providerRef: submitted.providerRef ?? null
      });
    }
    if (submitted.ok && submitted.status === 'pending') {
      return markRefundStatus(parcelId, snapshot, 'pending', { reference, transactionId: submitted.transactionId ?? null });
    }
    // Code ≠ 00 : on vérifie le statut réel avant de conclure (règle officielle).
    const verified = submitted.ok ? null : await checkStatus(invoice.disburseToken);
    if (verified?.ok && verified.status === 'success') {
      return markRefundStatus(parcelId, snapshot, 'completed', { reference, transactionId: verified.transactionId ?? null });
    }
    if (verified?.ok && ['pending', 'created'].includes(verified.status)) {
      return markRefundStatus(parcelId, snapshot, 'pending', { reference });
    }
    return markRefundStatus(parcelId, snapshot, 'failed', {
      reference,
      error: submitted.error?.message ?? verified?.error ?? 'Remboursement refusé par l’opérateur'
    });
  } catch (err) {
    log?.error?.({ parcelId, err }, 'Cancellation refund failed unexpectedly');
    return markRefundStatus(parcelId, snapshot, 'failed', { reference, error: 'Erreur interne du remboursement' });
  }
}

async function markRefundStatus(parcelId, snapshot, status, extra = {}) {
  const next = {
    ...snapshot,
    refundStatus: status,
    refundReference: extra.reference ?? snapshot.refundReference,
    refundTransactionId: extra.transactionId ?? snapshot.refundTransactionId ?? null,
    refundError: extra.error ?? null
  };

  await prisma.parcel.update({
    where: { id: parcelId },
    data: { cancellationData: next }
  });

  // Le paiement plateforme d'origine est marqué remboursé une fois terminé.
  if (status === 'completed') {
    await prisma.payment.updateMany({
      where: { parcelId, status: 'completed', method: { not: 'cash' } },
      data: { status: 'refunded' }
    });
  }

  return next;
}

// ============================================================
// SÉRIALISATION — deux contrats à partir de la même source de vérité.
// ============================================================

/**
 * Contrat web (champs plats) tel que consommé par `normalizeOutcome`.
 * - `redactDriverFinancials` (vue client) masque les soldes privés du chauffeur.
 * - `redactClientFinancials` (vue chauffeur) masque les montants privés du client.
 */
export function serializeCancellationWeb(outcome, { redactDriverFinancials = false, redactClientFinancials = false } = {}) {
  const driver = outcome.driverId
    ? {
        penalty: outcome.driverShare,
        fees: 0,
        refund: 0,
        walletDeduction: outcome.wallet.deduction,
        walletBefore: redactDriverFinancials ? null : outcome.wallet.before,
        walletAfter: redactDriverFinancials ? null : outcome.wallet.after,
        pointsDeduction: outcome.points.deduction,
        pointsBefore: redactDriverFinancials ? null : outcome.points.before,
        pointsAfter: redactDriverFinancials ? null : outcome.points.after,
        debtAmount: outcome.debt.created,
        debtBefore: redactDriverFinancials ? null : outcome.debt.before,
        debtAfter: redactDriverFinancials ? null : outcome.debt.after
      }
    : null;

  return {
    allowed: outcome.allowed,
    penalized: outcome.penalized,
    exempt: outcome.exempt,
    responsibility: outcome.responsibility,
    paidAmount: redactClientFinancials ? null : outcome.paidAmount,
    fees: outcome.fees,
    paydunyaFee: outcome.paydunyaFee,
    technicalFee: outcome.technicalFee,
    penalty: outcome.penaltyAmount,
    refund: redactClientFinancials ? null : outcome.refundAmount,
    refundStatus: redactClientFinancials ? null : outcome.refundStatus,
    client: redactClientFinancials
      ? null
      : {
          penalty: outcome.clientShare,
          fees: outcome.fees,
          refund: outcome.refundAmount,
          debt: outcome.clientDebt,
          debtReference: outcome.clientDebtReference
        },
    driver
  };
}

/**
 * Contrat mobile (objet imbriqué `cancellation`) tel que décrit dans le
 * contrat de structure : `responsibleParty`, `penalty.amount`, `refund.initialAmount`,
 * `wallet/points/debt` avec instantanés avant/prélèvement/après.
 *
 * `snapshotToCancellation` reconstruit ce même contrat depuis l'instantané
 * persisté dans `parcel.cancellation_data`, sans recalcul ni accès à la base.
 */
export function snapshotToCancellation(snapshot, { redactDriverFinancials = false, redactClientFinancials = false } = {}) {
  if (!snapshot) return null;
  return serializeCancellationMobile(
    {
      allowed: snapshot.allowed,
      penalized: snapshot.penalized,
      exempt: snapshot.exempt,
      responsibility: snapshot.responsibility,
      paidAmount: snapshot.paidAmount,
      penaltyAmount: snapshot.penalty,
      penaltyLabel: snapshot.penaltyLabel,
      clientShare: snapshot.clientShare,
      driverShare: snapshot.driverShare,
      clientDebt: snapshot.clientDebt,
      clientDebtReference: snapshot.clientDebtReference,
      clientDebtId: snapshot.clientDebtId,
      paydunyaFee: snapshot.paydunyaFee,
      technicalFee: snapshot.technicalFee,
      fees: snapshot.fees,
      refundAmount: snapshot.refundAmount,
      refundStatus: snapshot.refundStatus,
      wallet: snapshot.wallet,
      points: snapshot.points,
      debt: snapshot.debt,
      driverId: snapshot.driverId
    },
    { redactDriverFinancials, redactClientFinancials }
  );
}

export function serializeCancellationMobile(outcome, { redactDriverFinancials = false, redactClientFinancials = false } = {}) {
  return {
    allowed: outcome.allowed,
    penalized: outcome.penalized,
    responsibleParty: outcome.responsibility,
    penalty: {
      amount: outcome.penaltyAmount,
      currency: 'XOF',
      label: outcome.penaltyLabel,
      applied: outcome.penalized,
      clientShare: redactClientFinancials ? null : outcome.clientShare,
      driverShare: outcome.driverShare
    },
    refund: redactClientFinancials
      ? null
      : {
          initialAmount: outcome.paidAmount,
          fees: outcome.fees,
          paydunyaFee: outcome.paydunyaFee,
          penaltyAmount: outcome.clientShare,
          refundedAmount: outcome.refundAmount,
          status: outcome.refundStatus
        },
    clientDebt: redactClientFinancials
      ? null
      : {
          id: outcome.clientDebtId ?? null,
          amount: outcome.clientDebt,
          reference: outcome.clientDebtReference
        },
    wallet: {
      before: redactDriverFinancials ? null : outcome.wallet.before,
      deduction: outcome.wallet.deduction,
      after: redactDriverFinancials ? null : outcome.wallet.after
    },
    points: {
      before: redactDriverFinancials ? null : outcome.points.before,
      deduction: outcome.points.deduction,
      after: redactDriverFinancials ? null : outcome.points.after
    },
    debt: {
      before: redactDriverFinancials ? null : outcome.debt.before,
      created: outcome.debt.created,
      after: redactDriverFinancials ? null : outcome.debt.after
    }
  };
}
