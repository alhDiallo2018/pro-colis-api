import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('SCP-010 — correspondances inter-véhicules (ParcelHandover)', () => {
  // Suffixe unique (ms + 2 chars random) pour éviter la collision avec les
  // autres tests handover tournant en série dans le même CI.
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  const parcelIds = [];
  const zoneIds = [];
  let sender;
  let driverA;
  let driverB;
  let driverC; // non impliqué
  let dakarZone;
  let thiesZone;

  async function createHandoverableParcel(status = 'in_transit') {
    const parcel = await prisma.parcel.create({
      data: {
        senderId: sender.id,
        senderName: 'Sender',
        senderPhone: `91${suffix}`,
        description: `Colis handover ${Date.now()}`,
        weight: 2,
        departureZoneId: dakarZone.id,
        arrivalZoneId: thiesZone.id,
        receiverName: 'Destinataire',
        receiverPhone: `77899${suffix.slice(-3)}`,
        receiverAddress: 'Thies',
        trackingNumber: `H${suffix}${Math.random().toString(36).slice(2, 6)}`,
        status,
        assignedDriverId: driverA.id
      }
    });
    parcelIds.push(parcel.id);
    return parcel;
  }

  beforeAll(async () => {
    for (const [prefix, role] of [['94', 'client'], ['95', 'driver'], ['96', 'driver'], ['97', 'driver']]) {
      const r = await registerPublic(`${prefix}${suffix}`, `Ho ${prefix}`, role);
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (role === 'client') sender = account;
      else if (!driverA) driverA = account;
      else if (!driverB) driverB = account;
      else driverC = account;
    }
    await prisma.user.updateMany({ where: { id: { in: [driverA.id, driverB.id, driverC.id] } }, data: { isVerified: true } });

    dakarZone = await prisma.zone.create({ data: { name: `Dakar ho ${suffix}`, placeId: `ho-dakar-${suffix}`, latitude: 14.69, longitude: -17.44, radiusKm: 2 } });
    thiesZone = await prisma.zone.create({ data: { name: `Thies ho ${suffix}`, placeId: `ho-thies-${suffix}`, latitude: 14.79, longitude: -16.93, radiusKm: 2 } });
    zoneIds.push(dakarZone.id, thiesZone.id);
  });

  afterAll(async () => {
    await prisma.parcelHandover.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('cycle complet : initiate → confirm transfère assignedDriverId', async () => {
    const parcel = await createHandoverableParcel();

    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id, latitude: 14.75, longitude: -17.0 });
    expect(init.status).toBe(201);
    const { handover } = init.body;
    expect(handover.status).toBe('pending_pickup');
    expect(handover.fromDriverId).toBe(driverA.id);
    expect(handover.toDriverId).toBe(driverB.id);
    expect(handover.pickupPin).toMatch(/^\d{6}$/);
    expect(handover.pickupPinLast4).toBe(handover.pickupPin.slice(-4));
    expect(typeof handover.pickupQrToken).toBe('string');
    expect(handover.pickupQrToken.length).toBeGreaterThan(20);

    const pin = handover.pickupPin;
    const qr = handover.pickupQrToken;

    const confirm = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/confirm`)
      .set(authHeader(driverB.token))
      .send({ pin, qrToken: qr });
    expect(confirm.status).toBe(200);
    expect(confirm.body.handover.status).toBe('completed');
    expect(confirm.body.handover.confirmedAt).toBeTruthy();
    // Les secrets ne sont plus exposés après confirm.
    expect(confirm.body.handover.pickupPin).toBeNull();
    expect(confirm.body.handover.pickupQrToken).toBeNull();

    const refreshed = await prisma.parcel.findUnique({ where: { id: parcel.id }, select: { assignedDriverId: true } });
    expect(refreshed.assignedDriverId).toBe(driverB.id);
  });

  test('un second handover actif est refusé (unique partiel)', async () => {
    const parcel = await createHandoverableParcel();
    const first = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverC.id });
    expect(second.status).toBe(409);
  });

  test('confirm avec mauvais PIN rejeté 422 et laisse le handover en attente', async () => {
    const parcel = await createHandoverableParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(init.status).toBe(201);
    const { handover } = init.body;

    const confirm = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/confirm`)
      .set(authHeader(driverB.token))
      .send({ pin: '000000', qrToken: handover.pickupQrToken });
    expect(confirm.status).toBe(422);

    const row = await prisma.parcelHandover.findUnique({ where: { id: handover.id } });
    expect(row.status).toBe('pending_pickup');
    expect(row.confirmedAt).toBeNull();
    const parcelAfter = await prisma.parcel.findUnique({ where: { id: parcel.id }, select: { assignedDriverId: true } });
    expect(parcelAfter.assignedDriverId).toBe(driverA.id);
  });

  test('confirm avec mauvais token QR rejeté 422', async () => {
    const parcel = await createHandoverableParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    const { handover } = init.body;

    const bad = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/confirm`)
      .set(authHeader(driverB.token))
      .send({ pin: handover.pickupPin, qrToken: 'wrong-token-value-xxxxxxxx' });
    expect(bad.status).toBe(422);
  });

  test('un driver tiers ne peut pas confirmer', async () => {
    const parcel = await createHandoverableParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    const { handover } = init.body;

    const res = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/confirm`)
      .set(authHeader(driverC.token))
      .send({ pin: handover.pickupPin, qrToken: handover.pickupQrToken });
    expect(res.status).toBe(403);
  });

  test('cancel par le sortant : status cancelled, assignedDriverId inchangé', async () => {
    const parcel = await createHandoverableParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    const { handover } = init.body;

    const cancel = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/cancel`)
      .set(authHeader(driverA.token))
      .send({ reason: 'Chauffeur B indisponible finalement' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.handover.status).toBe('cancelled');
    expect(cancel.body.handover.cancellationReason).toContain('indisponible');

    const parcelAfter = await prisma.parcel.findUnique({ where: { id: parcel.id }, select: { assignedDriverId: true } });
    expect(parcelAfter.assignedDriverId).toBe(driverA.id);

    // Après annulation, on peut initier un nouveau handover.
    const second = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverC.id });
    expect(second.status).toBe(201);
  });

  test('initiate refusé si le driver n\'est pas l\'actuel assigné', async () => {
    const parcel = await createHandoverableParcel();
    const res = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverB.token))
      .send({ toDriverId: driverC.id });
    expect(res.status).toBe(403);
  });

  test('initiate refusé si toDriverId == actor', async () => {
    const parcel = await createHandoverableParcel();
    const res = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverA.id });
    expect(res.status).toBe(422);
  });

  test('initiate refusé si le colis n\'est pas en transport', async () => {
    const parcel = await prisma.parcel.create({
      data: {
        senderId: sender.id,
        senderName: 'Sender',
        senderPhone: `91${suffix}`,
        description: 'Colis non transportable',
        weight: 2,
        receiverName: 'X',
        receiverPhone: '00',
        trackingNumber: `H${suffix}${Math.random().toString(36).slice(2, 6)}`,
        status: 'free',
        assignedDriverId: driverA.id
      }
    });
    parcelIds.push(parcel.id);
    const res = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(res.status).toBe(409);
  });

  test('cancel après completed : 409', async () => {
    const parcel = await createHandoverableParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    const { handover } = init.body;
    const confirmRes = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/confirm`)
      .set(authHeader(driverB.token))
      .send({ pin: handover.pickupPin, qrToken: handover.pickupQrToken });
    expect(confirmRes.status).toBe(200);
    const cancel = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${handover.id}/cancel`)
      .set(authHeader(driverA.token))
      .send({ reason: 'trop tard' });
    expect(cancel.status).toBe(409);
  });

  test('list handovers : driver sortant, entrant, sender et admin autorisés ; tiers refusé', async () => {
    const parcel = await createHandoverableParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(init.status).toBe(201);

    const asFrom = await request(app).get(`/api/v1/parcels/${parcel.id}/handovers`).set(authHeader(driverA.token));
    expect(asFrom.status).toBe(200);
    expect(asFrom.body.handovers.length).toBeGreaterThanOrEqual(1);

    const asTo = await request(app).get(`/api/v1/parcels/${parcel.id}/handovers`).set(authHeader(driverB.token));
    expect(asTo.status).toBe(200);

    const asSender = await request(app).get(`/api/v1/parcels/${parcel.id}/handovers`).set(authHeader(sender.token));
    expect(asSender.status).toBe(200);

    const asOther = await request(app).get(`/api/v1/parcels/${parcel.id}/handovers`).set(authHeader(driverC.token));
    expect(asOther.status).toBe(403);
  });

  test('parcel inexistant : 404', async () => {
    const res = await request(app)
      .post(`/api/v1/parcels/${randomUUID()}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(res.status).toBe(404);
  });
});
