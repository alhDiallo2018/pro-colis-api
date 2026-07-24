import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/api-response.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { ValidationError, NotFoundError, normalizeError } from '../utils/errors.js';

// Registre des dépenses de l'entreprise : date, montant, justificatif photo…
// Aligné sur les conventions de admin-finance.controller.js.

const STATUSES = ['paid', 'pending'];

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number(value);
}

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.error?.(
        { error, action, userId: req.user?.id, requestId: req.requestId },
        `Admin expense endpoint failed: ${action}`
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

/** Génère une référence lisible DEP-000123 ; suffixe aléatoire en secours. */
async function generateReference() {
  const count = await prisma.expense.count();
  const base = `DEP-${String(count + 1).padStart(5, '0')}`;
  const existing = await prisma.expense.findUnique({ where: { reference: base } });
  if (!existing) return base;
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `DEP-${String(count + 1).padStart(5, '0')}-${suffix}`;
}

function serialize(e) {
  if (!e) return null;
  return {
    id: e.id,
    reference: e.reference,
    title: e.title,
    category: e.category,
    amount: number(e.amount),
    currency: e.currency,
    description: e.description ?? null,
    proofUrl: e.proofUrl ?? null,
    status: e.status,
    spentAt: e.spentAt?.toISOString() ?? null,
    createdById: e.createdById ?? null,
    createdBy: e.createdBy ? { id: e.createdBy.id, fullName: e.createdBy.fullName } : null,
    createdAt: e.createdAt?.toISOString() ?? null,
    updatedAt: e.updatedAt?.toISOString() ?? null
  };
}

const includeRelations = {
  createdBy: { select: { id: true, fullName: true } }
};

function buildWhere(query) {
  const { search, category, status, from, to } = query;
  const where = {
    ...(category ? { category } : {}),
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } }
          ]
        }
      : {})
  };
  if (from || to) {
    where.spentAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {})
    };
  }
  return where;
}

export const listExpenses = handle('expense.list', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const where = buildWhere(req.query);

  const [total, rows, sumAll, sumPaid, sumPending] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: includeRelations,
      orderBy: { spentAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { ...where, status: 'paid' }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { ...where, status: 'pending' }, _sum: { amount: true } })
  ]);

  return ok(res, {
    message: 'Dépenses',
    data: {
      expenses: rows.map(serialize),
      summary: {
        count: total,
        totalAmount: number(sumAll._sum.amount),
        paidAmount: number(sumPaid._sum.amount),
        pendingAmount: number(sumPending._sum.amount)
      }
    },
    meta: paginationMeta({ page, limit, total })
  });
});

export const getExpense = handle('expense.get', async (req, res) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.expenseId },
    include: includeRelations
  });
  if (!expense) throw new NotFoundError('Dépense introuvable');
  return ok(res, { message: 'Dépense', data: { expense: serialize(expense) } });
});

export const createExpense = handle('expense.create', async (req, res) => {
  const { title, category, amount, currency, description, proofUrl, status, spentAt } = req.body;

  const errors = [];
  if (!title || !String(title).trim()) errors.push({ path: 'title', message: 'Libellé requis' });
  const amountNum = number(amount);
  if (!amountNum || amountNum <= 0) errors.push({ path: 'amount', message: 'Montant strictement positif requis' });
  if (errors.length) throw new ValidationError(errors);

  const finalStatus = STATUSES.includes(status) ? status : 'paid';
  const reference = await generateReference();

  const expense = await prisma.expense.create({
    data: {
      reference,
      title: String(title).trim(),
      category: category ? String(category) : 'autre',
      amount: String(amountNum),
      currency: currency ? String(currency) : 'XOF',
      description: description ? String(description) : null,
      proofUrl: proofUrl ? String(proofUrl) : null,
      status: finalStatus,
      spentAt: spentAt ? new Date(spentAt) : new Date(),
      createdById: req.user.id
    },
    include: includeRelations
  });

  return ok(res, {
    status: 201,
    message: 'Dépense enregistrée',
    data: { expense: serialize(expense) }
  });
});

export const updateExpense = handle('expense.update', async (req, res) => {
  const existing = await prisma.expense.findUnique({ where: { id: req.params.expenseId } });
  if (!existing) throw new NotFoundError('Dépense introuvable');

  const { title, category, amount, currency, description, proofUrl, status, spentAt } = req.body;
  if (status !== undefined && !STATUSES.includes(status)) {
    throw new ValidationError([{ path: 'status', message: 'Statut invalide' }]);
  }
  if (amount !== undefined) {
    const amountNum = number(amount);
    if (!amountNum || amountNum <= 0) {
      throw new ValidationError([{ path: 'amount', message: 'Montant strictement positif requis' }]);
    }
  }

  const data = {
    ...(title !== undefined ? { title: String(title).trim() } : {}),
    ...(category !== undefined ? { category: category ? String(category) : 'autre' } : {}),
    ...(amount !== undefined ? { amount: String(number(amount)) } : {}),
    ...(currency !== undefined ? { currency: currency ? String(currency) : 'XOF' } : {}),
    ...(description !== undefined ? { description: description ? String(description) : null } : {}),
    ...(proofUrl !== undefined ? { proofUrl: proofUrl ? String(proofUrl) : null } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(spentAt !== undefined ? { spentAt: spentAt ? new Date(spentAt) : new Date() } : {})
  };

  const expense = await prisma.expense.update({
    where: { id: req.params.expenseId },
    data,
    include: includeRelations
  });

  return ok(res, { message: 'Dépense mise à jour', data: { expense: serialize(expense) } });
});

export const deleteExpense = handle('expense.delete', async (req, res) => {
  const existing = await prisma.expense.findUnique({ where: { id: req.params.expenseId } });
  if (!existing) throw new NotFoundError('Dépense introuvable');
  await prisma.expense.delete({ where: { id: req.params.expenseId } });
  return ok(res, { message: 'Dépense supprimée' });
});
