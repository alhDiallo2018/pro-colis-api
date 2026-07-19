import { prisma } from '../config/prisma.js';

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
  const value = await getConfigValue(tx, 'score.deliveryCompleted', 120);
  return Math.max(0, Number(value));
}

export async function getCommitmentFee(tx) {
  const value = await getConfigValue(tx, 'score.commitmentFee', 1);
  return Math.max(0, Number(value));
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
  const pointsCFA = Math.floor(pointsBalance * cfaPerPoint);

  const totalAvailable = walletBalance + pointsCFA;

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

  if (covered < commission) {
    const rule = await getConfigValue(tx, 'commission.insufficient_rule', 'block');
    if (rule === 'block') {
      const err = new Error('Ressources insuffisantes pour payer la commission');
      err.code = 'INSUFFICIENT_FUNDS';
      throw err;
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

  return {
    commission,
    walletDeducted,
    pointsDeducted,
    cfaPerPoint,
    remainingAfterDeduction: commission - covered
  };
}

export async function getConfigValue(tx, key, fallback) {
  const row = await tx.systemConfig.findUnique({ where: { key } });
  if (!row) return fallback;
  if (typeof row.value === 'string') return row.value;
  return row.value?.value ?? fallback;
}
