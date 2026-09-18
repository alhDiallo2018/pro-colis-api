import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { executeCancellationRefund } from '../src/utils/cancellation.js';
import { processCompletedPayment } from '../src/modules/paydunya.controller.js';
import { registerStaff } from './helpers.js';

/**
 * Moteur central d'annulation (pénalité, frais, remboursement, répartition,
 * wallet → points → dette) exposé par le backend. Le mobile et le web ne font
 * qu'afficher : toutes les règles sont calculées côté serveur.
 *
 * Couverture (références A → R du cahier des charges) :
 *  A annulation légitime / exonérée
 *  B client responsable
 *  C chauffeur responsable
 *  D responsabilité partagée
 *  E commun accord ≠ gratuit
 *  F wallet suffisant
 *  G wallet insuffisant + points suffisants
 *  H wallet + points insuffisants → dette
 *  I remboursement PayDunya réussi
 *  J remboursement PayDunya échoué
 *  K double requête (idempotence)
 *  L rejeu réseau (idempotence, pas de double prélèvement)
 *  M quote puis changement de statut → recalcul
 *  N quote puis changement de configuration → recalcul
 *  O confidentialité client/chauffeur
 *  P serializer parcel (champ `cancellation`)
 *  Q compatibilité mobile (contrat imbriqué)
 *  R compatibilité web (contrat plat)
 */

describe('centralized cancellation engine', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let clientToken;
  let clientId;
  let driverToken;
  let driverId;
  let superAdminToken;
  let garageId;
  let secondClientToken;

  async function register(phonePrefix, fullName, role) {
    const res = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(res.status).toBe(201);
    userIds.push(res.body.user.id);
    return res.body;
  }

  async function setConfig(key, value) {
    await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  async function createParcel({ status, assignedDriverId = null, price = 10000, paid = false }) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `CNX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        senderId: clientId,
        senderName: 'Client Annulation',
        senderPhone: `77${suffix}`,
        receiverName: 'Destinataire',
        receiverPhone: `70${suffix}`,
        description: 'Colis de test annulation',
        weight: '1.00',
        status,
        departureGarageId: garageId,
        assignedDriverId,
        price: String(price),
        totalAmount: String(price),
        paymentMethod: paid ? 'wave' : null,
        paymentChannel: paid ? 'platform' : null,
        paymentPhoneNumber: paid ? `77${suffix}` : null,
        createdBy: clientId
      }
    });
    parcelIds.push(parcel.id);
    if (paid) {
      await prisma.payment.create({
        data: {
          userId: clientId,
          parcelId: parcel.id,
          amount: price,
          currency: 'XOF',
          method: 'wave',
          status: 'completed',
          transactionId: `TXN-${parcel.id}`,
          completedAt: new Date()
        }
      });
    }
    return parcel;
  }

  async function setDriverWallet(balance, commissionDebt = 0) {
    await prisma.wallet.upsert({
      where: { userId: driverId },
      update: { balance, commissionDebt },
      create: { userId: driverId, balance, commissionDebt }
    });
  }

  async function setDriverPoints(points) {
    await prisma.score.upsert({
      where: { userId: driverId },
      update: { points },
      create: { userId: driverId, points, totalEarned: points, totalSpent: 0 }
    });
  }

  beforeAll(async () => {
    const client = await register('77', 'Client Annulation', 'client');
    const driver = await register('76', 'Chauffeur Annulation', 'driver');
    clientToken = client.accessToken;
    clientId = client.user.id;
    driverToken = driver.accessToken;
    driverId = driver.user.id;

    const other = await register('74', 'Client Autre', 'client');
    secondClientToken = other.accessToken;

    const staff = await registerStaff(`75${suffix}`, 'Super Admin Annulation', 'super_admin');
    superAdminToken = staff.accessToken;
    userIds.push(staff.userId);

    const garage = await prisma.garage.create({ data: { name: `Garage Annulation ${suffix}`, city: 'Dakar', region: 'Dakar' } });
    garageId = garage.id;

    await setConfig('score.cfaPerPoint', 1);
    await setConfig('score.commitmentFee', 1);
    await setConfig('cancellation.allowedStatuses', ['pending', 'free', 'proposal_sent', 'negotiating', 'confirmed', 'picked_up', 'in_transit', 'arrived', 'out_for_delivery']);
    await setConfig('cancellation.freeCancellationStatuses', ['pending', 'free', 'proposal_sent', 'negotiating']);
    await setConfig('cancellation.penalty.percentage', 10);
    await setConfig('cancellation.penalty.minAmount', 0);
    await setConfig('cancellation.penalty.maxAmount', 0);
    await setConfig('cancellation.penalty.clientSharePercent', 50);
    await setConfig('cancellation.fee.paydunyaPercentage', 0);
    await setConfig('cancellation.fee.technicalFixed', 0);
    await setConfig('cancellation.fee.technicalPercentage', 0);
    await setConfig('cancellation.reasons', [
      { value: 'client_change_of_mind', label: 'Changement d’avis', responsibility: 'client', exempt: false },
      { value: 'driver_no_show', label: 'Chauffeur absent', responsibility: 'driver', exempt: false },
      { value: 'mutual_agreement', label: 'Accord mutuel', responsibility: 'shared', exempt: false },
      { value: 'driver_unavailable', label: 'Chauffeur indisponible', responsibility: 'driver', exempt: false },
      { value: 'force_majeure', label: 'Force majeure', responsibility: 'exempt', exempt: true },
      { value: 'platform_issue', label: 'Problème plateforme', responsibility: 'exempt', exempt: true }
    ]);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: parcelIds } }] } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { parcelId: { in: parcelIds } }] } });
    await prisma.payment.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.clientPenaltyDebt.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { parcelId: { in: parcelIds } }] } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (garageId) await prisma.garage.delete({ where: { id: garageId } }).catch(() => {});
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'cancellation.' } } });
    await prisma.$disconnect();
  });

  const clientAuth = () => ({ Authorization: `Bearer ${clientToken}` });

  // A — annulation exonérée (colis non engagé, sans paiement)
  it('A: annulation légitime exonérée → penalized=false, aucun prélèvement', async () => {
    const parcel = await createParcel({ status: 'pending' });
    const quote = await request(app).get(`/api/v1/client/parcels/${parcel.id}/cancel/quote`).set(clientAuth());
    expect(quote.status).toBe(200);
    expect(quote.body.allowed).toBe(true);
    expect(quote.body.penalized).toBe(false);
    expect(quote.body.exempt).toBe(true);
    expect(quote.body.responsibility).toBe('exempt');
    expect(quote.body.penalty).toBe(0);

    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.cancellation.penalized).toBe(false);
    expect(res.body.cancellation.penalty.amount).toBe(0);
  });

  // B — client responsable : pénalité déduite du remboursement
  it('B: client responsable → pénalité sur le remboursement (10000 → 9000)', async () => {
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.penalized).toBe(true);
    expect(res.body.exempt).toBe(false);
    expect(res.body.responsibility).toBe('client');
    expect(res.body.paidAmount).toBe(10000);
    expect(res.body.penalty).toBe(1000);
    expect(res.body.refund).toBe(9000);
    expect(res.body.client.penalty).toBe(1000);
    expect(res.body.client.refund).toBe(9000);
    expect(res.body.client.debt).toBe(0);
    expect(res.body.driver.penalty).toBe(0);
  });

  // C — chauffeur responsable : prélèvement sur le chauffeur
  it('C: chauffeur responsable → pénalité prélevée sur le chauffeur', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'driver_no_show' });

    expect(res.status).toBe(200);
    expect(res.body.responsibility).toBe('driver');
    expect(res.body.penalty).toBe(1000);
    expect(res.body.driver.penalty).toBe(1000);
    expect(res.body.driver.walletDeduction).toBe(1000);
    expect(res.body.driver.pointsDeduction).toBe(0);
    expect(res.body.driver.debtAmount).toBe(0);
    // Le remboursement du client n'est pas amputé par la faute du chauffeur.
    expect(res.body.refund).toBe(10000);
  });

  // D + E — commun accord : pénalité partagée selon la configuration (pas 0)
  it('D/E: commun accord → responsabilité partagée et pénalité ≠ 0', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'mutual_agreement' });

    expect(res.status).toBe(200);
    expect(res.body.responsibility).toBe('shared');
    expect(res.body.penalized).toBe(true);
    expect(res.body.penalty).toBe(1000);
    expect(res.body.client.penalty).toBe(500);
    expect(res.body.driver.penalty).toBe(500);
    expect(res.body.refund).toBe(9500);
  });

  // F — wallet suffisant
  it('F: wallet suffisant → pénalité entièrement prélevée du wallet', async () => {
    await setDriverWallet(10000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'driver_no_show' });

    expect(res.body.driver.walletDeduction).toBe(1000);
    expect(res.body.driver.pointsDeduction).toBe(0);
    expect(res.body.driver.debtAmount).toBe(0);
  });

  // G — wallet insuffisant + points suffisants
  it('G: wallet insuffisant + points suffisants → complément en points', async () => {
    await setDriverWallet(200);
    await setDriverPoints(800);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'driver_no_show' });

    expect(res.body.driver.walletDeduction).toBe(200);
    expect(res.body.driver.pointsDeduction).toBe(800);
    expect(res.body.driver.debtAmount).toBe(0);
  });

  // H — wallet + points insuffisants → dette
  it('H: wallet + points insuffisants → dette créée', async () => {
    await setDriverWallet(0);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'driver_no_show' });

    expect(res.body.driver.debtAmount).toBe(1000);
    expect(res.body.driver.walletDeduction).toBe(0);
    expect(res.body.driver.pointsDeduction).toBe(0);
    expect(res.body.cancellation.debt.created).toBe(1000);
  });

  // I — remboursement PayDunya réussi (unit, disburse injecté)
  it('I: remboursement PayDunya réussi → completed + paiement refunded', async () => {
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const snapshot = {
      refundStatus: 'pending',
      refundAmount: 9000,
      refundMethod: 'wave',
      refundPhone: `77${suffix}`,
      paidAmount: 10000
    };
    await prisma.parcel.update({ where: { id: parcel.id }, data: { cancellationData: snapshot } });

    const fake = {
      isPaydunyaConfigured: () => true,
      getInvoice: async () => ({ ok: true, disburseToken: 'dtok' }),
      submitInvoice: async () => ({ ok: true, status: 'success', transactionId: 'tx-1', providerRef: 'pr-1' }),
      checkStatus: async () => ({ ok: true, status: 'success' }),
      toAccountAlias: (p) => p,
      withdrawModeFor: () => 'wave-senegal'
    };

    const updated = await executeCancellationRefund({ parcelId: parcel.id, disburse: fake });
    expect(updated.refundStatus).toBe('completed');

    const payment = await prisma.payment.findFirst({ where: { parcelId: parcel.id } });
    expect(payment.status).toBe('refunded');
  });

  // J — remboursement PayDunya échoué
  it('J: remboursement PayDunya échoué → failed, pas de simulation', async () => {
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    await prisma.parcel.update({
      where: { id: parcel.id },
      data: { cancellationData: { refundStatus: 'pending', refundAmount: 9000, refundMethod: 'wave', refundPhone: `77${suffix}` } }
    });

    const fake = {
      isPaydunyaConfigured: () => true,
      getInvoice: async () => ({ ok: false, error: { message: 'Fonds insuffisants' } }),
      submitInvoice: async () => ({ ok: false, error: { message: 'Fonds insuffisants' } }),
      checkStatus: async () => ({ ok: false, error: 'échec' }),
      toAccountAlias: (p) => p,
      withdrawModeFor: () => 'wave-senegal'
    };

    const updated = await executeCancellationRefund({ parcelId: parcel.id, disburse: fake });
    expect(updated.refundStatus).toBe('failed');

    const payment = await prisma.payment.findFirst({ where: { parcelId: parcel.id } });
    expect(payment.status).toBe('completed');
  });

  // K — double requête : rejet sans double prélèvement
  it('K: double requête → PARCEL_ALREADY_CANCELLED, aucun double prélèvement', async () => {
    await setDriverWallet(10000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const first = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'driver_no_show' });
    expect(first.status).toBe(200);

    const walletAfter = await prisma.wallet.findUnique({ where: { userId: driverId } });
    const balanceAfter = Number(walletAfter.balance);

    const second = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'driver_no_show' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PARCEL_ALREADY_CANCELLED');

    const walletAfterRetry = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(walletAfterRetry.balance)).toBe(balanceAfter);
  });

  // L — rejeu réseau : pas de double dette / double remboursement
  it('L: rejeu réseau → pas de double dette', async () => {
    await setDriverWallet(0);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const first = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'driver_no_show' });
    expect(first.status).toBe(200);
    expect(first.body.driver.debtAmount).toBe(1000);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    const debtAfter = Number(wallet.commissionDebt);

    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'driver_no_show' });

    const walletRetry = await prisma.wallet.findUnique({ where: { userId: driverId } });
    expect(Number(walletRetry.commissionDebt)).toBe(debtAfter);
  });

  // M — quote puis changement de statut : recalcul obligatoire
  it('M: quote puis changement de statut → recalcul (pas de confiance au quote)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'pending' });

    const quote = await request(app).get(`/api/v1/client/parcels/${parcel.id}/cancel/quote`).set(clientAuth());
    expect(quote.body.penalized).toBe(false);

    // Le statut évolue entre le quote et l'annulation : le serveur doit recalculer.
    await prisma.parcel.update({ where: { id: parcel.id }, data: { status: 'confirmed', assignedDriverId: driverId } });
    await prisma.payment.create({
      data: { userId: clientId, parcelId: parcel.id, amount: 10000, currency: 'XOF', method: 'wave', status: 'completed', transactionId: `TXN-${parcel.id}`, completedAt: new Date() }
    });

    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    expect(res.status).toBe(200);
    expect(res.body.penalized).toBe(true);
    expect(res.body.penalty).toBe(1000);
  });

  // N — quote puis changement de configuration : recalcul
  it('N: quote puis changement de configuration → recalcul', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    await setConfig('cancellation.penalty.percentage', 10);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const quote = await request(app).get(`/api/v1/client/parcels/${parcel.id}/cancel/quote?reason=client_change_of_mind`).set(clientAuth());
    expect(quote.body.penalty).toBe(1000);

    await setConfig('cancellation.penalty.percentage', 20);

    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    expect(res.status).toBe(200);
    expect(res.body.penalty).toBe(2000);

    await setConfig('cancellation.penalty.percentage', 10);
  });

  // O — confidentialité : le client ne voit pas les soldes privés du chauffeur
  it('O: confidentialité → soldes chauffeur masqués pour le client', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(100);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'driver_no_show' });

    expect(res.status).toBe(200);
    expect(res.body.driver.walletBefore).toBeNull();
    expect(res.body.driver.walletAfter).toBeNull();
    expect(res.body.driver.pointsBefore).toBeNull();
    expect(res.body.driver.pointsAfter).toBeNull();
    expect(res.body.driver.debtBefore).toBeNull();
    expect(res.body.driver.debtAfter).toBeNull();
    // Les montants prélevés restent visibles (décrivent la pénalité, pas un solde).
    expect(res.body.driver.walletDeduction).toBe(1000);
    expect(res.body.cancellation.wallet.before).toBeNull();
  });

  // P — serializer parcel : champ `cancellation` présent
  it('P: serializer parcel → champ `cancellation` imbriqué', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    expect(res.body.parcel.cancellation).toBeTruthy();
    expect(res.body.parcel.cancellation.responsibleParty).toBe('client');
    expect(res.body.parcel.cancellation.penalty.amount).toBe(1000);
    expect(res.body.parcel.cancellation.refund.refundedAmount).toBe(9000);
  });

  // Q — compatibilité mobile : contrat imbriqué
  it('Q: compatibilité mobile → responsibleParty + sous-objets', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    const c = res.body.cancellation;
    expect(c).toHaveProperty('allowed');
    expect(c).toHaveProperty('penalized');
    expect(c).toHaveProperty('responsibleParty');
    expect(c.penalty).toHaveProperty('amount');
    expect(c.penalty).toHaveProperty('clientShare');
    expect(c.penalty).toHaveProperty('driverShare');
    expect(c.refund).toHaveProperty('initialAmount');
    expect(c.refund).toHaveProperty('refundedAmount');
    expect(c).toHaveProperty('wallet');
    expect(c).toHaveProperty('points');
    expect(c).toHaveProperty('debt');
  });

  // R — compatibilité web : contrat plat
  it('R: compatibilité web → champs plats attendus', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });
    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    for (const field of ['allowed', 'penalized', 'exempt', 'responsibility', 'paidAmount', 'fees', 'paydunyaFee', 'technicalFee', 'penalty', 'refund', 'refundStatus']) {
      expect(res.body).toHaveProperty(field);
    }
    expect(res.body).toHaveProperty('reasons');
    expect(res.body).toHaveProperty('client');
    expect(res.body).toHaveProperty('driver');
    expect(Array.isArray(res.body.reasons)).toBe(true);
  });

  const driverAuth = () => ({ Authorization: `Bearer ${driverToken}` });

  // S — annulation par le chauffeur : même moteur central, responsabilité chauffeur
  it('S: annulation chauffeur → même moteur, chauffeur responsable', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/cancel`)
      .set(driverAuth())
      .send({ reason: 'driver_unavailable' });

    expect(res.status).toBe(200);
    expect(res.body.responsibility).toBe('driver');
    expect(res.body.penalized).toBe(true);
    expect(res.body.penalty).toBe(1000);
    expect(res.body.driver.penalty).toBe(1000);
    expect(res.body.driver.walletDeduction).toBe(1000);
    // Le chauffeur voit ses propres soldes, pas ceux du client.
    expect(res.body.driver.walletBefore).not.toBeNull();
    expect(res.body.driver.walletAfter).not.toBeNull();
  });

  // T — un chauffeur non assigné ne peut pas annuler une mission
  it('T: chauffeur non assigné → accès refusé', async () => {
    // Colis visible (statut free) mais sans chauffeur assigné.
    const parcel = await createParcel({ status: 'free', assignedDriverId: null, paid: false });
    const res = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/cancel`)
      .set(driverAuth())
      .send({ reason: 'x' });

    expect(res.status).toBe(403);
  });

  // U — confidentialité inversée : le chauffeur ne voit pas les montants privés du client
  it('U: confidentialité inversée → montants client masqués pour le chauffeur', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/cancel`)
      .set(driverAuth())
      .send({ reason: 'driver_unavailable' });

    expect(res.status).toBe(200);
    // Part client masquée : payé, remboursé, statut de remboursement, breakdown client.
    expect(res.body.paidAmount).toBeNull();
    expect(res.body.refund).toBeNull();
    expect(res.body.refundStatus).toBeNull();
    expect(res.body.client).toBeNull();
    expect(res.body.cancellation.refund).toBeNull();
    expect(res.body.cancellation.penalty.clientShare).toBeNull();
  });

  // V — motif inconnu → rejeté par le backend (aucun contournement par reason arbitraire)
  it('V: motif inconnu → rejeté (CANCELLATION_REASON_REQUIRED)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'Raison libre non configurée' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANCELLATION_REASON_REQUIRED');
  });

  // W — motif vide sur un statut non libre → rejeté
  it('W: motif vide sur statut non libre → rejeté', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANCELLATION_REASON_REQUIRED');
  });

  // AD — le devis n'exige pas de motif : aperçu neutre + liste des motifs disponibles
  it('AD: devis sans motif → aperçu neutre (200) avec motifs', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const quote = await request(app).get(`/api/v1/client/parcels/${parcel.id}/cancel/quote`).set(clientAuth());

    expect(quote.status).toBe(200);
    expect(quote.body.allowed).toBe(true);
    expect(quote.body.responsibility).toBeNull();
    expect(quote.body.exempt).toBe(true);
    expect(quote.body.penalty).toBe(0);
    expect(Array.isArray(quote.body.reasons)).toBe(true);
    expect(quote.body.reasons.length).toBeGreaterThan(0);
  });

  // X — motif exempt (force_majeure) refusé pour un CLIENT : pas d'auto-exonération
  it('X: motif exempt refusé pour CLIENT (force_majeure) → 403', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'force_majeure' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANCELLATION_EXEMPT_REASON_FORBIDDEN');

    // Le colis ne doit pas avoir été annulé (aucune écriture financière).
    const after = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(after.status).toBe('confirmed');
  });

  // Y — répartition partagée avec clientSharePercent différent de 50
  it('Y: clientSharePercent = 30 → répartition 30/70', async () => {
    await setConfig('cancellation.penalty.clientSharePercent', 30);
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'mutual_agreement' });

    expect(res.status).toBe(200);
    expect(res.body.responsibility).toBe('shared');
    expect(res.body.penalty).toBe(1000);
    expect(res.body.client.penalty).toBe(300);
    expect(res.body.driver.penalty).toBe(700);

    await setConfig('cancellation.penalty.clientSharePercent', 50);
  });

  // Z — configuration invalide rejetée à l'écriture (responsabilité hors enum)
  it('Z: config invalide (responsabilité hors enum) → 422', async () => {
    const res = await request(app)
      .put('/api/v1/super-admin/config')
      .set({ Authorization: `Bearer ${superAdminToken}` })
      .send({
        'cancellation.reasons': [
          { value: 'bad', label: 'Mauvais motif', responsibility: 'hacker', exempt: false }
        ]
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // AA — configuration invalide rejetée à l'écriture (pourcentage hors bornes)
  it('AA: config invalide (pourcentage > 100) → 422', async () => {
    const res = await request(app)
      .put('/api/v1/super-admin/config')
      .set({ Authorization: `Bearer ${superAdminToken}` })
      .send({ 'cancellation.penalty.percentage': 150 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // AB — motif partagé sans clientSharePercent → configuration incohérente refusée
  it('AB: motif shared sans clientSharePercent → 422', async () => {
    await prisma.systemConfig.deleteMany({ where: { key: 'cancellation.penalty.clientSharePercent' } });
    const res = await request(app)
      .put('/api/v1/super-admin/config')
      .set({ Authorization: `Bearer ${superAdminToken}` })
      .send({
        'cancellation.reasons': [
          { value: 'client_change_of_mind', label: 'Changement d’avis', responsibility: 'client', exempt: false },
          { value: 'mutual_agreement', label: 'Accord mutuel', responsibility: 'shared', exempt: false }
        ]
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    await setConfig('cancellation.penalty.clientSharePercent', 50);
    await setConfig('cancellation.reasons', [
      { value: 'client_change_of_mind', label: 'Changement d’avis', responsibility: 'client', exempt: false },
      { value: 'driver_no_show', label: 'Chauffeur absent', responsibility: 'driver', exempt: false },
      { value: 'mutual_agreement', label: 'Accord mutuel', responsibility: 'shared', exempt: false },
      { value: 'driver_unavailable', label: 'Chauffeur indisponible', responsibility: 'driver', exempt: false },
      { value: 'force_majeure', label: 'Force majeure', responsibility: 'exempt', exempt: true },
      { value: 'platform_issue', label: 'Problème plateforme', responsibility: 'exempt', exempt: true }
    ]);
  });

  // AC — le staff passe par le moteur central pour annuler (pas de bypass statut)
  it('AC: statut cancelled via staff → moteur central, pénalité appliquée', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .put(`/api/v1/super-admin/parcels/${parcel.id}/status`)
      .set({ Authorization: `Bearer ${superAdminToken}` })
      .send({ status: 'cancelled', reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    expect(res.body.penalized).toBe(true);
    expect(res.body.responsibility).toBe('client');
    expect(res.body.penalty).toBe(1000);
  });

  // ============================================================
  // F5 — pénalité CLIENT sans remboursement → dette persistante
  // ============================================================

  // F5-A — client responsable + aucun remboursement (colis non payé) → dette
  it('F5-A: client responsable + aucun remboursement → dette client créée', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    expect(res.body.responsibility).toBe('client');
    expect(res.body.penalty).toBe(1000);
    expect(res.body.refund).toBe(0);
    expect(res.body.client.debt).toBe(1000);
    expect(res.body.cancellation.clientDebt.amount).toBe(1000);

    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });
    expect(debt).toBeTruthy();
    expect(Number(debt.amount)).toBe(1000);
    expect(Number(debt.remaining)).toBe(1000);
    expect(debt.status).toBe('pending');
    expect(debt.userId).toBe(clientId);
  });

  // F5-B — client responsable + remboursement insuffisant → dette = reliquat
  it('F5-B: client responsable + remboursement insuffisant → dette = reliquat', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    await setConfig('cancellation.penalty.minAmount', 1000);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    await prisma.payment.create({
      data: {
        userId: clientId,
        parcelId: parcel.id,
        amount: 500,
        currency: 'XOF',
        method: 'wave',
        status: 'completed',
        transactionId: `TXN-${parcel.id}`,
        completedAt: new Date()
      }
    });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    expect(res.body.paidAmount).toBe(500);
    // Pénalité plancher 1000 > 500 payés → reliquat en dette.
    expect(res.body.penalty).toBe(1000);
    expect(res.body.refund).toBe(0);
    expect(res.body.client.debt).toBe(500);

    await setConfig('cancellation.penalty.minAmount', 0);
  });

  // F5-C — paiement espèces + pénalité → dette (cash exclu du remboursable)
  it('F5-C: paiement espèces + pénalité → dette client (cash non remboursable)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    await prisma.payment.create({
      data: {
        userId: clientId,
        parcelId: parcel.id,
        amount: 10000,
        currency: 'XOF',
        method: 'cash',
        status: 'completed',
        transactionId: `TXN-${parcel.id}`,
        completedAt: new Date()
      }
    });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    expect(res.body.paidAmount).toBe(0);
    expect(res.body.penalty).toBe(1000);
    expect(res.body.refund).toBe(0);
    expect(res.body.client.debt).toBe(1000);
  });

  // F5-D — shared sans remboursement → dette client + dette chauffeur, somme exacte
  it('F5-D: shared sans remboursement → dette client + chauffeur, somme exacte', async () => {
    await setDriverWallet(0);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'mutual_agreement' });

    expect(res.status).toBe(200);
    expect(res.body.responsibility).toBe('shared');
    expect(res.body.penalty).toBe(1000);
    expect(res.body.client.penalty).toBe(500);
    expect(res.body.driver.penalty).toBe(500);
    expect(res.body.client.debt).toBe(500);
    expect(res.body.driver.debtAmount).toBe(500);
    expect(res.body.client.debt + res.body.driver.debtAmount).toBe(1000);
  });

  // F5-E — aucune double dette : une seule ligne par colis
  it('F5-E: aucune double dette (double annulation → une seule ligne)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });

    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });

    const count = await prisma.clientPenaltyDebt.count({ where: { parcelId: parcel.id } });
    expect(count).toBe(1);
  });

  // F5-F — règlement de la dette via PayDunya (sans wallet, sans commission)
  it('F5-F: règlement de la dette via PayDunya → payée, sans commission', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });

    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });
    expect(debt).toBeTruthy();

    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id }, invoice: { total_amount: 1000 } },
      `txn-settle-${parcel.id}`
    );

    const settled = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(settled.status).toBe('paid');
    expect(Number(settled.remaining)).toBe(0);

    const payment = await prisma.payment.findUnique({ where: { transactionId: `txn-settle-${parcel.id}` } });
    expect(payment).toBeTruthy();
    expect(payment.parcelId).toBeNull();
    expect(payment.metadata.type).toBe('penalty_debt');

    // Aucune commission / recette de livraison : aucun wallet chauffeur touché,
    // aucun crédit points, aucune transaction wallet pour le client.
    const clientWalletTx = await prisma.walletTransaction.count({ where: { walletUserId: clientId } });
    expect(clientWalletTx).toBe(0);
  });

  // F5-G — idempotence du règlement : pas de double règlement
  it('F5-G: idempotence du règlement → aucun double règlement', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });

    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id }, invoice: { total_amount: 1000 } },
      `txn-replay-${parcel.id}`
    );
    // Rejeu du même token → ignoré.
    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id }, invoice: { total_amount: 1000 } },
      `txn-replay-${parcel.id}`
    );
    // Autre token sur une dette déjà réglée → ignoré.
    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id }, invoice: { total_amount: 1000 } },
      `txn-replay-2-${parcel.id}`
    );

    const settled = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(settled.status).toBe('paid');
    expect(Number(settled.remaining)).toBe(0);

    const payments = await prisma.payment.count({
      where: { transactionId: { in: [`txn-replay-${parcel.id}`, `txn-replay-2-${parcel.id}`] } }
    });
    expect(payments).toBe(1);
  });

  // F5-H — paiement partiel : 5000 → 2000 → 1500 → 1500 = soldée
  it('F5-H: paiement partiel → reliquat décrémenté, statut paid seulement à 0', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false, price: 50000 });
    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });

    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });
    expect(Number(debt.amount)).toBe(5000);
    expect(Number(debt.remaining)).toBe(5000);
    expect(debt.status).toBe('pending');

    // Paiement partiel 1 : 2000 → reste 3000
    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id, expectedAmount: 2000 }, invoice: { total_amount: 2000 } },
      `txn-partial-1-${parcel.id}`
    );
    let d = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(Number(d.remaining)).toBe(3000);
    expect(d.status).toBe('partially_paid');

    // Paiement partiel 2 : 1500 → reste 1500
    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id, expectedAmount: 1500 }, invoice: { total_amount: 1500 } },
      `txn-partial-2-${parcel.id}`
    );
    d = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(Number(d.remaining)).toBe(1500);
    expect(d.status).toBe('partially_paid');

    // Paiement final : 1500 → soldée
    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id, expectedAmount: 1500 }, invoice: { total_amount: 1500 } },
      `txn-partial-3-${parcel.id}`
    );
    d = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(Number(d.remaining)).toBe(0);
    expect(d.status).toBe('paid');
    expect(d.settledAt).not.toBeNull();

    // Historique : 3 paiements conservés (montant + reliquat), pas de wallet/commission.
    const history = await prisma.payment.findMany({
      where: { transactionId: { in: [`txn-partial-1-${parcel.id}`, `txn-partial-2-${parcel.id}`, `txn-partial-3-${parcel.id}`] } }
    });
    expect(history.length).toBe(3);
    const clientWalletTx = await prisma.walletTransaction.count({ where: { walletUserId: clientId } });
    expect(clientWalletTx).toBe(0);
  });

  // F5-I — paiement supérieur au restant → rejet à la création
  it('F5-I: paiement supérieur au restant → rejet (montant borné côté serveur)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });
    expect(Number(debt.remaining)).toBe(1000);

    // Config PayDunya minimale pour franchir le contrôle de configuration et
    // atteindre la validation métier (rejet AVANT tout appel réseau).
    await setConfig('paydunya.masterKey', 'mk-test');
    await setConfig('paydunya.privateKey', 'pk-test');
    await setConfig('paydunya.token', 'tok-test');

    const res = await request(app)
      .post('/api/v1/payments/paydunya/create')
      .set(clientAuth())
      .send({ type: 'penalty_debt', debtId: debt.id, amount: 99999 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    // La dette reste intacte : aucun débit, aucun paiement enregistré.
    const after = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(Number(after.remaining)).toBe(1000);
    expect(after.status).toBe('pending');

    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
  });

  // F5-J — double traitement du même token sur un paiement partiel → une seule écriture
  it('F5-J: double traitement du même token (partiel) → une seule écriture', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false, price: 50000 });
    await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });

    const payload = { custom_data: { type: 'penalty_debt', userId: clientId, debtId: debt.id, expectedAmount: 2000 }, invoice: { total_amount: 2000 } };
    await processCompletedPayment(payload, `txn-partial-dup-${parcel.id}`);
    // Rejeu du même token → ignoré, aucun double débit.
    await processCompletedPayment(payload, `txn-partial-dup-${parcel.id}`);

    const d = await prisma.clientPenaltyDebt.findUnique({ where: { id: debt.id } });
    expect(Number(d.remaining)).toBe(3000);
    const payments = await prisma.payment.count({ where: { transactionId: `txn-partial-dup-${parcel.id}` } });
    expect(payments).toBe(1);
  });

  // ============================================================
  // F6-contract — exposition de `clientDebt.id` au mobile (paiement de la dette)
  // ============================================================

  it('F6-contract-1: la dette mobile sérialisée contient id/amount/reference', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    expect(res.status).toBe(200);
    const cd = res.body.cancellation.clientDebt;
    expect(cd).toBeTruthy();
    expect(typeof cd.id).toBe('string');
    expect(cd.id.length).toBeGreaterThan(0);
    expect(cd.amount).toBe(1000);
    expect(cd.reference).toBe(`PD-${parcel.trackingNumber}`);

    // L'identifiant exposé est bien l'UUID réel de ClientPenaltyDebt en base.
    const debt = await prisma.clientPenaltyDebt.findFirst({ where: { parcelId: parcel.id } });
    expect(debt).toBeTruthy();
    expect(cd.id).toBe(debt.id);
  });

  it('F6-contract-2: le client propriétaire peut régler avec ce debtId', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });

    const debtId = res.body.cancellation.clientDebt.id;

    // Le règlement utilise directement l'id exposé au mobile (callback PayDunya).
    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId }, invoice: { total_amount: 1000 } },
      `txn-f6-contract-2-${parcel.id}`
    );

    const debt = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } });
    expect(debt.status).toBe('paid');
    expect(Number(debt.remaining)).toBe(0);
  });

  it('F6-contract-3: un autre client ne peut pas utiliser ce debtId', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    const cancelRes = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'client_change_of_mind' });
    const debtId = cancelRes.body.cancellation.clientDebt.id;

    await setConfig('paydunya.masterKey', 'mk-test');
    await setConfig('paydunya.privateKey', 'pk-test');
    await setConfig('paydunya.token', 'tok-test');

    const res = await request(app)
      .post('/api/v1/payments/paydunya/create')
      .set({ Authorization: `Bearer ${secondClientToken}` })
      .send({ type: 'penalty_debt', debtId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    // La dette reste intacte : aucun règlement, aucune écriture.
    const debt = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } });
    expect(debt.status).toBe('pending');
    expect(Number(debt.remaining)).toBe(1000);

    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
  });

  it('F6-contract-4: le reliquat est recalculé côté serveur', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false, price: 50000 });
    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debtId = res.body.cancellation.clientDebt.id;

    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId, expectedAmount: 2000 }, invoice: { total_amount: 2000 } },
      `txn-f6-contract-4-${parcel.id}`
    );

    const d = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } });
    expect(Number(d.remaining)).toBe(3000);
    expect(d.status).toBe('partially_paid');
  });

  it('F6-contract-5: le paiement partiel fonctionne toujours', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false, price: 50000 });
    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debtId = res.body.cancellation.clientDebt.id;

    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId, expectedAmount: 1500 }, invoice: { total_amount: 1500 } },
      `txn-f6-contract-5-${parcel.id}`
    );

    const d = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } });
    expect(Number(d.remaining)).toBe(3500);
    expect(d.status).toBe('partially_paid');
  });

  it('F6-contract-6: montant supérieur au restant toujours refusé', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debtId = res.body.cancellation.clientDebt.id;

    await setConfig('paydunya.masterKey', 'mk-test');
    await setConfig('paydunya.privateKey', 'pk-test');
    await setConfig('paydunya.token', 'tok-test');

    const create = await request(app)
      .post('/api/v1/payments/paydunya/create')
      .set(clientAuth())
      .send({ type: 'penalty_debt', debtId, amount: 99999 });

    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe('VALIDATION_ERROR');

    const debt = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } });
    expect(debt.status).toBe('pending');
    expect(Number(debt.remaining)).toBe(1000);

    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
  });

  it('F6-contract-7: une dette entièrement payée ne peut pas être re-payée', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debtId = res.body.cancellation.clientDebt.id;

    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId }, invoice: { total_amount: 1000 } },
      `txn-f6-contract-7-${parcel.id}`
    );
    const settled = await prisma.clientPenaltyDebt.findUnique({ where: { id: debtId } });
    expect(settled.status).toBe('paid');

    await setConfig('paydunya.masterKey', 'mk-test');
    await setConfig('paydunya.privateKey', 'pk-test');
    await setConfig('paydunya.token', 'tok-test');

    const create = await request(app)
      .post('/api/v1/payments/paydunya/create')
      .set(clientAuth())
      .send({ type: 'penalty_debt', debtId });

    expect(create.status).toBe(422);
    expect(create.body.error.code).toBe('VALIDATION_ERROR');

    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
  });

  it('F6-contract-8: aucun impact wallet/commission chauffeur', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: false });
    const res = await request(app).post(`/api/v1/client/parcels/${parcel.id}/cancel`).set(clientAuth()).send({ reason: 'client_change_of_mind' });
    const debtId = res.body.cancellation.clientDebt.id;

    const driverWalletTxBefore = await prisma.walletTransaction.count({ where: { walletUserId: driverId } });

    await processCompletedPayment(
      { custom_data: { type: 'penalty_debt', userId: clientId, debtId }, invoice: { total_amount: 1000 } },
      `txn-f6-contract-8-${parcel.id}`
    );

    // Aucun wallet client créé, aucune transaction wallet, aucune commission chauffeur.
    const clientWallet = await prisma.wallet.findUnique({ where: { userId: clientId } });
    expect(clientWallet).toBeNull();
    const clientWalletTx = await prisma.walletTransaction.count({ where: { walletUserId: clientId } });
    expect(clientWalletTx).toBe(0);
    // Le règlement de la dette ne touche pas le wallet du chauffeur : aucun
    // prélèvement de pénalité ni crédit de commission n'est ajouté par ce flux.
    const driverWalletTxAfter = await prisma.walletTransaction.count({ where: { walletUserId: driverId } });
    expect(driverWalletTxAfter).toBe(driverWalletTxBefore);
  });

  // ============================================================
  // F6 — anti auto-exonération (motifs exempt réservés au support/admin)
  // ============================================================

  it('F6-A: platform_issue refusé pour CLIENT → 403', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/client/parcels/${parcel.id}/cancel`)
      .set(clientAuth())
      .send({ reason: 'platform_issue' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANCELLATION_EXEMPT_REASON_FORBIDDEN');
  });

  it('F6-B: force_majeure refusé pour DRIVER → 403', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/cancel`)
      .set(driverAuth())
      .send({ reason: 'force_majeure' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANCELLATION_EXEMPT_REASON_FORBIDDEN');
  });

  it('F6-C: platform_issue refusé pour DRIVER → 403', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/cancel`)
      .set(driverAuth())
      .send({ reason: 'platform_issue' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANCELLATION_EXEMPT_REASON_FORBIDDEN');
  });

  it('F6-D: force_majeure accepté pour SUPPORT/ADMIN → exonéré, aucune pénalité', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .put(`/api/v1/super-admin/parcels/${parcel.id}/status`)
      .set({ Authorization: `Bearer ${superAdminToken}` })
      .send({ status: 'cancelled', reason: 'force_majeure' });

    expect(res.status).toBe(200);
    expect(res.body.exempt).toBe(true);
    expect(res.body.penalized).toBe(false);
    expect(res.body.penalty).toBe(0);
    expect(res.body.refund).toBe(10000);

    // Aucune dette, aucune pénalité pour un motif exempt validement utilisé.
    const debtCount = await prisma.clientPenaltyDebt.count({ where: { parcelId: parcel.id } });
    expect(debtCount).toBe(0);
  });

  it('F6-E: les motifs exonérants sont masqués pour le client (reasons filtrées)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const quote = await request(app).get(`/api/v1/client/parcels/${parcel.id}/cancel/quote`).set(clientAuth());
    expect(quote.status).toBe(200);
    const values = quote.body.reasons.map((r) => r.value);
    expect(values).not.toContain('force_majeure');
    expect(values).not.toContain('platform_issue');
    expect(values).toContain('client_change_of_mind');
  });

  // F6-F — annulation sans motif sur un colis engagé (statut alternatif) → rejet,
  // ni exonération structurelle ni contournement de pénalité.
  it('F6-F: chauffeur annulant sans motif sur colis engagé → rejet (pas d’exonération)', async () => {
    await setDriverWallet(5000);
    await setDriverPoints(0);
    const parcel = await createParcel({ status: 'confirmed', assignedDriverId: driverId, paid: true });

    const res = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/cancel`)
      .set(driverAuth())
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANCELLATION_REASON_REQUIRED');
  });
});
