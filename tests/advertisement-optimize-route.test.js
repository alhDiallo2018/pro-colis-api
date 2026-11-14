import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('SCP-051 — POST /advertisements/:id/optimize-route', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  const zoneIds = [];
  let driver;
  let client;
  let outsider;
  let advertisementId;
  let dakarZone;
  let thiesZone;
  let mbourZone;
  let saintLouisZone;

  async function createParcelAt(arrivalZone) {
    const p = await prisma.parcel.create({
      data: {
        senderId: client.id,
        senderName: 'Shipper',
        senderPhone: `88${suffix}`,
        description: `Colis optimize ${Math.random().toString(36).slice(2, 5)}`,
        weight: 1,
        departureZoneId: dakarZone.id,
        arrivalZoneId: arrivalZone.id,
        receiverName: `Dest ${arrivalZone.name}`,
        receiverPhone: `77700${suffix.slice(-3)}`,
        receiverAddress: arrivalZone.name,
        trackingNumber: `OPT${suffix}${Math.random().toString(36).slice(2, 6)}`,
        status: 'free'
      }
    });
    parcelIds.push(p.id);
    return p;
  }

  beforeAll(async () => {
    for (const [prefix, role] of [['82', 'driver'], ['83', 'client'], ['84', 'client']]) {
      const r = await registerPublic(`${prefix}${suffix}OP`, `Opt ${prefix}`, role);
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (role === 'driver') driver = account;
      else if (!client) client = account;
      else outsider = account;
    }
    await prisma.user.update({ where: { id: driver.id }, data: { isVerified: true } });

    dakarZone = await prisma.zone.create({ data: { name: `Dakar opt ${suffix}`, placeId: `opt-dakar-${suffix}`, latitude: 14.6937, longitude: -17.4441 } });
    thiesZone = await prisma.zone.create({ data: { name: `Thies opt ${suffix}`, placeId: `opt-thies-${suffix}`, latitude: 14.7919, longitude: -16.9359 } });
    mbourZone = await prisma.zone.create({ data: { name: `Mbour opt ${suffix}`, placeId: `opt-mbour-${suffix}`, latitude: 14.4199, longitude: -16.9664 } });
    saintLouisZone = await prisma.zone.create({ data: { name: `SL opt ${suffix}`, placeId: `opt-sl-${suffix}`, latitude: 16.0326, longitude: -16.489 } });
    zoneIds.push(dakarZone.id, thiesZone.id, mbourZone.id, saintLouisZone.id);

    const ad = await prisma.advertisement.create({
      data: {
        driverId: driver.id,
        departureZoneId: dakarZone.id,
        departureCity: 'Dakar',
        arrivalCity: 'Multi',
        status: 'open'
      }
    });
    advertisementId = ad.id;
  });

  afterAll(async () => {
    await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
    await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('3 offres acceptées : retourne un ordre + distance > 0', async () => {
    const p1 = await createParcelAt(thiesZone);
    const p2 = await createParcelAt(mbourZone);
    const p3 = await createParcelAt(saintLouisZone);
    for (const parcel of [p1, p2, p3]) {
      await prisma.advertisementOffer.create({
        data: {
          advertisementId,
          clientId: client.id,
          parcelId: parcel.id,
          price: 2500,
          status: 'accepted',
          respondedAt: new Date()
        }
      });
    }

    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/optimize-route`)
      .set(authHeader(driver.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ordered).toHaveLength(3);
    expect(res.body.distanceKm).toBeGreaterThan(0);
    expect(res.body.improvedBy).toBeGreaterThanOrEqual(0);
    // Chaque arrêt porte bien son parcelId et sa coord.
    for (const s of res.body.ordered) {
      expect(s.parcelId).toBeTruthy();
      expect(typeof s.latitude).toBe('number');
      expect(typeof s.longitude).toBe('number');
    }
    // Les 3 parcels sont présents sans doublon.
    const ids = new Set(res.body.ordered.map((s) => s.parcelId));
    expect(ids.size).toBe(3);
  });

  test('aucune offre acceptée : réponse 200 avec ordered vide', async () => {
    // Nouvelle annonce sans offres.
    const ad2 = await prisma.advertisement.create({
      data: { driverId: driver.id, departureZoneId: dakarZone.id, status: 'open' }
    });
    const res = await request(app)
      .post(`/api/v1/advertisements/${ad2.id}/optimize-route`)
      .set(authHeader(driver.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ordered).toEqual([]);
    expect(res.body.distanceKm).toBe(0);
    await prisma.advertisement.deleteMany({ where: { id: ad2.id } });
  });

  test('client tiers (non-driver, non-admin) : 403', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/optimize-route`)
      .set(authHeader(outsider.token))
      .send({});
    expect(res.status).toBe(403);
  });

  test('annonce inexistante : 404', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${randomUUID()}/optimize-route`)
      .set(authHeader(driver.token))
      .send({});
    expect(res.status).toBe(404);
  });

  test('config maxIterations respectée', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/optimize-route`)
      .set(authHeader(driver.token))
      .send({ config: { maxIterations: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.iterations).toBeLessThanOrEqual(1);
  });
});
