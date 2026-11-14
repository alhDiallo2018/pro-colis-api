import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerStaff, registerPublic } from './helpers.js';
import { build14dPilotMetrics } from '../src/utils/pilot-metrics-14d.js';

describe('OPS-4 — Métriques pilote 14 jours', () => {
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  let admin;
  let client;

  beforeAll(async () => {
    const staff = await registerStaff(`55${suffix}`, 'Admin pilot', 'super_admin');
    admin = { id: staff.userId, token: staff.accessToken };
    userIds.push(staff.userId);
    const c = await registerPublic(`56${suffix}`, 'Client pilot', 'client');
    client = { id: c.body.user.id, token: c.body.accessToken };
    userIds.push(c.body.user.id);
  });

  afterAll(async () => {
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('build14dPilotMetrics : structure complète', async () => {
    const m = await build14dPilotMetrics(prisma, { windowDays: 14 });
    expect(m.window.days).toBe(14);
    expect(typeof m.window.from).toBe('string');
    expect(typeof m.window.to).toBe('string');
    expect(typeof m.parcels).toBe('object');
    expect(typeof m.handovers).toBe('object');
    expect(typeof m.stopEvents).toBe('number');
    expect(typeof m.offersAccepted).toBe('number');
    expect(typeof m.webhooks).toBe('object');
    expect(typeof m.customsSigned).toBe('number');
    expect(typeof m.shipmentBatches).toBe('object');
  });

  test('GET /super-admin/pilot-metrics/14d : admin OK', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/pilot-metrics/14d')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.window.days).toBe(14);
  });

  test('windowDays query respecté et borné', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/pilot-metrics/14d?windowDays=7')
      .set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.window.days).toBe(7);

    const over = await request(app)
      .get('/api/v1/super-admin/pilot-metrics/14d?windowDays=500')
      .set(authHeader(admin.token));
    expect(over.status).toBe(200);
    expect(over.body.window.days).toBeLessThanOrEqual(90);
  });

  test('client non-admin → 403', async () => {
    const res = await request(app)
      .get('/api/v1/super-admin/pilot-metrics/14d')
      .set(authHeader(client.token));
    expect(res.status).toBe(403);
  });
});
