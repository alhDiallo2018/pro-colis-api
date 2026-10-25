import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { sessionIdleTimeoutMs } from '../../utils/tokens.js';

/**
 * Le verrou PostgreSQL porte sur le compte : il fonctionne entre processus API
 * et serialize rotation, activite et logout. Les resets/deletions verrouillent
 * deja cette meme ligne via leur UPDATE users, avant de revoquer les sessions.
 */
export function withSessionLock(userId, operation) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    return operation(tx);
  }, { maxWait: 10000, timeout: 15000 });
}

export async function activeSessionForAccess(tx, sid, userId) {
  const session = await tx.refreshToken.findUnique({ where: { jti: sid } });
  if (!session || session.userId !== userId) return null;
  // Les requetes deja en vol gardent leur access token jusqu'a son expiration.
  // Seule la rotation permet de suivre la famille ; logout/reset ne le peuvent pas.
  if (session.revokedReason === 'rotated') {
    return tx.refreshToken.findFirst({ where: { familyId: session.familyId, userId, revokedAt: null } });
  }
  return session.revokedAt ? null : session;
}

/** Retourne l'erreur au lieu de la lever pour COMMIT la revocation d'inactivite. */
export async function touchSession(tx, session, role, now = new Date()) {
  if (session.expiresAt <= now) {
    return new UnauthorizedError('Session expiree', 'SESSION_EXPIRED');
  }
  const idleMs = now.getTime() - session.lastUsedAt.getTime();
  if (idleMs > sessionIdleTimeoutMs(role)) {
    await tx.refreshToken.update({
      where: { id: session.id }, data: { revokedAt: now, revokedReason: 'idle' }
    });
    logger.info({ action: 'auth.session.revoked', reason: 'idle', userId: session.userId, familyId: session.familyId }, 'Session inactive fermee');
    return new UnauthorizedError('Session expiree pour inactivite', 'SESSION_IDLE');
  }
  // Au plus une ecriture par cinq secondes, avec un horodatage monotone.
  if (idleMs >= 5000) {
    await tx.refreshToken.update({ where: { id: session.id }, data: { lastUsedAt: now } });
  }
  return null;
}
