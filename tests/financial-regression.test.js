import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, registerPublic, registerStaff, cleanupUsers } from './helpers.js';
import { finalizeWithdrawalSuccess, failWithdrawal } from '../src/utils/withdrawal-flow.js';

/**
 * Régression des corrections de l'audit financier :
 *  - retrait : une seule transaction `withdrawal` par retrait (idempotence incluse) ;
 *  - dette de commission réglée par les points : ledger cohérent ;
 *  - dette de commission réglée depuis le wallet (recharge) : débit réel + agrégats ;
 *  - débit de points sans solde négatif ;
 *  - validation méthode/numéro de retrait ;
 *  - autorisation financière (support_technique / support_commercial en lecture seule).
 */

describe('régression financière - retraits', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let driver;
  let admin;
  let driverId;

  beforeAll(async () => {
    driver = await registerPublic(`76${suffix}`, 'Chauffeur Fin', 'driver');
    driverId = driver.body.user.id;
    userIds.push(driverId);
    admin = await registerStaff(`75${suffix}`, 'Super Admin Fin', 'super_admin');
    userIds.push(admin.userId);

    await prisma.systemConfig.upsert({
      where: { key: 'withdrawal.minAmount' },
      update: { value: 500 },
      create: { key: 'withdrawal.minAmount', value: 500 }
    });
  });

  afterEach(async () => {
    await prisma.systemConfig.deleteMany({
      where: { key: { in: ['withdrawal.maxAmount', 'withdrawal.maxPerDay'] } }
    });
  });

  afterAll(async () => {
    await prisma.withdrawal.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.systemConfig.deleteMany({ where: { key: 'withdrawal.minAmount' } });
    await prisma.$disconnect();
  });

  const driverAuth = () => authHeader(driver.body.accessToken);
  const adminAuth = () => authHeader(admin.accessToken);

  async function fundWallet(amount) {
    await prisma.wallet.upsert({
      where: { userId: driverId },
      update: { balance: amount, pendingBalance: 0, totalDeposited: amount, totalWithdrawn: 0 },
      create: { userId: driverId, balance: amount, totalDeposited: amount }
    });
  }

  async function requestWithdrawal(amount) {
    const res = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount, method: 'wave', phone: `77${suffix}` });
    expect(res.status).toBe(201);
    return res.body.withdrawal;
  }

  it('un retrait approuvé puis complété ne produit qu une seule transaction', async () => {
    await fundWallet(5000);
    const w = await requestWithdrawal(2000);

    const approve = await request(app)
      .post(`/api/v1/super-admin/withdrawals/${w.id}/approve`)
      .set(adminAuth());
    expect(approve.status).toBe(200);

    const complete = await request(app)
      .post(`/api/v1/super-admin/withdrawals/${w.id}/complete`)
      .set(adminAuth());
    expect(complete.status).toBe(200);

    const txns = await prisma.walletTransaction.findMany({
      where: { withdrawalId: w.id, type: 'withdrawal' }
    });
    expect(txns.length).toBe(1);
    expect(txns[0].status).toBe('completed');
    expect(Number(txns[0].balanceBefore)).toBe(5000);
    expect(Number(txns[0].balanceAfter)).toBe(3000);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(3000);
    expect(Number(wallet.pendingBalance)).toBe(0);
    expect(Number(wallet.totalWithdrawn)).toBe(2000);
  });

  it('un retrait rejeté recrédite le solde sans doublon de transaction de retrait', async () => {
    await fundWallet(5000);
    const w = await requestWithdrawal(2000);

    const reject = await request(app)
      .post(`/api/v1/super-admin/withdrawals/${w.id}/reject`)
      .set(adminAuth())
      .send({ reason: 'test' });
    expect(reject.status).toBe(200);

    const txns = await prisma.walletTransaction.findMany({
      where: { withdrawalId: w.id, type: 'withdrawal' }
    });
    expect(txns.length).toBe(1);
    expect(txns[0].status).toBe('failed');

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(5000);
    expect(Number(wallet.pendingBalance)).toBe(0);
    expect(Number(wallet.totalWithdrawn)).toBe(0);
  });

  it('finalizeWithdrawalSuccess est idempotent (double appel sans double écriture)', async () => {
    await fundWallet(5000);
    const w = await requestWithdrawal(2000);

    await finalizeWithdrawalSuccess(w.id);
    await finalizeWithdrawalSuccess(w.id);

    const txns = await prisma.walletTransaction.findMany({
      where: { withdrawalId: w.id, type: 'withdrawal' }
    });
    expect(txns.length).toBe(1);
    expect(txns[0].status).toBe('completed');

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.pendingBalance)).toBe(0);
    expect(Number(wallet.totalWithdrawn)).toBe(2000);
  });

  it('finalizeWithdrawalSuccess ne traite pas un retrait déjà échoué', async () => {
    await fundWallet(5000);
    const w = await requestWithdrawal(2000);

    await failWithdrawal(w.id, 'erreur');
    // Un succès tardif (callback) ne doit ni re-débiter ni re-créditer.
    await finalizeWithdrawalSuccess(w.id);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(5000);
    expect(Number(wallet.pendingBalance)).toBe(0);
    expect(Number(wallet.totalWithdrawn)).toBe(0);

    const txns = await prisma.walletTransaction.findMany({
      where: { withdrawalId: w.id, type: 'withdrawal' }
    });
    expect(txns.length).toBe(1);
    expect(txns[0].status).toBe('failed');
  });

  it('refuse un retrait vers une méthode inconnue (422)', async () => {
    await fundWallet(5000);
    const res = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount: 2000, method: 'bitcoin', phone: `77${suffix}` });
    expect(res.status).toBe(422);
  });

  it('refuse un retrait vers un numéro invalide (422)', async () => {
    await fundWallet(5000);
    const res = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount: 2000, method: 'wave', phone: '123' });
    expect(res.status).toBe(422);
  });

  it('applique le montant maximum configuré', async () => {
    await fundWallet(5000);
    await prisma.systemConfig.upsert({
      where: { key: 'withdrawal.maxAmount' },
      update: { value: 1500 },
      create: { key: 'withdrawal.maxAmount', value: 1500 }
    });

    const res = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount: 2000, method: 'wave', phone: `77${suffix}` });

    expect(res.status).toBe(422);
    expect(Number((await prisma.wallet.findUnique({ where: { userId: driverId } })).balance)).toBe(5000);
  });

  it('applique le cumul journalier configuré', async () => {
    await fundWallet(10000);
    const previous = await prisma.withdrawal.aggregate({
      where: {
        walletUserId: driverId,
        status: { in: ['pending', 'processing', 'completed'] }
      },
      _sum: { amount: true }
    });
    const alreadyRequested = Number(previous._sum.amount ?? 0);
    await prisma.systemConfig.upsert({
      where: { key: 'withdrawal.maxPerDay' },
      update: { value: alreadyRequested + 3000 },
      create: { key: 'withdrawal.maxPerDay', value: alreadyRequested + 3000 }
    });

    await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount: 2000, method: 'wave', phone: `77${suffix}` })
      .expect(201);
    const refused = await request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount: 1500, method: 'wave', phone: `77${suffix}` });

    expect(refused.status).toBe(422);
    expect(refused.body.error?.details?.[0]?.message).toContain('Plafond journalier');
  });

  it('sérialise deux retraits concurrents sans découvert', async () => {
    await fundWallet(3000);
    const send = () => request(app)
      .post('/api/v1/driver/wallet/withdraw')
      .set(driverAuth())
      .send({ amount: 2000, method: 'wave', phone: `77${suffix}` });

    const results = await Promise.all([send(), send()]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 422]);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(1000);
    expect(Number(wallet.pendingBalance)).toBe(2000);
  });
});

describe('régression financière - dette de commission par les points', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let admin;
  let driverId;

  beforeAll(async () => {
    admin = await registerStaff(`75${suffix}`, 'Super Admin Points', 'super_admin');
    userIds.push(admin.userId);
    const driver = await registerPublic(`76${suffix}`, 'Chauffeur Points', 'driver');
    driverId = driver.body.user.id;
    userIds.push(driverId);

    await prisma.systemConfig.upsert({
      where: { key: 'score.cfaPerPoint' },
      update: { value: 1 },
      create: { key: 'score.cfaPerPoint', value: 1 }
    });
  });

  afterAll(async () => {
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.systemConfig.deleteMany({ where: { key: 'score.cfaPerPoint' } });
    await prisma.$disconnect();
  });

  async function setDebt(debt) {
    await prisma.wallet.upsert({
      where: { userId: driverId },
      update: { commissionDebt: debt },
      create: { userId: driverId, commissionDebt: debt }
    });
  }

  async function ledgerSum() {
    const agg = await prisma.scoreTransaction.aggregate({
      where: { userId: driverId },
      _sum: { amount: true }
    });
    return Number(agg._sum.amount ?? 0);
  }

  async function addPoints(points) {
    const res = await request(app)
      .post(`/api/v1/super-admin/scores/${driverId}/add`)
      .set(authHeader(admin.accessToken))
      .send({ amount: points, description: 'crédit test' });
    expect(res.status).toBe(200);
    return res.body;
  }

  it.each([
    { debt: 1000, recharge: 600, expectedPoints: 0, expectedDebt: 400 },
    { debt: 1000, recharge: 1000, expectedPoints: 0, expectedDebt: 0 },
    { debt: 1000, recharge: 1500, expectedPoints: 500, expectedDebt: 0 }
  ])('dette $debt + recharge $recharge → points $expectedPoints / dette $expectedDebt, ledger cohérent', async ({ debt, recharge, expectedPoints, expectedDebt }) => {
    await setDebt(debt);
    await prisma.score.upsert({
      where: { userId: driverId },
      update: { points: 0 },
      create: { userId: driverId, points: 0 }
    });
    await prisma.scoreTransaction.deleteMany({ where: { userId: driverId } });

    const ledgerBefore = await ledgerSum();

    await addPoints(recharge);

    const score = await prisma.score.findUnique({ where: { userId: driverId } });
    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    const ledgerAfter = await ledgerSum();

    expect(score.points).toBe(expectedPoints);
    expect(Number(wallet.commissionDebt)).toBe(expectedDebt);

    // Invariant : somme des mouvements du ledger = variation du solde de points.
    expect(ledgerAfter - ledgerBefore).toBe(expectedPoints);
  });
});

describe('régression financière - dette de commission par le wallet (recharge)', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let admin;
  let driverId;

  beforeAll(async () => {
    admin = await registerStaff(`75${suffix}`, 'Super Admin Wallet', 'super_admin');
    userIds.push(admin.userId);
    const driver = await registerPublic(`76${suffix}`, 'Chauffeur Wallet', 'driver');
    driverId = driver.body.user.id;
    userIds.push(driverId);
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function setWallet(balance, debt) {
    await prisma.wallet.upsert({
      where: { userId: driverId },
      update: { balance, commissionDebt: debt, totalCommissionsPaid: 0 },
      create: { userId: driverId, balance, commissionDebt: debt }
    });
  }

  async function recharge(amount) {
    const res = await request(app)
      .post(`/api/v1/super-admin/wallets/${driverId}/recharge`)
      .set(authHeader(admin.accessToken))
      .send({ userId: driverId, amount });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('recharge 600 avec dette 1000 : la dette est débitée du solde, agrégats à jour', async () => {
    await setWallet(5000, 1000);

    await recharge(600);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(5000);
    expect(Number(wallet.commissionDebt)).toBe(400);
    expect(Number(wallet.totalCommissionsPaid)).toBe(600);

    // Ledger : dépôt +600 puis commission -600 → solde net inchangé.
    const txns = await prisma.walletTransaction.findMany({
      where: { walletUserId: driverId },
      orderBy: { createdAt: 'asc' }
    });
    const deposit = txns.find((t) => t.type === 'deposit');
    const commission = txns.find((t) => t.type === 'commission' && t.origin === 'debt_repayment');
    expect(Number(deposit.amount)).toBe(600);
    expect(Number(deposit.balanceAfter) - Number(deposit.balanceBefore)).toBe(600);
    expect(Number(commission.amount)).toBe(600);
    expect(Number(commission.balanceAfter)).toBe(Number(commission.balanceBefore) - 600);
  });

  it('recharge 1000 avec dette 1000 : dette soldée', async () => {
    await setWallet(5000, 1000);

    await recharge(1000);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(5000);
    expect(Number(wallet.commissionDebt)).toBe(0);
    expect(Number(wallet.totalCommissionsPaid)).toBe(1000);
  });

  it('recharge bornée par le montant entrant quand le solde est faible', async () => {
    await setWallet(500, 1000);

    await recharge(600);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    // 500 + 600 - 600 (dette) = 500 ; dette 1000 - 600 = 400.
    expect(Number(wallet.balance)).toBe(500);
    expect(Number(wallet.commissionDebt)).toBe(400);
  });

  it('utilise le userId de l URL et sérialise les débits concurrents', async () => {
    await setWallet(5000, 0);
    const debit = () => request(app)
      .post(`/api/v1/super-admin/wallets/${driverId}/debit`)
      .set(authHeader(admin.accessToken))
      .send({ amount: 4000 });

    const results = await Promise.all([debit(), debit()]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 422]);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(wallet.balance)).toBe(1000);
  });
});

describe('régression financière - débit de points sans solde négatif', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let support;
  let clientId;

  beforeAll(async () => {
    support = await registerStaff(`75${suffix}`, 'Support Debit', 'support');
    userIds.push(support.userId);
    const client = await registerPublic(`78${suffix}`, 'Client Debit', 'client');
    clientId = client.body.user.id;
    userIds.push(clientId);

    await prisma.score.upsert({
      where: { userId: clientId },
      update: { points: 30 },
      create: { userId: clientId, points: 30 }
    });
  });

  afterAll(async () => {
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const auth = () => authHeader(support.accessToken);

  it('débite dans la limite du solde', async () => {
    const res = await request(app)
      .post('/api/v1/score/debit')
      .set(auth())
      .send({ userId: clientId, amount: 20 });
    expect(res.status).toBe(200);
    const score = await prisma.score.findUnique({ where: { userId: clientId } });
    expect(score.points).toBe(10);
  });

  it('refuse un débit supérieur au solde', async () => {
    const res = await request(app)
      .post('/api/v1/score/debit')
      .set(auth())
      .send({ userId: clientId, amount: 999 });
    expect(res.status).toBe(422);
    const score = await prisma.score.findUnique({ where: { userId: clientId } });
    expect(score.points).toBe(10);
  });

  it('refuse un montant négatif', async () => {
    const res = await request(app)
      .post('/api/v1/score/debit')
      .set(auth())
      .send({ userId: clientId, amount: -10 });
    expect(res.status).toBe(422);
  });

  it('refuse un montant non numérique', async () => {
    const res = await request(app)
      .post('/api/v1/score/debit')
      .set(auth())
      .send({ userId: clientId, amount: 'abc' });
    expect(res.status).toBe(422);
  });

  it('sérialise deux débits concurrents sans solde négatif', async () => {
    await prisma.score.update({ where: { userId: clientId }, data: { points: 30 } });
    const debit = () => request(app)
      .post('/api/v1/score/debit')
      .set(auth())
      .send({ userId: clientId, amount: 20 });

    const results = await Promise.all([debit(), debit()]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 422]);
    expect((await prisma.score.findUnique({ where: { userId: clientId } })).points).toBe(10);
  });
});

describe('régression financière - autorisation des rôles support', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  let driverId;
  let supportTechnique;
  let supportCommercial;

  beforeAll(async () => {
    const driver = await registerPublic(`76${suffix}`, 'Chauffeur Auth', 'driver');
    driverId = driver.body.user.id;
    userIds.push(driverId);
    supportTechnique = await registerStaff(`74${suffix}`, 'Support Tech Auth', 'support_technique');
    userIds.push(supportTechnique.userId);
    supportCommercial = await registerStaff(`73${suffix}`, 'Support Com Auth', 'support_commercial');
    userIds.push(supportCommercial.userId);
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.withdrawal.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it.each([
    ['support_technique', () => authHeader(supportTechnique.accessToken)],
    ['support_commercial', () => authHeader(supportCommercial.accessToken)]
  ])('refuse le crédit wallet à %s (403)', async (_role, tok) => {
    const res = await request(app)
      .post(`/api/v1/super-admin/wallets/${driverId}/recharge`)
      .set(tok())
      .send({ amount: 1000 });
    expect(res.status).toBe(403);
  });

  it.each([
    ['support_technique', () => authHeader(supportTechnique.accessToken)],
    ['support_commercial', () => authHeader(supportCommercial.accessToken)]
  ])('refuse le débit wallet à %s (403)', async (_role, tok) => {
    const res = await request(app)
      .post(`/api/v1/super-admin/wallets/${driverId}/debit`)
      .set(tok())
      .send({ amount: 1000 });
    expect(res.status).toBe(403);
  });

  it.each([
    ['support_technique', () => authHeader(supportTechnique.accessToken)],
    ['support_commercial', () => authHeader(supportCommercial.accessToken)]
  ])('refuse le crédit de points à %s (403)', async (_role, tok) => {
    const res = await request(app)
      .post('/api/v1/score/credit')
      .set(tok())
      .send({ userId: driverId, amount: 10 });
    expect(res.status).toBe(403);
  });
});
