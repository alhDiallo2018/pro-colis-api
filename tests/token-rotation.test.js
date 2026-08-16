import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { durationToMs, hashSecret, refreshTokenTtl } from '../src/utils/tokens.js';

/**
 * Duree de vie et rotation des sessions.
 *
 * Deux invariants tiennent la securite de la chaine : un refresh token ne sert
 * qu'une fois (sa reutilisation coupe le compte), et sa duree depend du role —
 * un compte staff voit toute la plateforme, sa session doit se refermer en
 * heures quand celle d'un client dure des semaines.
 */
describe('rotation des refresh tokens', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];

  async function register(phonePrefix, fullName, role = 'client') {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role: role === 'client' || role === 'driver' ? role : 'client'
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);

    if (response.body.user.role !== role) {
      await prisma.user.update({ where: { id: response.body.user.id }, data: { role } });
    }
    return { id: response.body.user.id, refreshToken: response.body.refreshToken };
  }

  const refresh = (token) => request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('renvoie un nouveau refresh token et invalide l ancien', async () => {
    const { refreshToken } = await register('78', 'Rotation Client');

    const first = await refresh(refreshToken);
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).toBeDefined();
    expect(first.body.refreshToken).not.toBe(refreshToken);

    // Le nouveau jeton fonctionne...
    expect((await refresh(first.body.refreshToken)).status).toBe(200);
  });

  it('coupe toutes les sessions quand un jeton revoque est rejoue', async () => {
    const { id, refreshToken } = await register('76', 'Rotation Rejeu');

    const rotated = await refresh(refreshToken);
    expect(rotated.status).toBe(200);

    // Rejeu du jeton deja consomme : on ne sait pas qui du voleur ou de la
    // victime le presente, donc tout le compte est coupe.
    const replayed = await refresh(refreshToken);
    expect(replayed.status).toBe(401);

    // Y compris le jeton legitimement obtenu juste avant.
    expect((await refresh(rotated.body.refreshToken)).status).toBe(401);

    const active = await prisma.refreshToken.count({ where: { userId: id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it('ferme la session ciblee sur /auth/logout', async () => {
    const { id, refreshToken } = await register('75', 'Rotation Logout');

    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(res.status).toBe(200);
    expect((await refresh(refreshToken)).status).toBe(401);

    const active = await prisma.refreshToken.count({ where: { userId: id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it('ferme toutes les sessions sur /auth/logout-all', async () => {
    const phone = `74${suffix}`;
    const first = await register('74', 'Rotation LogoutAll');

    // Deuxieme appareil : une seconde connexion ouvre une seconde session.
    const second = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: phone, pin: '123456' });
    expect(second.status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: first.id, revokedAt: null } })).toBe(2);

    const res = await request(app)
      .post('/api/v1/auth/logout-all')
      .set({ Authorization: `Bearer ${second.body.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body.sessions).toBe(2);

    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh(second.body.refreshToken)).status).toBe(401);
  });

  it('donne au staff une session bien plus courte qu a un client', async () => {
    const client = await register('73', 'Rotation Client TTL', 'client');
    const staff = await register('72', 'Rotation Support TTL', 'support_technique');

    // La connexion doit suivre le role : le compte a ete promu apres son
    // inscription, la session staff n'existe qu'a partir de ce login.
    const staffLogin = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: `72${suffix}`, pin: '123456' });
    expect(staffLogin.status).toBe(200);

    const [clientSession] = await prisma.refreshToken.findMany({
      where: { userId: client.id, revokedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    const [staffSession] = await prisma.refreshToken.findMany({
      where: { userId: staff.id, revokedAt: null },
      orderBy: { createdAt: 'desc' }
    });

    const lifetime = (session) => session.expiresAt.getTime() - session.createdAt.getTime();
    expect(lifetime(staffSession)).toBeLessThan(lifetime(clientSession));

    // `expiresAt` derive de la configuration, il n'est plus fige a 30 jours.
    const tolerance = 5000;
    expect(Math.abs(lifetime(clientSession) - durationToMs(refreshTokenTtl('client')))).toBeLessThan(tolerance);
    expect(Math.abs(lifetime(staffSession) - durationToMs(refreshTokenTtl('support_technique')))).toBeLessThan(tolerance);
  });

  // Chemin de compatibilite : au deploiement, les jetons deja en circulation
  // n'ont pas de `jti`. S'ils cessaient d'etre acceptes, toute la base
  // utilisateurs serait deconnectee d'un coup.
  it('accepte un jeton emis avant la rotation et le fait basculer', async () => {
    const { id } = await register('71', 'Rotation Legacy');

    const legacyToken = jwt.sign({ sub: id }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    await prisma.refreshToken.create({
      data: {
        userId: id,
        jti: null,
        tokenHash: await hashSecret(legacyToken),
        expiresAt: new Date(Date.now() + 30 * 86400 * 1000)
      }
    });

    const res = await refresh(legacyToken);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeDefined();

    // Le jeton renouvele porte desormais un `jti` : le repli ne sert qu'une fois.
    const rotated = await prisma.refreshToken.findFirst({
      where: { userId: id, revokedAt: null },
      orderBy: { createdAt: 'desc' }
    });
    expect(rotated.jti).not.toBeNull();
    expect((await refresh(legacyToken)).status).toBe(401);
  });

  it('reste muet sur un jeton illisible', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'x'.repeat(40) });
    expect(res.status).toBe(200);
  });
});

/**
 * Expiration sur inactivite.
 *
 * Le delai se mesure a chaque requete authentifiee, pas seulement au
 * renouvellement : un access token encore valide ne doit pas survivre a une
 * session endormie.
 */
describe('expiration sur inactivite', () => {
  const suffix = `9${Date.now().toString().slice(-6)}`;
  const userIds = [];

  async function openSession(phonePrefix, fullName) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role: 'client'
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response.body;
  }

  /** Recule l'horodatage d'activite pour simuler une session endormie. */
  async function sleepSession(userId, ms) {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { lastUsedAt: new Date(Date.now() - ms) }
    });
  }

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  const idleMs = durationToMs(env.SESSION_IDLE_TIMEOUT);
  const me = (token) => request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` });

  it('laisse passer une session active', async () => {
    const session = await openSession('68', 'Inactivite Active');
    expect((await me(session.accessToken)).status).toBe(200);
  });

  it('refuse un access token encore valide sur une session endormie', async () => {
    const session = await openSession('67', 'Inactivite Dormante');
    // L'access token vit 15 min : sans controle d'inactivite il passerait.
    await sleepSession(session.user.id, idleMs + 5000);

    const res = await me(session.accessToken);
    expect(res.status).toBe(401);

    const closed = await prisma.refreshToken.findFirst({ where: { userId: session.user.id } });
    expect(closed.revokedReason).toBe('idle');
  });

  it('refuse aussi le renouvellement d une session endormie', async () => {
    const session = await openSession('66', 'Inactivite Refresh');
    await sleepSession(session.user.id, idleMs + 5000);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(401);
  });

  it('repousse l echeance a chaque requete authentifiee', async () => {
    const session = await openSession('65', 'Inactivite Prolongee');

    // Presque au bout du delai : une requete doit relancer le compteur.
    await sleepSession(session.user.id, idleMs - 2000);
    expect((await me(session.accessToken)).status).toBe(200);

    const refreshed = await prisma.refreshToken.findFirst({ where: { userId: session.user.id } });
    expect(Date.now() - refreshed.lastUsedAt.getTime()).toBeLessThan(2000);

    // Et la session survit a une nouvelle attente de la meme duree.
    await sleepSession(session.user.id, idleMs - 2000);
    expect((await me(session.accessToken)).status).toBe(200);
  });

  it('ne coupe pas les autres appareils quand une session s endort', async () => {
    const first = await openSession('64', 'Inactivite Multi');
    const second = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: `64${suffix}`, pin: '123456' });
    expect(second.status).toBe(200);

    // Seule la premiere session dort.
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: first.user.id, revokedAt: null },
      orderBy: { createdAt: 'asc' }
    });
    await prisma.refreshToken.update({
      where: { id: sessions[0].id },
      data: { lastUsedAt: new Date(Date.now() - idleMs - 5000) }
    });

    expect((await me(first.accessToken)).status).toBe(401);
    // Le second appareil, actif, n'est pas touche.
    expect((await me(second.body.accessToken)).status).toBe(200);
  });
});
