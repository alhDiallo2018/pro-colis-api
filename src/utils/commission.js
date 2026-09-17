import { prisma } from '../config/prisma.js';
import { CommissionDebtRequiredError, DebtLimitExceededError } from './errors.js';

export async function calculateCommission(price, profile = 'local') {
  if (!price || price <= 0) return 0;

  const configs = await prisma.commissionConfig.findMany({ where: { isActive: true } });
  const cfg = configs.find((c) => c.profile === profile) || configs[0];

  if (!cfg) return 0;

  const pct = Number(cfg.percentage);
  const min = Number(cfg.minAmount);
  const max = Number(cfg.maxAmount);

  return Math.max(min, Math.min(Math.round((pct * price) / 100), max));
}

export function calculateCommissionSync(price, percentage = 5, minAmount = 100, maxAmount = 500) {
  if (!price || price <= 0) return 0;
  return Math.max(minAmount, Math.min(Math.round((percentage * price) / 100), maxAmount));
}

export async function getCfaPerPoint(tx) {
  const value = await getConfigValue(tx, 'score.cfaPerPoint', 1);
  const rate = Number(value);
  return rate > 0 ? rate : 1;
}

export async function getDeliveryPoints(tx) {
  // La valeur provient exclusivement de la configuration (`score.deliveryCompleted`).
  // Aucune valeur par défaut codée en dur : une config absente ou à 0
  // n'attribue aucun point.
  const value = await getConfigValue(tx, 'score.deliveryCompleted', 0);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export async function getCommitmentFee(tx) {
  const value = await getConfigValue(tx, 'score.commitmentFee', 0);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/// Montant maximal de commission impayée qu'un chauffeur peut accumuler (FCFA).
/// `0` signifie « aucune limite » : la dette est autorisée sans plafond afin
/// qu'une livraison déjà acceptée puisse toujours être terminée. Une valeur
/// positive borne la dette (`commissionDebt`) ; la limite est appliquée par le
/// backend au moment de la création de la dette.
export async function getDebtLimit(tx) {
  const value = await getConfigValue(tx, 'commission.debtLimit', 0);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/// Dette de commission actuelle d'un chauffeur (FCFA). `0` si aucun wallet.
export async function getCommissionDebt(tx, userId) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  return Number(wallet?.commissionDebt ?? 0);
}

/// Lève une erreur métier si le chauffeur possède une dette de commission
/// impayée : il ne peut pas accepter un nouveau colis tant qu'elle subsiste.
export async function assertCanAcceptNewDelivery(tx, userId) {
  const debt = await getCommissionDebt(tx, userId);
  if (debt > 0) throw new CommissionDebtRequiredError(debt);
  return debt;
}

/// État dérivé (aucun statut en base) : un chauffeur sans dette peut accepter
/// de nouvelles livraisons.
export function canAcceptNewDeliveries(debt) {
  return Number(debt || 0) <= 0;
}

/// Rembourse prioritairement la dette de commission à partir de nouveaux points
/// crédités au chauffeur. `points` est le nombre de points entrants ; le reliquat
/// réellement crédité est réduit de la part convertie en FCFA affectée au
/// règlement (`cfaPerPoint`).
export async function repayDebtFromPoints(tx, { userId, points, cfaPerPoint }) {
  const debt = await getCommissionDebt(tx, userId);
  if (debt <= 0 || points <= 0) return { netPoints: points, debtRepaid: 0, pointsForDebt: 0 };

  const valueFCFA = points * cfaPerPoint;
  const debtRepaid = Math.min(debt, valueFCFA);
  const pointsForDebt = Math.ceil(debtRepaid / cfaPerPoint);
  const netPoints = points - pointsForDebt;

  if (debtRepaid > 0) {
    await tx.wallet.update({
      where: { userId },
      data: { commissionDebt: { decrement: debtRepaid }, lastActivityAt: new Date() }
    });
    await tx.scoreTransaction.create({
      data: {
        userId,
        amount: -pointsForDebt,
        type: 'commission_debt_repayment',
        source: 'system',
        description: `Règlement dette de commission (${debtRepaid} FCFA via ${pointsForDebt} pts)`,
        metadata: { debtRepaid, pointsForDebt, cfaPerPoint }
      }
    });
  }

  return { netPoints, debtRepaid, pointsForDebt };
}

/// Rembourse prioritairement la dette de commission à partir d'un crédit wallet
/// entrant (`amount` FCFA). L'appelant crédite d'abord l'intégralité du montant
/// sur le solde ; cette fonction débite ensuite réellement le wallet du montant
/// remboursé (borné par la dette et le solde disponible), met à jour les agrégats
/// financiers et trace une transaction cohérente
/// (`balanceAfter = balanceBefore - montant débité`).
export async function repayDebtFromWallet(tx, { userId, amount }) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  const debt = Number(wallet?.commissionDebt ?? 0);
  const balance = Number(wallet?.balance ?? 0);
  if (debt <= 0 || amount <= 0) return { netAmount: amount, debtRepaid: 0 };

  const debtRepaid = Math.min(debt, amount, balance);
  const netAmount = amount - debtRepaid;

  if (debtRepaid > 0) {
    const balanceAfter = balance - debtRepaid;
    await tx.wallet.update({
      where: { userId },
      data: {
        balance: { decrement: debtRepaid },
        commissionDebt: { decrement: debtRepaid },
        totalSpent: { increment: debtRepaid },
        totalCommissionsPaid: { increment: debtRepaid },
        lastActivityAt: new Date()
      }
    });
    await tx.walletTransaction.create({
      data: {
        walletUserId: userId,
        type: 'commission',
        amount: debtRepaid,
        balanceBefore: balance,
        balanceAfter,
        description: `Règlement dette de commission (${debtRepaid} FCFA)`,
        origin: 'debt_repayment',
        status: 'completed'
      }
    });
  }

  return { netAmount, debtRepaid };
}

/// Règle la dette de commission d'un chauffeur à partir de son solde wallet
/// existant. `amount` est le montant demandé en FCFA ; le montant réellement
/// réglé est borné par le solde disponible et la dette restante. `amount <= 0`
/// signifie « régler tout ce que le solde permet ».
export async function settleCommissionDebtFromWallet(tx, { userId, amount }) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  const debt = Number(wallet?.commissionDebt ?? 0);
  const balance = Number(wallet?.balance ?? 0);
  if (debt <= 0 || balance <= 0) {
    return { settled: 0, remainingDebt: debt, balanceAfter: balance };
  }

  const requested = amount > 0 ? amount : balance;
  const settled = Math.min(debt, balance, requested);
  if (settled <= 0) {
    return { settled: 0, remainingDebt: debt, balanceAfter: balance };
  }

  const balanceAfter = balance - settled;
  const remainingDebt = debt - settled;

  await tx.wallet.update({
    where: { userId },
    data: {
      balance: { decrement: settled },
      commissionDebt: { decrement: settled },
      totalSpent: { increment: settled },
      totalCommissionsPaid: { increment: settled },
      lastActivityAt: new Date()
    }
  });

  await tx.walletTransaction.create({
    data: {
      walletUserId: userId,
      type: 'commission',
      amount: settled,
      balanceBefore: balance,
      balanceAfter,
      description: `Règlement dette de commission (${settled} FCFA)`,
      origin: 'debt_repayment',
      status: 'completed'
    }
  });

  return { settled, remainingDebt, balanceAfter };
}

export async function deductCashCommission({ parcelId, driverId, commission, tx, req }) {
  const cfaPerPoint = await getCfaPerPoint(tx);

  const wallet = await tx.wallet.upsert({
    where: { userId: driverId },
    update: {},
    create: { userId: driverId }
  });
  const score = await tx.score.upsert({
    where: { userId: driverId },
    update: {},
    create: { userId: driverId }
  });

  const walletBalance = Number(wallet.balance);
  const pointsBalance = score.points;

  let walletDeducted = 0;
  let pointsDeducted = 0;

  if (walletBalance >= commission) {
    walletDeducted = commission;
  } else {
    walletDeducted = walletBalance;
    const rest = commission - walletBalance;

    const pointsNeeded = Math.ceil(rest / cfaPerPoint);

    if (pointsBalance >= pointsNeeded) {
      pointsDeducted = pointsNeeded;
    } else {
      pointsDeducted = pointsBalance;
    }
  }

  const covered = walletDeducted + (pointsDeducted * cfaPerPoint);

  let debt = 0;
  if (covered < commission) {
    debt = commission - covered;

    // La livraison d'un colis déjà accepté n'est jamais bloquée : la part non
    // couverte devient une dette de commission, bornée par `commission.debtLimit`
    // (0 = aucune limite). Seul le dépassement du plafond refuse l'opération.
    const debtLimit = await getDebtLimit(tx);
    const currentDebt = Number(wallet.commissionDebt ?? 0);
    if (debtLimit > 0 && currentDebt + debt > debtLimit) {
      throw new DebtLimitExceededError();
    }
  }

  const parcel = parcelId ? await tx.parcel.findUnique({ where: { id: parcelId }, select: { trackingNumber: true } }) : null;
  const trackingSnip = parcel?.trackingNumber || parcelId;

  if (walletDeducted > 0) {
    await tx.wallet.update({
      where: { userId: driverId },
      data: {
        balance: { decrement: walletDeducted },
        totalSpent: { increment: walletDeducted },
        totalCommissionsPaid: { increment: walletDeducted },
        lastActivityAt: new Date()
      }
    });
    await tx.walletTransaction.create({
      data: {
        walletUserId: driverId,
        type: 'commission',
        amount: walletDeducted,
        balanceBefore: walletBalance,
        balanceAfter: walletBalance - walletDeducted,
        parcelId,
        description: `Commission colis ${trackingSnip} (${walletDeducted} FCFA)`,
        origin: 'cash_delivery',
        status: 'completed'
      }
    });
  }

  if (pointsDeducted > 0) {
    const pointsCFADeducted = pointsDeducted * cfaPerPoint;
    await tx.score.update({
      where: { userId: driverId },
      data: {
        points: { decrement: pointsDeducted },
        totalSpent: { increment: pointsDeducted },
        lastUpdated: new Date()
      }
    });
    await tx.scoreTransaction.create({
      data: {
        userId: driverId,
        amount: -pointsDeducted,
        type: 'commission_deduction',
        source: 'system',
        parcelId,
        description: `Commission colis ${trackingSnip} (${pointsDeducted} pts = ${pointsCFADeducted} FCFA)`,
        metadata: { commission, cfaPerPoint, pointsCFADeducted }
      }
    });
  }

  if (debt > 0) {
    await tx.wallet.update({
      where: { userId: driverId },
      data: {
        commissionDebt: { increment: debt },
        lastActivityAt: new Date()
      }
    });
    await tx.scoreTransaction.create({
      data: {
        userId: driverId,
        amount: 0,
        type: 'commission_debt',
        source: 'system',
        parcelId,
        description: `Commission impayée colis ${trackingSnip} (${debt} FCFA à régulariser)`,
        metadata: { commission, debt, cfaPerPoint }
      }
    });
  }

  return {
    commission,
    walletDeducted,
    pointsDeducted,
    cfaPerPoint,
    debt,
    remainingAfterDeduction: commission - covered
  };
}

export async function getConfigValue(tx, key, fallback) {
  const row = await tx.systemConfig.findUnique({ where: { key } });
  if (!row) return fallback;
  const value = row.value;
  if (value === undefined || value === null) return fallback;
  // Les valeurs sont stockées en JSON (nombre, chaîne, booléen ou tableau).
  // Certaines écritures historiques enveloppent la valeur dans `{ value }` ;
  // on normalise les deux formes sans confondre un tableau avec un objet.
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value.value ?? fallback;
  }
  return value;
}
