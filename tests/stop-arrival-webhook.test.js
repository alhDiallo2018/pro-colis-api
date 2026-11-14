import { prisma } from '../src/config/prisma.js';
import { registerPublic, cleanupUsers } from './helpers.js';
import { evaluateStopArrival, dispatchStopReachedWebhooks } from '../src/modules/trips/stop-arrival.service.js';
import { invalidatePartnersCache } from '../src/utils/shipment-webhook-service.js';

describe('SCP-021 — webhook partenaires stop_reached', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  const zoneIds = [];
  let driver;
  let client;
  let advertisementId;
  let transitLineId;
  let vehicleId;
  let dakarZone;
  let thiesZone;
  let partnerConfigKey;

  beforeAll(async () => {
    for (const [prefix, role] of [['86', 'driver'], ['87', 'client']]) {
      const r = await registerPublic(`${prefix}${suffix}WH`, `Wh ${prefix}`, role);
      expect(r.status).toBe(201);
      userIds.push(r.body.user.id);
      const account = { id: r.body.user.id, token: r.body.accessToken };
      if (role === 'driver') driver = account;
      else client = account;
    }
    await prisma.user.update({ where: { id: driver.id }, data: { isVerified: true } });

    dakarZone = await prisma.zone.create({ data: { name: `Dakar wh ${suffix}`, placeId: `wh-dakar-${suffix}`, latitude: 14.6937, longitude: -17.4441, radiusKm: 2 } });
    thiesZone = await prisma.zone.create({ data: { name: `Thies wh ${suffix}`, placeId: `wh-thies-${suffix}`, latitude: 14.7919, longitude: -16.9359, radiusKm: 2 } });
    zoneIds.push(dakarZone.id, thiesZone.id);

    const line = await prisma.transitLine.create({
      data: {
        operator: 'ddd',
        number: `W${suffix}`,
        direction: 'aller',
        name: `Wh ${suffix}`,
        origin: 'Dakar',
        destination: 'Thies',
        stops: {
          create: [
            { order: 0, zoneId: dakarZone.id, label: 'Dakar' },
            { order: 1, zoneId: thiesZone.id, label: 'Thies' }
          ]
        }
      }
    });
    transitLineId = line.id;

    const vehicle = await prisma.vehicle.create({
      data: { driverId: driver.id, type: 'bus', model: `Bus wh ${suffix}`, plateNumber: `DK${suffix}W`, capacity: 25 }
    });
    vehicleId = vehicle.id;

    const ad = await prisma.advertisement.create({
      data: { driverId: driver.id, transitLineId, departureCity: 'Dakar', arrivalCity: 'Thies', status: 'open' }
    });
    advertisementId = ad.id;

    const parcel = await prisma.parcel.create({
      data: {
        senderId: client.id,
        senderName: 'B2B',
        senderPhone: `87${suffix}`,
        description: 'Colis webhook',
        weight: 2,
        departureZoneId: dakarZone.id,
        arrivalZoneId: thiesZone.id,
        receiverName: 'Dest',
        receiverPhone: `77800${suffix.slice(-3)}`,
        receiverAddress: 'Thies',
        trackingNumber: `WH${suffix}`,
        status: 'free'
      }
    });
    parcelIds.push(parcel.id);

    await prisma.advertisementOffer.create({
      data: {
        advertisementId,
        clientId: client.id,
        parcelId: parcel.id,
        price: 3000,
        status: 'accepted',
        boardingStopOrder: 0,
        dropOffStopOrder: 1,
        respondedAt: new Date()
      }
    });

    // Partenaire e-commerce actif avec le scope shipments.read et webhookUrl.
    partnerConfigKey = `apiKeys.business.partner-wh-${suffix}`;
    await prisma.systemConfig.create({
      data: {
        key: partnerConfigKey,
        value: {
          partnerName: `Partenaire Wh ${suffix}`,
          webhookUrl: 'https://example.invalid/webhook',
          webhookSecret: 'secret-test',
          scopes: ['shipments.read'],
          active: true
        }
      }
    });
    invalidatePartnersCache();
  });

  afterAll(async () => {
    await prisma.webhookDelivery.deleteMany({ where: { partnerKeyId: partnerConfigKey.replace('apiKeys.business.', '') } });
    await prisma.systemConfig.deleteMany({ where: { key: partnerConfigKey } });
    invalidatePartnersCache();
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

  test('dispatchStopReachedWebhooks : enqueue un webhook pour chaque parcel au stop ciblé', async () => {
    const dispatched = await dispatchStopReachedWebhooks(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId
    }, { order: 1, label: 'Thies', zoneId: thiesZone.id, distanceMeters: 150 });
    expect(dispatched).toBe(1);

    const queued = await prisma.webhookDelivery.findMany({
      where: { partnerKeyId: partnerConfigKey.replace('apiKeys.business.', ''), eventType: 'stop_reached' }
    });
    expect(queued.length).toBeGreaterThanOrEqual(1);
    // Le payload inclut le tracking + les champs stop_reached.
    const payload = queued[0].payload;
    expect(payload.trackingNumber).toBe(`WH${suffix}`);
    expect(payload.stopOrder).toBe(1);
    expect(payload.stopLabel).toBe('Thies');
    expect(payload.distanceMeters).toBe(150);
    expect(payload.advertisementId).toBe(advertisementId);
  });

  test('pipeline complet evaluateStopArrival déclenche le webhook', async () => {
    // Clean les events pour garantir un nouveau déclenchement.
    await prisma.journeyStopEvent.deleteMany({ where: { advertisementId } });
    await prisma.webhookDelivery.deleteMany({ where: { partnerKeyId: partnerConfigKey.replace('apiKeys.business.', '') } });

    const dLat = 30 / 111_320;
    const near1 = { latitude: 14.7919 + dLat, longitude: -16.9359, capturedAt: new Date(Date.now() - 60_000).toISOString() };
    const near2 = { latitude: 14.7919 + dLat * 0.6, longitude: -16.9359, capturedAt: new Date().toISOString() };

    const res = await evaluateStopArrival(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId,
      advertisement: { id: advertisementId, transitLineId }
    }, [near1, near2]);

    expect(res.reached).toHaveLength(1);
    expect(res.reached[0].order).toBe(1);
    expect(res.webhooksQueued).toHaveLength(1);
    expect(res.webhooksQueued[0].queued).toBe(1);

    const queued = await prisma.webhookDelivery.findMany({ where: { eventType: 'stop_reached' } });
    expect(queued.length).toBeGreaterThanOrEqual(1);
  });

  test('aucun partenaire : pas d\'erreur, pas de webhook (non bloquant)', async () => {
    // Désactive temporairement le partenaire.
    await prisma.systemConfig.update({
      where: { key: partnerConfigKey },
      data: { value: { partnerName: 'Off', webhookUrl: 'https://x.invalid', webhookSecret: 's', scopes: ['shipments.read'], active: false } }
    });
    invalidatePartnersCache();
    await prisma.webhookDelivery.deleteMany({ where: { partnerKeyId: partnerConfigKey.replace('apiKeys.business.', '') } });

    const r = await dispatchStopReachedWebhooks(prisma, {
      advertisementId,
      driverId: driver.id,
      vehicleId
    }, { order: 1, label: 'Thies', zoneId: thiesZone.id, distanceMeters: 150 });
    expect(r).toBe(0);
    const queued = await prisma.webhookDelivery.findMany({ where: { eventType: 'stop_reached' } });
    expect(queued).toHaveLength(0);

    // Réactive pour les tests suivants.
    await prisma.systemConfig.update({
      where: { key: partnerConfigKey },
      data: { value: { partnerName: `Partenaire Wh ${suffix}`, webhookUrl: 'https://example.invalid/webhook', webhookSecret: 'secret-test', scopes: ['shipments.read'], active: true } }
    });
    invalidatePartnersCache();
  });
});
