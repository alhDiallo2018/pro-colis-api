import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';
import { evaluateStopArrival, appendPosition } from '../src/modules/trips/stop-arrival.service.js';

describe('Pipeline détection arrivée + GET /advertisements/:id/reached-stops', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  let driver;
  let client;
  let outsider;
  let transitLineId;
  let advertisementId;
  let vehicleId;
  let dakarZone;
  let thiesZone;

  beforeAll(async () => {
    for (const [prefix, role] of [['83', 'driver'], ['84', 'client'], ['85', 'client']]) {
      const r = await registerPublic(`${prefix}${suffix}`, `Arrive ${prefix}`, role);
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (role === 'driver') driver = account;
      else if (!client) client = account;
      else outsider = account;
    }
    await prisma.user.update({ where: { id: driver.id }, data: { isVerified: true } });

    dakarZone = await prisma.zone.create({ data: { name: `Dakar arrive ${suffix}`, placeId: `arrive-dakar-${suffix}`, latitude: 14.6937, longitude: -17.4441, radiusKm: 2 } });
    thiesZone = await prisma.zone.create({ data: { name: `Thies arrive ${suffix}`, placeId: `arrive-thies-${suffix}`, latitude: 14.7919, longitude: -16.9359, radiusKm: 2 } });
    zoneIds.push(dakarZone.id, thiesZone.id);

    const transitLine = await prisma.transitLine.create({
      data: {
        operator: 'ddd',
        number: `A${suffix}`,
        direction: 'aller',
        name: `Ligne arrive ${suffix}`,
        origin: 'Dakar',
        destination: 'Thies',
        stops: {
          create: [
            { order: 0, zoneId: dakarZone.id, label: 'Dakar centre' },
            { order: 1, zoneId: thiesZone.id, label: 'Thies gare' }
          ]
        }
      }
    });
    transitLineId = transitLine.id;

    // Vehicle (tx uses it for journey persistence shape; our test uses prisma directly).
    const vehicle = await prisma.vehicle.create({
      data: {
        driverId: driver.id,
        type: 'bus',
        model: `Bus manifeste ${suffix}`,
        plateNumber: `DK${suffix}`,
        capacity: 25
      }
    });
    vehicleId = vehicle.id;

    const ad = await prisma.advertisement.create({
      data: {
        driverId: driver.id,
        transitLineId,
        departureCity: 'Dakar',
        arrivalCity: 'Thies',
        status: 'open'
      }
    });
    advertisementId = ad.id;

    // Offre acceptée pour le client (donne la permission de lire reached-stops).
    await prisma.advertisementOffer.create({
      data: {
        advertisementId,
        clientId: client.id,
        price: 2500,
        status: 'accepted',
        boardingStopOrder: 0,
        dropOffStopOrder: 1,
        respondedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.journeyStopEvent.deleteMany({ where: { advertisementId } });
    await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
    await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    await prisma.transitLineStop.deleteMany({ where: { transitLineId } });
    await prisma.transitLine.deleteMany({ where: { id: transitLineId } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('appendPosition : respecte la taille max et l\'ordre chronologique', () => {
    let buffer = [];
    for (let i = 0; i < 15; i++) {
      buffer = appendPosition(buffer, {
        latitude: 14 + i * 0.001,
        longitude: -17 + i * 0.001,
        capturedAt: new Date(Date.UTC(2026, 10, 11, 12, 0, i))
      });
    }
    expect(buffer).toHaveLength(10);
    expect(buffer[0].latitude).toBeCloseTo(14.005, 3);
    expect(buffer.at(-1).latitude).toBeCloseTo(14.014, 3);
  });

  test('evaluateStopArrival : persiste un événement quand GPS proche du stop', async () => {
    // Deux positions à ~30 m de la zone Dakar.
    const dLat = 30 / 111_320;
    const near1 = { latitude: 14.6937 + dLat, longitude: -17.4441, capturedAt: new Date(Date.now() - 60_000) };
    const near2 = { latitude: 14.6937 + dLat * 0.6, longitude: -17.4441, capturedAt: new Date() };
    const buffer = [near1, near2].map((p) => ({ ...p, capturedAt: p.capturedAt.toISOString() }));

    const fakeJourneyLive = {
      advertisementId,
      driverId: driver.id,
      vehicleId,
      advertisement: { id: advertisementId, transitLineId }
    };
    const result = await evaluateStopArrival(prisma, fakeJourneyLive, buffer);

    expect(result.reached).toHaveLength(1);
    expect(result.reached[0].order).toBe(0);
    expect(result.nearest.order).toBe(0);

    const events = await prisma.journeyStopEvent.findMany({ where: { advertisementId } });
    expect(events).toHaveLength(1);
    expect(events[0].stopOrder).toBe(0);
    expect(events[0].stopLabel).toBe('Dakar centre');
  });

  test('GET /reached-stops : driver voit l\'arrêt atteint', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/reached-stops`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(200);
    expect(res.body.reachedStops).toHaveLength(1);
    expect(res.body.reachedStops[0].stopOrder).toBe(0);
    expect(res.body.reachedStops[0].stopLabel).toBe('Dakar centre');
  });

  test('GET /reached-stops : client avec offre acceptée autorisé', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/reached-stops`)
      .set(authHeader(client.token));
    expect(res.status).toBe(200);
    expect(res.body.reachedStops).toHaveLength(1);
  });

  test('GET /reached-stops : client tiers 403', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/reached-stops`)
      .set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });

  test('GET /reached-stops : annonce inexistante 404', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${randomUUID()}/reached-stops`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(404);
  });

  test('evaluateStopArrival idempotent : second appel sur mêmes positions ne duplique pas', async () => {
    const dLat = 30 / 111_320;
    const near1 = { latitude: 14.6937 + dLat, longitude: -17.4441, capturedAt: new Date(Date.now() - 30_000).toISOString() };
    const near2 = { latitude: 14.6937 + dLat * 0.6, longitude: -17.4441, capturedAt: new Date().toISOString() };
    const fakeJourneyLive = {
      advertisementId,
      driverId: driver.id,
      vehicleId,
      advertisement: { id: advertisementId, transitLineId }
    };
    await evaluateStopArrival(prisma, fakeJourneyLive, [near1, near2]);

    const events = await prisma.journeyStopEvent.findMany({ where: { advertisementId } });
    expect(events).toHaveLength(1);
  });

  test('evaluateStopArrival : advertisement sans transit_line_id → no-op', async () => {
    const r = await evaluateStopArrival(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId,
      advertisement: { id: advertisementId, transitLineId: null }
    }, [{ latitude: 14.6937, longitude: -17.4441, capturedAt: new Date().toISOString() }]);
    expect(r.reached).toEqual([]);
  });
});
