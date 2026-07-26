import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * Contrat E2E du paiement espèces porté par les clients mobile et web.
 *
 * Les colis sont préparés directement en base pour isoler ce domaine des
 * assistants de création et des transitions logistiques testés ailleurs.
 */
describe('cash payment reconciliation', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let adminToken;
  let driverToken;
  let clientToken;
  let driverId;
  let clientId;
  let garageId;

  async function register(phonePrefix, fullName, role) {
    const response = await request(app).post('/api/v1/auth/register').send({
      phone: `${phonePrefix}${suffix}`,
      fullName,
      pin: '123456',
      role
    });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    return response;
  }

  async function createCashParcel({
    trackingNumber,
    status,
    collectionPoint
  }) {
    const parcel = await prisma.parcel.create({
      data: {
        trackingNumber,
        senderId: clientId,
        senderName: 'Client Cash Test',
        senderPhone: `78${suffix}`,
        receiverName: 'Destinataire Cash Test',
        receiverPhone: `70${suffix}`,
        description: 'Colis de test espèces',
        weight: '2.50',
        status,
        departureGarageId: garageId,
        driverId,
        price: '7500',
        totalAmount: '7500',
        paymentMethod: 'cash',
        paymentChannel: 'cash',
        cashCollectionPoint: collectionPoint,
        pickupDate: status === 'picked_up' || status === 'delivered' ? new Date() : null,
        deliveryDate: status === 'delivered' ? new Date() : null,
        createdBy: clientId
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  beforeAll(async () => {
    const admin = await register('75', 'Admin Cash Test', 'super_admin');
    const driver = await register('76', 'Chauffeur Cash Test', 'driver');
    const client = await register('78', 'Client Cash Test', 'client');
    adminToken = admin.body.accessToken;
    driverToken = driver.body.accessToken;
    clientToken = client.body.accessToken;
    driverId = driver.body.user.id;
    clientId = client.body.user.id;

    const garage = await prisma.garage.create({
      data: {
        name: `Garage Cash ${suffix}`,
        city: 'Dakar',
        region: 'Dakar'
      }
    });
    garageId = garage.id;
  });

  afterAll(async () => {
    // L'ordre respecte les relations non-cascade (audit, notifications,
    // paiements) afin que la suite reste rejouable sur la base de test.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: parcelIds } }
        ]
      }
    });
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { parcelId: { in: parcelIds } }
        ]
      }
    });
    await prisma.payment.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (garageId) await prisma.garage.delete({ where: { id: garageId } });
    await prisma.$disconnect();
  });

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const driverAuth = () => ({ Authorization: `Bearer ${driverToken}` });
  const clientAuth = () => ({ Authorization: `Bearer ${clientToken}` });

  it('declares an eligible collection once, lists it, then validates it', async () => {
    const parcel = await createCashParcel({
      trackingNumber: `CASH-VALID-${suffix}`,
      status: 'picked_up',
      collectionPoint: 'sender_pickup'
    });

    const first = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/declare-cash`)
      .set(driverAuth())
      .send({
        amount: 7500,
        collectionPoint: 'sender_pickup',
        note: 'Espèces reçues au départ'
      });
    expect(first.status).toBe(201);
    expect(first.body.payment.status).toBe('processing');
    expect(first.body.payment.channel).toBe('cash');
    expect(first.body.payment.declaredBy).toBe(driverId);

    // Un retry réseau renvoie la déclaration active au lieu d'en dupliquer une.
    const retry = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/declare-cash`)
      .set(driverAuth())
      .send({ amount: 7500, collectionPoint: 'sender_pickup' });
    expect(retry.status).toBe(200);
    expect(retry.body.payment.id).toBe(first.body.payment.id);

    const driverList = await request(app)
      .get('/api/v1/driver/cash-declarations')
      .set(driverAuth());
    expect(driverList.status).toBe(200);
    expect(driverList.body.declarations.some((item) => item.id === first.body.payment.id)).toBe(true);

    const adminList = await request(app)
      .get('/api/v1/super-admin/payments/cash-declarations')
      .set(adminAuth());
    expect(adminList.status).toBe(200);
    expect(adminList.body.declarations.some((item) => item.id === first.body.payment.id)).toBe(true);

    const validation = await request(app)
      .post(`/api/v1/super-admin/payments/${first.body.payment.id}/validate-cash`)
      .set(adminAuth());
    expect(validation.status).toBe(200);
    expect(validation.body.payment.status).toBe('completed');

    const persistedParcel = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(persistedParcel.paymentStatus).toBe('completed');
    expect(Number(persistedParcel.cashCollectedAmount)).toBe(7500);
  });

  it('rejects a delivery collection with a mandatory reconciliation reason', async () => {
    const parcel = await createCashParcel({
      trackingNumber: `CASH-REJECT-${suffix}`,
      status: 'delivered',
      collectionPoint: 'receiver_delivery'
    });
    const declaration = await request(app)
      .post(`/api/v1/driver/parcels/${parcel.id}/declare-cash`)
      .set(driverAuth())
      .send({ amount: 7500, collectionPoint: 'receiver_delivery' });
    expect(declaration.status).toBe(201);

    const withoutReason = await request(app)
      .post(`/api/v1/super-admin/payments/${declaration.body.payment.id}/reject-cash`)
      .set(adminAuth())
      .send({});
    expect(withoutReason.status).toBe(422);

    const rejection = await request(app)
      .post(`/api/v1/super-admin/payments/${declaration.body.payment.id}/reject-cash`)
      .set(adminAuth())
      .send({ reason: 'Montant non remis au garage' });
    expect(rejection.status).toBe(200);
    expect(rejection.body.payment.status).toBe('failed');
    expect(rejection.body.payment.rejectionReason).toBe('Montant non remis au garage');

    const persistedParcel = await prisma.parcel.findUnique({ where: { id: parcel.id } });
    expect(persistedParcel.paymentStatus).toBe('failed');
    expect(persistedParcel.cashCollectedAmount).toBeNull();
  });

  it('updates an accessible unpaid parcel payment channel', async () => {
    const parcel = await createCashParcel({
      trackingNumber: `CASH-CHANNEL-${suffix}`,
      status: 'pending',
      collectionPoint: 'receiver_delivery'
    });

    const platform = await request(app)
      .patch(`/api/v1/parcels/${parcel.id}/payment-channel`)
      .set(clientAuth())
      .send({ paymentChannel: 'platform' });
    expect(platform.status).toBe(200);
    expect(platform.body.parcel.paymentChannel).toBe('platform');
    expect(platform.body.parcel.cashCollectionPoint).toBeNull();

    const cash = await request(app)
      .patch(`/api/v1/parcels/${parcel.id}/payment-channel`)
      .set(clientAuth())
      .send({
        paymentChannel: 'cash',
        cashCollectionPoint: 'receiver_delivery'
      });
    expect(cash.status).toBe(200);
    expect(cash.body.parcel.paymentChannel).toBe('cash');
    expect(cash.body.parcel.cashCollectionPoint).toBe('receiver_delivery');
  });
});
