import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { signAccessToken } from '../src/utils/tokens.js';
import { systemHealth, listWebhooks } from '../src/modules/mobile/mobile.controller.js';

let actor;
let token;
const requestId = randomUUID();
const headers = () => ({ Authorization: `Bearer ${token}` });
const auditPath = '/api/v1/super-admin/audit-logs';

beforeAll(async () => {
  actor = await prisma.user.create({ data: { phone: randomUUID(), fullName: `Audit ${randomUUID()}`, role: 'super_admin' } });
  token = signAccessToken(actor);
  // Les donnees de part et d'autre de minuit detectent un filtre ignore ou
  // une date de fin interpretee comme le debut de la journee.
  for (const date of ['2026-08-01T23:59:59.999Z', '2026-08-02T12:00:00Z', '2026-08-02T23:59:59.999Z', '2026-08-03T00:00:00Z']) {
    await prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'test.audit',
      entityType: 'test', entityId: actor.id, requestId, createdAt: new Date(date) } });
  }
});

afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (actor) {
    await prisma.webhook.deleteMany({ where: { createdBy: actor.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
  await prisma.$disconnect();
});

test.each([
  { dateFrom: '2026-08-02', dateTo: '2026-08-02' },
  { from: '2026-08-02', to: '2026-08-02' }
])('filtre audit la journee complete avec %j', async (dates) => {
  const res = await request(app).get(auditPath).set(headers()).query({ actorId: actor.id, ...dates });
  expect(res.status).toBe(200);
  expect(res.body.pagination.total).toBe(2);
  expect(res.body.auditLogs.map((log) => log.createdAt)).toEqual(['2026-08-02T23:59:59.999Z', '2026-08-02T12:00:00.000Z']);
});

test('recherche audit retrouve auteur, entite et request ID avec le bon total pagine', async () => {
  for (const search of [actor.fullName.toUpperCase(), requestId, actor.id]) {
    const res = await request(app).get(auditPath).set(headers()).query({ actorId: actor.id, search, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ total: 4, totalPages: 2 });
    expect(res.body.auditLogs).toHaveLength(2);
  }
});

test('rejette une periode audit inversee', async () => {
  const res = await request(app).get(auditPath).set(headers()).query({ from: '2026-08-03', to: '2026-08-02' });
  expect(res.status).toBe(422);
});

test('creation, lecture et suppression webhook conservent les valeurs et leur audit sans secret', async () => {
  const res = await request(app).post('/api/v1/webhooks').set(headers()).send({
    url: ' https://example.test/events ', events: [' parcel.delivered ', 'parcel.delivered'],
    isActive: false, secret: 'test-signing-secret'
  });
  expect(res.status).toBe(201);
  const hook = res.body.webhook;
  expect(hook).toMatchObject({ url: 'https://example.test/events', events: ['parcel.delivered'], isActive: false, hasSecret: true });
  expect(hook.secret).toBeUndefined();
  const listed = await request(app).get('/api/v1/webhooks').set(headers());
  expect(listed.body.webhooks.find((row) => row.id === hook.id)).toEqual(hook);
  const removed = await request(app).delete(`/api/v1/webhooks/${hook.id}`).set(headers());
  expect(removed.status).toBe(200);
  expect(await prisma.webhook.findUnique({ where: { id: hook.id } })).toBeNull();
  const trail = await prisma.auditLog.findMany({ where: { entityId: hook.id }, orderBy: { createdAt: 'asc' } });
  expect(trail.map((log) => log.action)).toEqual(['webhook.create', 'webhook.delete']);
  expect(trail[0].afterData).toEqual(trail[1].beforeData);
  expect(JSON.stringify(trail)).not.toContain('test-signing-secret');
  expect((await request(app).delete(`/api/v1/webhooks/${hook.id}`).set(headers())).status).toBe(404);
});

test('un secret vide ne produit pas un faux indicateur signe', async () => {
  const res = await request(app).post('/api/v1/webhooks').set(headers()).send({
    url: 'https://example.test/events', events: ['parcel.delivered'], secret: '  '
  });
  expect(res.status).toBe(201);
  expect(res.body.webhook).toMatchObject({ isActive: true, hasSecret: false });
});

test.each([
  { events: [' '] }, { events: ['parcel.delivered', 42] },
  { isActive: 'false' }, { url: 'https://?' }, { secret: 42 }
])('rejette les valeurs webhook invalides %j', async (patch) => {
  const res = await request(app).post('/api/v1/webhooks').set(headers()).send({
    url: 'https://example.test/events', events: ['parcel.delivered'], ...patch
  });
  expect(res.status).toBe(422);
});

test('une erreur audit annule la creation webhook', async () => {
  // Un role mal forme provoque l'echec de l'audit apres l'insertion : la vraie
  // transaction doit annuler l'abonnement sans toucher aux donnees existantes.
  const { createWebhook } = await import('../src/modules/mobile/mobile.controller.js');
  const url = `https://example.test/${randomUUID()}`;
  const req = { body: { url, events: ['parcel.delivered'] }, headers: {}, user: { id: actor.id, role: {} },
    log: { error: jest.fn(), warn: jest.fn() } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await createWebhook(req, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  expect(await prisma.webhook.count({ where: { url } })).toBe(0);
});

test('les erreurs BD sont journalisees et la sonde renvoie ses valeurs degradees', async () => {
  jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('database unavailable'));
  jest.spyOn(prisma.webhook, 'findMany').mockRejectedValue(new Error('database unavailable'));
  const req = { log: { error: jest.fn(), warn: jest.fn() } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await systemHealth(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, status: 'degraded', database: 'disconnected' }));
  await listWebhooks(req, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(req.log.error).toHaveBeenCalledTimes(2);
});
