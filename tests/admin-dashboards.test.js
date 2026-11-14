import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic, registerStaff } from './helpers.js';

describe('ADM-1 — dashboards admin agrégats', () => {
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  let admin;
  let regularClient;

  beforeAll(async () => {
    const staff = await registerStaff(`60${suffix}`, 'Admin dash', 'super_admin');
    admin = { id: staff.userId, token: staff.accessToken };
    userIds.push(staff.userId);

    const c = await registerPublic(`61${suffix}`, 'Client dash', 'client');
    expect(c.status).toBe(201);
    regularClient = { id: c.body.user.id, token: c.body.accessToken };
    userIds.push(c.body.user.id);
  });

  afterAll(async () => {
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('GET /super-admin/webhooks/recent : admin OK, structure cohérente', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/webhooks/recent?limit=10')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deliveries)).toBe(true);
    expect(typeof res.body.statusCounts).toBe('object');
  });

  test('GET /super-admin/stop-events/recent : admin OK', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/stop-events/recent')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  test('GET /super-admin/handovers/recent : admin OK', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/handovers/recent')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.handovers)).toBe(true);
    expect(typeof res.body.statusCounts).toBe('object');
  });

  test('client non-admin : 403 sur chacun des 3 endpoints', async () => {
    for (const path of [
      '/api/v1/super-admin/webhooks/recent',
      '/api/v1/super-admin/stop-events/recent',
      '/api/v1/super-admin/handovers/recent'
    ]) {
      const res = await request(app).get(path).set(authHeader(regularClient.token));
      expect(res.status).toBe(403);
    }
  });

  test('non authentifié : 401', async () => {
    const res = await request(app).get('/api/v1/super-admin/webhooks/recent');
    expect(res.status).toBe(401);
  });

  test('limit bornée à 200', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/webhooks/recent?limit=500')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    // Si la base en a plus de 200, on devrait s'arrêter à 200.
    expect(res.body.deliveries.length).toBeLessThanOrEqual(200);
  });
});
