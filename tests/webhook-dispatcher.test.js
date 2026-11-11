import { jest } from '@jest/globals';

const { signWebhook, verifyWebhook, dispatchWebhook, WEBHOOK_CONSTANTS } = await import(
  '../src/utils/webhook-dispatcher.js'
);

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('signWebhook / verifyWebhook', () => {
  test('signe un payload et le vérifie en round-trip', () => {
    const payload = JSON.stringify({ event: 'shipment.updated', id: 'PC-1' });
    const ts = 1700000000000;
    const sig = signWebhook(payload, 'secret-123', ts);
    expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(verifyWebhook(payload, 'secret-123', sig, { now: ts })).toBe(true);
  });

  test('rejette une signature avec mauvais secret', () => {
    const payload = '{"a":1}';
    const sig = signWebhook(payload, 'secret-A', 1700000000000);
    expect(verifyWebhook(payload, 'secret-B', sig, { now: 1700000000000 })).toBe(false);
  });

  test('rejette une signature trop ancienne (> 5 min)', () => {
    const payload = '{"a":1}';
    const sig = signWebhook(payload, 'secret', 1700000000000);
    expect(verifyWebhook(payload, 'secret', sig, { now: 1700000000000 + 10 * 60 * 1000 })).toBe(false);
  });

  test('rejette une signature malformée', () => {
    expect(verifyWebhook('{}', 'secret', 'not-a-signature')).toBe(false);
    expect(verifyWebhook('{}', 'secret', undefined)).toBe(false);
  });
});

describe('dispatchWebhook', () => {
  test('refuse une URL invalide', async () => {
    const r = await dispatchWebhook({
      url: 'ftp://invalid',
      secret: 'secret-123',
      eventType: 'shipment.updated',
      data: {}
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
  });

  test('refuse un secret trop court', async () => {
    const r = await dispatchWebhook({
      url: 'https://partner.example.com/hook',
      secret: 'x',
      eventType: 'shipment.updated',
      data: {}
    });
    expect(r.ok).toBe(false);
  });

  test('POST sur partenaire avec headers signés', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    const r = await dispatchWebhook({
      url: 'https://partner.example.com/hook',
      secret: 'super-secret-123',
      eventType: 'shipment.delivered',
      data: { trackingNumber: 'PC-1' }
    });

    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://partner.example.com/hook');
    expect(options.method).toBe('POST');
    expect(options.headers[WEBHOOK_CONSTANTS.SIGNATURE_HEADER]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(options.headers[WEBHOOK_CONSTANTS.EVENT_HEADER]).toBe('shipment.delivered');
    const body = JSON.parse(options.body);
    expect(body.event).toBe('shipment.delivered');
    expect(body.data.trackingNumber).toBe('PC-1');
  });

  test('retourne ok=false si partenaire répond en erreur', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await dispatchWebhook({
      url: 'https://partner.example.com/hook',
      secret: 'super-secret-123',
      eventType: 'shipment.updated',
      data: {}
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
  });

  test('retourne ok=false en cas de crash réseau', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const r = await dispatchWebhook({
      url: 'https://partner.example.com/hook',
      secret: 'super-secret-123',
      eventType: 'shipment.updated',
      data: {}
    });
    expect(r.ok).toBe(false);
  });
});
