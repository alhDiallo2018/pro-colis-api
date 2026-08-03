import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Rapports d'activité par période.
 *
 * Le point de vigilance est le périmètre : un admin de zone doit voir SA zone,
 * jamais les chiffres de la plateforme — c'est ce que renvoyaient les
 * implémentations précédentes, qui ignoraient aussi la date demandée.
 */
describe('activity reports', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let adminToken;
  let superToken;
  let clientId;
  let driverId;
  let zoneGarageId;
  let otherGarageId;

  async function register(phonePrefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response;
  }

  async function createParcel({ garageId, status, deliveryDate, amount }) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `RPT-${status}-${garageId.slice(0, 4)}-${suffix}-${parcelIds.length}`,
        senderId: clientId,
        senderName: 'Client Rapport',
        senderPhone: `78${suffix}`,
        receiverName: 'Destinataire Rapport',
        receiverPhone: `70${suffix}`,
        description: 'Colis de test rapport',
        weight: '1.00',
        status,
        departureGarageId: garageId,
        driverId: status === 'delivered' ? driverId : null,
        price: String(amount),
        totalAmount: String(amount),
        deliveryDate: deliveryDate ?? null,
        createdBy: clientId
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  beforeAll(async () => {
    const client = await register('78', 'Client Rapport', 'client');
    const driver = await register('76', 'Chauffeur Rapport', 'driver');
    const superAdmin = await register('75', 'Super Rapport', 'super_admin');
    clientId = client.body.user.id;
    driverId = driver.body.user.id;
    superToken = superAdmin.body.accessToken;

    const zoneGarage = await prisma.garage.create({
      data: { name: `Zone Rapport ${suffix}`, city: 'Dakar', region: 'Dakar' }
    });
    const otherGarage = await prisma.garage.create({
      data: { name: `Zone Voisine ${suffix}`, city: 'Thiès', region: 'Thiès' }
    });
    zoneGarageId = zoneGarage.id;
    otherGarageId = otherGarage.id;

    const admin = await register('77', 'Admin Rapport', 'admin');
    await prisma.user.update({ where: { id: admin.body.user.id }, data: { garageId: zoneGarageId } });
    // Le rattachement est lu au moment de l'authentification : on rouvre une
    // session pour que le jeton porte la zone.
    const relogin = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: `77${suffix}`, pin: '123456' });
    adminToken = relogin.body.accessToken;

    const now = new Date();
    await createParcel({ garageId: zoneGarageId, status: 'delivered', deliveryDate: now, amount: 5000 });
    await createParcel({ garageId: zoneGarageId, status: 'pending', amount: 3000 });
    // Colis d'une autre zone : il ne doit apparaître que dans le rapport global.
    await createParcel({ garageId: otherGarageId, status: 'delivered', deliveryDate: now, amount: 9000 });
    // Quatre inscriptions + une reconnexion : le hachage bcrypt dépasse le
    // délai par défaut de Jest.
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: parcelIds } }] }
    });
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { parcelId: { in: parcelIds } }] }
    });
    await prisma.payment.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.garage.deleteMany({ where: { id: { in: [zoneGarageId, otherGarageId] } } });
    await prisma.$disconnect();
  });

  it('limite le rapport journalier de zone au périmètre de l’admin', async () => {
    const response = await request(app)
      .get('/api/v1/garage-admin/reports/daily')
      .set({ Authorization: `Bearer ${adminToken}` });

    expect(response.status).toBe(200);
    const report = response.body.report;
    expect(report.totals.created).toBe(2);
    expect(report.totals.delivered).toBe(1);
    expect(report.totals.deliveryRate).toBe(50);
    expect(report.parcelsByStatus.pending).toBe(1);
    // La série journalière est horaire et couvre les 24 heures.
    expect(report.bucket).toBe('hour');
    expect(report.series).toHaveLength(24);
    expect(report.series.reduce((sum, point) => sum + point.created, 0)).toBe(2);
    expect(report.topDrivers[0]).toMatchObject({ driverId, delivered: 1 });
  });

  it('renvoie la veille vide pour la même zone', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const response = await request(app)
      .get('/api/v1/garage-admin/reports/daily')
      .query({ date: yesterday.toISOString().slice(0, 10) })
      .set({ Authorization: `Bearer ${adminToken}` });

    expect(response.status).toBe(200);
    expect(response.body.report.totals.created).toBe(0);
    expect(response.body.report.totals.delivered).toBe(0);
  });

  it('couvre les deux zones dans le rapport mensuel plateforme', async () => {
    const now = new Date();
    const response = await request(app)
      .get('/api/v1/super-admin/reports/monthly')
      .query({ year: now.getFullYear(), month: now.getMonth() + 1 })
      .set({ Authorization: `Bearer ${superToken}` });

    expect(response.status).toBe(200);
    const report = response.body.report;
    expect(report.bucket).toBe('day');
    expect(report.totals.created).toBeGreaterThanOrEqual(3);
    expect(report.totals.delivered).toBeGreaterThanOrEqual(2);
    expect(report.series.length).toBeGreaterThanOrEqual(28);
  });
});
