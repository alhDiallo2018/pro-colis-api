import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { signAccessToken } from '../src/utils/tokens.js';
import { dispatchManualMessage } from '../src/modules/notifications/manual-message.service.js';
import { heartbeat, openChat } from '../src/modules/support/chat.service.js';

const users = [];
const prefix = `Recipients-${randomUUID()}`;
const base = '/api/v1/admin/notifications';
const headers = user => ({ Authorization: `Bearer ${signAccessToken(user)}` });
const log = { info: jest.fn(), error: jest.fn() };
let garage, admin, root, customer, driver, outside, unassigned, supports;
const payload = (user, extra = {}) => ({ requestId: randomUUID(), userId: user.id,
  channel: 'in_app', subject: 'Informations', content: 'Message ciblé', ...extra });

beforeAll(async () => {
  garage = await prisma.garage.create({ data: { name: prefix, city: 'Dakar', region: 'Dakar' } });
  for (const [name, role, garageId] of [
    ['Admin', 'admin', garage.id], ['Super', 'super_admin', null], ['Client', 'client', garage.id],
    ['Chauffeur', 'driver', garage.id], ['Externe', 'driver', null], ['Sans-zone', 'admin', null],
    ['Support', 'support', null], ['Technique', 'support_technique', null], ['Commercial', 'support_commercial', null]
  ]) users.push(await prisma.user.create({ data: { fullName: `${prefix} ${name}`, role, garageId,
    phone: randomUUID(), email: `${randomUUID()}@example.test`, driverStatus: role === 'driver' ? 'offline' : null,
    passwordHash: 'NEVER-SEND-PASSWORD', pinHash: 'NEVER-SEND-PIN' } }));
  [admin, root, customer, driver, outside, unassigned, ...supports] = users;
});
afterAll(async () => {
  const ids = users.map(user => user.id);
  await prisma.manualMessageDispatch.deleteMany({ where: { actorId: { in: ids } } });
  const conversations = await prisma.supportChatConversation.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: conversations.map(row => row.id) } }] } });
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { senderId: { in: ids } }] } });
  await prisma.supportChatConversation.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (garage) await prisma.garage.delete({ where: { id: garage.id } });
  await prisma.$disconnect();
});

test('les supports et super admin recherchent et paginent aussi les chauffeurs hors ligne', async () => {
  for (const actor of [root, ...supports]) {
    const a = await request(app).get(`${base}/recipients`).set(headers(actor)).query({ search: prefix, role: 'driver', limit: 1 });
    const b = await request(app).get(`${base}/recipients`).set(headers(actor)).query({ search: prefix, role: 'driver', limit: 1, page: 2 });
    expect(a.status).toBe(200);
    expect(a.body.pagination.total).toBe(2);
    expect(new Set([...a.body.users, ...b.body.users].map(user => user.id))).toEqual(new Set([driver.id, outside.id]));
    expect(a.body.users[0]).not.toHaveProperty('passwordHash');
    expect(a.body.users[0]).not.toHaveProperty('pinHash');
  }
});

test('recherche email et filtrage de rôle se combinent', async () => {
  const response = await request(app).get(`${base}/recipients`).set(headers(supports[0])).query({ search: driver.email.toUpperCase(), role: 'driver' });
  expect(response.body.users.map(row => row.id)).toEqual([driver.id]);
  const filtered = await request(app).get(`${base}/recipients`).set(headers(root)).query({ search: driver.email, role: 'client' });
  expect(filtered.body.users).toEqual([]);
});

test('admin zone : liste et envoi imposent le même périmètre même avec un ID falsifié', async () => {
  const response = await request(app).get(`${base}/recipients`).set(headers(admin)).query({ search: prefix });
  expect(response.body.users.map(row => row.id).sort()).toEqual([customer.id, driver.id].sort());
  for (const user of [outside, root]) {
    const response = await request(app).post(`${base}/messages`).set(headers(admin)).send(payload(user));
    expect(response.status).toBe(200);
    expect(response.body.result.status).toBe('skipped');
  }
  const allowed = await request(app).post(`${base}/messages`).set(headers(admin)).send(payload(driver));
  expect(allowed.body.result.status).toBe('sent');
  const empty = await request(app).get(`${base}/recipients`).set(headers(unassigned)).query({ search: prefix });
  expect(empty.body.users).toEqual([]);
});

test('comptes publics refusés et paramètres de recherche invalides rejetés', async () => {
  expect((await request(app).get(`${base}/recipients`).set(headers(customer))).status).toBe(403);
  for (const query of [{ role: 'unknown' }, { page: 0 }, { limit: 999 }]) {
    expect((await request(app).get(`${base}/recipients`).set(headers(root)).query(query)).status).toBe(422);
  }
});

test('les fiches sont personnalisées côté serveur et excluent les secrets', async () => {
  const transport = { sendEmail: jest.fn().mockResolvedValue({ messageId: 'mock' }), sendSms: jest.fn().mockResolvedValue({ messageId: 'mock-sms' }) };
  for (const user of [customer, driver]) {
    const body = payload(user, { channel: 'email', kind: 'account_summary', content: '' });
    expect((await dispatchManualMessage(root, body, log, transport)).status).toBe('sent');
    const sent = transport.sendEmail.mock.calls.at(-1)[0];
    expect(sent.to).toBe(user.email);
    expect(sent.textContent).toContain(user.fullName);
    expect(sent.textContent).toContain(user.phone);
    expect(sent.textContent).not.toContain(user === customer ? driver.email : customer.email);
    expect(JSON.stringify(sent)).not.toMatch(/NEVER-SEND/);
    await dispatchManualMessage(root, body, log, transport);
  }
  expect(transport.sendEmail).toHaveBeenCalledTimes(2);
  expect((await dispatchManualMessage(root, payload(driver, { channel: 'sms', kind: 'account_summary', content: '' }), log, transport)).status).toBe('sent');
  expect(transport.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: driver.phone, content: expect.stringContaining(driver.fullName) }));
});

test('la diffusion chat garde les fils privés, le reçu idempotent et l’affectation existante', async () => {
  await heartbeat(supports[0], null, randomUUID(), true);
  const original = await openChat(customer, customer.id);
  expect(original.assignedTo.id).toBe(supports[0].id);
  for (const user of [customer, driver]) {
    const body = payload(user, { channel: 'chat', kind: 'account_summary', content: '' });
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await request(app).post(`${base}/messages`).set(headers(supports[1])).send(body);
      expect(response.status).toBe(200);
      expect(response.body.result.status).toBe('sent');
    }
    const thread = await prisma.supportChatConversation.findUnique({ where: { userId: user.id }, include: { messages: true } });
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].body).toContain(user.fullName);
    expect(thread.messages[0].fromSupport).toBe(true);
    const own = await request(app).get(`/api/v1/support/chat/conversations/${thread.id}`).set(headers(user));
    expect(own.status).toBe(200);
    const other = await request(app).get(`/api/v1/support/chat/conversations/${thread.id}`).set(headers(outside));
    expect(other.status).toBe(403);
  }
  expect((await prisma.supportChatConversation.findUnique({ where: { id: original.id } })).assignedToId).toBe(supports[0].id);
});
