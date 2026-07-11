import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/api-response.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { serializeUser } from '../utils/mobile-serializers.js';
import { NotFoundError, ValidationError, normalizeError } from '../utils/errors.js';

function decimal(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number(value);
}

function cleanUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function getLevel(points) {
  if (points >= 1000) return 'ELITE';
  if (points >= 500) return 'PREMIUM';
  if (points >= 100) return 'STANDARD';
  return 'NEW';
}

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.error?.(
        {
          error,
          action,
          userId: req.user?.id,
          role: req.user?.role,
          requestId: req.requestId
        },
        `Admin reputation endpoint failed: ${action}`
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

export const reputationDashboard = handle('reputation.dashboard', async (_req, res) => {
  const [totalDrivers, scores, avgRatingResult] = await Promise.all([
    prisma.user.count({ where: { role: 'driver', status: 'active' } }),
    prisma.score.findMany(),
    prisma.user.aggregate({
      where: { role: 'driver', status: 'active' },
      _avg: { rating: true }
    })
  ]);

  let eliteCount = 0;
  let premiumCount = 0;
  let standardCount = 0;
  let newCount = 0;

  for (const s of scores) {
    const p = s.points;
    if (p >= 1000) eliteCount++;
    else if (p >= 500) premiumCount++;
    else if (p >= 100) standardCount++;
    else newCount++;
  }

  const averageRating = avgRatingResult._avg.rating ? Number(avgRatingResult._avg.rating) : 0;

  return ok(res, {
    message: 'Tableau de bord reputation',
    data: { eliteCount, premiumCount, standardCount, newCount, totalDrivers, averageRating }
  });
});

export const listScores = handle('reputation.listScores', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const userWhere = cleanUndefined({
    role: 'driver',
    status: 'active',
    ...(req.query.garage ? { garageId: req.query.garage } : {}),
    ...(req.query.region ? { region: req.query.region } : {}),
    ...(req.query.search
      ? {
          OR: [
            { fullName: { contains: req.query.search, mode: 'insensitive' } },
            { phone: { contains: req.query.search, mode: 'insensitive' } }
          ]
        }
      : {})
  });

  if (req.query.level) {
    const lvl = req.query.level.toUpperCase();
    let pointsFilter;
    if (lvl === 'ELITE') pointsFilter = { points: { gte: 1000 } };
    else if (lvl === 'PREMIUM') pointsFilter = { points: { gte: 500, lt: 1000 } };
    else if (lvl === 'STANDARD') pointsFilter = { points: { gte: 100, lt: 500 } };
    else if (lvl === 'NEW') pointsFilter = { points: { lt: 100 } };

    if (pointsFilter) {
      const matchingScores = await prisma.score.findMany({
        where: pointsFilter,
        select: { userId: true }
      });
      const ids = matchingScores.map((s) => s.userId);
      if (ids.length === 0) {
        return ok(res, {
          message: 'Scores chauffeurs',
          data: { scores: [] },
          meta: paginationMeta({ page, limit, total: 0 })
        });
      }
      userWhere.id = { in: ids };
    }
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.user.findMany({
      where: userWhere,
      include: { garage: true, score: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  const drivers = users.map((u) => ({
    userId: u.id,
    driverName: u.fullName,
    garageName: u.garage?.name || null,
    region: u.region,
    points: u.score?.points || 0,
    totalEarned: u.score?.totalEarned || 0,
    totalSpent: u.score?.totalSpent || 0,
    level: getLevel(u.score?.points || 0),
    rating: Number(u.rating || 0),
    totalDeliveries: u.totalDeliveries,
    lastUpdated: u.score?.lastUpdated || u.updatedAt
  }));

  return ok(res, {
    message: 'Scores chauffeurs',
    data: { scores: drivers },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getScore = handle('reputation.getScore', async (req, res) => {
  const userId = req.params.userId || req.query.userId;

  const [user, score, transactions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { garage: true } }),
    prisma.score.findUnique({ where: { userId } }),
    prisma.scoreTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
  ]);

  if (!user) throw new NotFoundError('Utilisateur introuvable');

  return ok(res, {
    message: 'Score utilisateur',
    data: {
      user: serializeUser(user),
      score: score
        ? {
            points: score.points,
            totalEarned: score.totalEarned,
            totalSpent: score.totalSpent,
            level: getLevel(score.points),
            lastUpdated: score.lastUpdated
          }
        : { points: 0, totalEarned: 0, totalSpent: 0, level: 'NEW', lastUpdated: null },
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: t.description,
        parcelId: t.parcelId,
        status: t.status,
        metadata: t.metadata,
        createdAt: t.createdAt
      }))
    }
  });
});

export const scoreHistory = handle('reputation.scoreHistory', async (req, res) => {
  const userId = req.params.userId || req.query.userId;
  const { page, limit, skip } = getPagination(req.query);

  const where = cleanUndefined({
    userId,
    ...(req.query.type ? { type: req.query.type } : {})
  });

  const [total, transactions] = await Promise.all([
    prisma.scoreTransaction.count({ where }),
    prisma.scoreTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: 'Historique transactions',
    data: {
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: t.description,
        parcelId: t.parcelId,
        status: t.status,
        metadata: t.metadata,
        createdAt: t.createdAt
      }))
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const addPoints = handle('reputation.addPoints', async (req, res) => {
  const userId = req.params.userId || req.body.userId;
  const amount = Number(req.body.amount);
  const description = req.body.description || 'Points ajoutes par admin';

  if (!amount || amount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Le montant doit etre superieur a 0' }]);
  }
  if (!description.trim()) {
    throw new ValidationError([{ path: 'body.description', message: 'La description est requise' }]);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('Utilisateur introuvable');

  const result = await prisma.$transaction(async (tx) => {
    const score = await tx.score.upsert({
      where: { userId },
      update: {
        points: { increment: amount },
        totalEarned: { increment: amount },
        lastUpdated: new Date()
      },
      create: {
        userId,
        points: amount,
        totalEarned: amount,
        totalSpent: 0
      }
    });

    const transaction = await tx.scoreTransaction.create({
      data: {
        userId,
        amount,
        type: 'admin_credit',
        description,
        metadata: { adminId: req.user.id, adminName: req.user.fullName }
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'score.admin_add',
        entityType: 'score',
        entityId: userId,
        afterData: { amount, description },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    });

    return { score, transaction };
  });

  return ok(res, {
    message: 'Points ajoutes',
    data: {
      userId,
      points: result.score.points,
      level: getLevel(result.score.points),
      transaction: {
        id: result.transaction.id,
        amount: result.transaction.amount,
        type: result.transaction.type,
        description: result.transaction.description,
        createdAt: result.transaction.createdAt
      }
    }
  });
});

export const removePoints = handle('reputation.removePoints', async (req, res) => {
  const userId = req.params.userId || req.body.userId;
  const amount = Number(req.body.amount);
  const description = req.body.description || 'Points retires par admin';

  if (!amount || amount <= 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Le montant doit etre superieur a 0' }]);
  }
  if (!description.trim()) {
    throw new ValidationError([{ path: 'body.description', message: 'La description est requise' }]);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('Utilisateur introuvable');

  const currentScore = await prisma.score.findUnique({ where: { userId } });
  const currentPoints = currentScore?.points || 0;

  if (currentPoints - amount < 0) {
    throw new ValidationError([{ path: 'body.amount', message: 'Solde de points insuffisant pour ce retrait' }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const score = await tx.score.upsert({
      where: { userId },
      update: {
        points: { decrement: amount },
        totalSpent: { increment: amount },
        lastUpdated: new Date()
      },
      create: {
        userId,
        points: 0,
        totalEarned: 0,
        totalSpent: amount
      }
    });

    const transaction = await tx.scoreTransaction.create({
      data: {
        userId,
        amount: -amount,
        type: 'admin_debit',
        description,
        metadata: { adminId: req.user.id, adminName: req.user.fullName }
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'score.admin_remove',
        entityType: 'score',
        entityId: userId,
        afterData: { amount, description },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      }
    });

    return { score, transaction };
  });

  return ok(res, {
    message: 'Points retires',
    data: {
      userId,
      points: result.score.points,
      level: getLevel(result.score.points),
      transaction: {
        id: result.transaction.id,
        amount: result.transaction.amount,
        type: result.transaction.type,
        description: result.transaction.description,
        createdAt: result.transaction.createdAt
      }
    }
  });
});

export const driverRanking = handle('reputation.driverRanking', async (_req, res) => {
  const activeDrivers = await prisma.user.findMany({
    where: { role: 'driver', status: 'active' },
    include: { garage: true, score: true }
  });

  let walletMap = new Map();
  try {
    const wallets = await prisma.wallet.findMany({ where: { userId: { in: activeDrivers.map(d => d.id) } } });
    for (const w of wallets) walletMap.set(w.userId, w);
  } catch { /* wallets table may not exist yet */ }

  const ranked = activeDrivers
    .map((d) => ({
      rank: 0,
      userId: d.id,
      fullName: d.fullName,
      profilePhoto: d.profilePhoto,
      garageName: d.garage?.name || null,
      region: d.region,
      points: d.score?.points || 0,
      level: getLevel(d.score?.points || 0),
      rating: Number(d.rating || 0),
      totalDeliveries: d.totalDeliveries,
      completedDeliveries: d.completedDeliveries,
      successRate: d.totalDeliveries > 0 ? Math.round((d.completedDeliveries / d.totalDeliveries) * 100) : null,
      walletBalance: walletMap.has(d.id) ? number(walletMap.get(d.id).balance) : null
    }))
    .sort((a, b) => b.points - a.points)
    .map((d, i) => ({ ...d, rank: i + 1 }));

  return ok(res, {
    message: 'Classement chauffeurs',
    data: { rankings: ranked }
  });
});

export const driverDetail = handle('reputation.driverDetail', async (req, res) => {
  const userId = req.params.userId || req.query.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { garage: true, score: true }
  });

  if (!user) throw new NotFoundError('Utilisateur introuvable');

  let wallet = null;
  try {
    wallet = await prisma.wallet.findUnique({ where: { userId } });
  } catch { /* wallets table may not exist yet */ }

  return ok(res, {
    message: 'Detail chauffeur',
    data: {
      user: serializeUser(user),
      score: user.score
        ? {
            points: user.score.points,
            totalEarned: user.score.totalEarned,
            totalSpent: user.score.totalSpent,
            level: getLevel(user.score.points),
            lastUpdated: user.score.lastUpdated
          }
        : null,
      wallet: wallet
        ? {
            balance: number(wallet.balance),
            totalDeposited: number(wallet.totalDeposited),
            totalSpent: number(wallet.totalSpent),
            totalRefunded: number(wallet.totalRefunded),
            status: wallet.status,
            lastDepositAt: wallet.lastDepositAt?.toISOString() ?? null,
            lastActivityAt: wallet.lastActivityAt?.toISOString() ?? null
          }
        : null
    }
  });
});
