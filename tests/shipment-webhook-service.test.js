import { jest } from '@jest/globals';

const findManyMock = jest.fn();
const enqueueMock = jest.fn().mockResolvedValue({ id: 'queued' });

jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    systemConfig: { findMany: findManyMock }
  }
}));

jest.unstable_mockModule('../src/utils/webhook-queue.js', () => ({
  enqueueWebhook: enqueueMock
}));

const { dispatchShipmentEvent, invalidatePartnersCache } = await import(
  '../src/utils/shipment-webhook-service.js'
);

afterEach(() => {
  findManyMock.mockReset();
  enqueueMock.mockReset().mockResolvedValue({ id: 'queued' });
  invalidatePartnersCache();
});

function buildParcel(overrides = {}) {
  return {
    trackingNumber: 'PC-WH-1',
    status: 'delivered',
    weight: 3.5,
    departureZone: { name: 'Dakar', city: 'Dakar' },
    arrivalZone: { name: 'Thiès', city: 'Thiès' },
    updatedAt: new Date('2026-11-11T13:00:00Z'),
    deliveryDate: new Date('2026-11-11T12:30:00Z'),
    estimatedDeliveryDate: new Date('2026-11-11T13:00:00Z'),
    pickupDate: new Date('2026-11-11T09:00:00Z'),
    ...overrides
  };
}

describe('dispatchShipmentEvent (file d\'attente persistante)', () => {
  test('retourne 0 enqueue si aucun partenaire configuré', async () => {
    findManyMock.mockResolvedValue([]);
    const r = await dispatchShipmentEvent({ type: 'shipment.updated', parcel: buildParcel() });
    expect(r).toEqual({ queued: 0, eligible: 0 });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  test('ignore les partenaires sans webhookUrl/secret', async () => {
    findManyMock.mockResolvedValue([
      {
        key: 'apiKeys.business.partner-A',
        value: { partnerName: 'A', scopes: ['shipments.read'] /* no webhookUrl */ }
      }
    ]);
    const r = await dispatchShipmentEvent({ type: 'shipment.updated', parcel: buildParcel() });
    expect(r).toEqual({ queued: 0, eligible: 0 });
  });

  test('ignore les partenaires inactifs', async () => {
    findManyMock.mockResolvedValue([
      {
        key: 'apiKeys.business.partner-A',
        value: {
          partnerName: 'A',
          webhookUrl: 'https://a.example.com/hook',
          webhookSecret: 'secret-1234567890',
          scopes: ['shipments.read'],
          active: false
        }
      }
    ]);
    const r = await dispatchShipmentEvent({ type: 'shipment.updated', parcel: buildParcel() });
    expect(r.queued).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  test('ignore les partenaires sans le scope requis', async () => {
    findManyMock.mockResolvedValue([
      {
        key: 'apiKeys.business.partner-A',
        value: {
          partnerName: 'A',
          webhookUrl: 'https://a.example.com/hook',
          webhookSecret: 'secret-1234567890',
          scopes: ['parcels.create']
        }
      }
    ]);
    const r = await dispatchShipmentEvent({
      type: 'shipment.updated',
      parcel: buildParcel(),
      requiredScope: 'shipments.read'
    });
    expect(r).toEqual({ queued: 0, eligible: 0 });
  });

  test('enqueue tous les partenaires éligibles', async () => {
    findManyMock.mockResolvedValue([
      {
        key: 'apiKeys.business.partner-A',
        value: {
          partnerName: 'A',
          webhookUrl: 'https://a.example.com/hook',
          webhookSecret: 'secret-1234567890',
          scopes: ['shipments.read']
        }
      },
      {
        key: 'apiKeys.business.partner-B',
        value: {
          partnerName: 'B',
          webhookUrl: 'https://b.example.com/hook',
          webhookSecret: 'secret-9876543210',
          scopes: ['shipments.read']
        }
      }
    ]);

    const r = await dispatchShipmentEvent({
      type: 'shipment.delivered',
      parcel: buildParcel()
    });

    expect(r).toEqual({ queued: 2, eligible: 2 });
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    const first = enqueueMock.mock.calls[0][0];
    expect(first.eventType).toBe('shipment.delivered');
    expect(first.payload.trackingNumber).toBe('PC-WH-1');
    expect(first.payload.status).toBe('delivered');
  });

  test('compte les enregistrements échoués sans jeter', async () => {
    findManyMock.mockResolvedValue([
      {
        key: 'apiKeys.business.partner-A',
        value: {
          partnerName: 'A',
          webhookUrl: 'https://a.example.com/hook',
          webhookSecret: 'secret-1234567890',
          scopes: ['shipments.read']
        }
      }
    ]);
    enqueueMock.mockResolvedValueOnce(null);
    const r = await dispatchShipmentEvent({
      type: 'shipment.updated',
      parcel: buildParcel()
    });
    expect(r).toEqual({ queued: 0, eligible: 1 });
  });

  test("retourne 0 si aucun type ou colis invalide", async () => {
    findManyMock.mockResolvedValue([]);
    expect(await dispatchShipmentEvent({ type: '', parcel: buildParcel() })).toEqual({ sent: 0, failed: 0 });
    expect(await dispatchShipmentEvent({ type: 'shipment.updated', parcel: null })).toEqual({ sent: 0, failed: 0 });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  test('tolère un crash de SystemConfig', async () => {
    findManyMock.mockRejectedValue(new Error('db down'));
    const r = await dispatchShipmentEvent({ type: 'shipment.updated', parcel: buildParcel() });
    expect(r).toEqual({ queued: 0, eligible: 0 });
  });
});
