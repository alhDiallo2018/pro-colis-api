import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

describe('paydunya admin config (DB prime sur env)', () => {
  const phone = `76${Date.now().toString().slice(-7)}`;
  let token;
  let adminId;

  beforeAll(async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      phone,
      fullName: 'Super Admin PayDunya',
      pin: '123456',
      role: 'super_admin'
    });
    token = res.body.accessToken;
    adminId = res.body.user?.id;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
    if (adminId) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.refreshToken.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('stores keys and returns them masked', async () => {
    const put = await request(app)
      .put('/api/v1/admin/payments/paydunya-config')
      .set(auth())
      .send({ masterKey: 'mk-secret-ABCD', privateKey: 'pk-secret-EFGH', token: 'tk-secret-IJKL', mode: 'test', storeName: 'ProColis Test' });
    expect(put.status).toBe(200);
    expect(put.body.config.masterKey).toBe('****ABCD');
    expect(put.body.config.configured).toBe(true);

    const get = await request(app).get('/api/v1/admin/payments/paydunya-config').set(auth());
    expect(get.body.config.privateKey).toBe('****EFGH');
    expect(get.body.config.storeName).toBe('ProColis Test');
  });

  it('ignores masked values sent back by the admin screen', async () => {
    const put = await request(app)
      .put('/api/v1/admin/payments/paydunya-config')
      .set(auth())
      .send({ masterKey: '****ABCD', mode: 'live' });
    expect(put.status).toBe(200);
    expect(put.body.config.mode).toBe('live');
    const row = await prisma.systemConfig.findUnique({ where: { key: 'paydunya.masterKey' } });
    expect(row.value).toBe('mk-secret-ABCD'); // inchangée
  });

  it('rejects non super-admin access', async () => {
    const res = await request(app).get('/api/v1/admin/payments/paydunya-config');
    expect(res.status).toBe(401);
  });
});
