import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('GET /advertisements/:id/manifest — manifeste navette', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  const parcelIds = [];
  let driver;
  let client;
  let outsider;
  let transitLineId;
  let advertisementId;

  beforeAll(async () => {
    for (const [prefix, role] of [['80', 'driver'], ['81', 'client'], ['82', 'client']]) {
      const res = await registerPublic(`${prefix}${suffix}`, `Manifest ${prefix}`, role);
      expect(res.status).toBe(201);
      userIds.push(res.body.user.id);
      const account = { id: res.body.user.id, token: res.body.accessToken };
      if (role === 'driver') driver = account;
      else if (!client) client = account;
      else outsider = account;
    }
    await prisma.user.update({ where: { id: driver.id }, data: { isVerified: true } });

    // Trois zones (points d'arrêt) en Mt Senegal autour de Dakar.
    const zones = await Promise.all([
      prisma.zone.create({ data: { name: `Dakar ${suffix}`, placeId: `manifest-dakar-${suffix}`, latitude: 14.6937, longitude: -17.4441, radiusKm: 2 } }),
      prisma.zone.create({ data: { name: `Thies ${suffix}`, placeId: `manifest-thies-${suffix}`, latitude: 14.7919, longitude: -16.9359, radiusKm: 2 } }),
      prisma.zone.create({ data: { name: `Mbour ${suffix}`, placeId: `manifest-mbour-${suffix}`, latitude: 14.4199, longitude: -16.9664, radiusKm: 2 } })
    ]);
    zoneIds.push(...zones.map((z) => z.id));

    const transitLine = await prisma.transitLine.create({
      data: {
        operator: 'ddd',
        number: `M${suffix}`,
        direction: 'aller',
        name: `Ligne manifeste ${suffix}`,
        origin: 'Dakar',
        destination: 'Mbour',
        stops: {
          create: [
            { order: 0, zoneId: zones[0].id, label: 'Dakar' },
            { order: 1, zoneId: zones[1].id, label: 'Thies' },
            { order: 2, zoneId: zones[2].id, label: 'Mbour' }
          ]
        }
      }
    });
    transitLineId = transitLine.id;

    const ad = await prisma.advertisement.create({
      data: {
        driverId: driver.id,
        transitLineId,
        departureCity: 'Dakar',
        arrivalCity: 'Mbour',
        status: 'open'
      }
    });
    advertisementId = ad.id;

    // Deux colis : l'un Dakar → Thies, l'autre Dakar → Mbour.
    for (const [index, dropOff] of [[0, 1], [1, 2]]) {
      const parcel = await prisma.parcel.create({
        data: {
          senderId: client.id,
          senderName: `Manifest 81`,
          senderPhone: `81${suffix}`,
          description: `Colis manifeste ${index}`,
          weight: 2,
          departureZoneId: zones[0].id,
          arrivalZoneId: zones[dropOff].id,
          receiverName: `Destinataire ${index}`,
          receiverPhone: `77800${index}${suffix.slice(-3)}`,
          receiverAddress: index === 0 ? 'Thies centre' : 'Mbour plage',
          trackingNumber: `MF${suffix}${index}`,
          status: 'free'
        }
      });
      parcelIds.push(parcel.id);

      await prisma.advertisementOffer.create({
        data: {
          advertisementId,
          clientId: client.id,
          parcelId: parcel.id,
          price: 3500,
          status: 'accepted',
          boardingStopOrder: 0,
          dropOffStopOrder: dropOff,
          respondedAt: new Date()
        }
      });
    }
  });

  afterAll(async () => {
    await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
    await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    await prisma.transitLineStop.deleteMany({ where: { transitLineId } });
    await prisma.transitLine.deleteMany({ where: { id: transitLineId } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('driver du trajet voit les colis groupés par arrêt', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/manifest`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.advertisementId).toBe(advertisementId);
    expect(body.transitLineId).toBe(transitLineId);
    expect(body.totalOffers).toBe(2);
    expect(body.stops).toHaveLength(3);
    expect(body.stops[0].order).toBe(0);
    expect(body.stops[0].label).toBe('Dakar');
    expect(body.stops[0].picked).toHaveLength(2);
    expect(body.stops[0].dropOffs).toHaveLength(0);
    expect(body.stops[1].picked).toHaveLength(0);
    expect(body.stops[1].dropOffs).toHaveLength(1);
    expect(body.stops[2].dropOffs).toHaveLength(1);
    expect(body.unassigned).toEqual([]);
  });

  test('client ayant une offre acceptée voit le manifeste', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/manifest`)
      .set(authHeader(client.token));
    expect(res.status).toBe(200);
    expect(res.body.stops).toHaveLength(3);
  });

  test('client tiers sans offre : 403', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/manifest`)
      .set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });

  test('annonce inexistante : 404', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/00000000-0000-0000-0000-000000000000/manifest`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(404);
  });
});
