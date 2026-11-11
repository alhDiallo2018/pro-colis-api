import { jest } from '@jest/globals';

/**
 * Tests du notifier WhatsApp. Ne lance aucune requête HTTP réelle : `fetch`
 * est mocké globalement. Vérifie :
 *  - dégradation gracieuse quand pas configuré ;
 *  - rendu du payload template Meta ;
 *  - dégradation gracieuse si Meta répond en erreur ;
 *  - validation minimale du numéro E.164.
 *
 * La journalisation (persistence dispatches) est mockée pour éviter de
 * nécessiter une DB. Les tests dédiés vivent dans `whatsapp-journal.test.js`.
 */

jest.unstable_mockModule('../src/utils/whatsapp-journal.js', () => ({
  recordWhatsAppSend: jest.fn().mockResolvedValue(null),
  recordWhatsAppFailure: jest.fn().mockResolvedValue(null)
}));

const { buildTemplateMessage, isWhatsAppConfigured, sendWhatsAppTemplate, sendParcelStatusWhatsApp } =
  await import('../src/utils/whatsapp.js');

// Sauvegarde de l'env + fetch pour restauration après tests.
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('buildTemplateMessage', () => {
  test('construit un payload Meta Cloud conforme', () => {
    const payload = buildTemplateMessage({
      to: '221771234567',
      templateName: 'procolis_parcel_delivered',
      languageCode: 'fr',
      bodyParams: ['Awa', 'PC-ABC-123']
    });

    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.to).toBe('221771234567');
    expect(payload.template.name).toBe('procolis_parcel_delivered');
    expect(payload.template.language.code).toBe('fr');
    expect(payload.template.components).toHaveLength(1);
    expect(payload.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Awa' },
      { type: 'text', text: 'PC-ABC-123' }
    ]);
  });

  test('omet les components si bodyParams vide', () => {
    const payload = buildTemplateMessage({
      to: '221771234567',
      templateName: 'simple_template',
      bodyParams: []
    });
    expect(payload.template.components).toEqual([]);
  });
});

describe('isWhatsAppConfigured', () => {
  test('false quand access token absent', () => {
    delete process.env.META_WHATSAPP_ACCESS_TOKEN;
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    expect(isWhatsAppConfigured()).toBe(false);
  });

  test('false quand phone_number_id absent', () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    expect(isWhatsAppConfigured()).toBe(false);
  });

  test('true quand les deux variables sont renseignées', () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123';
    expect(isWhatsAppConfigured()).toBe(true);
  });
});

describe('sendWhatsAppTemplate', () => {
  test('retourne null sans appeler fetch si pas configuré', async () => {
    delete process.env.META_WHATSAPP_ACCESS_TOKEN;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await sendWhatsAppTemplate({
      phone: '+221771234567',
      templateName: 'procolis_parcel_delivered'
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('retourne null et log si numéro invalide', async () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123';
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await sendWhatsAppTemplate({
      phone: '12',
      templateName: 'procolis_parcel_delivered'
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('POST sur Meta Cloud API avec le payload attendu', async () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'secret-token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wa-abc' }] })
    });
    global.fetch = fetchMock;

    const result = await sendWhatsAppTemplate({
      phone: '+221 77 123 45 67',
      templateName: 'procolis_parcel_in_transit',
      bodyParams: ['PC-XYZ']
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/1234567890/messages');
    expect(options.headers.Authorization).toBe('Bearer secret-token');
    const body = JSON.parse(options.body);
    expect(body.to).toBe('221771234567'); // nettoyé
    expect(body.template.name).toBe('procolis_parcel_in_transit');
    expect(result.messages[0].id).toBe('wa-abc');
  });

  test('retourne null si Meta répond en erreur HTTP', async () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid template"}'
    });
    global.fetch = fetchMock;

    const result = await sendWhatsAppTemplate({
      phone: '+221771234567',
      templateName: 'procolis_parcel_delivered'
    });
    expect(result).toBeNull();
  });

  test('retourne null en cas de crash réseau', async () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await sendWhatsAppTemplate({
      phone: '+221771234567',
      templateName: 'procolis_parcel_delivered'
    });
    expect(result).toBeNull();
  });
});

describe('sendParcelStatusWhatsApp', () => {
  test('route le bon template selon le statut', async () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wa-1' }] })
    });
    global.fetch = fetchMock;

    await sendParcelStatusWhatsApp({
      phone: '+221771234567',
      trackingNumber: 'PC-1',
      status: 'out_for_delivery',
      recipientName: 'Awa'
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.template.name).toBe('procolis_parcel_out_for_delivery');
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Awa' },
      { type: 'text', text: 'PC-1' }
    ]);
  });

  test('retourne null pour un statut sans template', async () => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123';
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await sendParcelStatusWhatsApp({
      phone: '+221771234567',
      trackingNumber: 'PC-1',
      status: 'cancelled'
    });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
