import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Le dashboard mobile affiche « Hors ligne » tant que `driverStatus` n'est pas
 * connu. Si la réponse de login l'omettait, le client devait faire un appel
 * supplémentaire à `/auth/me` avant de pouvoir statuer. Ce test verrouille le
 * contrat : la réponse de login-with-pin doit toujours porter `driverStatus`
 * pour un compte chauffeur.
 */
describe('login driver status payload', () => {
  const suffix = Date.now().toString().slice(-7);
  const phone = `78${suffix}`;
  const pin = '246810';
  const userIds = [];

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('un driver fraîchement enregistré reçoit driverStatus="offline" dès la création', async () => {
    const register = await request(app).post('/api/v1/auth/register').send({
      phone,
      fullName: 'Driver Status Test',
      pin,
      role: 'driver'
    });
    expect(register.status).toBe(201);
    expect(register.body.user).toBeDefined();
    expect(register.body.user.role).toBe('driver');
    // La valeur par défaut (auth.service.js:162) rend un chauffeur hors ligne
    // tant qu'il n'active pas explicitement sa disponibilité.
    expect(register.body.user.driverStatus).toBe('offline');
    userIds.push(register.body.user.id);
  });

  it('login-with-pin renvoie driverStatus dans la réponse', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: phone, pin });
    expect(login.status).toBe(200);
    expect(login.body.user).toBeDefined();
    expect(login.body.user).toHaveProperty('driverStatus');
    expect(['available', 'busy', 'offline']).toContain(login.body.user.driverStatus);
  });

  it('la valeur persiste et remonte telle quelle après un passage en available', async () => {
    const userId = userIds[0];
    await prisma.user.update({
      where: { id: userId },
      data: { driverStatus: 'available' }
    });

    const login = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: phone, pin });
    expect(login.status).toBe(200);
    expect(login.body.user.driverStatus).toBe('available');
  });
});
