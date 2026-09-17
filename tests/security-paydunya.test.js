import { createHash } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic, registerStaff, cleanupUsers } from './helpers.js';

/**
 * C5 — Idempotence de l'IPN PayDunya (aucun double crédit, y compris concurrent).
 * C6 — Sous-paiement PayDunya rejeté (aucun crédit, aucun statut « payé »).
 *
 * On installe une config PayDunya de test en base puis on rejoue l'IPN signé
 * (SHA-512 de la masterKey) pour exercer `processCompletedPayment` de bout en bout.
 */
describe('C5/C6 - PayDunya IPN idempotence et sous-paiement', () => {
  const suffix = Date.now().toString().slice(-7);
  const MASTER_KEY = `test-master-${suffix}`;
  const userIds = [];
  const parcelIds = [];
  const tokens = [];
  let clientId;
  let driverId;

  const ipnHash = createHash('sha512').update(MASTER_KEY).digest('hex');

  function ipn({ token, totalAmount, customData, status = 'completed' }) {
    return request(app).post('/api/v1/payments/paydunya/ipn').send({
      data: {
        hash: ipnHash,
        status,
        invoice: { token, total_amount: totalAmount },
        custom_data: customData
      }
    });
  }

  beforeAll(async () => {
    await prisma.systemConfig.upsert({
      where: { key: 'paydunya.masterKey' },
      update: { value: MASTER_KEY },
      create: { key: 'paydunya.masterKey', value: MASTER_KEY }
    });
    await prisma.systemConfig.upsert({
      where: { key: 'paydunya.privateKey' },
      update: { value: `test-private-${suffix}` },
      create: { key: 'paydunya.privateKey', value: `test-private-${suffix}` }
    });
    await prisma.systemConfig.upsert({
      where: { key: 'paydunya.token' },
      update: { value: `test-token-${suffix}` },
      create: { key: 'paydunya.token', value: `test-token-${suffix}` }
    });

    const client = await registerPublic(`78${suffix}`, 'Client PayDunya', 'client');
    clientId = client.body.user.id;
    userIds.push(clientId);
    const driver = await registerPublic(`76${suffix}`, 'Driver PayDunya', 'driver');
    driverId = driver.body.user.id;
    userIds.push(driverId);
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  async function scorePoints(userId) {
    const score = await prisma.score.findUnique({ where: { userId } });
    return score?.points ?? 0;
  }

  it('rejette une signature IPN invalide (403)', async () => {
    const res = await request(app).post('/api/v1/payments/paydunya/ipn').send({
      data: { hash: 'wrong-hash', status: 'completed', invoice: { token: 'BAD', total_amount: 500 }, custom_data: { type: 'score', userId: clientId, points: 500 } }
    });
    expect(res.status).toBe(403);
  });

  it('crédite les points une seule fois, même après rejeu', async () => {
    const token = `SCORE-${suffix}-1`;
    tokens.push(token);

    const first = await ipn({ token, totalAmount: 500, customData: { type: 'score', userId: clientId, points: 500 } });
    expect(first.status).toBe(200);
    expect(await scorePoints(clientId)).toBe(500);

    const replay = await ipn({ token, totalAmount: 500, customData: { type: 'score', userId: clientId, points: 500 } });
    expect(replay.status).toBe(200);
    expect(await scorePoints(clientId)).toBe(500);
  });

  it('ne crédite qu une seule fois en cas de deux IPN concurrents', async () => {
    const token = `SCORE-${suffix}-CONC`;
    tokens.push(token);

    await Promise.all([
      ipn({ token, totalAmount: 300, customData: { type: 'score', userId: clientId, points: 300 } }),
      ipn({ token, totalAmount: 300, customData: { type: 'score', userId: clientId, points: 300 } })
    ]);

    expect(await scorePoints(clientId)).toBe(500 + 300);
  });

  it('ne crédite aucun point sur un sous-paiement', async () => {
    const before = await scorePoints(clientId);
    const token = `SCORE-${suffix}-UNDER`;

    const res = await ipn({ token, totalAmount: 100, customData: { type: 'score', userId: clientId, points: 500 } });
    expect(res.status).toBe(200);
    expect(await scorePoints(clientId)).toBe(before);

    const payment = await prisma.payment.findUnique({ where: { transactionId: token } });
    expect(payment).toBeNull();
  });

  it('ne crédite aucun wallet sur un sous-paiement de colis', async () => {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `PD-UNDER-${suffix}`,
        senderId: clientId,
        senderName: 'Client PayDunya',
        senderPhone: `78${suffix}`,
        receiverName: 'Dest PayDunya',
        receiverPhone: `70${suffix}`,
        description: 'Colis PayDunya',
        weight: '1.00',
        status: 'delivered',
        assignedDriverId: driverId,
        price: '5000',
        totalAmount: '5000'
      }
    });
    parcelIds.push(parcel.id);
    const token = `PARCEL-${suffix}-UNDER`;

    const res = await ipn({ token, totalAmount: 200, customData: { type: 'parcel', userId: clientId, parcelId: parcel.id } });
    expect(res.status).toBe(200);

    const updated = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(updated.paymentStatus).toBeNull();
    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet?.balance ?? 0)).toBe(0);
  });

  it('marque le colis payé et crédite le chauffeur au montant exact', async () => {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `PD-OK-${suffix}`,
        senderId: clientId,
        senderName: 'Client PayDunya',
        senderPhone: `78${suffix}`,
        receiverName: 'Dest PayDunya',
        receiverPhone: `70${suffix}`,
        description: 'Colis PayDunya OK',
        weight: '1.00',
        status: 'delivered',
        assignedDriverId: driverId,
        price: '5000',
        totalAmount: '5000'
      }
    });
    parcelIds.push(parcel.id);
    const token = `PARCEL-${suffix}-OK`;

    const res = await ipn({ token, totalAmount: 5000, customData: { type: 'parcel', userId: clientId, parcelId: parcel.id } });
    expect(res.status).toBe(200);

    const updated = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(updated.paymentStatus).toBe('completed');

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    // commission 0 (aucune config active) → gain = prix
    expect(Number(wallet?.balance ?? 0)).toBe(5000);

    // Rejeu idempotent : pas de double crédit du chauffeur.
    await ipn({ token, totalAmount: 5000, customData: { type: 'parcel', userId: clientId, parcelId: parcel.id } });
    const walletAfterReplay = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(walletAfterReplay?.balance ?? 0)).toBe(5000);
  });

  it('crédite le wallet une seule fois (top-up libre)', async () => {
    const token = `WALLET-${suffix}-1`;
    const before = Number((await prisma.wallet.findUnique({ where: { userId: clientId } }))?.balance ?? 0);

    await ipn({ token, totalAmount: 300, customData: { type: 'wallet', userId: clientId } });
    const afterFirst = Number((await prisma.wallet.findUnique({ where: { userId: clientId } })).balance ?? 0);
    expect(afterFirst).toBe(before + 300);

    await ipn({ token, totalAmount: 300, customData: { type: 'wallet', userId: clientId } });
    const afterReplay = Number((await prisma.wallet.findUnique({ where: { userId: clientId } })).balance ?? 0);
    expect(afterReplay).toBe(before + 300);
  });

  it('ignore un IPN non « completed » (échec/annulation)', async () => {
    const before = await scorePoints(clientId);
    await ipn({ token: `SCORE-${suffix}-FAILED`, totalAmount: 500, customData: { type: 'score', userId: clientId, points: 500 }, status: 'failed' });
    expect(await scorePoints(clientId)).toBe(before);
  });
});
