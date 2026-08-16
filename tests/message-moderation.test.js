import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Moderation des messages.
 *
 * Le point de vigilance est double : l'admin et les deux cellules support
 * doivent voir TOUS les echanges — pas seulement les leurs, ni seulement le
 * fil support — et un message deja efface par son auteur doit rester lisible
 * cote moderation, sans quoi un signalement arrive toujours trop tard.
 */
describe('moderation des messages', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const messageIds = [];
  const tokens = {};
  let clientId;
  let driverId;

  // `/auth/register` n'ouvre que les roles publics : les cellules support sont
  // provisionnees en base (comme le fait `npm run seed:support`), le middleware
  // relisant de toute facon le role depuis la table users a chaque requete.
  async function register(phonePrefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role: ['client', 'driver', 'admin', 'super_admin'].includes(role) ? role : 'client'
    });
    expect(response.status).toBe(201);

    const userId = response.body.user.id;
    userIds.push(userId);
    tokens[role] = response.body.accessToken;

    if (response.body.user.role !== role) {
      await prisma.user.update({ where: { id: userId }, data: { role } });
    }
    return userId;
  }

  const auth = (role) => ({ Authorization: `Bearer ${tokens[role]}` });

  async function seedMessage(body, { from = clientId, to = driverId } = {}) {
    const message = await prisma.message.create({
      data: { senderId: from, receiverId: to, body }
    });
    messageIds.push(message.id);
    return message;
  }

  beforeAll(async () => {
    clientId = await register('78', 'Client Moderation', 'client');
    driverId = await register('76', 'Chauffeur Moderation', 'driver');
    await register('75', 'Super Moderation', 'super_admin');
    await register('74', 'Admin Moderation', 'admin');
    await register('73', 'Technique Moderation', 'support_technique');
    await register('72', 'Commercial Moderation', 'support_commercial');
  }, 30000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: messageIds } }] }
    });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.message.deleteMany({ where: { id: { in: messageIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('refuse l acces a un participant de la conversation', async () => {
    for (const path of [
      '/api/v1/messages/admin/conversations',
      `/api/v1/messages/admin/thread?userId=${clientId}&peerId=${driverId}`,
      '/api/v1/messages/admin/messages'
    ]) {
      const res = await request(app).get(path).set(auth('client'));
      expect(res.status).toBe(403);
    }

    const message = await seedMessage(`Contenu prive ${suffix}`);
    const denied = await request(app)
      .delete(`/api/v1/messages/admin/messages/${message.id}`)
      .set(auth('driver'));
    expect(denied.status).toBe(403);
  });

  it.each(['admin', 'support_technique', 'support_commercial', 'super_admin'])(
    'donne a %s le fil complet entre deux tiers',
    async (role) => {
      const message = await seedMessage(`Echange visible ${role} ${suffix}`);

      const thread = await request(app)
        .get(`/api/v1/messages/admin/thread?userId=${clientId}&peerId=${driverId}`)
        .set(auth(role));

      expect(thread.status).toBe(200);
      expect(thread.body.messages.map((m) => m.id)).toContain(message.id);
      // Les identites des deux tiers accompagnent le fil : sans elles la
      // console de moderation ne sait pas qui elle sanctionne.
      expect(thread.body.participants.map((p) => p.id).sort()).toEqual([clientId, driverId].sort());
    }
  );

  it('liste les conversations de la plateforme sans en etre partie prenante', async () => {
    await seedMessage(`Conversation listee ${suffix}`);

    const res = await request(app)
      .get(`/api/v1/messages/admin/conversations?userId=${clientId}`)
      .set(auth('support_technique'));

    expect(res.status).toBe(200);
    const conversation = res.body.conversations.find((c) =>
      c.participants.some((p) => p.id === driverId)
    );
    expect(conversation).toBeDefined();
    expect(conversation.messageCount).toBeGreaterThan(0);
    expect(conversation.lastMessage.body).toContain(suffix);
  });

  it('retrouve un message signale par son contenu', async () => {
    const message = await seedMessage(`Insulte signalee ${suffix}`);

    const res = await request(app)
      .get(`/api/v1/messages/admin/messages?search=Insulte signalee ${suffix}`)
      .set(auth('support_commercial'));

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.id)).toContain(message.id);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('supprime un message non autorise et trace le motif', async () => {
    const message = await seedMessage(`A supprimer ${suffix}`);

    const res = await request(app)
      .delete(`/api/v1/messages/admin/messages/${message.id}`)
      .set(auth('admin'))
      .send({ reason: 'Signalement : propos haineux' });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored.deletedAt).not.toBeNull();
    // Suppression logique : la preuve du litige survit a la moderation.
    expect(stored.body).toBe(`A supprimer ${suffix}`);
    // Le motif et l'auteur sont lisible directement sur le message, pas
    // seulement dans l'audit : la console peut l'afficher sans croiser deux
    // tables.
    expect(stored.deletedReason).toBe('Signalement : propos haineux');
    expect(stored.deletedBy).not.toBeNull();

    const trail = await prisma.auditLog.findFirst({
      where: { action: 'message.moderate.delete', entityId: message.id }
    });
    expect(trail).not.toBeNull();
    expect(trail.afterData.reason).toBe('Signalement : propos haineux');
  });

  it('masque le message supprime au participant mais le garde pour la moderation', async () => {
    const message = await seedMessage(`Efface pour le client ${suffix}`);
    await request(app)
      .delete(`/api/v1/messages/admin/messages/${message.id}`)
      .set(auth('support_technique'))
      .send({ reason: 'Contenu non autorise' });

    const userThread = await request(app)
      .get(`/api/v1/messages/thread?peerId=${driverId}`)
      .set(auth('client'));
    expect(userThread.status).toBe(200);
    expect(userThread.body.messages.map((m) => m.id)).not.toContain(message.id);

    const moderated = await request(app)
      .get(`/api/v1/messages/admin/thread?userId=${clientId}&peerId=${driverId}`)
      .set(auth('support_technique'));
    const found = moderated.body.messages.find((m) => m.id === message.id);
    expect(found).toBeDefined();
    expect(found.isDeleted).toBe(true);

    // `includeDeleted=false` rend la vue identique a celle des participants.
    const visibleOnly = await request(app)
      .get(`/api/v1/messages/admin/thread?userId=${clientId}&peerId=${driverId}&includeDeleted=false`)
      .set(auth('support_technique'));
    expect(visibleOnly.body.messages.map((m) => m.id)).not.toContain(message.id);
  });

  it('restaure un message masque et trace l annulation', async () => {
    const message = await seedMessage(`A restaurer ${suffix}`);
    await request(app)
      .delete(`/api/v1/messages/admin/messages/${message.id}`)
      .set(auth('admin'))
      .send({ reason: 'Signalement annule' });

    const res = await request(app)
      .post(`/api/v1/messages/admin/messages/${message.id}/restore`)
      .set(auth('support_technique'))
      .send({ reason: 'Erreur de moderation' });

    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(1);

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored.deletedAt).toBeNull();
    expect(stored.deletedBy).toBeNull();
    expect(stored.deletedReason).toBeNull();

    const trail = await prisma.auditLog.findFirst({
      where: { action: 'message.moderate.restore', entityId: message.id }
    });
    expect(trail).not.toBeNull();
    expect(trail.afterData.reason).toBe('Erreur de moderation');
  });

  it('purge une rafale de messages en un appel', async () => {
    const burst = await Promise.all([
      seedMessage(`Spam 1 ${suffix}`),
      seedMessage(`Spam 2 ${suffix}`),
      seedMessage(`Spam 3 ${suffix}`)
    ]);

    const res = await request(app)
      .post('/api/v1/messages/admin/messages/bulk-delete')
      .set(auth('support_commercial'))
      .send({ messageIds: burst.map((m) => m.id), reason: 'Spam signale' });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);

    const remaining = await prisma.message.count({
      where: { id: { in: burst.map((m) => m.id) }, deletedAt: null }
    });
    expect(remaining).toBe(0);
  });

  it('rejette un identifiant de message invalide', async () => {
    const res = await request(app)
      .delete('/api/v1/messages/admin/messages/pas-un-uuid')
      .set(auth('admin'));
    expect(res.status).toBe(422);
  });
});
