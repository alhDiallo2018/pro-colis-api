import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * I3 — endpoints publics de chauffeurs : whitelist minimale.
 * I2 — /public/parcels/:id/bids : pas de driverPhone.
 *
 * Chaque chauffeur de test est volontairement renseigne avec des donnees
 * personnelles (email, adresse, genre, lastLogin, lastActiveAt) pour prouver
 * que les reponses publiques les filtrent reellement.
 */
describe('public drivers & bids — driver PII never exposed', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  const garageIds = [];
  const zoneIds = [];
  const bidIds = [];
  let driverId;
  let driverPhone;

  const SENTINEL_EMAIL = `driver.secret.${suffix}@example.com`;
  const SENTINEL_ADDRESS = `123 Rue Secrete ${suffix}, Dakar`;
  const SENTINEL_GENDER = 'male';
  const SENTINEL_LAST_LOGIN = new Date('2026-01-01T00:00:00.000Z');

  async function register(prefix, fullName, role) {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: `${prefix}${suffix}`, fullName, pin: '123456', role });
    expect(res.status).toBe(201);
    userIds.push(res.body.user.id);
    return res.body;
  }

  beforeAll(async () => {
    const driver = await register('72', 'Chauffeur Prive', 'driver');
    driverId = driver.user.id;
    driverPhone = driver.user.phone;

    await prisma.user.update({
      where: { id: driverId },
      data: {
        email: SENTINEL_EMAIL,
        address: SENTINEL_ADDRESS,
        gender: SENTINEL_GENDER,
        lastLogin: SENTINEL_LAST_LOGIN,
        lastActiveAt: SENTINEL_LAST_LOGIN
      }
    });
  });

  afterAll(async () => {
    await prisma.bid.deleteMany({ where: { id: { in: bidIds } } });
    await prisma.notification.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zoneDriver.deleteMany({ where: { driverId: { in: userIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.garage.deleteMany({ where: { id: { in: garageIds } } });
    await prisma.driverLocation.deleteMany({ where: { driverId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const PII_KEYS = [
    'email', 'phone', 'address', 'gender',
    'lastLogin', 'lastActiveAt',
    'passwordHash', 'pinHash', 'password',
    'refreshTokens', 'otpCodes', 'wallet',
    'isEmailVerified', 'isPhoneVerified'
  ];

  function expectNoDriverPii(driverObj) {
    expect(driverObj).toBeDefined();
    for (const key of PII_KEYS) {
      expect(driverObj).not.toHaveProperty(key);
    }
  }

  // ------------------------------------------------------------
  // searchDrivers
  // ------------------------------------------------------------
  it('searchDrivers exposes only the public whitelist', async () => {
    const res = await request(app).get('/api/v1/public/drivers/search');
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain(SENTINEL_ADDRESS);
    expect(raw).not.toContain(driverPhone);

    const driver = (res.body.drivers || []).find((d) => d.id === driverId);
    expect(driver).toBeDefined();
    expectNoDriverPii(driver);
    expect(driver.fullName).toBe('Chauffeur Prive');
    expect(driver).toHaveProperty('rating');
    expect(driver).toHaveProperty('completedDeliveries');
    expect(driver).toHaveProperty('driverStatus');
  });

  // ------------------------------------------------------------
  // publicDriverDetail
  // ------------------------------------------------------------
  it('publicDriverDetail exposes only the public whitelist (no phone/email/address)', async () => {
    const res = await request(app).get(`/api/v1/public/drivers/${driverId}`);
    expect(res.status).toBe(200);

    const driver = res.body.driver;
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain(SENTINEL_ADDRESS);
    expect(raw).not.toContain(driverPhone);
    expect(raw).not.toContain(SENTINEL_GENDER);

    expectNoDriverPii(driver);
    expect(driver.fullName).toBe('Chauffeur Prive');
    // La fiche publique conserve les statistiques publiques et la description
    // du vehicule (modele / type), jamais la plaque.
    expect(driver).toHaveProperty('totalDeliveries');
    expect(driver).not.toHaveProperty('vehiclePlate');
    expect(driver).not.toHaveProperty('plateNumber');
  });

  // ------------------------------------------------------------
  // garagePublicDrivers
  // ------------------------------------------------------------
  it('garagePublicDrivers exposes only the public whitelist', async () => {
    const garage = await prisma.garage.create({
      data: { name: `Garage Public ${suffix}`, city: 'Dakar', region: 'Dakar' }
    });
    garageIds.push(garage.id);
    await prisma.user.update({ where: { id: driverId }, data: { garageId: garage.id } });

    const res = await request(app).get(`/api/v1/public/drivers/garage/${garage.id}`);
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain(SENTINEL_ADDRESS);
    expect(raw).not.toContain(driverPhone);

    const driver = (res.body.drivers || []).find((d) => d.id === driverId);
    expect(driver).toBeDefined();
    expectNoDriverPii(driver);
  });

  // ------------------------------------------------------------
  // zonePublicDrivers
  // ------------------------------------------------------------
  it('zonePublicDrivers exposes only the public whitelist', async () => {
    const zone = await prisma.zone.create({
      data: {
        name: `Zone Publique ${suffix}`,
        city: 'Dakar',
        region: 'Dakar',
        latitude: 14.7,
        longitude: -17.45
      }
    });
    zoneIds.push(zone.id);
    await prisma.zoneDriver.create({
      data: { zoneId: zone.id, driverId, isPrimary: true }
    });

    const res = await request(app).get(`/api/v1/public/drivers/zone/${zone.id}`);
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain(SENTINEL_ADDRESS);
    expect(raw).not.toContain(driverPhone);

    const driver = (res.body.drivers || []).find((d) => d.id === driverId);
    expect(driver).toBeDefined();
    expectNoDriverPii(driver);
  });

  // ------------------------------------------------------------
  // /public/parcels/:id/bids (I2)
  // ------------------------------------------------------------
  it('/public/parcels/:id/bids never exposes driverPhone', async () => {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `PUBBID-${suffix}`,
        senderName: 'Expediteur Test',
        senderPhone: '+221770000001',
        receiverName: 'Destinataire Test',
        receiverPhone: '+221770000002',
        description: 'Colis pour test d offres publiques',
        weight: '2.5',
        status: 'free',
        isFreeForBidding: true
      }
    });
    parcelIds.push(parcel.id);

    const bid = await prisma.bid.create({
      data: { parcelId: parcel.id, driverId, price: '5000', message: 'Je peux livrer rapidement' }
    });
    bidIds.push(bid.id);

    const res = await request(app).get(`/api/v1/public/parcels/${parcel.id}/bids`);
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SENTINEL_EMAIL);
    expect(raw).not.toContain(SENTINEL_ADDRESS);
    expect(raw).not.toContain(driverPhone);

    const found = (res.body.bids || []).find((b) => b.id === bid.id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('driverPhone');
    expect(found).not.toHaveProperty('phone');
    expect(found).not.toHaveProperty('email');
    expect(found).not.toHaveProperty('driverCity');
    expect(found).not.toHaveProperty('driverZoneName');
    expect(found).not.toHaveProperty('negotiationHistory');

    // Les donnees publiques de l'offre restent disponibles.
    expect(found.driverName).toBe('Chauffeur Prive');
    expect(found.price).toBeTruthy();
    expect(found.status).toBe('pending');
  });
});
