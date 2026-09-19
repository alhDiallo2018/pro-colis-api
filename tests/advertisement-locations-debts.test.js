import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('annonces : lieux résolus et consultation des dettes', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  const garageIds = [];
  const parcelIds = [];
  let driver;
  let client;
  let otherClient;
  let zone;
  let advertisementId;

  beforeAll(async () => {
    for (const [prefix, role] of [['75', 'driver'], ['76', 'client'], ['77', 'client']]) {
      const response = await registerPublic(`${prefix}${suffix}`, `Test lieux ${prefix}`, role);
      expect(response.status).toBe(201);
      userIds.push(response.body.user.id);
      const account = { id: response.body.user.id, token: response.body.accessToken };
      if (role === 'driver') driver = account;
      else if (!client) client = account;
      else otherClient = account;
    }
    await prisma.user.update({ where: { id: driver.id }, data: { isVerified: true } });
    // Point hors couverture sénégalaise pour exercer la création d'une zone
    // pending. Les UUID zone et garage miroir doivent rester distincts.
    const resolved = await request(app).post('/api/v1/zones/resolve')
      .set(authHeader(driver.token)).send({
        name: `Localité test ${suffix}`, placeId: `test-lieu-${suffix}`,
        latitude: -70, longitude: -120
      });
    expect(resolved.status).toBe(201);
    zone = resolved.body.data;
    zoneIds.push(zone.id);
    garageIds.push(resolved.body.garageId);
    expect(zone.id).not.toBe(resolved.body.garageId);

    for (const account of [client, otherClient]) {
      const parcel = await prisma.parcel.create({ data: {
        trackingNumber: `DEBT-LOC-${account.id}`, senderId: account.id,
        senderName: 'Client test', senderPhone: '770000000',
        receiverName: 'Destinataire', receiverPhone: '780000000',
        description: 'Test dette', weight: 1, createdBy: account.id
      } });
      parcelIds.push(parcel.id);
      await prisma.clientPenaltyDebt.createMany({ data: [
        { userId: account.id, parcelId: parcel.id, amount: 1000, remaining: 400,
          status: 'partially_paid', reference: `PARTIAL-${account.id}`, reason: 'Annulation' },
        { userId: account.id, parcelId: parcel.id, amount: 500, remaining: 0,
          status: 'paid', reference: `PAID-${account.id}`, settledAt: new Date() }
      ] });
    }
  });

  afterAll(async () => {
    await prisma.advertisement.deleteMany({ where: { driverId: { in: userIds } } });
    await prisma.clientPenaltyDebt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.garage.deleteMany({ where: { id: { in: garageIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('crée une annonce avec une nouvelle zone et expose son nom sans ville', async () => {
    const response = await request(app).post('/api/v1/advertisements')
      .set(authHeader(driver.token)).send({
        departureZoneId: zone.id, departureCity: ' ', arrivalCity: 'Thiès'
      });
    expect(response.status).toBe(201);
    advertisementId = response.body.advertisement.id;
    expect(response.body.advertisement).toMatchObject({
      departureZoneId: zone.id, departureName: zone.name,
      departureZoneName: zone.name, departureCity: zone.name, arrivalName: 'Thiès'
    });
  });

  test('conserve les mêmes lieux dans les listes, le détail et les modifications', async () => {
    for (const path of ['/advertisements', '/advertisements/my', `/advertisements/${advertisementId}`]) {
      const response = await request(app).get(`/api/v1${path}`).set(authHeader(driver.token));
      expect(response.status).toBe(200);
      const ad = response.body.advertisement || response.body.advertisements.find((row) => row.id === advertisementId);
      expect(ad.departureName).toBe(zone.name);
      expect(ad.arrivalName).toBe('Thiès');
    }
    const updated = await request(app).put(`/api/v1/advertisements/${advertisementId}`)
      .set(authHeader(driver.token)).send({ description: 'Trajet mis à jour' });
    expect(updated.status).toBe(200);
    expect(updated.body.advertisement.departureName).toBe(zone.name);
    const unchanged = await request(app).put(`/api/v1/advertisements/${advertisementId}`)
      .set(authHeader(driver.token)).send({ description: 'Trajet mis à jour' });
    expect(unchanged.body.advertisement.departureName).toBe(zone.name);
  });

  test('affiche aussi les lieux des anciennes annonces avec garages', async () => {
    const response = await request(app).post('/api/v1/advertisements')
      .set(authHeader(driver.token)).send({ departureGarageId: garageIds[0], arrivalCity: 'Dakar' });
    expect(response.status).toBe(201);
    expect(response.body.advertisement.departureName).toBe(zone.name);
    expect(response.body.advertisement.departureCity).toBe(zone.name);
  });

  test('expose uniquement les dettes du client et un total global malgré la pagination', async () => {
    const response = await request(app).get(`/api/v1/client/debts?limit=1&userId=${otherClient.id}`)
      .set(authHeader(client.token));
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(2);
    expect(response.body.debts).toHaveLength(1);
    expect(response.body.debts[0].reference).toContain(client.id);
    expect(response.body.debts[0].trackingNumber).toBe(`DEBT-LOC-${client.id}`);
    expect(typeof response.body.debts[0].remaining).toBe('number');
    expect(response.body.summary.totalDebt).toBe(400);
    const paid = await request(app).get('/api/v1/client/debts?status=paid').set(authHeader(client.token));
    expect(paid.body.debts).toHaveLength(1);
    expect(paid.body.debts[0].remaining).toBe(0);
    expect(paid.body.summary.totalDebt).toBe(400);
  });

  test('protège la consultation et valide le filtre', async () => {
    expect((await request(app).get('/api/v1/client/debts')).status).toBe(401);
    expect((await request(app).get('/api/v1/client/debts').set(authHeader(driver.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/client/debts?status=invalid').set(authHeader(client.token))).status).toBe(422);
  });
});
