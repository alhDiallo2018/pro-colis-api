import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

export const PUBLIC_ROLES = ['client', 'driver'];
export const STAFF_ROLES = ['admin', 'super_admin', 'support', 'support_technique', 'support_commercial'];

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

/** Inscription publique : seuls client/driver sont autorisés. */
export function registerPublic(phone, fullName, role = 'client', pin = '123456') {
  return request(app).post('/api/v1/auth/register').send({ phone, fullName, pin, role });
}

/**
 * Provisionnement d'un compte staff : l'inscription publique n'autorise pas ces
 * rôles, on crée un compte public puis on promeut en base (comme `seed.js`).
 * Retourne `{ userId, accessToken, refreshToken }`.
 */
export async function registerStaff(phone, fullName, role) {
  const res = await registerPublic(phone, fullName, 'client');
  if (res.status !== 201) throw new Error(`registerPublic failed: ${res.status}`);
  const userId = res.body.user.id;
  await prisma.user.update({ where: { id: userId }, data: { role } });
  return { userId, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

/** Supprime proprement les utilisateurs créés par un test. */
export async function cleanupUsers(userIds) {
  if (!userIds.length) return;
  await prisma.deviceToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
