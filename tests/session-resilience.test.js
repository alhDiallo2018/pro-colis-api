import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';
import * as auth from '../src/modules/auth/auth.service.js';
import { authenticate } from '../src/middlewares/auth.middleware.js';
import { signAccessToken, signRefreshToken, durationToMs, sessionIdleTimeoutMs } from '../src/utils/tokens.js';

const userIds = [];
async function openSession() {
  const result = await auth.registerUser({ phone: `session-test-${randomUUID()}`, fullName: 'Session regression', pin: '123456' });
  userIds.push(result.user.id);
  return result;
}
const me = token => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
const refresh = token => request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });

afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

it('garde une session client apres une pause de lecture de 65 secondes', async () => {
  const first = await openSession();
  await prisma.refreshToken.updateMany({ where: { userId: first.user.id }, data: { lastUsedAt: new Date(Date.now() - 65000) } });
  expect((await me(first.accessToken)).status).toBe(200);
  expect((await refresh(first.refreshToken)).status).toBe(200);
  expect(sessionIdleTimeoutMs('support_technique')).toBeLessThan(sessionIdleTimeoutMs('client'));
});

it('restitue un successeur unique pour quatre rotations concurrentes puis un retry', async () => {
  const first = await openSession();
  const responses = await Promise.all(Array.from({ length: 4 }, () => refresh(first.refreshToken)));
  expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200]);
  expect(new Set(responses.map(r => r.body.refreshToken)).size).toBe(1);
  expect(await prisma.refreshToken.count({ where: { userId: first.user.id, revokedAt: null } })).toBe(1);
  expect((await refresh(first.refreshToken)).body.refreshToken).toBe(responses[0].body.refreshToken);
  // Le JWT reconstruit est strictement identique et valide au refresh suivant.
  expect((await refresh(responses[0].body.refreshToken)).status).toBe(200);
});

it('la rotation garde les access tokens en vol valides jusqu au logout', async () => {
  const first = await openSession();
  const next = await auth.refreshAccessToken(first.refreshToken);
  expect((await me(first.accessToken)).status).toBe(200);
  // Le logout peut arriver avec l ancien refresh si sa reponse a ete perdue.
  await auth.logout(first.refreshToken);
  expect((await me(first.accessToken)).status).toBe(401);
  expect((await me(next.accessToken)).status).toBe(401);
  expect((await refresh(first.refreshToken)).status).toBe(401);
});

it('un rejeu tardif ferme sa famille sans deconnecter un autre appareil', async () => {
  const first = await openSession();
  const second = await auth.loginWithPin({ identifier: first.user.phone, pin: '123456' });
  const next = await auth.refreshAccessToken(first.refreshToken);
  await prisma.refreshToken.updateMany({ where: { jti: jwt.decode(first.refreshToken).jti }, data: {
    revokedAt: new Date(Date.now() - (env.REFRESH_RETRY_GRACE_SECONDS + 1) * 1000)
  } });
  expect((await refresh(first.refreshToken)).body.error.code).toBe('REFRESH_TOKEN_REUSED');
  expect((await me(next.accessToken)).status).toBe(401);
  expect((await me(second.accessToken)).status).toBe(200);
});

it('une rotation concurrente ne ressuscite pas un logout global', async () => {
  const first = await openSession();
  await Promise.allSettled([auth.refreshAccessToken(first.refreshToken), auth.logoutAllSessions(first.user.id)]);
  expect(await prisma.refreshToken.count({ where: { userId: first.user.id, revokedAt: null } })).toBe(0);
  expect((await refresh(first.refreshToken)).status).toBe(401);
});

it('refuse une session disparue et retourne 401 pour les JWT expires ou invalides', async () => {
  const first = await openSession();
  expect((await me(signAccessToken(first.user, randomUUID()))).status).toBe(401);
  const expired = jwt.sign({ sub: first.user.id }, env.JWT_REFRESH_SECRET, { expiresIn: -1 });
  expect((await refresh(expired)).status).toBe(401);
  expect((await refresh('invalid-refresh-token-with-enough-characters')).status).toBe(401);
});

it('laisse remonter une panne BD comme erreur technique et non comme 401', async () => {
  const error = new Error('SIMULATED_DATABASE_UNAVAILABLE');
  jest.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(error);
  const next = jest.fn();
  await authenticate({ headers: { authorization: `Bearer ${signAccessToken({ id: randomUUID(), role: 'client' })}` } }, {}, next);
  expect(next).toHaveBeenCalledWith(error);
  expect(error.statusCode).toBeUndefined();
});

it('interprete les durees numeriques comme des secondes pour les deux JWT', () => {
  const oldAccess = env.JWT_ACCESS_EXPIRES_IN;
  const oldRefresh = env.JWT_REFRESH_EXPIRES_IN;
  try {
    env.JWT_ACCESS_EXPIRES_IN = '900';
    env.JWT_REFRESH_EXPIRES_IN = '900';
    const user = { id: randomUUID(), role: 'client' };
    for (const token of [signAccessToken(user), signRefreshToken(user).token]) {
      const payload = jwt.decode(token);
      expect(payload.exp - payload.iat).toBe(durationToMs('900') / 1000);
    }
  } finally {
    env.JWT_ACCESS_EXPIRES_IN = oldAccess;
    env.JWT_REFRESH_EXPIRES_IN = oldRefresh;
  }
});
