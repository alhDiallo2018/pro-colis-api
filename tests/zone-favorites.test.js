import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Contrat des routes exprimées dans le référentiel « zones » consommées par le
 * web : favoris et annuaire public des chauffeurs d'une zone.
 *
 * Les deux rattachements coexistent pendant la migration (table `zone_drivers`
 * et colonne héritée `users.garage_id` pointant le garage miroir) : la suite
 * vérifie que l'union est bien renvoyée et que l'identifiant du garage miroir
 * reste accepté à la place de celui de la zone.
 */
describe('zone favorites and public drivers', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let clientToken;
  let clientId;
  let zoneId;
  let mirrorGarageId;
  let linkedDriverId;
  let legacyDriverId;

  async function register(phonePrefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response;
  }

  beforeAll(async () => {
    const client = await register('75', 'Client Zone Test', 'client');
    const linked = await register('76', 'Chauffeur Zone Test', 'driver');
    const legacy = await register('77', 'Chauffeur Garage Test', 'driver');

    clientToken = client.body.accessToken;
    clientId = client.body.user.id;
    linkedDriverId = linked.body.user.id;
    legacyDriverId = legacy.body.user.id;

    const garage = await prisma.garage.create({
      data: { name: `Garage Zone ${suffix}`, city: 'Dakar', region: 'Dakar' }
    });
    mirrorGarageId = garage.id;

    const zone = await prisma.zone.create({
      data: {
        name: `Zone Test ${suffix}`,
        type: 'CIRCLE',
        city: 'Dakar',
        region: 'Dakar',
        latitude: '14.6928000',
        longitude: '-17.4467000',
        radiusKm: '30',
        metadata: { garageId: garage.id }
      }
    });
    zoneId = zone.id;

    await prisma.zoneDriver.create({ data: { zoneId, driverId: linkedDriverId, isPrimary: true } });
    await prisma.user.update({ where: { id: legacyDriverId }, data: { garageId: mirrorGarageId } });
  });

  afterAll(async () => {
    await prisma.favoriteZone.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.zoneDriver.deleteMany({ where: { zoneId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.zone.deleteMany({ where: { id: zoneId } });
    await prisma.garage.deleteMany({ where: { id: mirrorGarageId } });
    await prisma.$disconnect();
  });

  const clientAuth = () => ({ Authorization: `Bearer ${clientToken}` });

  it('renvoie l’union des chauffeurs rattachés par zone et par garage miroir', async () => {
    const response = await request(app).get(`/api/v1/public/drivers/zone/${zoneId}`);

    expect(response.status).toBe(200);
    const ids = response.body.drivers.map((driver) => driver.id);
    expect(ids).toEqual(expect.arrayContaining([linkedDriverId, legacyDriverId]));
    // Pas de doublon lorsque les deux rattachements pointent le même chauffeur.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('accepte l’identifiant du garage miroir à la place de celui de la zone', async () => {
    const response = await request(app).get(`/api/v1/public/drivers/zone/${mirrorGarageId}`);

    expect(response.status).toBe(200);
    const ids = response.body.drivers.map((driver) => driver.id);
    expect(ids).toEqual(expect.arrayContaining([linkedDriverId, legacyDriverId]));
  });

  it('répond 404 sur une zone inconnue', async () => {
    const response = await request(app).get(
      '/api/v1/public/drivers/zone/00000000-0000-4000-8000-000000000000'
    );
    expect(response.status).toBe(404);
  });

  it('ajoute, liste puis retire une zone favorite de façon idempotente', async () => {
    const empty = await request(app).get('/api/v1/favorites/zones').set(clientAuth());
    expect(empty.status).toBe(200);
    expect(empty.body.zones).toEqual([]);

    const added = await request(app).post(`/api/v1/favorites/zones/${zoneId}`).set(clientAuth());
    expect(added.status).toBe(200);

    // Un second appel ne doit pas violer la clé primaire composite.
    const again = await request(app).post(`/api/v1/favorites/zones/${zoneId}`).set(clientAuth());
    expect(again.status).toBe(200);

    const listed = await request(app).get('/api/v1/favorites/zones').set(clientAuth());
    expect(listed.status).toBe(200);
    expect(listed.body.zones).toHaveLength(1);
    expect(listed.body.zones[0].id).toBe(zoneId);
    expect(listed.body.zones[0].name).toBe(`Zone Test ${suffix}`);

    const removed = await request(app).delete(`/api/v1/favorites/zones/${zoneId}`).set(clientAuth());
    expect(removed.status).toBe(200);

    // Retirer deux fois reste un succès : le front n'a rien à réconcilier.
    const removedAgain = await request(app)
      .delete(`/api/v1/favorites/zones/${zoneId}`)
      .set(clientAuth());
    expect(removedAgain.status).toBe(200);

    const after = await request(app).get('/api/v1/favorites/zones').set(clientAuth());
    expect(after.body.zones).toEqual([]);
  });

  it('refuse les favoris sans session', async () => {
    const response = await request(app).get('/api/v1/favorites/zones');
    expect(response.status).toBe(401);
  });

  it('expose la zone de rattachement du chauffeur sur /auth/me', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: `76${suffix}`, pin: '123456' });
    expect(login.status).toBe(200);
    expect(login.body.user.zoneId).toBe(zoneId);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${login.body.accessToken}` });
    expect(me.status).toBe(200);
    expect(me.body.user.zoneId).toBe(zoneId);
    expect(me.body.user.zoneName).toBe(`Zone Test ${suffix}`);

    // Un client sans rattachement reçoit explicitement `null`, pas un champ absent.
    const clientMe = await request(app).get('/api/v1/auth/me').set(clientAuth());
    expect(clientMe.body.user.zoneId).toBeNull();
    expect(clientMe.body.user.id).toBe(clientId);
  });
});
