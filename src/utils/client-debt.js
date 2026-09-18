import { getConfigValue } from './commission.js';
import { CancellationDebtLimitExceededError } from './errors.js';

/**
 * Dette de pénalité d'annulation côté CLIENT (modèle `ClientPenaltyDebt`).
 *
 * Le client SendProColis n'a pas de wallet préfinancé : la pénalité d'annulation
 * non couverte par un remboursement devient une dette persistante, réglée
 * directement via PayDunya (type `penalty_debt`), sans wallet ni commission.
 *
 * Séparation stricte avec la dette de commission chauffeur (`Wallet.commissionDebt`).
 */

/// Seuil de dette client au-delà duquel la création de colis peut être bloquée.
/// `0` (défaut) = aucune restriction. Une valeur positive borne le total de
/// pénalités impayées ; le backend l'applique au moment de créer un colis.
export async function getClientDebtLimit(tx) {
  const value = await getConfigValue(tx, 'cancellation.clientDebtLimit', 0);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/// Total des pénalités d'annulation impayées d'un client (FCFA).
/// Prend en compte toutes les dettes dont le reliquat est > 0, qu'elles soient
/// `pending` (aucun paiement) ou `partially_paid` (paiement partiel reçu).
export async function getClientPenaltyDebtTotal(tx, userId) {
  const agg = await tx.clientPenaltyDebt.aggregate({
    where: { userId, remaining: { gt: 0 } },
    _sum: { remaining: true }
  });
  return Number(agg._sum.remaining ?? 0);
}

export function isClientDebtLimitReached(totalDebt, debtLimit) {
  const total = Number(totalDebt || 0);
  const limit = Number(debtLimit || 0);
  return limit > 0 && total >= limit;
}

/// Lève une erreur métier si le client a atteint le seuil configuré de dette de
/// pénalité. Aucun blocage arbitraire : `cancellation.clientDebtLimit` = 0 (défaut)
/// n'impose aucune restriction. Le blocage n'intervient que si le seuil est > 0
/// et que la dette impayée atteint ce seuil.
export async function assertClientCanCreateParcel(tx, userId) {
  const limit = await getClientDebtLimit(tx);
  if (limit <= 0) return;

  // Les lignes payables sont jointes à l'erreur métier : le mobile peut
  // proposer immédiatement le règlement sans inventer un identifiant de dette.
  const debts = await tx.clientPenaltyDebt.findMany({
    where: { userId, remaining: { gt: 0 } },
    select: {
      id: true,
      parcelId: true,
      amount: true,
      remaining: true,
      status: true,
      reference: true
    },
    orderBy: { createdAt: 'asc' }
  });
  const total = debts.reduce((sum, debt) => sum + Number(debt.remaining ?? 0), 0);
  if (isClientDebtLimitReached(total, limit)) {
    throw new CancellationDebtLimitExceededError(
      total,
      limit,
      debts.map((debt) => ({
        ...debt,
        amount: Number(debt.amount),
        remaining: Number(debt.remaining)
      }))
    );
  }
  return total;
}
