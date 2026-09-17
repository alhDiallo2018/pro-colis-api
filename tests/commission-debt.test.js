import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Gestion de la dette de commission d'un chauffeur sans solde.
 *
 * Règles couvertes :
 *  1. Livraison déjà acceptée terminée, commission couverte → dette inchangée.
 *  2. Aucun solde (wallet + points) → livraison terminée, dette créée.
 *  3. Dette > 0 → nouvelle acceptation refusée, colis en cours terminable.
 *  4/5. Plafond `commission.debtLimit` appliqué à la création de dette.
 *  6/7. Remboursement prioritaire de la dette sur les nouveaux points.
 *  8. Colis déjà accepté terminable malgré une dette existante.
 */
describe('commission debt management', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let adminToken;
  let driverToken;
  let driverId;
  let clientId;
  let garageId;

  async function register(phonePrefix, fullName, role) {
    const publicRole = ['client', 'driver'].includes(role) ? role : 'client';
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role: publicRole
    });
    expect(response.status).toBe(201);
    const userId = response.body.user.id;
    if (publicRole !== role) {
      await prisma.user.update({ where: { id: userId }, data: { role } });
    }
    userIds.push(userId);
    return response;
  }

  async function setCommissionConfig(minAmount, maxAmount) {
    await prisma.commissionConfig.deleteMany({});
    await prisma.commissionConfig.create({
      data: {
        profile: 'local',
        percentage: 5,
        minAmount,
        maxAmount,
        isActive: true,
        effectiveFrom: new Date()
      }
    });
  }

  async function setDebtLimit(value) {
    await prisma.systemConfig.upsert({
      where: { key: 'commission.debtLimit' },
      update: { value },
      create: { key: 'commission.debtLimit', value }
    });
  }

  async function setDriverWallet(userId, { balance = 0, commissionDebt = 0 } = {}) {
    await prisma.wallet.upsert({
      where: { userId },
      update: { balance, commissionDebt },
      create: { userId, balance, commissionDebt }
    });
  }

  async function setDriverScore(userId, points) {
    await prisma.score.upsert({
      where: { userId },
      update: { points },
      create: { userId, points, totalEarned: points, totalSpent: 0 }
    });
  }

  async function createDeliveredCashParcel({ price = 5000, tracking } = {}) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: tracking || `DBT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        senderId: clientId,
        senderName: 'Client Dette Test',
        senderPhone: `78${suffix}`,
        receiverName: 'Dest Dette Test',
        receiverPhone: `70${suffix}`,
        description: 'Colis de test dette',
        weight: '1.00',
        status: 'delivered',
        departureGarageId: garageId,
        assignedDriverId: driverId,
        price: String(price),
        totalAmount: String(price),
        paymentMethod: 'cash',
        paymentChannel: 'cash',
        cashCollectionPoint: 'receiver_delivery',
        deliveryDate: new Date(),
        createdBy: clientId
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  async function createProposalParcel() {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `PROP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        senderId: clientId,
        senderName: 'Client Dette Test',
        senderPhone: `78${suffix}`,
        receiverName: 'Dest Dette Test',
        receiverPhone: `70${suffix}`,
        description: 'Proposition de test dette',
        weight: '1.00',
        status: 'pending',
        departureGarageId: garageId,
        proposedDriverId: driverId,
        proposalStatus: 'pending',
        proposalPrice: '5000',
        price: '5000',
        totalAmount: '5000',
        lastOfferBy: 'client',
        createdBy: clientId
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  async function getWallet(userId) {
    return prisma.wallet.findUnique({ where: { userId } });
  }

  async function getScore(userId) {
    return prisma.score.findUnique({ where: { userId } });
  }

  beforeAll(async () => {
    const admin = await register('75', 'Admin Dette Test', 'super_admin');
    const driver = await register('76', 'Chauffeur Dette Test', 'driver');
    const client = await register('78', 'Client Dette Test', 'client');
    adminToken = admin.body.accessToken;
    driverToken = driver.body.accessToken;
    driverId = driver.body.user.id;
    clientId = client.body.user.id;

    const garage = await prisma.garage.create({
      data: { name: `Garage Dette ${suffix}`, city: 'Dakar', region: 'Dakar' }
    });
    garageId = garage.id;

    // Commission figée à 500 FCFA par défaut (min = max = 500).
    await setCommissionConfig(500, 500);
    // Dette autorisée sans plafond par défaut (0 = aucune limite).
    await setDebtLimit(0);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: parcelIds } }] }
    });
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { parcelId: { in: parcelIds } }] }
    });
    await prisma.payment.deleteMany({ where: { OR: [{ parcelId: { in: parcelIds } }, { userId: { in: userIds } }] } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (garageId) await prisma.garage.delete({ where: { id: garageId } }).catch(() => {});
    await prisma.commissionConfig.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: 'commission.debtLimit' } });
    await prisma.$disconnect();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const driverAuth = () => ({ Authorization: `Bearer ${driverToken}` });

  it('case 1: soldes suffisants → livraison terminée, commission payée, dette = 0', async () => {
    await setDriverWallet(driverId, { balance: 500, commissionDebt: 0 });
    await setDriverScore(driverId, 0);
    const parcel = await createDeliveredCashParcel({ price: 5000 });

    const res = await request(app)
      .post(`/api/v1/super-admin/parcels/${parcel.id}/confirm-cash`)
      .set(adminAuth());

    expect(res.status).toBe(200);

    const wallet = await getWallet(driverId);
    // 500 (solde initial) - 500 (commission) + 4500 (gain net) = 4500.
    expect(Number(wallet.balance)).toBe(4500);
    expect(Number(wallet.commissionDebt)).toBe(0);
  });

  it('case 2: aucun solde → livraison terminée, dette = commission', async () => {
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 0 });
    await setDriverScore(driverId, 0);
    const parcel = await createDeliveredCashParcel({ price: 5000 });

    const res = await request(app)
      .post(`/api/v1/super-admin/parcels/${parcel.id}/confirm-cash`)
      .set(adminAuth());

    expect(res.status).toBe(200);

    const wallet = await getWallet(driverId);
    // Gain net crédité (4500), commission (500) non couverte → dette.
    expect(Number(wallet.commissionDebt)).toBe(500);
    expect(Number(wallet.balance)).toBe(4500);
  });

  it('case 3: dette > 0 → nouvelle acceptation refusée avec code stable', async () => {
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 500 });
    const parcel = await createProposalParcel();

    const res = await request(app)
      .post(`/api/v1/driver/proposals/${parcel.id}/respond`)
      .set(driverAuth())
      .send({ action: 'accept' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMMISSION_DEBT_REQUIRED');
    expect(res.body.message).toContain('dette de commission de 500 FCFA');

    // Aucune modification partielle : le colis reste non assigné.
    const persisted = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(persisted.assignedDriverId).toBeNull();
    expect(persisted.proposalStatus).toBe('pending');
  });

  it('case 4: dette sous la limite → opération autorisée, dette = 1800', async () => {
    await setCommissionConfig(300, 300);
    await setDebtLimit(2000);
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 1500 });
    await setDriverScore(driverId, 0);
    const parcel = await createDeliveredCashParcel({ price: 5000 });

    const res = await request(app)
      .post(`/api/v1/super-admin/parcels/${parcel.id}/confirm-cash`)
      .set(adminAuth());

    expect(res.status).toBe(200);
    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(1800);
  });

  it('case 5: dette dépasserait la limite → refusée, dette inchangée (1800)', async () => {
    await setCommissionConfig(500, 500);
    await setDebtLimit(2000);
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 1800 });
    await setDriverScore(driverId, 0);
    const parcel = await createDeliveredCashParcel({ price: 5000 });

    const res = await request(app)
      .post(`/api/v1/super-admin/parcels/${parcel.id}/confirm-cash`)
      .set(adminAuth());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEBT_LIMIT_EXCEEDED');

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(1800);
    const persisted = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(persisted.paymentStatus).toBeNull();
  });

  it('case 6: remboursement partiel → dette résiduelle, acceptations toujours bloquées', async () => {
    await setDebtLimit(0);
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 1000 });
    await setDriverScore(driverId, 0);

    // Crédit admin de 600 points (cfaPerPoint = 1) → 600 FCFA remboursent la
    // dette en priorité ; seul le reliquat crédite le solde de points.
    const res = await request(app)
      .post(`/api/v1/super-admin/scores/${driverId}/add`)
      .set(adminAuth())
      .send({ amount: 600, description: 'Crédit test remboursement partiel' });

    expect(res.status).toBe(200);

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(400);
    const score = await getScore(driverId);
    expect(score.points).toBe(0);
  });

  it('case 7: remboursement complet → dette = 0, acceptations réactivées', async () => {
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 500 });
    await setDriverScore(driverId, 0);

    const res = await request(app)
      .post(`/api/v1/super-admin/scores/${driverId}/add`)
      .set(adminAuth())
      .send({ amount: 1000, description: 'Crédit test remboursement complet' });

    expect(res.status).toBe(200);

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(0);
    const score = await getScore(driverId);
    expect(score.points).toBe(500);
  });

  it('case 8: colis déjà accepté terminable malgré une dette existante', async () => {
    await setDebtLimit(0);
    await setCommissionConfig(500, 500);
    await setDriverWallet(driverId, { balance: 0, commissionDebt: 500 });
    await setDriverScore(driverId, 0);
    const parcel = await createDeliveredCashParcel({ price: 5000 });

    const res = await request(app)
      .post(`/api/v1/super-admin/parcels/${parcel.id}/confirm-cash`)
      .set(adminAuth());

    expect(res.status).toBe(200);

    const wallet = await getWallet(driverId);
    // La livraison déjà acceptée est finalisée : la commission s'ajoute à la dette.
    expect(Number(wallet.commissionDebt)).toBe(1000);
  });

  it('case 9: règlement de la dette depuis le solde wallet', async () => {
    await setDriverWallet(driverId, { balance: 4500, commissionDebt: 500 });
    await setDriverScore(driverId, 0);

    const res = await request(app)
      .post('/api/v1/driver/wallet/pay-debt')
      .set(driverAuth())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.debtRepaid).toBe(500);
    expect(res.body.commissionDebt).toBe(0);
    expect(res.body.canAcceptNewDeliveries).toBe(true);

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(0);
    expect(Number(wallet.balance)).toBe(4000);
  });

  it('case 10: règlement partiel borné par le solde disponible', async () => {
    await setDriverWallet(driverId, { balance: 300, commissionDebt: 500 });
    await setDriverScore(driverId, 0);

    const res = await request(app)
      .post('/api/v1/driver/wallet/pay-debt')
      .set(driverAuth())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.debtRepaid).toBe(300);
    expect(res.body.commissionDebt).toBe(200);
    expect(res.body.canAcceptNewDeliveries).toBe(false);

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(200);
    expect(Number(wallet.balance)).toBe(0);
  });

  it('case 11: montant explicite supérieur à la dette → dette réglée, reliquat conservé', async () => {
    await setDriverWallet(driverId, { balance: 5000, commissionDebt: 500 });
    await setDriverScore(driverId, 0);

    const res = await request(app)
      .post('/api/v1/driver/wallet/pay-debt')
      .set(driverAuth())
      .send({ amount: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.debtRepaid).toBe(500);
    expect(res.body.commissionDebt).toBe(0);

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(0);
    expect(Number(wallet.balance)).toBe(4500);
  });

  it('case 12: aucune dette → demande refusée', async () => {
    await setDriverWallet(driverId, { balance: 1000, commissionDebt: 0 });
    await setDriverScore(driverId, 0);

    const res = await request(app)
      .post('/api/v1/driver/wallet/pay-debt')
      .set(driverAuth())
      .send({});

    expect(res.status).toBe(422);

    const wallet = await getWallet(driverId);
    expect(Number(wallet.commissionDebt)).toBe(0);
    expect(Number(wallet.balance)).toBe(1000);
  });
});
