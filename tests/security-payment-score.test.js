import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, registerPublic, registerStaff, cleanupUsers } from './helpers.js';

/**
 * C2 — confirmPayment : autorisation strictement staff.
 * C3 — purchaseScore : aucun crédit de points sans paiement réel.
 * C4 — /score/debit|credit|refund : réservés aux rôles staff.
 */
describe('C2/C3/C4 - autorisation des opérations financières', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let client;
  let driver;
  let support;

  beforeAll(async () => {
    client = await registerPublic(`78${suffix}`, 'Client Fin', 'client');
    userIds.push(client.body.user.id);
    driver = await registerPublic(`76${suffix}`, 'Driver Fin', 'driver');
    userIds.push(driver.body.user.id);
    const sup = await registerStaff(`75${suffix}`, 'Support Fin', 'support');
    support = { userId: sup.userId, accessToken: sup.accessToken };
    userIds.push(sup.userId);
  });

  afterAll(async () => {
    const paymentIds = await prisma.payment.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds.map((p) => p.id) } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------
  // C2 — confirmPayment
  // ------------------------------------------------------------
  describe('confirmPayment', () => {
    it('refuse un utilisateur non authentifié (401)', async () => {
      const p = await request(app).post('/api/v1/payments/initiate').set(authHeader(client.body.accessToken)).send({ amount: 1000, method: 'cash' });
      const res = await request(app).post(`/api/v1/payments/${p.body.payment.id}/confirm`).send({});
      expect(res.status).toBe(401);
    });

    it('refuse le propriétaire CLIENT (403)', async () => {
      const p = await request(app).post('/api/v1/payments/initiate').set(authHeader(client.body.accessToken)).send({ amount: 1000, method: 'cash' });
      const res = await request(app)
        .post(`/api/v1/payments/${p.body.payment.id}/confirm`)
        .set(authHeader(client.body.accessToken))
        .send({});
      expect(res.status).toBe(403);
    });

    it('refuse un autre DRIVER (403)', async () => {
      const p = await request(app).post('/api/v1/payments/initiate').set(authHeader(client.body.accessToken)).send({ amount: 1000, method: 'cash' });
      const res = await request(app)
        .post(`/api/v1/payments/${p.body.payment.id}/confirm`)
        .set(authHeader(driver.body.accessToken))
        .send({});
      expect(res.status).toBe(403);
    });

    it('autorise le support à confirmer et reste idempotent', async () => {
      const p = await request(app).post('/api/v1/payments/initiate').set(authHeader(client.body.accessToken)).send({ amount: 1000, method: 'cash' });
      const res = await request(app)
        .post(`/api/v1/payments/${p.body.payment.id}/confirm`)
        .set(authHeader(support.accessToken))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe('completed');

      // Re-confirmation → conflit, pas de double traitement.
      const again = await request(app)
        .post(`/api/v1/payments/${p.body.payment.id}/confirm`)
        .set(authHeader(support.accessToken))
        .send({});
      expect(again.status).toBe(409);
    });

    it('répond 404 sur un identifiant inconnu sans fuite', async () => {
      const res = await request(app)
        .post('/api/v1/payments/00000000-0000-0000-0000-000000000000/confirm')
        .set(authHeader(support.accessToken))
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ------------------------------------------------------------
  // C3 — purchaseScore
  // ------------------------------------------------------------
  describe('purchaseScore', () => {
    it('ne crédite aucun point sans paiement PayDunya réel', async () => {
      const res = await request(app)
        .post('/api/v1/score/purchase')
        .set(authHeader(client.body.accessToken))
        .send({ points: 5000 });

      // PayDunya non configuré en test → la création de facture échoue.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);

      const score = await prisma.score.findUnique({ where: { userId: client.body.user.id } });
      expect(score?.points ?? 0).toBe(0);
      const txCount = await prisma.scoreTransaction.count({ where: { userId: client.body.user.id } });
      expect(txCount).toBe(0);
    });

    it('ne crédite aucun point malgré un montant falsifié', async () => {
      const res = await request(app)
        .post('/api/v1/score/purchase')
        .set(authHeader(client.body.accessToken))
        .send({ points: 5000, amount: 9999999, method: 'cash' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);

      const score = await prisma.score.findUnique({ where: { userId: client.body.user.id } });
      expect(score?.points ?? 0).toBe(0);
    });
  });

  // ------------------------------------------------------------
  // C4 — /score/debit|credit|refund
  // ------------------------------------------------------------
  describe('score credit/debit/refund', () => {
    it('refuse un utilisateur non authentifié (401)', async () => {
      for (const path of ['/api/v1/score/credit', '/api/v1/score/debit', '/api/v1/score/refund']) {
        const res = await request(app).post(path).send({ amount: 10 });
        expect(res.status).toBe(401);
      }
    });

    it.each(['client', 'driver'])('refuse le crédit arbitraire à %s (403)', async (role) => {
      const tok = role === 'client' ? client.body.accessToken : driver.body.accessToken;
      const res = await request(app)
        .post('/api/v1/score/credit')
        .set(authHeader(tok))
        .send({ amount: 10 });
      expect(res.status).toBe(403);
    });

    it.each(['client', 'driver'])('refuse le débit arbitraire à %s (403)', async (role) => {
      const tok = role === 'client' ? client.body.accessToken : driver.body.accessToken;
      const res = await request(app)
        .post('/api/v1/score/debit')
        .set(authHeader(tok))
        .send({ userId: support.userId, amount: 10 });
      expect(res.status).toBe(403);
    });

    it.each(['client', 'driver'])('refuse le refund arbitraire à %s (403)', async (role) => {
      const tok = role === 'client' ? client.body.accessToken : driver.body.accessToken;
      const res = await request(app)
        .post('/api/v1/score/refund')
        .set(authHeader(tok))
        .send({ amount: 10 });
      expect(res.status).toBe(403);
    });

    it('autorise le support à créditer/débiter des points', async () => {
      const credit = await request(app)
        .post('/api/v1/score/credit')
        .set(authHeader(support.accessToken))
        .send({ userId: client.body.user.id, amount: 50, description: 'test credit' });
      expect(credit.status).toBe(200);

      const score = await prisma.score.findUnique({ where: { userId: client.body.user.id } });
      expect(score.points).toBe(50);

      const debit = await request(app)
        .post('/api/v1/score/debit')
        .set(authHeader(support.accessToken))
        .send({ userId: client.body.user.id, amount: 20, description: 'test debit' });
      expect(debit.status).toBe(200);

      const after = await prisma.score.findUnique({ where: { userId: client.body.user.id } });
      expect(after.points).toBe(30);
    });
  });
});
