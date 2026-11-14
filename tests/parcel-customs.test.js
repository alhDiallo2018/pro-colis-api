import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('SCP-040 — ParcelCustoms', () => {
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  const parcelIds = [];
  let sender;
  let outsider;
  let parcelId;

  beforeAll(async () => {
    for (const prefix of ['70', '71']) {
      const r = await registerPublic(`${prefix}${suffix}`, `Cust ${prefix}`, 'client');
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const acc = { id: r.body.user.id, token: r.body.accessToken };
      if (!sender) sender = acc;
      else outsider = acc;
    }
    const parcel = await prisma.parcel.create({
      data: {
        senderId: sender.id,
        senderName: 'S',
        senderPhone: `91${suffix}`,
        description: 'Colis cust',
        weight: 2,
        receiverName: 'Dest',
        receiverPhone: `77777${suffix.slice(-3)}`,
        receiverAddress: 'Lyon',
        trackingNumber: `CU${suffix}`,
        status: 'pending'
      }
    });
    parcelId = parcel.id;
    parcelIds.push(parcelId);
  });

  afterAll(async () => {
    await prisma.parcelCustoms.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('create : OK avec champs minimaux', async () => {
    const res = await request(app)
      .post(`/api/v1/parcels/${parcelId}/customs`)
      .set(authHeader(sender.token))
      .send({
        originCountry: 'SN',
        destinationCountry: 'FR',
        contentsDescription: 'Textile artisanal',
        declaredValue: 25000,
        declaredCurrency: 'XOF',
        purpose: 'gift',
        quantity: 3
      });
    expect(res.status).toBe(201);
    expect(res.body.customs.originCountry).toBe('SN');
    expect(res.body.customs.destinationCountry).toBe('FR');
    expect(res.body.customs.purpose).toBe('gift');
    expect(res.body.customs.signedAt).toBeNull();
  });

  test('create : second appel → 409 (unique)', async () => {
    const res = await request(app)
      .post(`/api/v1/parcels/${parcelId}/customs`)
      .set(authHeader(sender.token))
      .send({
        originCountry: 'SN',
        destinationCountry: 'FR',
        contentsDescription: 'Encore',
        declaredValue: 10000,
        purpose: 'personal'
      });
    expect(res.status).toBe(409);
  });

  test('update : modifie les champs', async () => {
    const res = await request(app)
      .put(`/api/v1/parcels/${parcelId}/customs`)
      .set(authHeader(sender.token))
      .send({
        originCountry: 'SN',
        destinationCountry: 'FR',
        contentsDescription: 'Textile artisanal SN',
        declaredValue: 30000,
        purpose: 'gift',
        hsCode: '6204',
        quantity: 2
      });
    expect(res.status).toBe(200);
    expect(res.body.customs.declaredValue).toBe(30000);
    expect(res.body.customs.hsCode).toBe('6204');
    expect(res.body.customs.quantity).toBe(2);
  });

  test('sign : fige la déclaration', async () => {
    const res = await request(app)
      .post(`/api/v1/parcels/${parcelId}/customs/sign`)
      .set(authHeader(sender.token));
    expect(res.status).toBe(200);
    expect(res.body.customs.signedAt).toBeTruthy();
    expect(res.body.customs.signedById).toBe(sender.id);
  });

  test('update après sign : 409', async () => {
    const res = await request(app)
      .put(`/api/v1/parcels/${parcelId}/customs`)
      .set(authHeader(sender.token))
      .send({
        originCountry: 'SN',
        destinationCountry: 'FR',
        contentsDescription: 'Après signature',
        declaredValue: 50000,
        purpose: 'commercial'
      });
    expect(res.status).toBe(409);
  });

  test('tiers non autorisé : 403', async () => {
    const res = await request(app)
      .get(`/api/v1/parcels/${parcelId}/customs`)
      .set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });

  test('propriétaire voit sa déclaration', async () => {
    const res = await request(app)
      .get(`/api/v1/parcels/${parcelId}/customs`)
      .set(authHeader(sender.token));
    expect(res.status).toBe(200);
    expect(res.body.customs.signedAt).toBeTruthy();
  });

  test('create : validation code pays invalide', async () => {
    const parcel = await prisma.parcel.create({
      data: {
        senderId: sender.id,
        senderName: 'S',
        senderPhone: `91${suffix}`,
        description: 'Colis cust 2',
        weight: 1,
        receiverName: 'Dest',
        receiverPhone: '77000',
        receiverAddress: 'X',
        trackingNumber: `CU${suffix}B`,
        status: 'pending'
      }
    });
    parcelIds.push(parcel.id);
    const res = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/customs`)
      .set(authHeader(sender.token))
      .send({
        originCountry: 'SEN', // invalide
        destinationCountry: 'FR',
        contentsDescription: 'OK',
        declaredValue: 10000,
        purpose: 'personal'
      });
    expect(res.status).toBe(422);
  });

  test('create : parcel inexistant → 404', async () => {
    const res = await request(app)
      .post(`/api/v1/parcels/${randomUUID()}/customs`)
      .set(authHeader(sender.token))
      .send({
        originCountry: 'SN',
        destinationCountry: 'FR',
        contentsDescription: 'Z',
        declaredValue: 1000,
        purpose: 'personal'
      });
    expect(res.status).toBe(404);
  });
});
