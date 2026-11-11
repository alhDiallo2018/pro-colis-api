import { jest } from '@jest/globals';

const createMock = jest.fn();
const findManyMock = jest.fn();
const updateMock = jest.fn();
const dispatchMock = jest.fn();

jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    webhookDelivery: {
      create: createMock,
      findMany: findManyMock,
      update: updateMock
    }
  }
}));

jest.unstable_mockModule('../src/utils/webhook-dispatcher.js', () => ({
  dispatchWebhook: dispatchMock
}));

const {
  enqueueWebhook,
  tickWebhookWorker,
  WEBHOOK_QUEUE_CONSTANTS
} = await import('../src/utils/webhook-queue.js');

afterEach(() => {
  createMock.mockReset();
  findManyMock.mockReset();
  updateMock.mockReset();
  dispatchMock.mockReset();
});

describe('enqueueWebhook', () => {
  test('rejette une URL invalide', async () => {
    const r = await enqueueWebhook({
      url: 'not-a-url',
      secret: 'longenoughsecret',
      eventType: 'x',
      payload: {}
    });
    expect(r).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('rejette un secret trop court', async () => {
    const r = await enqueueWebhook({
      url: 'https://x.example',
      secret: 'short',
      eventType: 'x',
      payload: {}
    });
    expect(r).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('persiste une tentative avec maxAttempts par défaut', async () => {
    createMock.mockResolvedValue({ id: 'row-1' });
    const r = await enqueueWebhook({
      partnerKeyId: 'p1',
      partnerName: 'Partner One',
      url: 'https://x.example/hook',
      secret: 'longenoughsecret',
      eventType: 'shipment.updated',
      payload: { foo: 'bar' }
    });
    expect(r).toEqual({ id: 'row-1' });
    const data = createMock.mock.calls[0][0].data;
    expect(data).toMatchObject({
      partnerKeyId: 'p1',
      partnerName: 'Partner One',
      url: 'https://x.example/hook',
      eventType: 'shipment.updated',
      maxAttempts: WEBHOOK_QUEUE_CONSTANTS.DEFAULT_MAX_ATTEMPTS
    });
  });

  test('tolère un crash de Prisma', async () => {
    createMock.mockRejectedValue(new Error('db down'));
    const r = await enqueueWebhook({
      url: 'https://x.example',
      secret: 'longenoughsecret',
      eventType: 'x',
      payload: {}
    });
    expect(r).toBeNull();
  });
});

describe('tickWebhookWorker', () => {
  const baseRow = {
    id: 'row-1',
    partnerKeyId: 'p1',
    partnerName: 'Partner One',
    url: 'https://x.example/hook',
    secret: 'longenoughsecret',
    eventType: 'shipment.updated',
    payload: { foo: 'bar' },
    attempts: 0,
    maxAttempts: 3,
    nextAttemptAt: new Date('2026-11-12T10:00:00Z')
  };

  test('livre avec succès : marque delivered et incrémente attempts', async () => {
    findManyMock.mockResolvedValue([{ ...baseRow }]);
    dispatchMock.mockResolvedValue({ ok: true, status: 200, error: null });

    const r = await tickWebhookWorker({ now: new Date('2026-11-12T10:01:00Z') });

    expect(r).toEqual({ processed: 1 });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: expect.objectContaining({
        status: 'delivered',
        attempts: 1,
        lastStatusCode: 200,
        lastError: null,
        deliveredAt: expect.any(Date)
      })
    });
  });

  test('échec non terminal : replanifie avec backoff exponentiel', async () => {
    findManyMock.mockResolvedValue([{ ...baseRow, attempts: 1 }]);
    dispatchMock.mockResolvedValue({ ok: false, status: 503, error: 'http_503' });

    await tickWebhookWorker();

    const update = updateMock.mock.calls[0][0];
    expect(update.data.status).toBe('pending');
    expect(update.data.attempts).toBe(2);
    expect(update.data.lastStatusCode).toBe(503);
    expect(update.data.lastError).toBe('http_503');
    expect(update.data.nextAttemptAt).toBeInstanceOf(Date);
    // Backoff exponentiel : attempt 2 → 2 × base = 1 min.
    const expectedMs = WEBHOOK_QUEUE_CONSTANTS.BACKOFF_BASE_MS * 2;
    const delta = update.data.nextAttemptAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(expectedMs - 1000);
    expect(delta).toBeLessThan(expectedMs + 1000);
  });

  test('échec terminal : marque la ligne dead', async () => {
    findManyMock.mockResolvedValue([{ ...baseRow, attempts: 2, maxAttempts: 3 }]);
    dispatchMock.mockResolvedValue({ ok: false, status: 500, error: 'http_500' });

    await tickWebhookWorker();

    expect(updateMock.mock.calls[0][0].data.status).toBe('dead');
    expect(updateMock.mock.calls[0][0].data.attempts).toBe(3);
  });

  test('ne traite rien si la queue est vide', async () => {
    findManyMock.mockResolvedValue([]);
    const r = await tickWebhookWorker();
    expect(r).toEqual({ processed: 0 });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('tolère un crash de la lecture Prisma', async () => {
    findManyMock.mockRejectedValue(new Error('db down'));
    const r = await tickWebhookWorker();
    expect(r).toEqual({ processed: 0 });
  });
});
