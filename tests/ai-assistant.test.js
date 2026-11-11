import { jest } from '@jest/globals';

const { askAssistant, parseAssistantResponse, isAiAssistantConfigured, AI_ASSISTANT_CONSTANTS } =
  await import('../src/utils/ai-assistant.js');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('isAiAssistantConfigured', () => {
  test('false sans ANTHROPIC_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiAssistantConfigured()).toBe(false);
  });

  test('true quand clé renseignée', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-xxx';
    expect(isAiAssistantConfigured()).toBe(true);
  });
});

describe('askAssistant — dégradation gracieuse', () => {
  test('retourne un answerText si pas configuré', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await askAssistant({ userMessage: 'Envoyer un colis à Thiès' });
    expect(r.intent).toBe('unknown');
    expect(r.answerText).toContain("assistant");
  });

  test('retourne un answerText si message vide', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-xxx';
    global.fetch = jest.fn();
    const r = await askAssistant({ userMessage: '   ' });
    expect(r.intent).toBe('unknown');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('tronque un prompt trop long et appelle fetch', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-xxx';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '{"intent":"unknown","draft":null,"trackingNumber":null,"answerText":"ok"}'
          }
        ]
      })
    });
    global.fetch = fetchMock;

    await askAssistant({ userMessage: 'A'.repeat(5000) });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userContent = body.messages[0].content;
    expect(userContent.length).toBeLessThan(5000);
  });

  test('retourne fallback en cas d\'erreur HTTP Claude', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-xxx';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error'
    });

    const r = await askAssistant({ userMessage: 'Envoyer un colis' });
    expect(r.intent).toBe('unknown');
    expect(r.answerText).toBeTruthy();
  });

  test("retourne fallback en cas d'erreur réseau", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-xxx';
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const r = await askAssistant({ userMessage: 'Envoyer un colis' });
    expect(r.intent).toBe('unknown');
    expect(r.answerText).toBeTruthy();
  });
});

describe('parseAssistantResponse', () => {
  test('parse un bloc text JSON strict', () => {
    const raw = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            intent: 'create_parcel',
            draft: {
              senderCity: 'Dakar',
              receiverCity: 'Thiès',
              receiverName: 'Awa Diop',
              receiverPhone: '+221771234567',
              weightKg: 5,
              type: 'package',
              isUrgent: false,
              notes: null
            },
            trackingNumber: null,
            answerText: 'Je prépare votre colis Dakar → Thiès.'
          })
        }
      ]
    };

    const r = parseAssistantResponse(raw);
    expect(r.intent).toBe('create_parcel');
    expect(r.draft.senderCity).toBe('Dakar');
    expect(r.draft.weightKg).toBe(5);
    expect(r.draft.type).toBe('package');
    expect(r.answerText).toContain('Dakar');
  });

  test('extrait le JSON même entouré de texte', () => {
    const raw = {
      content: [
        {
          type: 'text',
          text: 'Voici le JSON :\n{"intent":"faq","draft":null,"trackingNumber":null,"answerText":"Bonjour"}\nFin.'
        }
      ]
    };
    const r = parseAssistantResponse(raw);
    expect(r.intent).toBe('faq');
    expect(r.answerText).toBe('Bonjour');
  });

  test('fallback si aucun JSON détectable', () => {
    const raw = {
      content: [{ type: 'text', text: 'Pas de JSON ici, juste du texte libre.' }]
    };
    const r = parseAssistantResponse(raw);
    expect(r.intent).toBe('unknown');
    expect(r.answerText).toBeTruthy();
  });

  test('sanitize draft : rejette type inconnu, weightKg négatif', () => {
    const raw = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            intent: 'create_parcel',
            draft: {
              senderCity: 'Dakar',
              receiverCity: 'Thiès',
              receiverName: null,
              receiverPhone: null,
              weightKg: -3,
              type: 'nuclear_waste',
              isUrgent: 'not a bool',
              notes: ''
            },
            trackingNumber: null,
            answerText: 'OK'
          })
        }
      ]
    };
    const r = parseAssistantResponse(raw);
    expect(r.draft.weightKg).toBeNull();
    expect(r.draft.type).toBeNull();
    expect(r.draft.isUrgent).toBe(false);
    expect(r.draft.notes).toBeNull();
  });

  test('tolère un contenu Claude vide', () => {
    const r = parseAssistantResponse({ content: [] });
    expect(r.intent).toBe('unknown');
  });
});

describe('AI_ASSISTANT_CONSTANTS', () => {
  test('expose des limites raisonnables', () => {
    expect(AI_ASSISTANT_CONSTANTS.MAX_PROMPT_CHARS).toBeLessThanOrEqual(5000);
    expect(AI_ASSISTANT_CONSTANTS.MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(200);
    expect(AI_ASSISTANT_CONSTANTS.DEFAULT_MODEL).toContain('claude');
  });
});
