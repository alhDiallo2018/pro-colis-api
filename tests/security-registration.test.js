import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * C1 — Inscription publique : élévation de rôle interdite.
 *
 * L'inscription publique n'ouvre que CLIENT et DRIVER. Toute tentative de créer
 * un compte privilégié (admin, super_admin, support*) ou un rôle inconnu doit
 * être rejetée et ne doit jamais créer de compte avec le rôle demandé.
 */
describe('C1 - inscription publique et rôles', () => {
  const suffix = Date.now().toString().slice(-7);
  const phones = [];
  let seq = 0;

  function phoneFor() {
    const p = `55${String(seq++).padStart(2, '0')}${suffix}`;
    phones.push(p);
    return p;
  }

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: 'user' } });
    await prisma.refreshToken.deleteMany({ where: { user: { phone: { in: phones } } } });
    await prisma.score.deleteMany({ where: { user: { phone: { in: phones } } } });
    await prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await prisma.$disconnect();
  });

  async function attemptRegister(role) {
    return request(app).post('/api/v1/auth/register').send({
      phone: phoneFor(),
      fullName: 'Test Role',
      pin: '123456',
      role
    });
  }

  it('autorise CLIENT', async () => {
    const res = await attemptRegister('client');
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('client');
  });

  it('autorise DRIVER', async () => {
    const res = await attemptRegister('driver');
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('driver');
  });

  it.each(['admin', 'super_admin', 'support', 'support_technique', 'support_commercial', 'hacker_role'])(
    'refuse le rôle %s et ne crée aucun compte privilégié',
    async (role) => {
      const phone = phoneFor();
      const res = await request(app).post('/api/v1/auth/register').send({
        phone,
        fullName: 'Test Escalade',
        pin: '123456',
        role
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);

      const created = await prisma.user.findFirst({ where: { phone } });
      expect(created).toBeNull();
    }
  );
});
