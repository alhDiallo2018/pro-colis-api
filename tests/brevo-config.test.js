import { jest } from '@jest/globals';
import request from 'supertest';
import { randomInt } from 'node:crypto';
const actualBrevo = await import('../src/utils/brevo.js');
const sendEmail = jest.fn().mockResolvedValue({ messageId: 'test-only' });
// Verifier les routes et la BD sans envoyer de message a un prestataire.
jest.unstable_mockModule('../src/utils/brevo.js', () => ({ ...actualBrevo,
  sendEmail, sendSms: jest.fn().mockResolvedValue({ messageId: 'test-only' }),
  sendOtpSms: jest.fn().mockResolvedValue({ messageId: 'test-only' }),
  sendOtpEmail: jest.fn().mockResolvedValue({ messageId: 'test-only' }) }));
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');
const { env } = await import('../src/config/env.js');
const auth = await import('../src/modules/auth/auth.service.js');
const oldKey = env.BREVO_API_KEY;
let previous;
let admin;
let client;
const url = '/api/v1/admin/notifications/brevo-config';
const headers = user => ({ Authorization: `Bearer ${user.accessToken}` });

beforeAll(async () => {
  previous = await prisma.systemConfig.findUnique({ where: { key: 'brevo' } });
  for (const role of ['super_admin', 'client']) {
    const session = await auth.registerUser({ fullName: 'Test Brevo', phone: `+2217${randomInt(10000000, 99999999)}`, pin: '123456', role: 'client' });
    if (role === 'super_admin') {
      await prisma.user.update({ where: { id: session.user.id }, data: { role } });
      admin = session;
    } else client = session;
  }
});
beforeEach(async () => {
  env.BREVO_API_KEY = 'env-only-test-key';
  await prisma.systemConfig.deleteMany({ where: { key: 'brevo' } });
  actualBrevo.invalidateBrevoConfigCache();
  sendEmail.mockClear();
});
afterAll(async () => {
  env.BREVO_API_KEY = oldKey;
  if (previous) {
    await prisma.systemConfig.upsert({ where: { key: 'brevo' }, create: previous,
      update: { value: previous.value, updatedAt: previous.updatedAt, updatedBy: previous.updatedBy } });
  } else await prisma.systemConfig.deleteMany({ where: { key: 'brevo' } });
  actualBrevo.invalidateBrevoConfigCache();
  const ids = [admin?.user.id, client?.user.id].filter(Boolean);
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('le GET indique la source environnement sans divulguer la cle', async () => {
  const response = await request(app).get(url).set(headers(admin));
  expect(response.status).toBe(200);
  expect(response.body.config).toMatchObject({ apiKey: '********', apiKeySource: 'environment', apiKeyConfigured: true });
  expect(JSON.stringify(response.body)).not.toContain('env-only-test-key');
});

test('sauvegarde admin prioritaire, cle conservee lors des edits et repli explicite au serveur', async () => {
  const saved = await request(app).put(url).set(headers(admin)).send({ apiKey: 'db-only-test-key', senderEmail: 'sender@example.test', senderName: 'Equipe', smsSender: 'ProColis' });
  expect(saved.status).toBe(200);
  expect(saved.body.config.apiKeySource).toBe('database');
  expect(JSON.stringify(saved.body)).not.toContain('db-only-test-key');
  expect((await prisma.systemConfig.findUnique({ where: { key: 'brevo' } })).value.apiKey).toBe('db-only-test-key');
  const edited = await request(app).put(url).set(headers(admin)).send({ senderName: 'Nouveau nom', apiKey: '********' });
  expect(edited.status).toBe(200);
  expect((await prisma.systemConfig.findUnique({ where: { key: 'brevo' } })).value.apiKey).toBe('db-only-test-key');
  const fallback = await request(app).put(url).set(headers(admin)).send({ apiKey: '' });
  expect(fallback.status).toBe(200);
  expect(fallback.body.config.apiKeySource).toBe('environment');
  const audit = await prisma.auditLog.findMany({ where: { actorId: admin.user.id, action: 'notifications.brevoConfigUpdate' } });
  expect(JSON.stringify(audit)).not.toContain('db-only-test-key');
});

test('test de connexion immediat apres enregistrement sans cle environnement', async () => {
  env.BREVO_API_KEY = '';
  const saved = await request(app).put(url).set(headers(admin)).send({ apiKey: 'db-only-test-key' });
  expect(saved.status).toBe(200);
  const response = await request(app).post('/api/v1/admin/notifications/brevo-test').set(headers(admin)).send({ email: 'test@example.test' });
  expect(response.status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(1);
});

test('valide les champs et refuse les comptes non autorises', async () => {
  expect((await request(app).put(url).set(headers(admin)).send({ apiKey: 123 })).status).toBe(422);
  expect((await request(app).put(url).set(headers(admin)).send({ senderEmail: 'invalid' })).status).toBe(422);
  expect((await request(app).put(url).set(headers(admin)).send({ smsSender: 'too-long-for-sms' })).status).toBe(422);
  expect((await request(app).put(url).set(headers(client)).send({ apiKey: 'forbidden' })).status).toBe(403);
  expect((await request(app).get(url).set(headers(client))).status).toBe(403);
});
