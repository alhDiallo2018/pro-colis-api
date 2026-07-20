import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Retrait libre-service du chauffeur. PayDunya volontairement non configuré :
 * le retrait reste PENDING (versement manuel) au lieu de partir en déboursement.
 */
describe('driver withdrawal flow (PayDunya disburse)', () => {
  const phone = `78${Date.now().toString().slice(-7)}`;
  let token;
  let driverId;

  beforeAll(async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      phone,
      fullName: 'Chauffeur Retrait Test',
      pin: '123456',
      role: 'driver'
    });
    token = res.body.accessToken;
    driverId = res.body.user?.id;
    expect(token).toBeTruthy();
    await prisma.wallet.upsert({
      where: { userId: driverId },
      update: { balance: 5000, totalDeposited: 5000 },
      create: { userId: driverId, balance: 5000, totalDeposited: 5000 }
    });
  });

  afterAll(async () => {
    if (driverId) {
      await prisma.withdrawal.deleteMany({ where: { walletUserId: driverId } });
      await prisma.walletTransaction.deleteMany({ where: { walletUserId: driverId } });
      await prisma.wallet.deleteMany({ where: { userId: driverId } });
      await prisma.notification.deleteMany({ where: { userId: driverId } });
      await prisma.refreshToken.deleteMany({ where: { userId: driverId } });
      await prisma.user.delete({ where: { id: driverId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  let withdrawalId;

  it('freezes the amount and returns an UPPERCASE status', async () => {
    const res = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(auth())
      .send({ amount: 2000, method: 'wave', phone });
    expect(res.status).toBe(201);
    expect(res.body.withdrawal.status).toBe('PENDING');
    withdrawalId = res.body.withdrawal.id;

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(3000);
    expect(Number(wallet.pendingBalance)).toBe(2000);
  });

  it('lists driver withdrawals with client-facing statuses', async () => {
    const res = await request(app).get('/api/v1/driver/wallet/withdrawals').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.withdrawals[0].status).toBe('PENDING');
    expect(res.body.withdrawals[0].phoneNumber).toBe(phone);
  });

  it('rejects the disburse callback when the hash is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .send({ hash: 'forged', status: 'success', token: 'whatever' });
    expect(res.status).toBe(403);
  });

  it('refunds the frozen amount on cancellation', async () => {
    const res = await request(app).delete(`/api/v1/driver/wallet/withdrawals/${withdrawalId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(5000);
    expect(Number(wallet.pendingBalance)).toBe(0);
  });

  it('refuses a withdrawal above the available balance', async () => {
    const res = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(auth())
      .send({ amount: 999999, method: 'wave', phone });
    expect(res.status).toBe(422);
  });
});
