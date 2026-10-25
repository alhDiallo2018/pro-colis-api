import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { signAccessToken } from '../src/utils/tokens.js';
import { dispatchManualMessage, getManualMessage } from '../src/modules/notifications/manual-message.service.js';

const users = [];
let actor, recipient, noEmail, deleted, token;
const log = { info: jest.fn(), error: jest.fn() };
const payload = (patch = {}) => ({ requestId: randomUUID(), userId: recipient.id,
  channel: 'email', subject: 'Informations', content: 'Bonjour <script> & "test"\nSuite', ...patch });
const transports = () => ({ sendEmail: jest.fn().mockResolvedValue({ messageId: 'email-1' }),
  sendSms: jest.fn().mockResolvedValue({ messageId: 'sms-1' }) });
const headers = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  for (const data of [
    { fullName: 'Admin test envoi', role: 'super_admin' },
    { fullName: 'Aminata Test Recherche', role: 'client', email: `search-${randomUUID()}@example.test`, phone: '+221779876543' },
    { fullName: 'Sans Email', role: 'client' },
    { fullName: 'Supprimé', role: 'client', status: 'deleted', deletedAt: new Date() }
  ]) users.push(await prisma.user.create({ data: { phone: randomUUID(), ...data } }));
  [actor, recipient, noEmail, deleted] = users;
  token = signAccessToken(actor);
});

afterAll(async () => {
  const ids = users.map(user => user.id);
  await prisma.manualMessageDispatch.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test.each(['Aminata Recherche', 'recherche AMINATA', '+221 77 987 65 43', '00221 77 987 65 43'])('recherche serveur %s avec pagination', async search => {
  const response = await request(app).get('/api/v1/super-admin/users').set(headers()).query({ search, limit: 1 });
  expect(response.status).toBe(200);
  expect(response.body.users.map(user => user.id)).toEqual([recipient.id]);
  expect(response.body.pagination.total).toBe(1);
});

test('recherche email insensible à la casse et filtre de rôle combiné', async () => {
  const response = await request(app).get('/api/v1/super-admin/users').set(headers()).query({ search: recipient.email.toUpperCase() });
  expect(response.body.users.map(user => user.id)).toEqual([recipient.id]);
  const filtered = await request(app).get('/api/v1/super-admin/users').set(headers()).query({ search: recipient.email, role: 'driver' });
  expect(filtered.body.users).toEqual([]);
});

test('sélecteur assistance recherche les mêmes numéros formatés', async () => {
  const response = await request(app).get('/api/v1/super-admin/assistances/users/search').set(headers()).query({ search: '+221 77 987 65 43' });
  expect(response.status).toBe(200);
  expect(response.body.users.map(user => user.id)).toEqual([recipient.id]);
});

test('envoie au contact en base et échappe le texte HTML', async () => {
  const mock = transports();
  const result = await dispatchManualMessage(actor, payload(), log, mock);
  expect(result.status).toBe('sent');
  expect(mock.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: recipient.email, textContent: 'Bonjour <script> & "test"\nSuite',
    htmlContent: '<p>Bonjour &lt;script&gt; &amp; &quot;test&quot;<br>Suite</p>'
  }));
});

test('deux requêtes concurrentes et un retry ne renvoient jamais le message', async () => {
  const mock = transports();
  const body = payload();
  await Promise.all([dispatchManualMessage(actor, body, log, mock), dispatchManualMessage(actor, body, log, mock)]);
  const replay = await dispatchManualMessage(actor, body, log, mock);
  expect(mock.sendEmail).toHaveBeenCalledTimes(1);
  expect(replay.status).toBe('sent');
  await expect(dispatchManualMessage(actor, { ...body, content: 'autre texte' }, log, mock)).rejects.toMatchObject({ statusCode: 409 });
});

test('un compte sans email est ignoré mais reste joignable par SMS', async () => {
  const mock = transports();
  expect((await dispatchManualMessage(actor, payload({ userId: noEmail.id }), log, mock)).status).toBe('skipped');
  expect(mock.sendEmail).not.toHaveBeenCalled();
  expect((await dispatchManualMessage(actor, payload({ userId: noEmail.id, channel: 'sms' }), log, mock)).status).toBe('sent');
  expect(mock.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: noEmail.phone }));
});

test('ignore les comptes supprimés ou absents', async () => {
  const mock = transports();
  for (const userId of [deleted.id, randomUUID()]) {
    expect((await dispatchManualMessage(actor, payload({ userId }), log, mock)).status).toBe('skipped');
  }
  expect(mock.sendEmail).not.toHaveBeenCalled();
});

test('isole un échec prestataire et conserve un résultat consultable', async () => {
  const mock = transports();
  mock.sendEmail.mockRejectedValueOnce(new Error('timeout'));
  const body = payload();
  expect((await dispatchManualMessage(actor, body, log, mock)).status).toBe('unknown');
  expect((await dispatchManualMessage(actor, body, log, mock)).status).toBe('unknown');
  expect(mock.sendEmail).toHaveBeenCalledTimes(1);
  expect((await getManualMessage(actor.id, body.requestId)).status).toBe('unknown');
  expect(await getManualMessage(recipient.id, body.requestId)).toBeNull();
  expect((await dispatchManualMessage(actor, payload(), log, mock)).status).toBe('sent');
});

test('une réponse prestataire vide n’est pas annoncée comme un succès', async () => {
  const mock = transports();
  mock.sendEmail.mockResolvedValue(null);
  expect((await dispatchManualMessage(actor, payload(), log, mock)).status).toBe('unknown');
});

test('une référence en traitement trop ancienne reste incertaine sans nouvel envoi', async () => {
  const body = payload();
  const mock = transports();
  await dispatchManualMessage(actor, body, log, mock);
  await prisma.manualMessageDispatch.update({ where: { id: body.requestId }, data: {
    status: 'processing', createdAt: new Date(Date.now() - 180000), result: {}
  } });
  expect((await dispatchManualMessage(actor, body, log, mock)).status).toBe('unknown');
  expect(mock.sendEmail).toHaveBeenCalledTimes(1);
});

test('route in-app : crée une seule notification et protège le résultat', async () => {
  const body = payload({ channel: 'in_app' });
  for (let i = 0; i < 2; i++) {
    const response = await request(app).post('/api/v1/admin/notifications/messages').set(headers()).send(body);
    expect(response.status).toBe(200);
    expect(response.body.result.status).toBe('sent');
  }
  expect(await prisma.notification.count({ where: { userId: recipient.id, data: { path: ['manualDispatchId'], equals: body.requestId } } })).toBe(1);
  const result = await request(app).get(`/api/v1/admin/notifications/messages/${body.requestId}`).set(headers());
  expect(result.status).toBe(200);
  expect(result.body.result.status).toBe('sent');
});

test('interdit les comptes publics, les messages vides et les SMS trop longs', async () => {
  expect((await request(app).post('/api/v1/admin/notifications/messages')
    .set('Authorization', `Bearer ${signAccessToken(recipient)}`).send(payload())).status).toBe(403);
  expect((await request(app).post('/api/v1/admin/notifications/messages').send(payload())).status).toBe(401);
  for (const patch of [{ content: ' ' }, { subject: '' }, { channel: 'other' }, { channel: 'sms', content: 'a'.repeat(1601) }]) {
    expect((await request(app).post('/api/v1/admin/notifications/messages').set(headers()).send(payload(patch))).status).toBe(422);
  }
});
