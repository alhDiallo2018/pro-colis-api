import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { invalidateEtaConfigCache } from '../src/utils/eta-config.js';

/**
 * Tests d'intégration du champ `eta` sur les endpoints de tracking.
 *
 * Confirme que :
 *  - l'ETA est calculée pendant le transport (picked_up, in_transit, arrived, out_for_delivery) ;
 *  - l'ETA est `null` hors transport (pending, delivered, cancelled) ;
 *  - l'ETA est `null` quand la zone d'arrivée n'a pas de coordonnées ;
 *  - les 3 endpoints existants sont enrichis sans régression sur `driverLocation`.
 */
describe('parcel ETA (tracking endpoints)', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  const zoneIds = [];

  let driverToken;
  let driverId;
  let clientToken;

  async function register(prefix, fullName, role) {
    const res = await request(app).post('/api/v1/auth/register').send({
      phone: `${prefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(res.status).toBe(201);
    userIds.push(res.body.user.id);
    return res.body;
  }

  async function createZone({ name, latitude, longitude }) {
    const zone = await prisma.zone.create({
      data: {
        name: `${name} ${suffix}`,
        latitude,
        longitude
      }
    });
    zoneIds.push(zone.id);
    return zone;
  }

  async function createParcel({ status, assignedDriverId, arrivalZoneId, senderId }) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `ETA${status.toUpperCase()}${suffix}${parcelIds.length}`,
        senderName: 'Expediteur Test',
        senderPhone: '+221770000001',
        receiverName: 'Destinataire Test',
        receiverPhone: '+221770000002',
        description: 'Colis test ETA',
        weight: '2.5',
        assignedDriverId,
        arrivalZoneId,
        senderId,
        status
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  async function insertPosition({ driverId, parcelId, lat, lng, secondsAgo }) {
    return prisma.driverLocation.create({
      data: {
        driverId,
        parcelId,
        latitude: lat,
        longitude: lng,
        accuracy: 10,
        createdAt: new Date(Date.now() - secondsAgo * 1000)
      }
    });
  }

  beforeAll(async () => {
    const driver = await register('72', 'Chauffeur ETA', 'driver');
    const client = await register('73', 'Client ETA', 'client');
    driverToken = driver.accessToken;
    driverId = driver.user.id;
    clientToken = client.accessToken;
    await prisma.user.update({
      where: { id: driverId },
      data: { isVerified: true, rating: 4.7 }
    });
    invalidateEtaConfigCache();
  });

  afterAll(async () => {
    await prisma.driverLocation.deleteMany({ where: { driverId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────────────
  // trackParcelLocation (polling 5 s, endpoint léger)
  // ─────────────────────────────────────────────────────────────────────

  it('exposes `eta` on /public/parcels/track/:tn/location when transport is active', async () => {
    const arrivalZone = await createZone({ name: 'Arrivée ETA', latitude: 14.7886, longitude: -16.9256 });
    const parcel = await createParcel({ status: 'in_transit', assignedDriverId: driverId, arrivalZoneId: arrivalZone.id });

    // 5 positions sur les 2 dernières minutes, rapprochées de la destination.
    for (let i = 4; i >= 0; i--) {
      await insertPosition({
        driverId,
        parcelId: parcel.id,
        lat: 14.74 + i * 0.001,
        lng: -17.00,
        secondsAgo: 10 + i * 20
      });
    }

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}/location`);
    expect(res.status).toBe(200);
    expect(res.body.driverLocation?.available).toBe(true);
    expect(res.body.eta).toBeTruthy();
    expect(res.body.eta.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(res.body.eta.minMinutes).toBeLessThanOrEqual(res.body.eta.etaMinutes);
    expect(res.body.eta.maxMinutes).toBeGreaterThanOrEqual(res.body.eta.etaMinutes);
    expect(['high', 'medium', 'low']).toContain(res.body.eta.confidence);
    expect(['moving', 'stopped', 'unknown']).toContain(res.body.eta.movingState);
    expect(typeof res.body.eta.arrivalAt).toBe('string');
    expect(typeof res.body.eta.computedAt).toBe('string');
  });

  it('returns `eta: null` for a pending parcel (no transport yet)', async () => {
    const arrivalZone = await createZone({ name: 'Arrivée pending', latitude: 14.7886, longitude: -16.9256 });
    const parcel = await createParcel({ status: 'pending', assignedDriverId: driverId, arrivalZoneId: arrivalZone.id });

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}/location`);
    expect(res.status).toBe(200);
    expect(res.body.eta).toBeNull();
  });

  it('returns `eta: null` for a delivered parcel', async () => {
    const arrivalZone = await createZone({ name: 'Arrivée delivered', latitude: 14.7886, longitude: -16.9256 });
    const parcel = await createParcel({ status: 'delivered', assignedDriverId: driverId, arrivalZoneId: arrivalZone.id });

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}/location`);
    expect(res.status).toBe(200);
    expect(res.body.eta).toBeNull();
  });

  it('returns `eta: null` when the arrival zone has no coordinates', async () => {
    // Zone sans coordonnées valides : Prisma Decimal(10,7) accepte 0 — on simule
    // l'absence en ne liant pas de zone d'arrivée. Ici assignedDriverId est
    // bien présent mais arrivalZoneId est null → eta doit rester null.
    const parcel = await createParcel({ status: 'in_transit', assignedDriverId: driverId, arrivalZoneId: null });
    await insertPosition({ driverId, parcelId: parcel.id, lat: 14.74, lng: -17.0, secondsAgo: 10 });

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}/location`);
    expect(res.status).toBe(200);
    expect(res.body.eta).toBeNull();
  });

  it('returns `eta: null` when no GPS point has been recorded yet', async () => {
    const arrivalZone = await createZone({ name: 'Arrivée no-gps', latitude: 14.7886, longitude: -16.9256 });
    const parcel = await createParcel({ status: 'in_transit', assignedDriverId: driverId, arrivalZoneId: arrivalZone.id });
    // Pas d'insertPosition : aucun point.

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}/location`);
    expect(res.status).toBe(200);
    expect(res.body.eta).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // trackParcel (vue complète)
  // ─────────────────────────────────────────────────────────────────────

  it('exposes `eta` on /public/parcels/track/:tn (full view)', async () => {
    const arrivalZone = await createZone({ name: 'Arrivée full', latitude: 14.7886, longitude: -16.9256 });
    const parcel = await createParcel({ status: 'out_for_delivery', assignedDriverId: driverId, arrivalZoneId: arrivalZone.id });
    await insertPosition({ driverId, parcelId: parcel.id, lat: 14.78, lng: -16.93, secondsAgo: 15 });

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.parcel).toBeTruthy();
    expect(res.body.eta).toBeTruthy();
    expect(res.body.eta.etaMinutes).toBeGreaterThanOrEqual(1);
    // Invariant contractuel : arrivalAt ≈ computedAt + etaMinutes (± 1 min).
    const diffMin =
      (new Date(res.body.eta.arrivalAt).getTime() - new Date(res.body.eta.computedAt).getTime()) / 60000;
    expect(Math.abs(diffMin - res.body.eta.etaMinutes)).toBeLessThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // getParcelDetail (client authentifié)
  // ─────────────────────────────────────────────────────────────────────

  it('exposes `parcel.eta` on /client/parcels/:id for the owning client', async () => {
    const client = await prisma.user.findFirst({ where: { role: 'client', phone: `73${suffix}` } });
    expect(client).toBeTruthy();
    const arrivalZone = await createZone({ name: 'Arrivée client', latitude: 14.7886, longitude: -16.9256 });
    const parcel = await createParcel({
      status: 'in_transit',
      assignedDriverId: driverId,
      arrivalZoneId: arrivalZone.id,
      senderId: client.id
    });
    await insertPosition({ driverId, parcelId: parcel.id, lat: 14.75, lng: -17.0, secondsAgo: 20 });
    await insertPosition({ driverId, parcelId: parcel.id, lat: 14.76, lng: -17.0, secondsAgo: 40 });
    await insertPosition({ driverId, parcelId: parcel.id, lat: 14.77, lng: -17.0, secondsAgo: 60 });

    const res = await request(app)
      .get(`/api/v1/client/parcels/${parcel.id}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.parcel).toBeTruthy();
    expect(res.body.parcel.eta).toBeTruthy();
    expect(res.body.parcel.eta.etaMinutes).toBeGreaterThanOrEqual(1);
  });

  it('exposes `parcel.eta = null` on /client/parcels/:id when parcel is pending', async () => {
    const client = await prisma.user.findFirst({ where: { role: 'client', phone: `73${suffix}` } });
    const parcel = await createParcel({
      status: 'pending',
      assignedDriverId: null,
      arrivalZoneId: null,
      senderId: client.id
    });

    const res = await request(app)
      .get(`/api/v1/client/parcels/${parcel.id}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.parcel.eta).toBeNull();
  });
});
