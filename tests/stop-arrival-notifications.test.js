import { prisma } from '../src/config/prisma.js';
import { registerPublic, cleanupUsers } from './helpers.js';
import { evaluateStopArrival, notifyRecipientsAtDropOff } from '../src/modules/trips/stop-arrival.service.js';

describe('SCP-004 — notification destinataires à l\'arrivée au dropOffStop', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  const parcelIds = [];
  let driver;
  let clientWithParcel;
  let clientNoParcel;
  let unrelatedClient;
  let advertisementId;
  let transitLineId;
  let vehicleId;
  let dakarZone;
  let thiesZone;

  beforeAll(async () => {
    for (const [prefix, role] of [['90', 'driver'], ['91', 'client'], ['92', 'client'], ['93', 'client']]) {
      const r = await registerPublic(`${prefix}${suffix}`, `Notif ${prefix}`, role);
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (role === 'driver') driver = account;
      else if (!clientWithParcel) clientWithParcel = account;
      else if (!clientNoParcel) clientNoParcel = account;
      else unrelatedClient = account;
    }
    await prisma.user.update({ where: { id: driver.id }, data: { isVerified: true } });

    dakarZone = await prisma.zone.create({ data: { name: `Dakar notif ${suffix}`, placeId: `notif-dakar-${suffix}`, latitude: 14.6937, longitude: -17.4441, radiusKm: 2 } });
    thiesZone = await prisma.zone.create({ data: { name: `Thies notif ${suffix}`, placeId: `notif-thies-${suffix}`, latitude: 14.7919, longitude: -16.9359, radiusKm: 2 } });
    zoneIds.push(dakarZone.id, thiesZone.id);

    const line = await prisma.transitLine.create({
      data: {
        operator: 'ddd',
        number: `N${suffix}`,
        direction: 'aller',
        name: `Notif ${suffix}`,
        origin: 'Dakar',
        destination: 'Thies',
        stops: {
          create: [
            { order: 0, zoneId: dakarZone.id, label: 'Dakar centre' },
            { order: 1, zoneId: thiesZone.id, label: 'Thies gare' }
          ]
        }
      }
    });
    transitLineId = line.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        driverId: driver.id,
        type: 'bus',
        model: `Bus notif ${suffix}`,
        plateNumber: `DK${suffix}N`,
        capacity: 25
      }
    });
    vehicleId = vehicle.id;

    const ad = await prisma.advertisement.create({
      data: { driverId: driver.id, transitLineId, departureCity: 'Dakar', arrivalCity: 'Thies', status: 'open' }
    });
    advertisementId = ad.id;

    const parcel = await prisma.parcel.create({
      data: {
        senderId: clientWithParcel.id,
        senderName: 'Notif 91',
        senderPhone: `91${suffix}`,
        description: 'Colis notif',
        weight: 2,
        departureZoneId: dakarZone.id,
        arrivalZoneId: thiesZone.id,
        receiverName: 'Dest Thies',
        receiverPhone: `77811${suffix.slice(-3)}`,
        receiverAddress: 'Thies',
        trackingNumber: `NP${suffix}`,
        status: 'free'
      }
    });
    parcelIds.push(parcel.id);

    // Offre acceptée avec parcel + dropOff à Thies.
    await prisma.advertisementOffer.create({
      data: {
        advertisementId,
        clientId: clientWithParcel.id,
        parcelId: parcel.id,
        price: 3000,
        status: 'accepted',
        boardingStopOrder: 0,
        dropOffStopOrder: 1,
        respondedAt: new Date()
      }
    });

    // Offre acceptée SANS parcel + dropOff à Thies (cas réservation de place).
    await prisma.advertisementOffer.create({
      data: {
        advertisementId,
        clientId: clientNoParcel.id,
        parcelId: null,
        price: 1500,
        status: 'accepted',
        boardingStopOrder: 0,
        dropOffStopOrder: 1,
        respondedAt: new Date()
      }
    });

    // Offre acceptée avec dropOff au Dakar (ne doit PAS être notifiée pour stop=1).
    await prisma.advertisementOffer.create({
      data: {
        advertisementId,
        clientId: unrelatedClient.id,
        parcelId: null,
        price: 1200,
        status: 'accepted',
        boardingStopOrder: 0,
        // dropOff à l'arrêt 0 : ne doit pas déclencher pour l'arrivée à l'arrêt 1
        dropOffStopOrder: 0,
        respondedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.journeyStopEvent.deleteMany({ where: { advertisementId } });
    await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
    await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    await prisma.transitLineStop.deleteMany({ where: { transitLineId } });
    await prisma.transitLine.deleteMany({ where: { id: transitLineId } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('notifyRecipientsAtDropOff : notifie uniquement les offres dont dropOff == stop atteint', async () => {
    const count = await notifyRecipientsAtDropOff(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId
    }, { order: 1, label: 'Thies gare', zoneId: thiesZone.id });

    expect(count).toBe(2); // clientWithParcel + clientNoParcel ; pas unrelatedClient

    const notifWith = await prisma.notification.findMany({
      where: { userId: clientWithParcel.id, type: 'stop_reached' }
    });
    const notifWithout = await prisma.notification.findMany({
      where: { userId: clientNoParcel.id, type: 'stop_reached' }
    });
    const notifUnrelated = await prisma.notification.findMany({
      where: { userId: unrelatedClient.id, type: 'stop_reached' }
    });

    expect(notifWith).toHaveLength(1);
    expect(notifWith[0].title).toBe('Votre colis approche');
    expect(notifWith[0].body).toContain('Thies gare');
    expect(notifWith[0].body).toContain('NP'); // trackingNumber inclus
    expect(notifWith[0].data.stopOrder).toBe(1);
    expect(notifWith[0].priority).toBe('high');

    expect(notifWithout).toHaveLength(1);
    expect(notifWithout[0].body).toContain('Thies gare');
    expect(notifWithout[0].body).not.toContain('(NP');

    expect(notifUnrelated).toHaveLength(0);
  });

  test('evaluateStopArrival pipeline complet déclenche les notifications', async () => {
    // Nettoie d'abord les notifs/events résiduels du test précédent.
    await prisma.notification.deleteMany({ where: { userId: { in: userIds }, type: 'stop_reached' } });
    await prisma.journeyStopEvent.deleteMany({ where: { advertisementId } });

    const dLat = 30 / 111_320;
    const near1 = { latitude: 14.7919 + dLat, longitude: -16.9359, capturedAt: new Date(Date.now() - 60_000).toISOString() };
    const near2 = { latitude: 14.7919 + dLat * 0.6, longitude: -16.9359, capturedAt: new Date().toISOString() };

    const result = await evaluateStopArrival(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId,
      advertisement: { id: advertisementId, transitLineId }
    }, [near1, near2]);

    expect(result.reached).toHaveLength(1);
    expect(result.reached[0].order).toBe(1);
    expect(result.notified).toHaveLength(1);
    expect(result.notified[0].stopOrder).toBe(1);
    expect(result.notified[0].recipients).toBe(2);

    const notifsClient = await prisma.notification.findMany({
      where: { userId: clientWithParcel.id, type: 'stop_reached' }
    });
    expect(notifsClient).toHaveLength(1);
  });

  test('evaluateStopArrival idempotent : second passage sur mêmes positions ne crée pas de doublons', async () => {
    const existingBefore = await prisma.notification.count({
      where: { userId: { in: [clientWithParcel.id, clientNoParcel.id] }, type: 'stop_reached' }
    });

    const dLat = 30 / 111_320;
    const near1 = { latitude: 14.7919 + dLat, longitude: -16.9359, capturedAt: new Date(Date.now() - 30_000).toISOString() };
    const near2 = { latitude: 14.7919 + dLat * 0.6, longitude: -16.9359, capturedAt: new Date().toISOString() };

    await evaluateStopArrival(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId,
      advertisement: { id: advertisementId, transitLineId }
    }, [near1, near2]);

    const existingAfter = await prisma.notification.count({
      where: { userId: { in: [clientWithParcel.id, clientNoParcel.id] }, type: 'stop_reached' }
    });

    expect(existingAfter).toBe(existingBefore);
  });
});
