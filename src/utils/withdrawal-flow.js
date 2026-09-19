import { prisma } from '../config/prisma.js';
import {
  checkStatus,
  getInvoice,
  isPaydunyaConfigured,
  submitInvoice,
  toAccountAlias,
  withdrawModeFor
} from './paydunya-disburse.js';
import { env } from '../config/env.js';

/**
 * Orchestration du déboursement PayDunya d'un retrait chauffeur.
 * S'appuie sur le flux officiel API PUSH : get-invoice → submit-invoice
 * → statut final via callback signé ou check-status.
 *
 * Statuts internes (enum WithdrawalStatus) : pending → processing → completed/failed/cancelled.
 * Les fronts (web + Flutter) attendent des statuts MAJUSCULES avec SUCCESS —
 * conversion via toClientWithdrawalStatus / fromClientWithdrawalStatus.
 */

const CLIENT_STATUS = {
  pending: 'PENDING',
  processing: 'PROCESSING',
  completed: 'SUCCESS',
  failed: 'FAILED',
  cancelled: 'CANCELLED'
};

const INTERNAL_STATUS = Object.fromEntries(Object.entries(CLIENT_STATUS).map(([k, v]) => [v, k]));

export function toClientWithdrawalStatus(status) {
  return CLIENT_STATUS[status] ?? String(status ?? '').toUpperCase();
}

export function fromClientWithdrawalStatus(status) {
  if (!status) return undefined;
  return INTERNAL_STATUS[String(status).toUpperCase()] ?? String(status).toLowerCase();
}

/** Méthodes que l'API PUSH sait débourser automatiquement (bank = manuel). */
export function isAutoDisbursable(method) {
  return Boolean(withdrawModeFor(String(method ?? '').replace('freemMoney', 'freeMoney')));
}

export { isPaydunyaConfigured };

async function notify(userId, type, title, body, data = {}) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, data, priority: 'high' } });
  } catch {
    // Une notification manquée ne doit jamais casser un flux financier.
  }
}

/**
 * Crée la transaction financière unique d'un retrait au moment où le solde est
 * réellement gelé. `balanceBefore`/`balanceAfter` reflètent le débit effectif du
 * wallet : le retrait ne produira ensuite qu'une seule transaction, dont seul le
 * statut évoluera.
 */
export async function createWithdrawalTransaction(tx, withdrawal, { balanceBefore, balanceAfter }) {
  return tx.walletTransaction.create({
    data: {
      walletUserId: withdrawal.walletUserId,
      withdrawalId: withdrawal.id,
      type: 'withdrawal',
      amount: Number(withdrawal.amount),
      balanceBefore,
      balanceAfter,
      description: `Retrait ${withdrawal.method} — ${withdrawal.reference}`,
      origin: 'withdrawal',
      status: 'pending'
    }
  });
}

/**
 * Met à jour le statut de la transaction de retrait unique (`type: withdrawal`)
 * associée à un retrait, ou la crée si elle n'existe pas encore (retrait
 * antérieur à ce correctif). Un retrait métier ne génère ainsi jamais deux
 * transactions de type `withdrawal` : seule la ligne existante évolue.
 */
export async function setWithdrawalTransactionStatus(tx, withdrawal, status, extra = {}) {
  const existing = await tx.walletTransaction.findFirst({
    where: { withdrawalId: withdrawal.id, type: 'withdrawal' }
  });
  if (existing) {
    return tx.walletTransaction.update({ where: { id: existing.id }, data: { status, ...extra } });
  }
  return tx.walletTransaction.create({
    data: {
      walletUserId: withdrawal.walletUserId,
      withdrawalId: withdrawal.id,
      type: 'withdrawal',
      amount: Number(withdrawal.amount),
      balanceBefore: extra.balanceBefore ?? 0,
      balanceAfter: extra.balanceAfter ?? 0,
      description: `Retrait ${withdrawal.method} — ${withdrawal.reference}`,
      origin: 'withdrawal',
      status
    }
  });
}

/** Succès : le montant gelé est consommé, totaux mis à jour, chauffeur notifié. */
export async function finalizeWithdrawalSuccess(withdrawalId, { transactionId = null, providerRef = null } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal || ['completed', 'failed', 'cancelled'].includes(withdrawal.status)) return withdrawal;
    const amount = Number(withdrawal.amount);
    await tx.wallet.update({
      where: { userId: withdrawal.walletUserId },
      data: {
        pendingBalance: { decrement: amount },
        totalSpent: { increment: amount },
        totalWithdrawn: { increment: amount },
        lastActivityAt: new Date()
      }
    });
    await setWithdrawalTransactionStatus(tx, withdrawal, 'completed');
    return tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        transactionId: transactionId ?? withdrawal.transactionId,
        providerRef: providerRef ?? withdrawal.providerRef
      }
    });
  });
  if (result?.status === 'completed') {
    await notify(
      result.walletUserId,
      'withdrawal_completed',
      'Retrait effectué',
      `Votre retrait de ${Number(result.amount)} FCFA a été envoyé sur votre compte ${result.method}.`,
      { withdrawalId: result.id, reference: result.reference }
    );
  }
  return result;
}

/** Échec : le montant gelé est recrédité sur le solde, chauffeur notifié. */
export async function failWithdrawal(withdrawalId, reason) {
  const result = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal || ['completed', 'failed', 'cancelled'].includes(withdrawal.status)) return withdrawal;
    const amount = Number(withdrawal.amount);
    const wallet = await tx.wallet.update({
      where: { userId: withdrawal.walletUserId },
      data: {
        balance: { increment: amount },
        pendingBalance: { decrement: amount },
        lastActivityAt: new Date()
      }
    });
    await setWithdrawalTransactionStatus(tx, withdrawal, 'failed');
    await tx.walletTransaction.create({
      data: {
        walletUserId: withdrawal.walletUserId,
        type: 'refund',
        amount,
        balanceBefore: Number(wallet.balance) - amount,
        balanceAfter: Number(wallet.balance),
        description: `Retrait ${withdrawal.reference} échoué — ${reason ?? 'erreur du prestataire'}`,
        origin: 'withdrawal',
        status: 'completed'
      }
    });
    return tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'failed', failureReason: reason ?? null }
    });
  });
  if (result?.status === 'failed') {
    await notify(
      result.walletUserId,
      'withdrawal_failed',
      'Retrait échoué',
      `Votre retrait de ${Number(result.amount)} FCFA a échoué : ${reason ?? 'erreur du prestataire'}. Le montant a été recrédité sur votre solde.`,
      { withdrawalId: result.id, reference: result.reference }
    );
  }
  return result;
}

/**
 * Tente le déboursement PayDunya d'un retrait `pending`/`processing`.
 * Retourne le retrait à jour (completed / processing / failed), ou null si
 * PayDunya n'est pas configuré ou la méthode non supportée (flux manuel).
 */
export async function attemptDisbursement(withdrawalId, log) {
  if (!isPaydunyaConfigured()) return null;
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal || !['pending', 'processing'].includes(withdrawal.status)) return withdrawal;

  const method = String(withdrawal.method).replace('freemMoney', 'freeMoney');
  const mode = withdrawModeFor(method);
  if (!mode) return null;

  // Après une soumission incertaine, seule une vérification permet de décider
  // de resoumettre. Une erreur réseau de check-status laisse les fonds gelés.
  const verifyStatus = async (token) => {
    try {
      const result = await checkStatus(token);
      if (!result.ok) log?.warn?.({ withdrawalId, error: result.error }, 'PayDunya check-status unconfirmed');
      return result;
    } catch {
      // Ne pas journaliser l'exception HTTP brute, susceptible de contenir le token.
      log?.error?.({ withdrawalId }, 'PayDunya check-status unavailable; withdrawal remains processing');
      return { ok: false };
    }
  };

  let processing = withdrawal;
  if (withdrawal.disburseToken) {
    const verified = await verifyStatus(withdrawal.disburseToken);
    if (verified.ok && verified.status === 'success') {
      return finalizeWithdrawalSuccess(withdrawal.id, { transactionId: verified.transactionId, providerRef: verified.providerRef });
    }
    if (verified.ok && verified.status === 'failed') {
      return failWithdrawal(withdrawal.id, 'Transaction refusée par l’opérateur');
    }
    if (!verified.ok || verified.status !== 'created') return withdrawal;
    // API PUSH, section 4 : CREATED exige un Submit avec le MÊME token.
  } else {
    const callbackUrl = `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/api/v1/payments/paydunya/disburse-callback`;
    const invoice = await getInvoice({
      accountAlias: method === 'paydunya' ? withdrawal.phone : toAccountAlias(withdrawal.phone),
      amount: Number(withdrawal.amount),
      withdrawMode: mode,
      callbackUrl
    });
    if (!invoice.ok) {
      log?.warn?.({ withdrawalId, error: invoice.error }, 'PayDunya get-invoice failed');
      // Aucun Submit n'a eu lieu : le refus de création permet de libérer les fonds.
      return failWithdrawal(withdrawal.id, invoice.error.message);
    }

    processing = await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'processing', disburseToken: invoice.disburseToken, processedAt: new Date() }
    });
  }

  // Une reprise immédiate au maximum par appel, et seulement après CREATED
  // confirmé. Cette limite locale évite une boucle sans fin chez le prestataire.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let submitted;
    try {
      submitted = await submitInvoice({ disburseToken: processing.disburseToken, disburseId: withdrawal.reference ?? withdrawal.id });
    } catch {
      log?.error?.({ withdrawalId }, 'PayDunya submit-invoice unavailable; checking transaction status');
      submitted = { ok: false };
    }
    if (submitted.ok) {
      if (submitted.status === 'success') {
        return finalizeWithdrawalSuccess(withdrawal.id, { transactionId: submitted.transactionId, providerRef: submitted.providerRef });
      }
      if (submitted.status === 'failed') {
        return failWithdrawal(withdrawal.id, 'Transaction refusée par l’opérateur');
      }
      return processing;
    }

    // API PUSH, section 4 : un code != 00 n'est pas une preuve d'échec du
    // transfert. Ne jamais recréditer sur un timeout ou un statut inconnu.
    const verified = await verifyStatus(processing.disburseToken);
    if (verified.ok && verified.status === 'success') {
      return finalizeWithdrawalSuccess(withdrawal.id, { transactionId: verified.transactionId, providerRef: verified.providerRef });
    }
    if (verified.ok && verified.status === 'failed') {
      return failWithdrawal(withdrawal.id, submitted.error?.message ?? 'Transaction refusée par l’opérateur');
    }
    if (!verified.ok || verified.status !== 'created') return processing;
  }
  return processing;
}
