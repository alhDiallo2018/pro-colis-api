import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Flux « le client choisit son chauffeur » : le colis reste une proposition
 * tant que le chauffeur n'a pas repondu, et la negociation alterne. Le camp qui
 * vient de poser un prix ne peut ni l'accepter ni le recouvrir : c'est ce qui
 * pilote l'affichage du bouton « Accepter » dans le web et le mobile.
 */
describe('direct driver proposal flow', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let clientToken;
  let driverToken;
  let driverId;
  let zoneId;

  async function register(prefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${prefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response.body;
  }

  function newParcelPayload(extra) {
    return {
      receiverName: 'Destinataire Test',
      receiverPhone: '+221771111111',
      description: 'Colis de test proposition',
      weight: 3,
      departureZoneId: zoneId,
      totalAmount: 5000,
      ...extra
    };
  }

  beforeAll(async () => {
    const client = await register('60', 'Client Proposition', 'client');
    const driver = await register('61', 'Chauffeur Proposition', 'driver');
    clientToken = client.accessToken;
    driverToken = driver.accessToken;
    driverId = driver.user.id;

    const zone = await prisma.zone.create({
      data: {
        name: `Zone Proposition ${suffix}`,
        type: 'CIRCLE',
        city: 'Dakar',
        region: 'Dakar',
        latitude: '14.6928000',
        longitude: '-17.4467000',
        radiusKm: '30'
      }
    });
    zoneId = zone.id;
  });

  afterAll(async () => {
    await prisma.negotiationMessage.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.bid.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.notification.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.scoreTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.zone.deleteMany({ where: { id: zoneId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('leaves the parcel unassigned until the driver answers', async () => {
    const created = await request(app)
      .post('/api/v1/client/parcels/create')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(newParcelPayload({ driverId }));

    expect(created.status).toBe(201);
    const parcel = created.body.parcel;
    parcelIds.push(parcel.id);

    expect(parcel.status).toBe('proposal_sent');
    expect(parcel.assignedDriverId).toBeNull();
    expect(parcel.driverId).toBeNull();
    expect(parcel.proposedDriverId).toBe(driverId);
    expect(parcel.proposal.status).toBe('pending');
    expect(parcel.proposal.lastOfferBy).toBe('client');
    // Cote client, le prix vient d'etre pose : rien a accepter.
    expect(parcel.proposal.canClientAccept).toBe(false);
    expect(parcel.proposal.canDriverAccept).toBe(true);

    const inbox = await request(app)
      .get('/api/v1/driver/proposals')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.parcels.map((item) => item.id)).toContain(parcel.id);
  });

  it('alternates the accept button through the negotiation', async () => {
    const created = await request(app)
      .post('/api/v1/client/parcels/create')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(newParcelPayload({ driverId }));
    const parcelId = created.body.parcel.id;
    parcelIds.push(parcelId);

    // Le chauffeur contre-propose : la main passe au client.
    const counter = await request(app)
      .post(`/api/v1/driver/proposals/${parcelId}/respond`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ action: 'counter', price: 7000, message: 'Trajet plus long que prevu' });
    expect(counter.status).toBe(200);
    const countered = counter.body.parcel;
    expect(countered.proposal.status).toBe('countered');
    expect(countered.proposal.lastOfferBy).toBe('driver');
    expect(countered.proposal.price).toBe(7000);
    expect(countered.proposal.lastMessage).toBe('Trajet plus long que prevu');
    expect(countered.proposal.canDriverAccept).toBe(false);
    expect(countered.proposal.canClientAccept).toBe(true);

    // Le chauffeur ne peut pas valider son propre prix.
    const selfAccept = await request(app)
      .post(`/api/v1/driver/proposals/${parcelId}/respond`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ action: 'accept' });
    expect(selfAccept.status).toBe(409);

    // Le client recontre : la main repasse au chauffeur.
    const clientCounter = await request(app)
      .post(`/api/v1/client/proposals/${parcelId}/respond-counter`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ action: 'counter', price: 6000, message: 'Dernier prix' });
    expect(clientCounter.status).toBe(200);
    expect(clientCounter.body.parcel.proposal.lastOfferBy).toBe('client');
    expect(clientCounter.body.parcel.proposal.lastMessage).toBe('Dernier prix');

    // Le client non plus ne valide pas son propre prix.
    const clientSelfAccept = await request(app)
      .post(`/api/v1/client/proposals/${parcelId}/respond-counter`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ action: 'accept' });
    expect(clientSelfAccept.status).toBe(409);

    // Le chauffeur accepte : le colis est enfin assigne.
    const accepted = await request(app)
      .post(`/api/v1/driver/proposals/${parcelId}/respond`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ action: 'accept' });
    expect(accepted.status).toBe(200);
    const finalParcel = accepted.body.parcel;
    expect(finalParcel.status).toBe('confirmed');
    expect(finalParcel.assignedDriverId).toBe(driverId);
    expect(Number(finalParcel.negotiatedPrice)).toBe(6000);
  });

  it('refuses the proposal without assigning the driver', async () => {
    const created = await request(app)
      .post('/api/v1/client/parcels/create')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(newParcelPayload({ driverId }));
    const parcelId = created.body.parcel.id;
    parcelIds.push(parcelId);

    const rejected = await request(app)
      .post(`/api/v1/driver/proposals/${parcelId}/respond`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ action: 'reject', message: 'Indisponible' });

    expect(rejected.status).toBe(200);
    const parcel = rejected.body.parcel;
    expect(parcel.status).toBe('pending');
    expect(parcel.assignedDriverId).toBeNull();
    expect(parcel.proposedDriverId).toBeNull();
    expect(parcel.proposal.status).toBe('rejected');
  });

  it('keeps the same turn rule on free-parcel bids', async () => {
    const created = await request(app)
      .post('/api/v1/client/parcels/create')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(newParcelPayload({ isFreeForBidding: true }));
    const parcelId = created.body.parcel.id;
    parcelIds.push(parcelId);

    const bid = await request(app)
      .post('/api/v1/driver/bids')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ parcelId, price: 8000, message: 'Je peux le prendre' });
    expect(bid.status).toBe(201);
    const bidId = bid.body.bid.id;
    expect(bid.body.bid.lastOfferBy).toBe('driver');
    expect(bid.body.bid.canClientAccept).toBe(true);

    // Le client contre : il perd le droit d'accepter.
    const counter = await request(app)
      .post(`/api/v1/client/bids/${bidId}/counter`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ price: 6500, message: 'Mon budget' });
    expect(counter.status).toBe(200);

    const clientSelfAccept = await request(app)
      .post(`/api/v1/client/bids/${bidId}/accept`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(clientSelfAccept.status).toBe(409);

    const negotiation = await request(app)
      .get(`/api/v1/bids/${bidId}/negotiation`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(negotiation.status).toBe(200);
    expect(negotiation.body.bid.lastOfferBy).toBe('client');
    expect(negotiation.body.bid.lastPrice).toBe(6500);
    expect(negotiation.body.bid.lastMessage).toBe('Mon budget');
    expect(negotiation.body.bid.canAccept).toBe(true);

    const driverAccept = await request(app)
      .post(`/api/v1/driver/bids/${bidId}/respond`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ action: 'accept' });
    expect(driverAccept.status).toBe(200);

    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });
    expect(parcel.status).toBe('confirmed');
    expect(parcel.assignedDriverId).toBe(driverId);
  });
});
