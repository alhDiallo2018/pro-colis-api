import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerStaff, registerPublic } from './helpers.js';

const base = '/api/v1/shuttle-operator/live';

// SCP-006 (Phase 2 chantier 3) : supervision temps réel des trajets actifs
// scopée à l'opérateur connecté. Un trajet apparaît si la JourneyLive associée
// est récente (capturedAt > now - 60s) et porte sur une de SES lignes.
describe('GET /shuttle-operator/live', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  const parcelIds = [];
  let aliceOperator; // propriétaire des lignes
  let bobOperator;   // autre opérateur (doit voir vide)
  let driver;
  let shipper;       // client expéditeur
  let transitLineId;
  let advertisementId;
  let vehicleId;

  beforeAll(async () => {
    const a = await registerStaff(`60${suffix}`, 'Alice Live', 'shuttle_operator');
    const b = await registerStaff(`61${suffix}`, 'Bob Live', 'shuttle_operator');
    aliceOperator = { id: a.userId, token: a.accessToken };
    bobOperator = { id: b.userId, token: b.accessToken };
    userIds.push(aliceOperator.id, bobOperator.id);

    const d = await registerPublic(`62${suffix}`, 'Driver Live', 'driver');
    expect(d.status).toBe(201);
    driver = { id: d.body.user.id, token: d.body.accessToken };
    userIds.push(driver.id);

    const c = await registerPublic(`63${suffix}`, 'Shipper Live', 'client');
    expect(c.status).toBe(201);
    shipper = { id: c.body.user.id, token: c.body.accessToken };
    userIds.push(shipper.id);

    const zones = await Promise.all([
      prisma.zone.create({ data: { name: `LD ${suffix}`, placeId: `live-d-${suffix}`, latitude: 14.6937, longitude: -17.4441, radiusKm: 2 } }),
      prisma.zone.create({ data: { name: `LT ${suffix}`, placeId: `live-t-${suffix}`, latitude: 14.7919, longitude: -16.9359, radiusKm: 2 } }),
      prisma.zone.create({ data: { name: `LM ${suffix}`, placeId: `live-m-${suffix}`, latitude: 14.4199, longitude: -16.9664, radiusKm: 2 } }),
    ]);
    zoneIds.push(...zones.map((z) => z.id));

    const line = await prisma.transitLine.create({
      data: {
        operator: 'ddd',
        operatorUserId: aliceOperator.id,
        number: `L${suffix}`,
        direction: 'aller',
        name: `Ligne live ${suffix}`,
        origin: 'Dakar',
        destination: 'Mbour',
        stops: {
          create: [
            { order: 0, zoneId: zones[0].id, label: 'Dakar' },
            { order: 1, zoneId: zones[1].id, label: 'Thies' },
            { order: 2, zoneId: zones[2].id, label: 'Mbour' },
          ],
        },
      },
    });
    transitLineId = line.id;

    // Véhicule du chauffeur (nécessaire pour JourneyLive).
    const vehicle = await prisma.vehicle.create({
      data: { driverId: driver.id, type: 'bus', model: 'Bus live', plateNumber: `LV${suffix}`, capacity: 25 },
    });
    vehicleId = vehicle.id;

    // Flotte de l'opérateur Alice (non liée à l'advertisement, juste pour les comptes).
    await prisma.shuttleVehicle.create({
      data: { operatorUserId: aliceOperator.id, plateNumber: `AV-${suffix}`, model: 'Fleet A', type: 'bus', capacity: 30, status: 'available' },
    });
    await prisma.shuttleVehicle.create({
      data: { operatorUserId: aliceOperator.id, plateNumber: `AV2-${suffix}`, model: 'Fleet B', type: 'minibus', capacity: 18, status: 'maintenance' },
    });

    const ad = await prisma.advertisement.create({
      data: {
        driverId: driver.id,
        transitLineId,
        departureCity: 'Dakar',
        arrivalCity: 'Mbour',
        status: 'open',
      },
    });
    advertisementId = ad.id;

    // Deux offres acceptées, un parcel par offre (totaux pickup/dropoff).
    for (const [index, dropOff] of [[0, 1], [1, 2]]) {
      const parcel = await prisma.parcel.create({
        data: {
          senderId: shipper.id,
          senderName: 'Shipper Live',
          senderPhone: `63${suffix}`,
          description: `Colis live ${index}`,
          weight: 2,
          departureZoneId: zones[0].id,
          arrivalZoneId: zones[dropOff].id,
          receiverName: `Dest ${index}`,
          receiverPhone: `77${index}00${suffix.slice(-3)}`,
          receiverAddress: `Addr ${index}`,
          trackingNumber: `LV${suffix}${index}`,
          status: 'free',
        },
      });
      parcelIds.push(parcel.id);
      await prisma.advertisementOffer.create({
        data: {
          advertisementId,
          clientId: shipper.id,
          parcelId: parcel.id,
          price: 3500,
          status: 'accepted',
          boardingStopOrder: 0,
          dropOffStopOrder: dropOff,
          respondedAt: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.shuttleStopConfirmation.deleteMany({ where: { advertisementId } });
    await prisma.journeyStopEvent.deleteMany({ where: { advertisementId } });
    await prisma.journeyLive.deleteMany({ where: { advertisementId } });
    await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
    await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    await prisma.shuttleVehicle.deleteMany({ where: { operatorUserId: aliceOperator.id } });
    await prisma.transitLineStop.deleteMany({ where: { transitLineId } });
    await prisma.transitLine.deleteMany({ where: { id: transitLineId } });
    await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('RBAC : un client ne peut pas accéder (403)', async () => {
    const res = await request(app).get(base).set(authHeader(shipper.token));
    expect(res.status).toBe(403);
  });

  test('aucune JourneyLive active → activeJourneys vide, fleet renseignée', async () => {
    const res = await request(app).get(base).set(authHeader(aliceOperator.token));
    expect(res.status).toBe(200);
    expect(res.body.activeJourneys).toEqual([]);
    expect(res.body.fleet).toEqual({ available: 1, maintenance: 1, retired: 0 });
    expect(typeof res.body.generatedAt).toBe('string');
  });

  test('JourneyLive récente → trajet apparaît avec métriques', async () => {
    await prisma.journeyLive.create({
      data: {
        advertisementId,
        driverId: driver.id,
        vehicleId,
        latitude: 14.7919,
        longitude: -16.9359,
        accuracyMeters: 10,
        capturedAt: new Date(),
      },
    });
    // Un arrêt atteint (Dakar) et une pickup confirmée sur la première offre.
    const firstOffer = await prisma.advertisementOffer.findFirst({ where: { advertisementId, boardingStopOrder: 0 } });
    await prisma.journeyStopEvent.create({
      data: {
        advertisementId,
        driverId: driver.id,
        vehicleId,
        transitLineId,
        stopOrder: 0,
        stopLabel: 'Dakar',
        zoneId: null,
        distanceMeters: 50,
        radiusMeters: 500,
        reachedAt: new Date(),
      },
    });
    await prisma.shuttleStopConfirmation.create({
      data: {
        advertisementId,
        offerId: firstOffer.id,
        driverId: driver.id,
        stopOrder: 0,
        type: 'pickup',
      },
    });

    const res = await request(app).get(base).set(authHeader(aliceOperator.token));
    expect(res.status).toBe(200);
    expect(res.body.activeJourneys).toHaveLength(1);
    const j = res.body.activeJourneys[0];
    expect(j.advertisementId).toBe(advertisementId);
    expect(j.driver.id).toBe(driver.id);
    expect(j.line.id).toBe(transitLineId);
    expect(j.position).not.toBeNull();
    expect(j.position.latitude).toBeCloseTo(14.7919, 3);
    expect(j.stopsTotal).toBe(3);
    expect(j.stopsReached).toBe(1);
    expect(j.nextStop.order).toBe(1);
    expect(j.confirmations).toEqual({ pickupDone: 1, pickupTotal: 2, dropoffDone: 0, dropoffTotal: 2 });
  });

  test('ownership : Bob ne voit pas le trajet d\'Alice', async () => {
    const res = await request(app).get(base).set(authHeader(bobOperator.token));
    expect(res.status).toBe(200);
    expect(res.body.activeJourneys).toEqual([]);
    expect(res.body.fleet).toEqual({ available: 0, maintenance: 0, retired: 0 });
  });

  test('JourneyLive périmée → trajet disparaît de la supervision', async () => {
    await prisma.journeyLive.update({
      where: { advertisementId },
      data: { capturedAt: new Date(Date.now() - 120_000) },
    });
    const res = await request(app).get(base).set(authHeader(aliceOperator.token));
    expect(res.status).toBe(200);
    expect(res.body.activeJourneys).toEqual([]);
  });
});
