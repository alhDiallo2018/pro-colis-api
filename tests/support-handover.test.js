import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { signAccessToken } from '../src/utils/tokens.js';
import * as chat from '../src/modules/support/chat.service.js';

const users = [];
let customer, other, agent, backup, commercial, supervisor;
const headers = user => ({ Authorization: `Bearer ${signAccessToken(user)}` });
const base = '/api/v1/support/chat';
const presence = (user, available = true, connectionId = randomUUID(), familyId = null) =>
  chat.heartbeat(user, familyId, connectionId, available);
const open = (user = customer, department = 'general') => chat.openChat(user, user.id, department);
const thread = id => prisma.supportChatConversation.findUnique({ where: { id } });

beforeAll(async () => {
  for (const [fullName, role] of [['Demandeur', 'client'], ['Autre client', 'driver'],
    ['Support technique', 'support_technique'], ['Support secours', 'support'], ['Support commercial', 'support_commercial'], ['Superviseur', 'super_admin']]) {
    users.push(await prisma.user.create({ data: { fullName, role, phone: randomUUID() } }));
  }
  [customer, other, agent, backup, commercial, supervisor] = users;
});
beforeEach(async () => {
  await prisma.supportPresence.deleteMany();
  await prisma.supportChatConversation.deleteMany();
});
afterAll(async () => {
  const ids = users.map(user => user.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityType: 'support_conversation' }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('sans agent, le message reste en attente puis est affecte au retour du support', async () => {
  const c = await open();
  expect(c.waiting).toBe(true);
  await chat.sendChatMessage(customer, c.id, { body: 'Besoin d’aide' });
  await presence(agent);
  expect((await thread(c.id)).assignedToId).toBe(agent.id);
  expect((await chat.chatThread(agent, c.id)).messages[0].body).toBe('Besoin d’aide');
  expect(await prisma.notification.count({ where: { userId: agent.id, type: 'support_chat', data: { path: ['conversationId'], equals: c.id } } })).toBe(1);
});

test('priorite a la specialite, sinon repartition entre les agents les moins charges', async () => {
  await presence(agent); await presence(backup); await presence(commercial);
  const c = await open(customer, 'commercial');
  expect(c.assignedTo.id).toBe(commercial.id);
  const d = await open(other, 'technique');
  expect(d.assignedTo.id).toBe(agent.id);
  const staffRequest = await open(commercial, 'general');
  expect(staffRequest.assignedTo.id).toBe(backup.id);
});

test('un agent ne peut pas etre affecte a sa propre demande, meme si sa specialite correspond', async () => {
  await presence(agent); await presence(backup);
  const c = await open(agent, 'technique');
  expect(c.assignedTo.id).toBe(backup.id);
});

test('une presence expiree provoque la reprise sans perte de l’historique ni de l’auteur', async () => {
  await presence(agent);
  const c = await open();
  await chat.sendChatMessage(customer, c.id, { body: 'Question' });
  await chat.sendChatMessage(agent, c.id, { body: 'Premiere reponse' });
  await presence(backup);
  await prisma.supportPresence.updateMany({ where: { userId: agent.id }, data: { lastSeenAt: new Date(Date.now() - 400000) } });
  await chat.withSupportLock(tx => chat.reconcileAssignments(tx));
  expect((await thread(c.id)).assignedToId).toBe(backup.id);
  await expect(chat.sendChatMessage(agent, c.id, { body: 'Reponse tardive' })).rejects.toMatchObject({ statusCode: 409 });
  await chat.sendChatMessage(backup, c.id, { body: 'Suite' });
  const result = await chat.chatThread(customer, c.id);
  expect(result.messages.map(m => m.senderId)).toEqual([customer.id, agent.id, backup.id]);
  expect(result.messages[1].senderName).toBe(agent.fullName);
  expect(await prisma.auditLog.count({ where: { entityId: c.id, action: 'support.assignment' } })).toBe(2);
});

test('mettre un appareil absent ne libere pas l’agent encore actif sur un autre appareil', async () => {
  const a = randomUUID(), b = randomUUID();
  await presence(agent, true, a); await presence(agent, true, b);
  const c = await open(); await presence(backup);
  await presence(agent, false, a);
  expect((await thread(c.id)).assignedToId).toBe(agent.id);
  await presence(agent, false, b);
  expect((await thread(c.id)).assignedToId).toBe(backup.id);
});

test('la fermeture de toutes les sessions libere immediatement les conversations', async () => {
  await presence(agent); const c = await open(); await presence(backup);
  await chat.releaseSupportSession(agent.id);
  expect((await thread(c.id)).assignedToId).toBe(backup.id);
});

test('une famille de session revoquee ne peut retenir une affectation', async () => {
  await presence(agent, true, randomUUID(), randomUUID());
  const c = await open();
  expect(c.waiting).toBe(true);
});

test('deux ouvertures concurrentes conservent un fil unique', async () => {
  const [a, b] = await Promise.all([open(), open()]);
  expect(a.id).toBe(b.id);
  expect(await prisma.supportChatConversation.count({ where: { userId: customer.id } })).toBe(1);
});

test('deux agents ne peuvent prendre et repondre simultanement au meme fil', async () => {
  await presence(agent); await presence(backup); const c = await open();
  const claims = await Promise.allSettled([chat.takeChat(agent, c.id), chat.takeChat(backup, c.id)]);
  expect(claims.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const sends = await Promise.allSettled([chat.sendChatMessage(agent, c.id, { body: 'A' }), chat.sendChatMessage(backup, c.id, { body: 'B' })]);
  expect(sends.filter(r => r.status === 'fulfilled')).toHaveLength(1);
});

test('lecture superviseur ne marque pas le message client comme lu', async () => {
  await presence(agent); const c = await open();
  await chat.sendChatMessage(customer, c.id, { body: 'Non lu' });
  await chat.chatThread(backup, c.id);
  expect((await prisma.supportChatEntry.findFirst({ where: { conversationId: c.id } })).readAt).toBeNull();
  await chat.chatThread(agent, c.id);
  expect((await prisma.supportChatEntry.findFirst({ where: { conversationId: c.id } })).readAt).not.toBeNull();
});

test('cloturer puis recevoir un nouveau message reutilise le meme historique', async () => {
  await presence(agent); const c = await open();
  await chat.closeChat(agent, c.id);
  expect((await chat.chatThread(customer, c.id)).conversation.status).toBe('closed');
  await chat.sendChatMessage(customer, c.id, { body: 'Encore une question' });
  expect((await thread(c.id)).status).toBe('open');
  expect((await thread(c.id)).assignedToId).toBe(agent.id);
});

test('les supports peuvent contacter tout role et prendre leur nouveau fil sortant', async () => {
  await presence(agent);
  for (const user of [customer, other, commercial]) {
    const c = await chat.openChat(agent, user.id);
    expect(c.assignedTo.id).toBe(agent.id);
    await chat.sendChatMessage(agent, c.id, { body: 'Bonjour' });
    expect((await chat.chatThread(user, c.id)).messages[0].body).toBe('Bonjour');
  }
});

test('API : un client ne peut ni consulter les autres fils ni publier une presence', async () => {
  const c = await open();
  for (const url of [`${base}/conversations`, `${base}/conversations/${c.id}`, `${base}/users`]) {
    expect((await request(app).get(url).set(headers(other))).status).toBe(403);
  }
  expect((await request(app).post(`${base}/presence`).set(headers(customer)).send({ connectionId: randomUUID(), available: true })).status).toBe(403);
  expect((await request(app).post(`${base}/conversations`).set(headers(customer)).send({ userId: other.id })).status).toBe(403);
});

test('API : validation, recherche de destinataire et reponse du support', async () => {
  expect((await request(app).post(`${base}/presence`).set(headers(agent)).send({ connectionId: randomUUID(), available: true })).status).toBe(200);
  const response = await request(app).post(`${base}/conversations`).set(headers(customer)).send({ department: 'technique' });
  expect(response.status).toBe(200);
  const c = response.body.conversation;
  expect((await request(app).post(`${base}/conversations/${c.id}/messages`).set(headers(agent)).send({ body: 'Bonjour' })).status).toBe(200);
  expect((await request(app).post(`${base}/conversations/${c.id}/messages`).set(headers(agent)).send({ body: ' ' })).status).toBe(422);
  const search = await request(app).get(`${base}/users`).set(headers(agent)).query({ search: customer.fullName });
  expect(search.status).toBe(200);
  expect(search.body.users.map(u => u.id)).toContain(customer.id);
  expect((await request(app).get('/api/v1/admin/notifications/brevo-config').set(headers(agent))).status).toBe(403);
});

test('ancien client : pas de diffusion et lire le fil ne rouvre pas une demande cloturee', async () => {
  await presence(agent);
  const response = await request(app).post('/api/v1/messages').set(headers(customer)).send({ receiverId: agent.id, body: 'Ancien client' });
  expect(response.status).toBe(201);
  expect(await prisma.message.count({ where: { senderId: customer.id } })).toBe(0);
  const c = await prisma.supportChatConversation.findUnique({ where: { userId: customer.id } });
  await chat.closeChat(agent, c.id);
  const read = await request(app).get('/api/v1/messages/thread').set(headers(customer)).query({ peerId: agent.id });
  expect(read.status).toBe(200);
  expect(read.body.messages[0].body).toBe('Ancien client');
  expect((await thread(c.id)).status).toBe('closed');
});


test('APK historique : son identifiant support par defaut ouvre le fil partage sans compte fictif', async () => {
  const peerId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const response = await request(app).post('/api/v1/messages').set(headers(customer)).send({ receiverId: peerId, body: 'Depuis Android' });
  expect(response.status).toBe(201);
  const read = await request(app).get('/api/v1/messages/thread').set(headers(customer)).query({ peerId });
  expect(read.body.messages[0].body).toBe('Depuis Android');
});

test('consulter son historique ne rouvre pas une conversation cloturee', async () => {
  expect((await request(app).get(`${base}/mine`).set(headers(customer))).body.conversation).toBeNull();
  await presence(agent); const c = await open(); await chat.closeChat(agent, c.id);
  const response = await request(app).get(`${base}/mine`).set(headers(customer));
  expect(response.body.conversation.id).toBe(c.id);
  expect(response.body.conversation.status).toBe('closed');
});


test('un transfert manuel garde le même fil et permet au nouvel agent de continuer', async () => {
  await presence(agent); const c = await open(); await presence(backup);
  await chat.sendChatMessage(customer, c.id, { body: 'Mon dossier' });
  await chat.sendChatMessage(agent, c.id, { body: 'Première assistance' });
  const response = await request(app).post(`${base}/conversations/${c.id}/transfer`).set(headers(agent))
    .send({ agentId: backup.id, expectedAssignedToId: agent.id });
  expect(response.status).toBe(200);
  expect(response.body.conversation.id).toBe(c.id);
  expect(response.body.conversation.assignedTo.id).toBe(backup.id);
  await expect(chat.sendChatMessage(agent, c.id, { body: 'Ancien agent' })).rejects.toMatchObject({ statusCode: 409 });
  await chat.sendChatMessage(backup, c.id, { body: 'Je reprends votre dossier' });
  await presence(agent);
  expect((await thread(c.id)).assignedToId).toBe(backup.id);
  expect((await chat.chatThread(customer, c.id)).messages.map(row => row.senderId)).toEqual([customer.id, agent.id, backup.id]);
  const audit = await prisma.auditLog.findFirst({ where: { entityId: c.id, actorId: agent.id, action: 'support.assignment' } });
  expect(audit.afterData).toMatchObject({ assignedToId: backup.id, reason: 'manual_transfer' });
  expect(await prisma.notification.count({ where: { userId: backup.id, type: 'support_chat', data: { path: ['conversationId'], equals: c.id } } })).toBe(1);
});

test('seul l’agent affecté ou le superviseur peut transférer un dossier déjà traité', async () => {
  await presence(agent); const c = await open(); await presence(backup); await presence(commercial);
  await expect(chat.transferChat(backup, c.id, commercial.id, agent.id)).rejects.toMatchObject({ statusCode: 403 });
  await expect(chat.transferChat(customer, c.id, backup.id, agent.id)).rejects.toMatchObject({ statusCode: 403 });
  const transferred = await chat.transferChat(supervisor, c.id, commercial.id, agent.id);
  expect(transferred.assignedTo.id).toBe(commercial.id);
});

test('un support absent ou le demandeur ne peut pas recevoir le transfert', async () => {
  await presence(agent); const c = await open();
  await expect(chat.transferChat(agent, c.id, backup.id, agent.id)).rejects.toMatchObject({ statusCode: 409 });
  await presence(commercial);
  const staffCase = await open(commercial);
  await expect(chat.transferChat(supervisor, staffCase.id, commercial.id, staffCase.assignedTo.id)).rejects.toMatchObject({ statusCode: 409 });
  expect((await thread(c.id)).assignedToId).toBe(agent.id);
});

test('deux transferts concurrents du superviseur ne peuvent pas s’écraser', async () => {
  await presence(agent); const c = await open(); await presence(backup); await presence(commercial);
  const results = await Promise.allSettled([
    chat.transferChat(supervisor, c.id, backup.id, agent.id),
    chat.transferChat(supervisor, c.id, commercial.id, agent.id)
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected').reason.statusCode).toBe(409);
});

test('la prise manuelle d’un dossier libre précède le choix automatique du moins chargé', async () => {
  await presence(agent); await open(); await presence(backup);
  const c = await open(other);
  await prisma.supportChatConversation.update({ where: { id: c.id }, data: { assignedToId: null, assignedAt: null } });
  // Agent a déjà un dossier ; l'ancien rééquilibrage attribuait celui-ci à backup.
  expect((await chat.takeChat(agent, c.id)).assignedTo.id).toBe(agent.id);
});

test('un dossier libre peut être affecté manuellement à un collègue disponible', async () => {
  await presence(agent); const c = await open(); await presence(backup);
  await prisma.supportChatConversation.update({ where: { id: c.id }, data: { assignedToId: null, assignedAt: null } });
  expect((await chat.transferChat(agent, c.id, backup.id, null)).assignedTo.id).toBe(backup.id);
  await chat.closeChat(backup, c.id);
  await expect(chat.transferChat(supervisor, c.id, agent.id, null)).rejects.toMatchObject({ statusCode: 409 });
});

test('la liste des agents expose la disponibilité et la charge sans les données de session', async () => {
  await presence(agent); await open(); await presence(backup);
  const response = await request(app).get(`${base}/agents`).set(headers(agent));
  expect(response.status).toBe(200);
  expect(response.body.agents.map(row => row.id)).toEqual([backup.id, agent.id]);
  expect(response.body.agents.map(row => row.activeCases)).toEqual([0, 1]);
  expect(response.body.agents[0]).not.toHaveProperty('familyId');
  expect((await request(app).get(`${base}/agents`).set(headers(customer))).status).toBe(403);
  const c = await open(other);
  expect((await request(app).post(`${base}/conversations/${c.id}/transfer`).set(headers(supervisor)).send({ agentId: agent.id })).status).toBe(422);
});
