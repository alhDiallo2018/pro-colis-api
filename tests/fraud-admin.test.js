/**
 * Tests du module Fraud — super-admin.
 *
 * Préalable : ces tests supposent que `src/app.js` monte le router sous
 * `/super-admin/fraud`. Tant que la ligne n'est pas ajoutée, les routes
 * répondent 404 et la plupart des tests échouent. Voir le rapport.
 *
 * Scénarios :
 *   1. 403 pour un rôle non-super_admin sur chaque endpoint.
 *   2. GET /scores : 3 utilisateurs (safe/medium/high), ordre + flags attendus.
 *   3. POST /refresh : crée les alertes pour medium/high puis pas de doublon.
 *   4. POST /alerts/:id/resolve : positionne resolvedAt + resolvedById.
 */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic, registerStaff } from './helpers.js';

const DAY_MS = 24 * 3600 * 1000;

async function createParcelsForSender(senderId, { total = 0, cancelled = 0, recentCancelled = 0 }) {
  const baseTracking = `FR${randomBytes(4).toString('hex').toUpperCase()}`;
  const parcels = [];
  const now = new Date();
  const recentDate = new Date(now.getTime() - 2 * DAY_MS);
  const oldDate = new Date(now.getTime() - 20 * DAY_MS);

  for (let i = 0; i < total; i++) {
    const isCancelled = i < cancelled;
    const isRecent = i < recentCancelled;
    const p = await prisma.parcel.create({
      data: {
        trackingNumber: `${baseTracking}-${i}`,
        senderId,
        senderName: 'Test',
        senderPhone: '770000000',
        receiverName: 'Dest',
        receiverPhone: '771111111',
        description: 'colis test',
        weight: 1,
        status: isCancelled ? 'cancelled' : 'delivered',
      },
    });
    // Prisma impose `@updatedAt` sur création → on force la date voulue via
    // une update postérieure (nécessaire pour simuler des annulations récentes
    // ou anciennes dans la même passe de scoring).
    const targetUpdatedAt = isCancelled && isRecent ? recentDate : oldDate;
    await prisma.$executeRaw`UPDATE parcels SET updated_at = ${targetUpdatedAt} WHERE id = ${p.id}::uuid`;
    parcels.push(p.id);
  }
  return parcels;
}

async function backdateUserCreatedAt(userId, days) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      createdAt: new Date(Date.now() - days * DAY_MS),
      lastActiveAt: new Date(),
    },
  });
}

describe('FRA-1 — fraude super-admin', () => {
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  const parcelIds = [];
  let admin;
  let regularClient;
  let safeUser;
  let mediumUser;
  let highUser;

  beforeAll(async () => {
    const staff = await registerStaff(`70${suffix}`, 'Admin fraude', 'super_admin');
    admin = { id: staff.userId, token: staff.accessToken };
    userIds.push(staff.userId);

    const c = await registerPublic(`71${suffix}`, 'Client regular', 'client');
    regularClient = { id: c.body.user.id, token: c.body.accessToken };
    userIds.push(c.body.user.id);

    // Safe : compte ancien (60j), 10 colis livrés, 0 annulé.
    const safe = await registerPublic(`72${suffix}`, 'User Safe', 'client');
    safeUser = { id: safe.body.user.id };
    userIds.push(safeUser.id);
    await backdateUserCreatedAt(safeUser.id, 60);
    const p1 = await createParcelsForSender(safeUser.id, { total: 10, cancelled: 0, recentCancelled: 0 });
    parcelIds.push(...p1);

    // Medium : compte ancien, 10 colis dont 5 annulés (ratio 50% > 30% = +25),
    // dont 4 récents (> 3 = +10). Total = 35 → medium.
    const med = await registerPublic(`73${suffix}`, 'User Medium', 'client');
    mediumUser = { id: med.body.user.id };
    userIds.push(mediumUser.id);
    await backdateUserCreatedAt(mediumUser.id, 60);
    const p2 = await createParcelsForSender(mediumUser.id, { total: 10, cancelled: 5, recentCancelled: 4 });
    parcelIds.push(...p2);

    // High : compte neuf (3j, +15), 10 colis dont 6 annulés (ratio 60% = +25),
    // dont 5 récents (+10). Total = 50. Pour pousser à high (>=75) on ajoute
    // une dette d'annulation (voir plus bas, +20) → 70 encore insuffisant.
    // On monte otp failures : création de 6 OtpCode avec attempts>0 (+20) → 90.
    const high = await registerPublic(`74${suffix}`, 'User High', 'client');
    highUser = { id: high.body.user.id };
    userIds.push(highUser.id);
    await backdateUserCreatedAt(highUser.id, 3);
    const p3 = await createParcelsForSender(highUser.id, { total: 10, cancelled: 6, recentCancelled: 5 });
    parcelIds.push(...p3);
    // OTP failures > 5 sur 24h → +20.
    for (let i = 0; i < 6; i++) {
      await prisma.otpCode.create({
        data: {
          userId: highUser.id,
          codeHash: `hash-${i}-${suffix}`,
          type: 'login',
          isUsed: false,
          attempts: 2,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.fraudAlert.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otpCode.deleteMany({ where: { userId: { in: userIds } } });
    if (parcelIds.length) {
      await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
      await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    }
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('403 pour client non super_admin sur chaque endpoint', async () => {
    const paths = [
      ['get', '/api/v1/super-admin/fraud/scores'],
      ['get', '/api/v1/super-admin/fraud/alerts'],
      ['post', '/api/v1/super-admin/fraud/refresh'],
      ['post', '/api/v1/super-admin/fraud/alerts/00000000-0000-0000-0000-000000000000/resolve'],
    ];
    for (const [method, path] of paths) {
      const res = await request(app)[method](path).set(authHeader(regularClient.token));
      expect(res.status).toBe(403);
    }
  });

  test('GET /scores : scoring correct, ordre desc, flags présents', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/fraud/scores?limit=200')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.scores)).toBe(true);

    const byId = new Map(res.body.scores.map((s) => [s.userId, s]));
    const safe = byId.get(safeUser.id);
    const med = byId.get(mediumUser.id);
    const high = byId.get(highUser.id);
    expect(safe).toBeDefined();
    expect(med).toBeDefined();
    expect(high).toBeDefined();

    expect(safe.level).toBe('safe');
    expect(safe.score).toBe(0);
    expect(['medium', 'high']).toContain(med.level);
    expect(high.level).toBe('high');
    expect(high.score).toBeGreaterThanOrEqual(75);
    // Ordre strict : high avant medium, medium avant safe.
    const idx = (id) => res.body.scores.findIndex((s) => s.userId === id);
    expect(idx(high.userId)).toBeLessThan(idx(med.userId));
    expect(idx(med.userId)).toBeLessThan(idx(safe.userId));

    // Flags attendus pour le compte high.
    expect(high.flags).toEqual(expect.arrayContaining(['new_account', 'high_cancellation_ratio']));
  });

  test('POST /refresh crée les alertes medium/high puis n’en re-crée pas', async () => {
    const first = await request(app).post('/api/v1/super-admin/fraud/refresh').set(authHeader(admin.token));
    expect(first.status).toBe(200);
    expect(first.body.created).toBeGreaterThanOrEqual(2);

    const open = await prisma.fraudAlert.findMany({
      where: { userId: { in: [mediumUser.id, highUser.id] }, resolvedAt: null },
    });
    expect(open.map((a) => a.userId).sort()).toEqual([mediumUser.id, highUser.id].sort());

    const second = await request(app).post('/api/v1/super-admin/fraud/refresh').set(authHeader(admin.token));
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(0);
  });

  test('POST /alerts/:id/resolve positionne resolvedAt + resolvedById', async () => {
    const alert = await prisma.fraudAlert.findFirst({ where: { userId: highUser.id, resolvedAt: null } });
    expect(alert).toBeTruthy();

    const res = await request(app)
      .post(`/api/v1/super-admin/fraud/alerts/${alert.id}/resolve`)
      .set(authHeader(admin.token))
      .send({ notes: 'Investigation faite, compte suspendu.' });
    expect(res.status).toBe(200);
    expect(res.body.alert.resolvedById).toBe(admin.id);
    expect(res.body.alert.resolvedAt).toBeTruthy();
    expect(res.body.alert.notes).toContain('Investigation');

    const inDb = await prisma.fraudAlert.findUnique({ where: { id: alert.id } });
    expect(inDb.resolvedAt).toBeTruthy();
    expect(inDb.resolvedById).toBe(admin.id);
  });

  test('POST /alerts/:id/resolve renvoie 404 sur alerte inconnue', async () => {
    const res = await request(app)
      .post('/api/v1/super-admin/fraud/alerts/00000000-0000-0000-0000-000000000000/resolve')
      .set(authHeader(admin.token))
      .send({ notes: 'ghost' });
    expect(res.status).toBe(404);
  });
});
