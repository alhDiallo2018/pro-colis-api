import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Récupération d'un accès perdu.
 *
 * La connexion des deux clients se fait au code PIN : la réinitialisation doit
 * donc écrire `pin_hash`, sans quoi l'utilisateur reste dehors après avoir
 * pourtant reçu et saisi son code de vérification.
 */
describe('forgotten PIN recovery', () => {
  const suffix = Date.now().toString().slice(-7);
  const phone = `74${suffix}`;
  const userIds = [];

  beforeAll(async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone,
      fullName: 'Client PIN Test',
      pin: '123456',
      role: 'client'
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
  });

  afterAll(async () => {
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('réinitialise le PIN via le code reçu, puis laisse se reconnecter', async () => {
    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: phone });
    expect(forgot.status).toBe(200);

    // Brevo n'est pas configuré en test : le code est renvoyé dans la réponse.
    const code = forgot.body.code;
    expect(code).toMatch(/^\d{4,10}$/);

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: phone, otpCode: code, newPin: '654321' });
    expect(reset.status).toBe(200);
    expect(reset.body.pinReset).toBe(true);

    const withNewPin = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: phone, pin: '654321' });
    expect(withNewPin.status).toBe(200);

    const withOldPin = await request(app)
      .post('/api/v1/auth/login-with-pin')
      .send({ identifier: phone, pin: '123456' });
    expect(withOldPin.status).toBe(401);
  });

  it('rejette une réinitialisation sans nouveau secret', async () => {
    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: phone });
    expect(forgot.status).toBe(200);

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: phone, otpCode: forgot.body.code });
    expect(response.status).toBe(422);
  });

  it('rejette un code de vérification invalide', async () => {
    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: phone, otpCode: '000000', newPin: '111111' });
    expect(response.status).toBe(422);
  });
});
