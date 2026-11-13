import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/api-response.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { ValidationError, NotFoundError, normalizeError } from '../utils/errors.js';

// Revue admin des vérifications d'identité chauffeur (KYC).
// Approuver marque l'utilisateur isVerified=true (conditionne les activités).
// Aligné sur les conventions de admin-finance.controller.js.

const STATUSES = ['pending', 'approved', 'rejected'];

function handle(action, fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      const normalized = normalizeError(error);
      req.log?.error?.(
        { error, action, userId: req.user?.id, requestId: req.requestId },
        `Admin identity endpoint failed: ${action}`
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

function serialize(v) {
  if (!v) return null;
  return {
    id: v.id,
    status: v.status,
    documentType: v.documentType ?? null,
    documentFrontUrl: v.documentFrontUrl ?? null,
    documentBackUrl: v.documentBackUrl ?? null,
    rejectionReason: v.rejectionReason ?? null,
    reviewedBy: v.reviewedBy ?? null,
    reviewedAt: v.reviewedAt?.toISOString() ?? null,
    createdAt: v.createdAt?.toISOString() ?? null,
    updatedAt: v.updatedAt?.toISOString() ?? null,
    user: v.user
      ? {
          id: v.user.id,
          fullName: v.user.fullName,
          phone: v.user.phone,
          email: v.user.email,
          role: v.user.role,
          isVerified: v.user.isVerified ?? false
        }
      : null
  };
}

const includeUser = {
  user: { select: { id: true, fullName: true, phone: true, email: true, role: true, isVerified: true } }
};

export const listIdentityVerifications = handle('identity.adminList', async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status, search } = req.query;

  const where = {
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(search
      ? {
          user: {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } }
            ]
          }
        }
      : {})
  };

  const [total, pending, approved, rejected, rows] = await Promise.all([
    prisma.identityVerification.count({ where }),
    prisma.identityVerification.count({ where: { ...where, status: 'pending' } }),
    prisma.identityVerification.count({ where: { ...where, status: 'approved' } }),
    prisma.identityVerification.count({ where: { ...where, status: 'rejected' } }),
    prisma.identityVerification.findMany({
      where,
      include: includeUser,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })
  ]);

  return ok(res, {
    message: "Vérifications d'identité",
    data: {
      verifications: rows.map(serialize),
      summary: { total, pending, approved, rejected }
    },
    meta: paginationMeta({ page, limit, total })
  });
});

async function review(req, res, { status, reason = null }) {
  const existing = await prisma.identityVerification.findUnique({
    where: { id: req.params.verificationId },
    include: includeUser
  });
  if (!existing) throw new NotFoundError('Vérification introuvable');

  const result = await prisma.$transaction(async (tx) => {
    const verification = await tx.identityVerification.update({
      where: { id: existing.id },
      data: { status, rejectionReason: status === 'rejected' ? reason : null, reviewedBy: req.user.id, reviewedAt: new Date() },
      include: includeUser
    });
    // Drapeau dénormalisé sur l'utilisateur (source de vérité du gating).
    await tx.user.update({
      where: { id: existing.userId },
      data: { isVerified: status === 'approved' }
    });
    await tx.notification.create({
      data: {
        userId: existing.userId,
        type: status === 'approved' ? 'identity_approved' : 'identity_rejected',
        title: status === 'approved' ? 'Identité vérifiée' : 'Vérification refusée',
        body:
          status === 'approved'
            ? 'Votre identité a été vérifiée. Vous pouvez maintenant enchérir et publier des annonces.'
            : `Votre vérification d'identité a été refusée${reason ? ` : ${reason}` : ''}. Vous pouvez renvoyer vos documents.`,
        data: { verificationId: existing.id, status },
        priority: 'high'
      }
    });
    return verification;
  });

  return ok(res, {
    message: status === 'approved' ? 'Identité approuvée' : 'Vérification refusée',
    data: { verification: serialize(result) }
  });
}

export const approveIdentity = handle('identity.approve', async (req, res) => {
  return review(req, res, { status: 'approved' });
});

export const rejectIdentity = handle('identity.reject', async (req, res) => {
  const reason = req.body.reason ? String(req.body.reason) : null;
  if (!reason) throw new ValidationError([{ path: 'body.reason', message: 'Motif de refus requis' }]);
  return review(req, res, { status: 'rejected', reason });
});

export const deleteIdentity = handle('identity.delete', async (req, res) => {
  const existing = await prisma.identityVerification.findUnique({
    where: { id: req.params.verificationId },
    include: includeUser
  });
  if (!existing) throw new NotFoundError('Vérification introuvable');

  await prisma.$transaction(async (tx) => {
    await tx.identityVerification.delete({ where: { id: existing.id } });
    // Si c'était la seule vérification approuvée, l'utilisateur redevient
    // non vérifié : garantit la cohérence du drapeau isVerified.
    if (existing.status === 'approved') {
      const stillApproved = await tx.identityVerification.count({
        where: { userId: existing.userId, status: 'approved' }
      });
      if (stillApproved === 0) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { isVerified: false }
        });
      }
    }
  });

  return ok(res, {
    message: 'Vérification supprimée',
    data: { id: existing.id }
  });
});

export const requestInfoIdentity = handle('identity.requestInfo', async (req, res) => {
  const message = req.body.message ? String(req.body.message).trim() : '';
  if (message.length < 5) {
    throw new ValidationError([
      { path: 'body.message', message: 'Message d’au moins 5 caractères requis' }
    ]);
  }

  const existing = await prisma.identityVerification.findUnique({
    where: { id: req.params.verificationId },
    include: includeUser
  });
  if (!existing) throw new NotFoundError('Vérification introuvable');

  // La demande ne change pas le statut : elle notifie l'utilisateur et
  // laisse la vérification en pending pour une re-soumission.
  await prisma.notification.create({
    data: {
      userId: existing.userId,
      type: 'identity_request_info',
      title: 'Complément requis pour votre vérification',
      body: message,
      data: { verificationId: existing.id, requestedBy: req.user.id },
      priority: 'high'
    }
  });

  return ok(res, {
    message: 'Demande envoyée',
    data: { verification: serialize(existing) }
  });
});
