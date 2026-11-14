import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('SCP-030 — ShipmentBatch (expéditions groupées)', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  const batchIds = [];
  let shipper;
  let otherShipper;

  async function createParcel(ownerId) {
    const p = await prisma.parcel.create({
      data: {
        senderId: ownerId,
        senderName: 'B2B',
        senderPhone: `80${suffix}`,
        description: 'Colis batch',
        weight: 3,
        receiverName: 'Dest',
        receiverPhone: `77700${suffix.slice(-3)}`,
        receiverAddress: 'Ville X',
        trackingNumber: `SB${suffix}${Math.random().toString(36).slice(2, 6)}`,
        status: 'pending'
      }
    });
    parcelIds.push(p.id);
    return p;
  }

  beforeAll(async () => {
    for (const prefix of ['80', '81']) {
      const r = await registerPublic(`${prefix}${suffix}SB`, `Ship ${prefix}`, 'client');
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (!shipper) shipper = account;
      else otherShipper = account;
    }
  });

  afterAll(async () => {
    await prisma.parcel.updateMany({ where: { batchId: { in: batchIds } }, data: { batchId: null } });
    await prisma.shipmentBatch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('create : status draft, totaux à zéro', async () => {
    const res = await request(app)
      .post('/api/v1/shipment-batches')
      .set(authHeader(shipper.token))
      .send({ reference: 'CMD-001', label: 'Commandes du 11 nov' });
    expect(res.status).toBe(201);
    const { batch } = res.body;
    batchIds.push(batch.id);
    expect(batch.status).toBe('draft');
    expect(batch.totalParcels).toBe(0);
    expect(Number(batch.totalWeightKg)).toBe(0);
    expect(batch.reference).toBe('CMD-001');
  });

  test('attach parcels : recalcule totaux et passe en open', async () => {
    const p1 = await createParcel(shipper.id);
    const p2 = await createParcel(shipper.id);
    const create = await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({ label: 'Lot 2' });
    const batch = create.body.batch;
    batchIds.push(batch.id);

    const attach = await request(app)
      .post(`/api/v1/shipment-batches/${batch.id}/parcels`)
      .set(authHeader(shipper.token))
      .send({ parcelIds: [p1.id, p2.id] });
    expect(attach.status).toBe(200);
    expect(attach.body.batch.status).toBe('open');
    expect(attach.body.batch.totalParcels).toBe(2);
    expect(attach.body.batch.totalWeightKg).toBeCloseTo(6);

    const p1After = await prisma.parcel.findUnique({ where: { id: p1.id }, select: { batchId: true } });
    expect(p1After.batchId).toBe(batch.id);
  });

  test('attach : colis appartenant à un autre user → 403', async () => {
    const foreignParcel = await createParcel(otherShipper.id);
    const create = await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({ label: 'Lot 3' });
    const batch = create.body.batch;
    batchIds.push(batch.id);

    const res = await request(app)
      .post(`/api/v1/shipment-batches/${batch.id}/parcels`)
      .set(authHeader(shipper.token))
      .send({ parcelIds: [foreignParcel.id] });
    expect(res.status).toBe(403);
  });

  test('attach : colis déjà dans un autre batch → 409', async () => {
    const parcel = await createParcel(shipper.id);
    const batch1 = (await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({})).body.batch;
    const batch2 = (await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({})).body.batch;
    batchIds.push(batch1.id, batch2.id);

    const first = await request(app).post(`/api/v1/shipment-batches/${batch1.id}/parcels`).set(authHeader(shipper.token)).send({ parcelIds: [parcel.id] });
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/v1/shipment-batches/${batch2.id}/parcels`).set(authHeader(shipper.token)).send({ parcelIds: [parcel.id] });
    expect(second.status).toBe(409);
  });

  test('detach : décrémente totaux, batchId du colis devient null', async () => {
    const p = await createParcel(shipper.id);
    const batch = (await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({})).body.batch;
    batchIds.push(batch.id);
    await request(app).post(`/api/v1/shipment-batches/${batch.id}/parcels`).set(authHeader(shipper.token)).send({ parcelIds: [p.id] });

    const detach = await request(app)
      .delete(`/api/v1/shipment-batches/${batch.id}/parcels/${p.id}`)
      .set(authHeader(shipper.token));
    expect(detach.status).toBe(200);
    expect(detach.body.batch.totalParcels).toBe(0);
    const after = await prisma.parcel.findUnique({ where: { id: p.id }, select: { batchId: true } });
    expect(after.batchId).toBeNull();
  });

  test('close : status closed, interdit nouvelles modifs', async () => {
    const p = await createParcel(shipper.id);
    const batch = (await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({})).body.batch;
    batchIds.push(batch.id);
    await request(app).post(`/api/v1/shipment-batches/${batch.id}/parcels`).set(authHeader(shipper.token)).send({ parcelIds: [p.id] });

    const close = await request(app).post(`/api/v1/shipment-batches/${batch.id}/close`).set(authHeader(shipper.token));
    expect(close.status).toBe(200);
    expect(close.body.batch.status).toBe('closed');
    expect(close.body.batch.closedAt).toBeTruthy();

    const p2 = await createParcel(shipper.id);
    const attach2 = await request(app).post(`/api/v1/shipment-batches/${batch.id}/parcels`).set(authHeader(shipper.token)).send({ parcelIds: [p2.id] });
    expect(attach2.status).toBe(409);
  });

  test('get : propriétaire OK, tiers 403', async () => {
    const create = await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({ label: 'Visible' });
    const batch = create.body.batch;
    batchIds.push(batch.id);

    const owner = await request(app).get(`/api/v1/shipment-batches/${batch.id}`).set(authHeader(shipper.token));
    expect(owner.status).toBe(200);
    expect(owner.body.batch.label).toBe('Visible');

    const other = await request(app).get(`/api/v1/shipment-batches/${batch.id}`).set(authHeader(otherShipper.token));
    expect(other.status).toBe(403);
  });

  test('list : ne retourne que les batches du caller (non admin)', async () => {
    await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({ label: 'Mine A' });
    await request(app).post('/api/v1/shipment-batches').set(authHeader(otherShipper.token)).send({ label: 'Theirs' });

    const mine = await request(app).get('/api/v1/shipment-batches').set(authHeader(shipper.token));
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body.batches)).toBe(true);
    for (const b of mine.body.batches) {
      expect(b.creatorId).toBe(shipper.id);
    }
    const theirs = mine.body.batches.find((b) => b.label === 'Theirs');
    expect(theirs).toBeUndefined();
  });

  test('batch inexistant : 404', async () => {
    const res = await request(app).get(`/api/v1/shipment-batches/${randomUUID()}`).set(authHeader(shipper.token));
    expect(res.status).toBe(404);
  });

  test('attach vide : 422', async () => {
    const batch = (await request(app).post('/api/v1/shipment-batches').set(authHeader(shipper.token)).send({})).body.batch;
    batchIds.push(batch.id);
    const res = await request(app).post(`/api/v1/shipment-batches/${batch.id}/parcels`).set(authHeader(shipper.token)).send({ parcelIds: [] });
    expect(res.status).toBe(422);
  });
});
