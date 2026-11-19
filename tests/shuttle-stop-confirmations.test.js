import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

// SCP-005 (Phase 2 — chantier 1) : confirmations manuelles pickup/dropoff
// par le chauffeur, avec idempotence applicative et contrôle d'accès strict.
describe('Shuttle stop confirmations — POST + GET', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  const parcelIds = [];
  let driver;
  let otherDriver;
  let client;
  let outsider;
  let transitLineId;
  let advertisementId;
  let offerDakarThiesId; // boarding=0, dropOff=1
  let offerDakarMbourId; // boarding=0, dropOff=2
  let offerNoStopsId;    // boarding=null, dropOff=null (ligne libre)

  beforeAll(async () => {
    const accounts = [
      ['90', 'driver'],
      ['91', 'driver'],
      ['92', 'client'],
      ['93', 'client'],
    ];
    const bag = {};
    for (const [prefix, role] of accounts) {
      const res = await registerPublic(`${prefix}${suffix}`, `Confirm ${prefix}`, role);
      expect(res.status).toBe(201);
      userIds.push(res.body.user.id);
      bag[prefix] = { id: res.body.user.id, token: res.body.accessToken };
    }
    driver = bag['90'];
    otherDriver = bag['91'];
    client = bag['92'];
    outsider = bag['93'];

    const zones = await Promise.all([
      prisma.zone.create({ data: { name: `Dakar ${suffix}`, placeId: `confirm-dakar-${suffix}`, latitude: 14.6937, longitude: -17.4441, radiusKm: 2 } }),
      prisma.zone.create({ data: { name: `Thies ${suffix}`, placeId: `confirm-thies-${suffix}`, latitude: 14.7919, longitude: -16.9359, radiusKm: 2 } }),
      prisma.zone.create({ data: { name: `Mbour ${suffix}`, placeId: `confirm-mbour-${suffix}`, latitude: 14.4199, longitude: -16.9664, radiusKm: 2 } }),
    ]);
    zoneIds.push(...zones.map((z) => z.id));

    const transitLine = await prisma.transitLine.create({
      data: {
        operator: 'ddd',
        number: `C${suffix}`,
        direction: 'aller',
        name: `Ligne confirmations ${suffix}`,
        origin: 'Dakar',
        destination: 'Mbour',
        stops: {
          create: [
            { order: 0, zoneId: zones[0].id, label: 'Dakar' },
            { order: 1, zoneId: zones[1].id, label: 'Thies' },
            { order: 2, zoneId: zones[2].id, label: 'Mbour' },
          ],
        },
      },
    });
    transitLineId = transitLine.id;

    const ad = await prisma.advertisement.create({
      data: {
        driverId: driver.id,
        transitLineId,
        departureCity: 'Dakar',
        arrivalCity: 'Mbour',
        status: 'open',
      },
    });
    advertisementId = ad.id;

    const parcelData = [
      { dropOff: 1, trackSuffix: 'A' },
      { dropOff: 2, trackSuffix: 'B' },
      { dropOff: null, trackSuffix: 'C' },
    ];
    const offerIds = [];
    for (const [index, spec] of parcelData.entries()) {
      const parcel = await prisma.parcel.create({
        data: {
          senderId: client.id,
          senderName: 'Confirm Sender',
          senderPhone: `92${suffix}`,
          description: `Colis confirm ${spec.trackSuffix}`,
          weight: 2,
          departureZoneId: zones[0].id,
          arrivalZoneId: spec.dropOff != null ? zones[spec.dropOff].id : zones[2].id,
          receiverName: `Dest ${spec.trackSuffix}`,
          receiverPhone: `77900${index}${suffix.slice(-3)}`,
          receiverAddress: `Adresse ${spec.trackSuffix}`,
          trackingNumber: `CF${suffix}${spec.trackSuffix}`,
          status: 'free',
        },
      });
      parcelIds.push(parcel.id);

      const offer = await prisma.advertisementOffer.create({
        data: {
          advertisementId,
          clientId: client.id,
          parcelId: parcel.id,
          price: 4000,
          status: 'accepted',
          boardingStopOrder: spec.dropOff != null ? 0 : null,
          dropOffStopOrder: spec.dropOff,
          respondedAt: new Date(),
        },
      });
      offerIds.push(offer.id);
    }
    offerDakarThiesId = offerIds[0];
    offerDakarMbourId = offerIds[1];
    offerNoStopsId = offerIds[2];
  });

  afterAll(async () => {
    await prisma.shuttleStopConfirmation.deleteMany({ where: { advertisementId } });
    await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
    await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    await prisma.transitLineStop.deleteMany({ where: { transitLineId } });
    await prisma.transitLine.deleteMany({ where: { id: transitLineId } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('driver confirme un pickup — 201 avec created=true et stopOrder figé', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerDakarThiesId}/stop-confirmations`)
      .set(authHeader(driver.token))
      .send({ type: 'pickup', latitude: 14.6937, longitude: -17.4441, note: 'Chargé à Dakar' });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.confirmation.type).toBe('pickup');
    expect(res.body.confirmation.stopOrder).toBe(0);
    expect(res.body.confirmation.latitude).toBe(14.6937);
    expect(res.body.confirmation.note).toBe('Chargé à Dakar');
  });

  test('deuxième POST même offre+type — idempotent (200, created=false)', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerDakarThiesId}/stop-confirmations`)
      .set(authHeader(driver.token))
      .send({ type: 'pickup' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.confirmation.id).toBeDefined();
  });

  test('driver confirme un dropoff sur une autre offre — 201 stopOrder=2', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerDakarMbourId}/stop-confirmations`)
      .set(authHeader(driver.token))
      .send({ type: 'dropoff' });
    expect(res.status).toBe(201);
    expect(res.body.confirmation.stopOrder).toBe(2);
    expect(res.body.confirmation.type).toBe('dropoff');
  });

  test('type invalide — 422', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerDakarThiesId}/stop-confirmations`)
      .set(authHeader(driver.token))
      .send({ type: 'arrived' });
    expect(res.status).toBe(422);
  });

  test('offre sans arrêt défini — 422 refus de type correspondant', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerNoStopsId}/stop-confirmations`)
      .set(authHeader(driver.token))
      .send({ type: 'pickup' });
    expect(res.status).toBe(422);
  });

  test('autre chauffeur — 403 (pas le driver du trajet)', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerDakarMbourId}/stop-confirmations`)
      .set(authHeader(otherDriver.token))
      .send({ type: 'pickup' });
    expect(res.status).toBe(403);
  });

  test('client — 403 (rôle driver requis)', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/${offerDakarMbourId}/stop-confirmations`)
      .set(authHeader(client.token))
      .send({ type: 'pickup' });
    expect(res.status).toBe(403);
  });

  test('offre inexistante — 404', async () => {
    const res = await request(app)
      .post(`/api/v1/advertisements/${advertisementId}/offers/00000000-0000-0000-0000-000000000000/stop-confirmations`)
      .set(authHeader(driver.token))
      .send({ type: 'pickup' });
    expect(res.status).toBe(404);
  });

  test('GET confirmations — driver du trajet voit toutes les confirmations', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/stop-confirmations`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.confirmations)).toBe(true);
    // Deux confirmations posées plus haut (pickup DakarThies + dropoff DakarMbour).
    expect(res.body.confirmations.length).toBeGreaterThanOrEqual(2);
    expect(res.body.confirmations.map((c) => c.type).sort()).toEqual(['dropoff', 'pickup']);
  });

  test('GET confirmations — client avec offre acceptée voit les confirmations', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/stop-confirmations`)
      .set(authHeader(client.token));
    expect(res.status).toBe(200);
    expect(res.body.confirmations.length).toBeGreaterThanOrEqual(2);
  });

  test('GET confirmations — client tiers sans offre : 403', async () => {
    const res = await request(app)
      .get(`/api/v1/advertisements/${advertisementId}/stop-confirmations`)
      .set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });
});
