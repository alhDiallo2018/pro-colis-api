import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Endpoints ajoutés pour combler les écarts avec les fronts web/mobile :
 * zones (detect), reset PIN super-admin et estimation de commission.
 */
describe('gap endpoints (zones, reset-pin, commissions)', () => {
  const adminPhone = `76${Date.now().toString().slice(-7)}`;
  const driverPhone = `77${Date.now().toString().slice(-7)}`;
  let adminToken;
  let adminId;
  let driverToken;
  let driverId;
  let zoneId;

  beforeAll(async () => {
    const adminRes = await request(app).post('/api/v1/auth/register').send({
      phone: adminPhone,
      fullName: 'Super Admin Gap Test',
      pin: '123456',
      role: 'super_admin'
    });
    adminToken = adminRes.body.accessToken;
    adminId = adminRes.body.user?.id;
    expect(adminToken).toBeTruthy();

    const driverRes = await request(app).post('/api/v1/auth/register').send({
      phone: driverPhone,
      fullName: 'Chauffeur Gap Test',
      pin: '654321',
      role: 'driver'
    });
    driverToken = driverRes.body.accessToken;
    driverId = driverRes.body.user?.id;
    expect(driverToken).toBeTruthy();
  });

  afterAll(async () => {
    if (zoneId) await prisma.zone.deleteMany({ where: { id: zoneId } });
    for (const userId of [driverId, adminId]) {
      if (!userId) continue;
      await prisma.deviceToken.deleteMany({ where: { userId } });
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const driverAuth = () => ({ Authorization: `Bearer ${driverToken}` });

  it('creates a zone as super admin', async () => {
    const res = await request(app)
      .post('/api/v1/super-admin/zones')
      .set(adminAuth())
      .send({ name: 'Zone Dakar Test', latitude: 14.6928, longitude: -17.4467, radius: 30, city: 'Dakar' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.radius).toBe(30);
    zoneId = res.body.data.id;
  });

  it('detects the zone from nearby coordinates, sorted by distance', async () => {
    const res = await request(app).get('/api/v1/zones/detect?latitude=14.70&longitude=-17.45');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((z) => z.id);
    expect(ids).toContain(zoneId);
    expect(res.body.data[0].distanceKm).toBeDefined();
  });

  it('does not detect the zone from far-away coordinates', async () => {
    const res = await request(app).get('/api/v1/zones/detect?latitude=48.8566&longitude=2.3522');
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((z) => z.id);
    expect(ids).not.toContain(zoneId);
  });

  it('resets a user PIN and returns the plain 6-digit PIN', async () => {
    const res = await request(app)
      .post(`/api/v1/super-admin/users/${driverId}/reset-pin`)
      .set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.pin).toMatch(/^\d{6}$/);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: driverPhone, pin: res.body.pin });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  it('refuses reset-pin to non super admins', async () => {
    const res = await request(app)
      .post(`/api/v1/super-admin/users/${driverId}/reset-pin`)
      .set(driverAuth());
    expect(res.status).toBe(403);
  });

  it('estimates the commission for a public amount', async () => {
    const res = await request(app).post('/api/v1/commissions/estimate').send({ amount: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.commission.commission).toBe(500);
    expect(res.body.commission.netAmount).toBe(9500);
    expect(res.body.commission.percentage).toBe(5);
  });

  it('registers a device token (upsert by token)', async () => {
    const token = `fcm-test-${Date.now()}`;
    const first = await request(app)
      .post('/api/v1/notifications/device-token')
      .set(driverAuth())
      .send({ token, platform: 'android' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/notifications/device-token')
      .set(driverAuth())
      .send({ token, platform: 'ios' });
    expect(second.status).toBe(201);

    const rows = await prisma.deviceToken.findMany({ where: { token } });
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('ios');
  });
});
