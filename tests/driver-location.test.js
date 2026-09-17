import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Suivi GPS reel des colis :
 *  - le chauffeur n'enregistre une position que pour un colis qui lui est
 *    assigne (le driverId vient de l'authentification, jamais du corps) ;
 *  - le suivi public ne renvoie que la derniere position, uniquement pendant
 *    le transport, sans jamais inventer de coordonnees.
 */
describe('driver location (GPS tracking)', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let driverToken;
  let otherDriverToken;
  let driverId;
  let otherDriverId;

  async function register(prefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${prefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response.body;
  }

  async function createParcel(status, assignedDriverId) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `TRK${status.toUpperCase()}${suffix}${parcelIds.length}`,
        senderName: 'Expediteur Test',
        senderPhone: '+221770000001',
        receiverName: 'Destinataire Test',
        receiverPhone: '+221770000002',
        description: 'Colis de test GPS',
        weight: '2.5',
        assignedDriverId,
        status
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  beforeAll(async () => {
    const driver = await register('70', 'Chauffeur GPS', 'driver');
    const other = await register('71', 'Autre Chauffeur', 'driver');
    driverToken = driver.accessToken;
    otherDriverToken = other.accessToken;
    driverId = driver.user.id;
    otherDriverId = other.user.id;
  });

  afterAll(async () => {
    await prisma.driverLocation.deleteMany({ where: { driverId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // Cas 1 — chauffeur autorise : la position est enregistree.
  it('records a position for the assigned driver', async () => {
    const parcel = await createParcel('picked_up', driverId);

    const res = await request(app)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        parcelId: parcel.id,
        latitude: 14.6928,
        longitude: -17.4467,
        accuracy: 10
      });

    expect(res.status).toBe(201);
    expect(res.body.location).toBeTruthy();
    expect(res.body.location.parcelId).toBe(parcel.id);
    expect(res.body.location.driverId).toBe(driverId);
    expect(Number(res.body.location.latitude)).toBe(14.6928);
    expect(Number(res.body.location.longitude)).toBe(-17.4467);
    expect(Number(res.body.location.accuracy)).toBe(10);

    const stored = await prisma.driverLocation.findFirst({
      where: { parcelId: parcel.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(stored).toBeTruthy();
    expect(stored.driverId).toBe(driverId);
  });

  // Cas 2 — chauffeur non affecte au colis : requete refusee.
  it('refuses a position from a driver not assigned to the parcel', async () => {
    const parcel = await createParcel('picked_up', driverId);

    const res = await request(app)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${otherDriverToken}`)
      .send({
        parcelId: parcel.id,
        latitude: 14.6928,
        longitude: -17.4467,
        accuracy: 10
      });

    expect(res.status).toBe(403);

    const count = await prisma.driverLocation.count({ where: { parcelId: parcel.id } });
    expect(count).toBe(0);
  });

  // Cas 3 — suivi avec position : available=true avec coordonnees reelles.
  it('exposes the last position on the public tracking endpoint', async () => {
    const parcel = await createParcel('in_transit', driverId);

    await request(app)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ parcelId: parcel.id, latitude: 14.7001, longitude: -17.4501, accuracy: 12 })
      .expect(201);

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);

    const location = res.body.driverLocation;
    expect(location.available).toBe(true);
    expect(location.latitude).toBe(14.7001);
    expect(location.longitude).toBe(-17.4501);
    expect(location.accuracy).toBe(12);
    expect(location.updatedAt).toBeTruthy();
  });

  // Cas 4 — suivi sans position : available=false.
  it('returns available=false when no position has been recorded', async () => {
    const parcel = await createParcel('picked_up', driverId);

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.driverLocation).toEqual({ available: false });
  });

  // Cas 5 — plusieurs positions : seule la plus recente est renvoyee.
  it('returns only the most recent position among several', async () => {
    const parcel = await createParcel('out_for_delivery', driverId);

    for (const [lat, lng] of [[14.1, -17.1], [14.2, -17.2], [14.3, -17.3]]) {
      await request(app)
        .post('/api/v1/driver/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ parcelId: parcel.id, latitude: lat, longitude: lng, accuracy: 5 })
        .expect(201);
    }

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.driverLocation.available).toBe(true);
    expect(res.body.driverLocation.latitude).toBe(14.3);
    expect(res.body.driverLocation.longitude).toBe(-17.3);
  });

  // Cas 6 — colis livre : une ancienne position n'est plus « live ».
  it('does not expose an old position as live once the parcel is delivered', async () => {
    const parcel = await createParcel('delivered', driverId);

    // Une position historiquement enregistree pendant le transport.
    await prisma.driverLocation.create({
      data: {
        driverId,
        parcelId: parcel.id,
        latitude: '14.6928',
        longitude: '-17.4467',
        accuracy: '10'
      }
    });

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.driverLocation).toEqual({ available: false });
  });

  // Avant prise en charge : la position n'est pas exposee non plus.
  it('keeps the position unavailable before pickup', async () => {
    const parcel = await createParcel('confirmed', driverId);

    await prisma.driverLocation.create({
      data: {
        driverId,
        parcelId: parcel.id,
        latitude: '14.6928',
        longitude: '-17.4467',
        accuracy: '10'
      }
    });

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.driverLocation).toEqual({ available: false });
  });

  // Le tracking ne doit jamais exposer l'historique ni des donnees du chauffeur.
  it('does not leak driver identity nor GPS history on the public tracking', async () => {
    const parcel = await createParcel('in_transit', driverId);

    await request(app)
      .post('/api/v1/driver/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ parcelId: parcel.id, latitude: 14.6, longitude: -17.4, accuracy: 8 })
      .expect(201);

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    const body = JSON.stringify(res.body);
    const location = res.body.driverLocation;

    expect(location.available).toBe(true);
    expect(location).not.toHaveProperty('driverId');
    expect(location).not.toHaveProperty('email');
    expect(location).not.toHaveProperty('phone');
    expect(location).not.toHaveProperty('history');
    // Une seule position plate, pas un tableau d'historique.
    expect(body).not.toMatch(/driver_locations/);
  });
});
