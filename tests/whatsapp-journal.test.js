import { jest } from '@jest/globals';

const createMock = jest.fn();
const updateManyMock = jest.fn();
const countMock = jest.fn();

jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    whatsAppDispatch: {
      create: createMock,
      updateMany: updateManyMock,
      count: countMock
    }
  }
}));

const {
  recordWhatsAppSend,
  recordWhatsAppFailure,
  applyWhatsAppCallback,
  countWhatsAppStatuses
} = await import('../src/utils/whatsapp-journal.js');

afterEach(() => {
  createMock.mockReset();
  updateManyMock.mockReset();
  countMock.mockReset();
});

describe('recordWhatsAppSend', () => {
  test('ignore un result null (envoi non effectué)', async () => {
    const r = await recordWhatsAppSend(null, { phone: '221', templateName: 't' });
    expect(r).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('extrait le messageId du payload Meta', async () => {
    createMock.mockResolvedValue({ id: 'row' });
    const result = { messages: [{ id: 'wamid.abc' }] };
    await recordWhatsAppSend(result, {
      phone: '221701234567',
      templateName: 'procolis_parcel_delivered',
      parcelId: 'p1'
    });
    const { data } = createMock.mock.calls[0][0];
    expect(data).toMatchObject({
      messageId: 'wamid.abc',
      phone: '221701234567',
      templateName: 'procolis_parcel_delivered',
      parcelId: 'p1',
      status: 'sent'
    });
  });

  test('tolère un result sans messageId exploitable', async () => {
    createMock.mockResolvedValue({ id: 'row' });
    await recordWhatsAppSend({ messages: [] }, { phone: '221', templateName: 't' });
    const { data } = createMock.mock.calls[0][0];
    expect(data.messageId).toBeNull();
    expect(data.status).toBe('sent');
  });
});

describe('recordWhatsAppFailure', () => {
  test('persiste un envoi échoué avec reason', async () => {
    createMock.mockResolvedValue({ id: 'row' });
    await recordWhatsAppFailure({
      phone: '221',
      templateName: 't',
      reason: 'invalid_phone'
    });
    const { data } = createMock.mock.calls[0][0];
    expect(data).toMatchObject({
      status: 'failed',
      errorReason: 'invalid_phone'
    });
    expect(data.failedAt).toBeInstanceOf(Date);
  });
});

describe('applyWhatsAppCallback', () => {
  test('ignore un payload vide', async () => {
    const r = await applyWhatsAppCallback({});
    expect(r).toEqual({ updated: 0 });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  test('digère une transition delivered + read', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.a', status: 'delivered' },
                  { id: 'wamid.b', status: 'read' }
                ]
              }
            }
          ]
        }
      ]
    };
    const r = await applyWhatsAppCallback(payload);
    expect(r.updated).toBe(2);
    const firstCall = updateManyMock.mock.calls[0][0];
    expect(firstCall.where).toEqual({ messageId: 'wamid.a' });
    expect(firstCall.data.status).toBe('delivered');
    expect(firstCall.data.deliveredAt).toBeInstanceOf(Date);

    const secondCall = updateManyMock.mock.calls[1][0];
    expect(secondCall.where).toEqual({ messageId: 'wamid.b' });
    expect(secondCall.data.status).toBe('read');
    expect(secondCall.data.readAt).toBeInstanceOf(Date);
  });

  test('marque failed quand Meta signale un échec', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    await applyWhatsAppCallback({
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: 'wamid.x', status: 'failed' }] } }
          ]
        }
      ]
    });
    const { data } = updateManyMock.mock.calls[0][0];
    expect(data.status).toBe('failed');
    expect(data.failedAt).toBeInstanceOf(Date);
  });
});

describe('countWhatsAppStatuses', () => {
  test('compte sent/delivered/read depuis la DB', async () => {
    countMock
      .mockResolvedValueOnce(10) // sent
      .mockResolvedValueOnce(7) // delivered
      .mockResolvedValueOnce(4); // read
    const r = await countWhatsAppStatuses(new Date('2026-11-01'));
    expect(r).toEqual({ sent: 10, delivered: 7, read: 4 });
  });

  test('tolère un crash Prisma', async () => {
    countMock.mockRejectedValue(new Error('db down'));
    const r = await countWhatsAppStatuses(null);
    expect(r).toEqual({ sent: 0, delivered: 0, read: 0 });
  });
});
