import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Contrats backend indispensables aux widgets Flutter portefeuille et annonces.
 * Les donnees metier sont creees directement avec Prisma afin d'isoler ces
 * regressions des assistants de creation de l'interface.
 */
describe('mobile backend gaps', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const advertisementIds = [];
  const offerIds = [];
  let ownerToken;
  let otherDriverToken;
  let recipientToken;
  let unrelatedClientToken;
  let ownerId;
  let otherDriverId;
  let clientId;
  let garageId;
  let parcelId;
  let acceptedOfferId;

  async function register(prefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${prefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response;
  }

  beforeAll(async () => {
    const owner = await register('75', 'Chauffeur annonce propriétaire', 'driver');
    const otherDriver = await register('76', 'Autre chauffeur annonce', 'driver');
    const client = await register('77', 'Client offre annonce', 'client');
    const recipient = await register('78', 'Destinataire du colis', 'client');
    const unrelatedClient = await register('79', 'Client sans accès au colis', 'client');
    ownerToken = owner.body.accessToken;
    otherDriverToken = otherDriver.body.accessToken;
    recipientToken = recipient.body.accessToken;
    unrelatedClientToken = unrelatedClient.body.accessToken;
    ownerId = owner.body.user.id;
    otherDriverId = otherDriver.body.user.id;
    clientId = client.body.user.id;

    const garage = await prisma.garage.create({
      data: {
        name: `Garage mobile gaps ${suffix}`,
        city: 'Dakar',
        region: 'Dakar'
      }
    });
    garageId = garage.id;

    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber: `MOBILE-GAP-${suffix}`,
        senderId: clientId,
        senderName: 'Client offre annonce',
        senderPhone: `77${suffix}`,
        receiverName: 'Destinataire test',
        receiverPhone: `78${suffix}`,
        description: 'Colis pour acceptation annonce',
        weight: '2.5',
        status: 'pending',
        departureGarageId: garageId,
        price: '5000',
        totalAmount: '5000',
        createdBy: clientId
      }
    });
    parcelId = parcel.id;

    const [ownerAd, competingAd] = await Promise.all([
      prisma.advertisement.create({
        data: {
          driverId: ownerId,
          departureCity: 'Dakar',
          arrivalCity: 'Thiès',
          status: 'open'
        }
      }),
      prisma.advertisement.create({
        data: {
          driverId: otherDriverId,
          departureCity: 'Dakar',
          arrivalCity: 'Thiès',
          status: 'open'
        }
      })
    ]);
    advertisementIds.push(ownerAd.id, competingAd.id);

    const [acceptedCandidate, competingOffer] = await Promise.all([
      prisma.advertisementOffer.create({
        data: {
          advertisementId: ownerAd.id,
          clientId,
          parcelId,
          price: '4200',
          message: 'Offre principale'
        }
      }),
      prisma.advertisementOffer.create({
        data: {
          advertisementId: competingAd.id,
          clientId,
          parcelId,
          price: '4500',
          message: 'Offre concurrente'
        }
      })
    ]);
    acceptedOfferId = acceptedCandidate.id;
    offerIds.push(acceptedCandidate.id, competingOffer.id);

    await prisma.wallet.create({
      data: {
        userId: ownerId,
        balance: '900',
        totalDeposited: '1000',
        totalSpent: '100'
      }
    });
    await prisma.walletTransaction.createMany({
      data: [
        {
          walletUserId: ownerId,
          type: 'deposit',
          amount: '1000',
          balanceBefore: '0',
          balanceAfter: '1000',
          description: 'Recharge de test',
          status: 'completed',
          createdAt: new Date('2026-07-28T10:00:00.000Z')
        },
        {
          walletUserId: ownerId,
          type: 'commission',
          amount: '100',
          balanceBefore: '1000',
          balanceAfter: '900',
          parcelId,
          description: 'Commission de test',
          status: 'completed',
          createdAt: new Date('2026-07-28T11:00:00.000Z')
        }
      ]
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: [...offerIds, parcelId].filter(Boolean) } }
        ]
      }
    });
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { parcelId }
        ]
      }
    });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId } });
    await prisma.advertisementOffer.deleteMany({ where: { id: { in: offerIds } } });
    await prisma.advertisement.deleteMany({ where: { id: { in: advertisementIds } } });
    if (parcelId) await prisma.parcel.deleteMany({ where: { id: parcelId } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (garageId) await prisma.garage.deleteMany({ where: { id: garageId } });
    await prisma.$disconnect();
  });

  const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });
  const otherDriverAuth = () => ({ Authorization: `Bearer ${otherDriverToken}` });
  const recipientAuth = () => ({ Authorization: `Bearer ${recipientToken}` });
  const unrelatedClientAuth = () => ({ Authorization: `Bearer ${unrelatedClientToken}` });

  it('allows the recipient to read parcel detail and timeline', async () => {
    const detail = await request(app)
      .get(`/api/v1/client/parcels/${parcelId}`)
      .set(recipientAuth());

    expect(detail.status).toBe(200);
    expect(detail.body.parcel.id).toBe(parcelId);
    expect(detail.body.parcel.receiverPhone).toBe(`78${suffix}`);

    const timeline = await request(app)
      .get(`/api/v1/parcels/${parcelId}/timeline`)
      .set(recipientAuth());

    expect(timeline.status).toBe(200);
    expect(timeline.body.events).toEqual([]);
  });

  it('keeps parcel detail private from unrelated clients', async () => {
    const response = await request(app)
      .get(`/api/v1/client/parcels/${parcelId}`)
      .set(unrelatedClientAuth());

    expect(response.status).toBe(404);
  });

  it('does not grant parcel mutation rights to the recipient', async () => {
    const response = await request(app)
      .post(`/api/v1/client/parcels/${parcelId}/cancel`)
      .set(recipientAuth())
      .send({ reason: 'Tentative du destinataire' });

    expect(response.status).toBe(404);
    const unchanged = await prisma.parcel.findUnique({ where: { id: parcelId } });
    expect(unchanged.status).toBe('pending');
  });

  it('returns wallet transactions with mobile-compatible signed amounts', async () => {
    const response = await request(app)
      .get('/api/v1/driver/wallet?limit=10')
      .set(ownerAuth());

    expect(response.status).toBe(200);
    expect(response.body.wallet.id).toBe(ownerId);
    expect(response.body.wallet.userId).toBe(ownerId);
    expect(response.body.wallet.transactions).toEqual(response.body.transactions);
    expect(response.body.pagination.total).toBe(2);

    const commission = response.body.transactions.find((item) => item.type === 'commission');
    const deposit = response.body.transactions.find((item) => item.type === 'deposit');
    expect(commission.amount).toBe(-100);
    expect(commission.trackingNumber).toBe(`MOBILE-GAP-${suffix}`);
    expect(deposit.amount).toBe(1000);
  });

  it('refuses acceptance by a driver who does not own the advertisement', async () => {
    const response = await request(app)
      .post(`/api/v1/advertisements/${advertisementIds[0]}/offers/${acceptedOfferId}/accept`)
      .set(otherDriverAuth());

    expect(response.status).toBe(403);
    const unchanged = await prisma.advertisementOffer.findUnique({ where: { id: acceptedOfferId } });
    expect(unchanged.status).toBe('pending');
  });

  it('refuses an offer that does not belong to the advertisement in the URL', async () => {
    const response = await request(app)
      .post(`/api/v1/advertisements/${advertisementIds[0]}/offers/${offerIds[1]}/accept`)
      .set(ownerAuth());

    expect(response.status).toBe(404);
    const unchanged = await prisma.advertisementOffer.findUnique({ where: { id: offerIds[1] } });
    expect(unchanged.status).toBe('pending');
  });

  it('accepts atomically, assigns the parcel and remains idempotent on retry', async () => {
    const path = `/api/v1/advertisements/${advertisementIds[0]}/offers/${acceptedOfferId}/accept`;
    const first = await request(app).post(path).set(ownerAuth());

    expect(first.status).toBe(200);
    expect(first.body.offer.status).toBe('accepted');
    expect(first.body.parcel.driverId).toBe(ownerId);
    expect(first.body.parcel.status).toBe('confirmed');
    expect(first.body.parcel.negotiatedPrice).toBe(4200);
    expect(first.body.parcel.totalAmount).toBe(4200);

    const competing = await prisma.advertisementOffer.findUnique({
      where: { id: offerIds[1] }
    });
    expect(competing.status).toBe('rejected');

    const retry = await request(app).post(path).set(ownerAuth());
    expect(retry.status).toBe(200);
    expect(retry.body.offer.status).toBe('accepted');

    const events = await prisma.parcelEvent.count({
      where: {
        parcelId,
        description: 'Offre de trajet acceptee et chauffeur assigne'
      }
    });
    expect(events).toBe(1);
  });
});
