import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

describe('SCP-011 — notifications handover à chaque transition', () => {
  // Suffixe = horodatage + 2 chars aléatoires : garantit l'unicité même si ce
  // fichier et parcel-handover-integration démarrent dans la même milliseconde
  // (ancien flap de collision de numéros de téléphone).
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const userIds = [];
  const parcelIds = [];
  const zoneIds = [];
  let sender;
  let driverA;
  let driverB;
  let driverC;
  let dakarZone;
  let thiesZone;

  async function createParcel() {
    const p = await prisma.parcel.create({
      data: {
        senderId: sender.id,
        senderName: 'Sender HN',
        senderPhone: `98${suffix}`,
        description: 'Colis handover notif',
        weight: 2,
        departureZoneId: dakarZone.id,
        arrivalZoneId: thiesZone.id,
        receiverName: 'Destinataire',
        receiverPhone: `77999${suffix.slice(-3)}`,
        receiverAddress: 'Thies',
        trackingNumber: `HN${suffix}${Math.random().toString(36).slice(2, 6)}`,
        status: 'in_transit',
        assignedDriverId: driverA.id
      }
    });
    parcelIds.push(p.id);
    return p;
  }

  beforeAll(async () => {
    for (const [prefix, role] of [['98', 'client'], ['99', 'driver'], ['95', 'driver'], ['94', 'driver']]) {
      const r = await registerPublic(`${prefix}${suffix}HN`, `HN ${prefix}`, role);
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (role === 'client') sender = account;
      else if (!driverA) driverA = account;
      else if (!driverB) driverB = account;
      else driverC = account;
    }
    await prisma.user.updateMany({ where: { id: { in: [driverA.id, driverB.id, driverC.id] } }, data: { isVerified: true } });

    dakarZone = await prisma.zone.create({ data: { name: `DKR HN ${suffix}`, placeId: `hn-dakar-${suffix}`, latitude: 14.69, longitude: -17.44, radiusKm: 2 } });
    thiesZone = await prisma.zone.create({ data: { name: `THI HN ${suffix}`, placeId: `hn-thies-${suffix}`, latitude: 14.79, longitude: -16.93, radiusKm: 2 } });
    zoneIds.push(dakarZone.id, thiesZone.id);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.parcelHandover.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('initiate crée 2 notifications (toDriver + sender)', async () => {
    const parcel = await createParcel();
    await prisma.notification.deleteMany({ where: { userId: { in: [sender.id, driverA.id, driverB.id] }, type: { startsWith: 'handover_' } } });

    const res = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(res.status).toBe(201);

    const notifSender = await prisma.notification.findMany({ where: { userId: sender.id, type: 'handover_initiated' } });
    const notifTo = await prisma.notification.findMany({ where: { userId: driverB.id, type: 'handover_initiated' } });
    const notifFrom = await prisma.notification.findMany({ where: { userId: driverA.id, type: 'handover_initiated' } });

    expect(notifSender).toHaveLength(1);
    expect(notifTo).toHaveLength(1);
    expect(notifFrom).toHaveLength(0); // driver sortant n'est pas notifié au moment de l'initiate (il est l'auteur)
    expect(notifTo[0].priority).toBe('high');
    expect(notifTo[0].parcelId).toBe(parcel.id);
    expect(notifTo[0].body).toContain('PIN');
    expect(notifTo[0].data.handoverId).toBe(res.body.handover.id);
  });

  test('confirm crée 2 notifications (fromDriver + sender)', async () => {
    const parcel = await createParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(init.status).toBe(201);
    await prisma.notification.deleteMany({ where: { userId: { in: [sender.id, driverA.id, driverB.id] }, type: { startsWith: 'handover_' } } });

    const confirm = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${init.body.handover.id}/confirm`)
      .set(authHeader(driverB.token))
      .send({ pin: init.body.handover.pickupPin, qrToken: init.body.handover.pickupQrToken });
    expect(confirm.status).toBe(200);

    const notifFrom = await prisma.notification.findMany({ where: { userId: driverA.id, type: 'handover_completed' } });
    const notifSender = await prisma.notification.findMany({ where: { userId: sender.id, type: 'handover_completed' } });
    const notifTo = await prisma.notification.findMany({ where: { userId: driverB.id, type: 'handover_completed' } });

    expect(notifFrom).toHaveLength(1);
    expect(notifSender).toHaveLength(1);
    expect(notifTo).toHaveLength(0);
  });

  test('cancel par le sortant notifie les deux autres (entrant + sender), pas l\'auteur', async () => {
    const parcel = await createParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    await prisma.notification.deleteMany({ where: { userId: { in: [sender.id, driverA.id, driverB.id] }, type: { startsWith: 'handover_' } } });

    const cancel = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${init.body.handover.id}/cancel`)
      .set(authHeader(driverA.token))
      .send({ reason: 'Correspondance abandonnée' });
    expect(cancel.status).toBe(200);

    const notifFrom = await prisma.notification.findMany({ where: { userId: driverA.id, type: 'handover_cancelled' } });
    const notifTo = await prisma.notification.findMany({ where: { userId: driverB.id, type: 'handover_cancelled' } });
    const notifSender = await prisma.notification.findMany({ where: { userId: sender.id, type: 'handover_cancelled' } });

    expect(notifFrom).toHaveLength(0); // auteur du cancel
    expect(notifTo).toHaveLength(1);
    expect(notifSender).toHaveLength(1);
    expect(notifTo[0].body).toContain('abandonnée');
  });

  test('cancel par un admin notifie les trois parties', async () => {
    const parcel = await createParcel();
    const init = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers`)
      .set(authHeader(driverA.token))
      .send({ toDriverId: driverB.id });
    expect(init.status).toBe(201);
    await prisma.notification.deleteMany({ where: { userId: { in: [sender.id, driverA.id, driverB.id] }, type: { startsWith: 'handover_' } } });

    // Promouvoir driverC en super_admin pour qu'il puisse annuler.
    await prisma.user.update({ where: { id: driverC.id }, data: { role: 'super_admin' } });

    const cancel = await request(app)
      .post(`/api/v1/parcels/${parcel.id}/handovers/${init.body.handover.id}/cancel`)
      .set(authHeader(driverC.token))
      .send({ reason: 'Intervention admin' });
    expect(cancel.status).toBe(200);

    const nf = await prisma.notification.count({ where: { userId: driverA.id, type: 'handover_cancelled' } });
    const nt = await prisma.notification.count({ where: { userId: driverB.id, type: 'handover_cancelled' } });
    const ns = await prisma.notification.count({ where: { userId: sender.id, type: 'handover_cancelled' } });
    expect(nf).toBe(1);
    expect(nt).toBe(1);
    expect(ns).toBe(1);

    // Restore role for cleanup.
    await prisma.user.update({ where: { id: driverC.id }, data: { role: 'driver' } });
  });
});
