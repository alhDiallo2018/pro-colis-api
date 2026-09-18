import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Securite du tracking public (GET /public/parcels/track/:trackingNumber).
 *
 * Le suivi public ne doit jamais exposer les donnees personnelles du chauffeur
 * (email, telephone, adresse, genre, lastLogin, etc.) ni les donnees de paiement,
 * de negociation ou d'authentification. Seul `{ id, name }` est autorise pour le
 * chauffeur, et le GPS reste limite a une unique derniere position.
 */
describe('public parcel tracking — driver data safety', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let driverId;
  let driverPhone;
  let driverToken;

  const SENTINEL_EMAIL = 'driver.secret@example.com';
  const SENTINEL_ADDRESS = '123 Rue Secrete, Dakar';

  async function register(prefix, fullName, role) {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: `${prefix}${suffix}`, fullName, pin: '123456', role });
    expect(res.status).toBe(201);
    userIds.push(res.body.user.id);
    return res.body;
  }

  async function createParcel(status, assignedDriverId) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `PUB${status.toUpperCase()}${suffix}${parcelIds.length}`,
        senderName: 'Expediteur Test',
        senderPhone: '+221770000001',
        receiverName: 'Destinataire Test',
        receiverPhone: '+221770000002',
        description: 'Colis de test securite',
        weight: '2.5',
        assignedDriverId,
        status
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  beforeAll(async () => {
    const driver = await register('72', 'Chauffeur Prive', 'driver');
    driverId = driver.user.id;
    driverPhone = driver.user.phone;
    driverToken = driver.accessToken;

    // On donne au chauffeur des donnees personnelles identifiables pour pouvoir
    // prouver qu'aucune ne transite par le endpoint public.
    await prisma.user.update({
      where: { id: driverId },
      data: {
        email: SENTINEL_EMAIL,
        address: SENTINEL_ADDRESS,
        gender: 'male',
        lastLogin: new Date('2026-01-01T00:00:00.000Z')
      }
    });
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

  it('exposes only the driver id and name', async () => {
    const parcel = await createParcel('in_transit', driverId);

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);

    const p = res.body.parcel;
    expect(p.driverName).toBe('Chauffeur Prive');
    expect(p.driver).toEqual({ id: driverId, name: 'Chauffeur Prive' });
    expect(p.assignedDriver).toEqual({ id: driverId, name: 'Chauffeur Prive' });
    expect(p.driverId).toBe(driverId);
    expect(p.assignedDriverId).toBe(driverId);
  });

  it('does not leak driver personal data (email, phone, address, gender, lastLogin)', async () => {
    const parcel = await createParcel('in_transit', driverId);

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    const p = res.body.parcel;

    // Aucune donnee du chauffeur ne transite par le payload public.
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain(SENTINEL_ADDRESS);
    expect(raw).not.toContain(driverPhone);
    expect(raw).not.toMatch(/lastLogin|"gender"|isEmailVerified|isPhoneVerified/);

    // Le champ `driverPhone` a disparu, et les objets conducteur sont reduits a
    // `{ id, name }` : pas d'email, de telephone, d'adresse, de genre ni de login.
    expect(p).not.toHaveProperty('driverPhone');
    for (const key of ['email', 'phone', 'address', 'gender', 'lastLogin', 'lastActiveAt']) {
      expect(p.driver).not.toHaveProperty(key);
      expect(p.assignedDriver).not.toHaveProperty(key);
    }
  });

  it('does not expose payment, negotiation, authentication or internal data', async () => {
    const parcel = await createParcel('in_transit', driverId);

    const res = await request(app).get(`/api/v1/public/parcels/track/${parcel.trackingNumber}`);
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    const p = res.body.parcel;

    // Donnees de caisse / paiement / preuve / notes / negociation : absentes.
    for (const key of [
      'cashCollectedAmount',
      'cashCollectedAt',
      'paymentPhoneNumber',
      'paymentStatus',
      'paymentMethod',
      'paymentChannel',
      'cashCollectionPoint',
      'signatureUrl',
      'notes',
      'bids',
      'proposal',
      'proposedDriver',
      'proposedDriverId',
      'proposedDriverName',
      'negotiatedPrice',
      'proposedPrice'
    ]) {
      expect(p).not.toHaveProperty(key);
    }

    // Aucune donnee d'authentification ne doit fuiter.
    expect(raw).not.toMatch(/password|"pin"|"hash"|accessToken|refreshToken|"token"/i);
  });

  it('still returns the last GPS position without leaking the driver id or history', async () => {
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
    expect(location).not.toHaveProperty('driverId');
    expect(location).not.toHaveProperty('history');

    // Le nom du chauffeur reste disponible pour l'experience de livraison.
    expect(res.body.parcel.driverName).toBe('Chauffeur Prive');
    expect(res.body.parcel.driver).toEqual({ id: driverId, name: 'Chauffeur Prive' });
  });
});
