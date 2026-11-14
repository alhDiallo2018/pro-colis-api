import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic, registerStaff } from './helpers.js';

describe('OPS-2 — POST /super-admin/users/:userId/role', () => {
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  let admin;
  let target;

  beforeAll(async () => {
    const staff = await registerStaff(`50${suffix}`, 'Admin prom', 'super_admin');
    admin = { id: staff.userId, token: staff.accessToken };
    userIds.push(staff.userId);

    const r = await registerPublic(`51${suffix}`, 'Target', 'client');
    expect(r.status).toBe(201);
    target = { id: r.body.user.id, token: r.body.accessToken };
    userIds.push(r.body.user.id);
  });

  afterAll(async () => {
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('super_admin promeut client → shuttle_operator (PATCH)', async () => {
    const res = await request(app)
      .patch(`/api/v1/super-admin/users/${target.id}/role`)
      .set(authHeader(admin.token))
      .send({ role: 'shuttle_operator' });
    expect(res.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { id: target.id }, select: { role: true } });
    expect(dbUser.role).toBe('shuttle_operator');
  });

  test('non-super_admin → 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/super-admin/users/${target.id}/role`)
      .set(authHeader(target.token))
      .send({ role: 'driver' });
    expect(res.status).toBe(403);
  });

  test('rôle invalide → 422', async () => {
    const res = await request(app)
      .patch(`/api/v1/super-admin/users/${target.id}/role`)
      .set(authHeader(admin.token))
      .send({ role: 'root' });
    expect(res.status).toBe(422);
  });

  test('user inexistant → 404', async () => {
    const res = await request(app)
      .patch(`/api/v1/super-admin/users/${randomUUID()}/role`)
      .set(authHeader(admin.token))
      .send({ role: 'driver' });
    expect(res.status).toBe(404);
  });
});
