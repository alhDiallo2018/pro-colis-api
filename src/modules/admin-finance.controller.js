import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/api-response.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { serializeUser } from '../utils/mobile-serializers.js';
import { ValidationError, NotFoundError, normalizeError } from '../utils/errors.js';
import { attemptDisbursement, toClientWithdrawalStatus, fromClientWithdrawalStatus } from '../utils/withdrawal-flow.js';

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
        `Admin finance endpoint failed: ${action}`
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

function serializeWallet(wallet) {
  if (!wallet) return null;
  return {
    id: wallet.userId,
    driver: serializeUser(wallet.user),
    balance: number(wallet.balance),
    totalDeposited: number(wallet.totalDeposited),
    totalSpent: number(wallet.totalSpent),
    totalRefunded: number(wallet.totalRefunded),
    status: wallet.status,
    lastDepositAt: wallet.lastDepositAt?.toISOString() ?? null,
    lastActivityAt: wallet.lastActivityAt?.toISOString() ?? null,
    transactionCount: wallet._count?.transactions ?? 0,
    commissionCount: wallet._commissionCount ?? 0,
    depositCount: wallet._depositCount ?? 0,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString()
  };
}

function serializeWalletTransaction(txn) {
  if (!txn) return null;
  return {
    id: txn.id,
    type: txn.type,
    amount: number(txn.amount),
    balanceBefore: number(txn.balanceBefore),
    balanceAfter: number(txn.balanceAfter),
    parcelId: txn.parcelId,
    description: txn.description,
    origin: txn.origin,
    status: txn.status,
    performedBy: txn.performedBy,
    admin: txn.admin ? { fullName: txn.admin.fullName } : null,
    createdAt: txn.createdAt.toISOString()
  };
}

export const financeDashboard = handle('finance.dashboard', async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalWallets,
    aggregate,
    commissionsMonth,
    depositsMonth,
    walletsLow,
    walletsInactive
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.wallet.aggregate({
      _sum: { balance: true, totalDeposited: true, totalSpent: true }
    }),
    prisma.walletTransaction.aggregate({
      where: { type: 'commission', createdAt: { gte: monthStart } },
      _sum: { amount: true }
    }),
    prisma.walletTransaction.aggregate({
      where: { type: 'deposit', createdAt: { gte: monthStart } },
      _sum: { amount: true }
    }),
    prisma.wallet.count({
      where: { balance: { lt: 500 }, status: 'active' }
    }),
    prisma.wallet.count({
      where: { lastActivityAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }
    })
  ]);

  return ok(res, {
    message: 'Tableau de bord financier',
    data: {
      dashboard: {
        totalWallets,
        totalBalance: number(aggregate._sum.balance),
        totalDeposited: number(aggregate._sum.totalDeposited),
        totalSpent: number(aggregate._sum.totalSpent),
        commissionsMonth: number(commissionsMonth._sum.amount),
        depositsMonth: number(depositsMonth._sum.amount),
        walletsLow,
        walletsInactive
      }
    }
  });
});

export const listWallets = handle('finance.listWallets', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { search, garage, region, status, minBalance, maxBalance } = req.query;

  const where = cleanUndefined({
    user: {
      role: 'driver',
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } }
            ]
          }
        : {}),
      ...(garage ? { garageId: garage } : {}),
      ...(region ? { region: { contains: region, mode: 'insensitive' } } : {})
    },
    status,
    ...(minBalance !== undefined ? { balance: { gte: number(minBalance) } } : {}),
    ...(maxBalance !== undefined ? { balance: { lte: number(maxBalance) } } : {})
  });

  const [total, wallets] = await Promise.all([
    prisma.wallet.count({ where }),
    prisma.wallet.findMany({
      where,
      include: {
        user: { include: { garage: true } },
        _count: { select: { transactions: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Portefeuilles chauffeurs',
    data: { wallets: wallets.map(serializeWallet) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getWallet = handle('finance.getWallet', async (req, res) => {
  const { userId } = req.params;

  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: {
      user: { include: { garage: true } },
      _count: { select: { transactions: true } }
    }
  });

  if (!wallet) throw new NotFoundError('Portefeuille introuvable');

  const [commissionCount, depositCount] = await Promise.all([
    prisma.walletTransaction.count({ where: { walletUserId: userId, type: 'commission' } }),
    prisma.walletTransaction.count({ where: { walletUserId: userId, type: 'deposit' } })
  ]);

  wallet._commissionCount = commissionCount;
  wallet._depositCount = depositCount;

  return ok(res, {
    message: 'Detail portefeuille',
    data: { wallet: serializeWallet(wallet) }
  });
});

export const walletTransactions = handle('finance.walletTransactions', async (req, res) => {
  const { userId } = req.params;
  const { page, limit, skip } = getPagination(req.query);

  const where = cleanUndefined({
    walletUserId: userId,
    type: req.query.type
  });

  const [total, transactions] = await Promise.all([
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.findMany({
      where,
      include: { admin: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Transactions portefeuille',
    data: { transactions: transactions.map(serializeWalletTransaction) },
    meta: paginationMeta({ page, limit, total })
  });
});

export const rechargeWallet = handle('finance.rechargeWallet', async (req, res) => {
  const { userId, amount, type = 'deposit', description, parcelId, origin } = req.body;
  const numericAmount = number(amount);

  if (numericAmount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Le montant doit etre positif' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.wallet.findUnique({ where: { userId } });
    const balanceBefore = existing ? number(existing.balance) : 0;
    const balanceAfter = balanceBefore + numericAmount;

    const wallet = await tx.wallet.upsert({
      where: { userId },
      update: {
        balance: { increment: numericAmount },
        totalDeposited: { increment: numericAmount },
        lastDepositAt: new Date(),
        lastActivityAt: new Date()
      },
      create: {
        userId,
        balance: numericAmount,
        totalDeposited: numericAmount,
        totalSpent: 0,
        totalRefunded: 0,
        status: 'active',
        lastDepositAt: new Date(),
        lastActivityAt: new Date()
      }
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        walletUserId: userId,
        type,
        amount: numericAmount,
        balanceBefore,
        balanceAfter,
        parcelId: parcelId || null,
        description: description || 'Recharge portefeuille',
        origin: origin || 'admin',
        status: 'completed',
        performedBy: req.user.id
      }
    });

    await audit(tx, req, {
      action: 'wallet.recharge',
      entityType: 'wallet',
      entityId: userId,
      beforeData: { balance: balanceBefore },
      afterData: { balance: balanceAfter, amount: numericAmount }
    });

    // P1 : notifier l'utilisateur du mouvement d'argent sur son compte.
    await tx.notification.create({
      data: {
        userId,
        type: 'wallet_recharged',
        title: 'Portefeuille crédité',
        body: `${numericAmount} FCFA ont été ajoutés à votre portefeuille par l'administration.`,
        data: { amount: numericAmount, balanceAfter, origin: origin || 'admin' },
        priority: 'high'
      }
    });

    return { wallet, transaction };
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { garage: true }
  });

  if (!user) throw new NotFoundError('Utilisateur introuvable');

  return ok(res, {
    message: 'Portefeuille recharge',
    data: {
      wallet: serializeWallet({ ...result.wallet, user, _count: null }),
      transaction: serializeWalletTransaction(result.transaction)
    }
  });
});

export const debitWallet = handle('finance.debitWallet', async (req, res) => {
  const { userId, amount, type = 'adjustment', description, parcelId, origin } = req.body;
  const numericAmount = number(amount);

  if (numericAmount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Le montant doit etre positif' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.wallet.findUnique({ where: { userId } });
    const balanceBefore = existing ? number(existing.balance) : 0;

    if (balanceBefore < numericAmount) {
      throw new ValidationError(
        [{ path: 'body.amount', message: `Solde insuffisant (${balanceBefore} disponible)` }],
        'Solde insuffisant'
      );
    }

    const balanceAfter = balanceBefore - numericAmount;

    const wallet = await tx.wallet.upsert({
      where: { userId },
      update: {
        balance: { decrement: numericAmount },
        totalSpent: { increment: numericAmount },
        lastActivityAt: new Date()
      },
      create: {
        userId,
        balance: 0,
        totalDeposited: 0,
        totalSpent: numericAmount,
        totalRefunded: 0,
        status: 'active',
        lastActivityAt: new Date()
      }
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        walletUserId: userId,
        type,
        amount: numericAmount,
        balanceBefore,
        balanceAfter,
        parcelId: parcelId || null,
        description: description || 'Debit portefeuille',
        origin: origin || 'admin',
        status: 'completed',
        performedBy: req.user.id
      }
    });

    await audit(tx, req, {
      action: 'wallet.debit',
      entityType: 'wallet',
      entityId: userId,
      beforeData: { balance: balanceBefore },
      afterData: { balance: balanceAfter, amount: numericAmount }
    });

    // P1 : notifier l'utilisateur du mouvement d'argent sur son compte.
    await tx.notification.create({
      data: {
        userId,
        type: 'wallet_debited',
        title: 'Portefeuille débité',
        body: `${numericAmount} FCFA ont été retirés de votre portefeuille par l'administration.`,
        data: { amount: numericAmount, balanceAfter, origin: origin || 'admin' },
        priority: 'high'
      }
    });

    return { wallet, transaction };
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { garage: true }
  });

  if (!user) throw new NotFoundError('Utilisateur introuvable');

  return ok(res, {
    message: 'Portefeuille debite',
    data: {
      wallet: serializeWallet({ ...result.wallet, user, _count: null }),
      transaction: serializeWalletTransaction(result.transaction)
    }
  });
});

export const getCommissionConfig = handle('finance.getCommissionConfig', async (_req, res) => {
  const configs = await prisma.commissionConfig.findMany({
    orderBy: [{ profile: 'asc' }, { createdAt: 'desc' }]
  });

  return ok(res, {
    message: 'Configurations commissions',
    data: {
      configs: configs.map((c) => ({
        id: c.id,
        profile: c.profile,
        percentage: number(c.percentage),
        minAmount: number(c.minAmount),
        maxAmount: number(c.maxAmount),
        isActive: c.isActive,
        effectiveFrom: c.effectiveFrom.toISOString(),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString()
      }))
    }
  });
});

export const updateCommissionConfig = handle('finance.updateCommissionConfig', async (req, res) => {
  const { profile, percentage, minAmount, maxAmount, isActive = true, effectiveFrom } = req.body;

  if (!profile) {
    throw new ValidationError([{ path: 'body.profile', message: 'Le profil de commission est requis' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    if (isActive) {
      await tx.commissionConfig.updateMany({
        where: { profile, isActive: true },
        data: { isActive: false }
      });
    }

    const config = await tx.commissionConfig.create({
      data: {
        profile,
        percentage: percentage !== undefined ? number(percentage) : 5,
        minAmount: minAmount !== undefined ? number(minAmount) : 100,
        maxAmount: maxAmount !== undefined ? number(maxAmount) : 500,
        isActive,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date()
      }
    });

    await audit(tx, req, {
      action: 'commission.update',
      entityType: 'commission',
      entityId: config.id,
      afterData: { profile, percentage, minAmount, maxAmount, isActive }
    });

    return config;
  });

  return ok(res, {
    status: 201,
    message: 'Configuration commission enregistree',
    data: {
      config: {
        id: result.id,
        profile: result.profile,
        percentage: number(result.percentage),
        minAmount: number(result.minAmount),
        maxAmount: number(result.maxAmount),
        isActive: result.isActive,
        effectiveFrom: result.effectiveFrom.toISOString(),
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString()
      }
    }
  });
});

export const simulateCommission = handle('finance.simulateCommission', async (req, res) => {
  const amount = number(req.body.amount);

  if (amount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Le montant doit etre positif' }]);
  }

  const configs = await prisma.commissionConfig.findMany({
    where: { isActive: true },
    orderBy: { profile: 'asc' }
  });

  const results = configs.map((config) => {
    const pct = number(config.percentage);
    const min = number(config.minAmount);
    const max = number(config.maxAmount);
    const raw = (pct * amount) / 100;
    const commission = Math.max(min, Math.min(raw, max));

    return {
      profile: config.profile,
      percentage: pct,
      minAmount: min,
      maxAmount: max,
      amount,
      commission: Math.round(commission)
    };
  });

  return ok(res, {
    message: 'Simulation commissions',
    data: { simulations: results }
  });
});

export const listPayments = handle('finance.listPayments', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const statusMap = {
    reussi: 'completed',
    en_attente: 'pending',
    echoue: 'failed',
    rembourse: 'refunded'
  };

  const rawStatus = req.query.status;
  const status = statusMap[rawStatus] || rawStatus;

  const where = cleanUndefined({
    status,
    method: req.query.method
  });

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: { user: true, parcel: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Paiements',
    data: {
      payments: payments.map((p) => ({
        id: p.id,
        amount: number(p.amount),
        currency: p.currency,
        method: p.method,
        status: p.status,
        transactionId: p.transactionId,
        phoneNumber: p.phoneNumber,
        reference: p.reference,
        user: { id: p.user?.id, fullName: p.user?.fullName, phone: p.user?.phone },
        parcel: p.parcel ? { id: p.parcel.id, trackingNumber: p.parcel.trackingNumber } : null,
        completedAt: p.completedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString()
      }))
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getPayment = handle('finance.getPayment', async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.paymentId },
    include: { user: true, parcel: true, validator: { select: { id: true, fullName: true } } }
  });

  if (!payment) throw new NotFoundError('Paiement introuvable');

  return ok(res, {
    message: 'Detail paiement',
    data: {
      payment: {
        id: payment.id,
        userId: payment.userId,
        parcelId: payment.parcelId,
        amount: number(payment.amount),
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        transactionId: payment.transactionId,
        phoneNumber: payment.phoneNumber,
        reference: payment.reference,
        metadata: payment.metadata,
        receiptUrl: payment.receiptUrl,
        user: { id: payment.user?.id, fullName: payment.user?.fullName, phone: payment.user?.phone, email: payment.user?.email },
        parcel: payment.parcel ? { id: payment.parcel.id, trackingNumber: payment.parcel.trackingNumber } : null,
        validatedBy: payment.validatedBy,
        validator: payment.validator ? { id: payment.validator.id, fullName: payment.validator.fullName } : null,
        validatedAt: payment.validatedAt?.toISOString() ?? null,
        completedAt: payment.completedAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString()
      }
    }
  });
});

export const listPayouts = handle('finance.listPayouts', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, method } = req.query;

  const where = cleanUndefined({
    status: fromClientWithdrawalStatus(status),
    method
  });

  const [total, withdrawals] = await Promise.all([
    prisma.withdrawal.count({ where }),
    prisma.withdrawal.findMany({
      where,
      include: { wallet: { include: { user: { select: { id: true, fullName: true, phone: true } } } }, processor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  const mappedPayouts = withdrawals.map((w) => ({
        id: w.id,
        userId: w.walletUserId,
        driver: w.wallet?.user ? { id: w.wallet.user.id, fullName: w.wallet.user.fullName, phone: w.wallet.user.phone } : null,
        amount: number(w.amount),
        method: w.method,
        phone: w.phone,
        phoneNumber: w.phone,
        status: toClientWithdrawalStatus(w.status),
        reference: w.reference,
        failureReason: w.failureReason,
        requestedAt: w.requestedAt,
        processedBy: w.processedBy,
        processor: w.processor ? { id: w.processor.id, fullName: w.processor.fullName } : null,
        processedAt: w.processedAt,
        completedAt: w.completedAt,
        createdAt: w.createdAt
  }));

  return ok(res, {
    message: 'Retraits',
    data: {
      withdrawals: mappedPayouts,
      payouts: mappedPayouts
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getWithdrawal = handle('finance.getWithdrawal', async (req, res) => {
  const { withdrawalId } = req.params;

  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    include: { wallet: { include: { user: { select: { id: true, fullName: true, phone: true } } } }, processor: { select: { id: true, fullName: true } } }
  });

  if (!withdrawal) throw new NotFoundError('Retrait introuvable');

  return ok(res, {
    message: 'Detail retrait',
    data: {
      withdrawal: {
        id: withdrawal.id,
        userId: withdrawal.walletUserId,
        driver: withdrawal.wallet?.user ? { id: withdrawal.wallet.user.id, fullName: withdrawal.wallet.user.fullName, phone: withdrawal.wallet.user.phone } : null,
        amount: number(withdrawal.amount),
        method: withdrawal.method,
        phone: withdrawal.phone,
        phoneNumber: withdrawal.phone,
        status: toClientWithdrawalStatus(withdrawal.status),
        reference: withdrawal.reference,
        transactionId: withdrawal.transactionId,
        providerRef: withdrawal.providerRef,
        failureReason: withdrawal.failureReason,
        requestedAt: withdrawal.requestedAt,
        processedBy: withdrawal.processedBy,
        processor: withdrawal.processor ? { id: withdrawal.processor.id, fullName: withdrawal.processor.fullName } : null,
        processedAt: withdrawal.processedAt,
        completedAt: withdrawal.completedAt,
        createdAt: withdrawal.createdAt,
        updatedAt: withdrawal.updatedAt
      }
    }
  });
});

export const approveWithdrawal = handle('finance.approveWithdrawal', async (req, res) => {
  const { withdrawalId } = req.params;

  const result = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundError('Retrait introuvable');
    if (withdrawal.status !== 'pending') {
      throw new ValidationError([{ path: 'status', message: 'Seuls les retraits en attente peuvent etre approuves' }]);
    }

    const updated = await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'processing',
        processedBy: req.user.id,
        processedAt: new Date()
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletUserId: withdrawal.walletUserId,
        type: 'withdrawal',
        amount: Number(withdrawal.amount),
        balanceBefore: 0,
        balanceAfter: 0,
        description: `Retrait ${withdrawal.method} — ${withdrawal.reference}`,
        origin: 'withdrawal',
        status: 'processing',
        performedBy: req.user.id
      }
    });

    await audit(tx, req, {
      action: 'withdrawal.approve',
      entityType: 'withdrawal',
      entityId: withdrawalId,
      afterData: { status: 'processing' }
    });

    return updated;
  });

  // Déboursement PayDunya automatique (API PUSH) — sinon versement manuel puis /complete.
  const disbursed = await attemptDisbursement(result.id, req.log);
  const final = disbursed ?? result;
  return ok(res, {
    message:
      final.status === 'completed'
        ? 'Retrait approuve et verse via PayDunya'
        : final.status === 'failed'
          ? `Deboursement echoue : ${final.failureReason ?? 'erreur prestataire'} (montant recredite)`
          : 'Retrait approuve',
    data: { status: toClientWithdrawalStatus(final.status), withdrawal: { id: final.id, status: toClientWithdrawalStatus(final.status), failureReason: final.failureReason ?? null } }
  });
});

export const completeWithdrawal = handle('finance.completeWithdrawal', async (req, res) => {
  const { withdrawalId } = req.params;

  const result = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundError('Retrait introuvable');
    if (withdrawal.status !== 'processing') {
      throw new ValidationError([{ path: 'status', message: 'Seuls les retraits en cours peuvent etre completes' }]);
    }

    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'completed',
        completedAt: new Date()
      }
    });

    await tx.wallet.update({
      where: { userId: withdrawal.walletUserId },
      data: {
        pendingBalance: { decrement: Number(withdrawal.amount) },
        totalSpent: { increment: Number(withdrawal.amount) },
        totalWithdrawn: { increment: Number(withdrawal.amount) },
        lastActivityAt: new Date()
      }
    });

    await tx.walletTransaction.updateMany({
      where: { walletUserId: withdrawal.walletUserId, origin: 'withdrawal', status: 'processing', description: { contains: withdrawal.reference } },
      data: { status: 'completed' }
    });

    await tx.notification.create({
      data: {
        userId: withdrawal.walletUserId,
        type: 'withdrawal_completed',
        title: 'Retrait complete',
        body: `Votre retrait de ${withdrawal.amount} FCFA a ete complete.`,
        data: { withdrawalId, amount: number(withdrawal.amount), reference: withdrawal.reference }
      }
    });

    await audit(tx, req, {
      action: 'withdrawal.complete',
      entityType: 'withdrawal',
      entityId: withdrawalId,
      afterData: { status: 'completed' }
    });

    return withdrawal;
  });

  return ok(res, { message: 'Retrait complete', data: { status: 'SUCCESS' } });
});

export const rejectWithdrawal = handle('finance.rejectWithdrawal', async (req, res) => {
  const { withdrawalId } = req.params;
  const { reason } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundError('Retrait introuvable');
    if (withdrawal.status !== 'pending' && withdrawal.status !== 'processing') {
      throw new ValidationError([{ path: 'status', message: 'Retrait non modifiable dans cet etat' }]);
    }

    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'failed',
        failureReason: reason || 'Rejete par l\'administrateur',
        processedBy: req.user.id,
        processedAt: new Date()
      }
    });

    await tx.wallet.update({
      where: { userId: withdrawal.walletUserId },
      data: {
        balance: { increment: Number(withdrawal.amount) },
        pendingBalance: { decrement: Number(withdrawal.amount) },
        lastActivityAt: new Date()
      }
    });

    await tx.walletTransaction.updateMany({
      where: { walletUserId: withdrawal.walletUserId, origin: 'withdrawal', status: { in: ['pending', 'processing'] }, description: { contains: withdrawal.reference } },
      data: { status: 'failed' }
    });

    await tx.notification.create({
      data: {
        userId: withdrawal.walletUserId,
        type: 'withdrawal_failed',
        title: 'Retrait refuse',
        body: `Votre retrait de ${withdrawal.amount} FCFA a ete refuse. ${reason || ''} Le montant est de nouveau disponible.`,
        data: { withdrawalId, amount: number(withdrawal.amount), reason }
      }
    });

    await audit(tx, req, {
      action: 'withdrawal.reject',
      entityType: 'withdrawal',
      entityId: withdrawalId,
      afterData: { status: 'failed', reason }
    });

    return withdrawal;
  });

  return ok(res, { message: 'Retrait refuse', data: { status: toClientWithdrawalStatus(result.status) } });
});
