import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { buildIntegrationsHealth } from '../src/utils/integrations-health.js';
import { DHL_ADAPTER, FEDEX_ADAPTER, UPS_ADAPTER, carriersConfigurationReport } from '../src/utils/international-carriers-adapters.js';

describe('OPS-3 / SCP-042 — Health intégrations + adapters carriers', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('buildIntegrationsHealth : structure + flags sans fuite de valeurs', () => {
    const r = buildIntegrationsHealth();
    expect(['ok', 'degraded', 'fail']).toContain(r.status);
    expect(r.integrations.brevo).toHaveProperty('configured');
    expect(r.integrations.whatsapp).toHaveProperty('configured');
    expect(r.integrations.anthropic).toHaveProperty('configured');
    expect(r.integrations.paydunya).toHaveProperty('configured');
    expect(r.integrations.carriers.length).toBe(3);
    // Aucune valeur de secret ne doit fuiter.
    const asString = JSON.stringify(r);
    expect(asString).not.toMatch(/sk-ant-/);
    expect(asString).not.toMatch(/xkeysib-/);
  });

  test('GET /health/integrations renvoie le rapport', async () => {
    const res = await request(app).get('/api/v1/health/integrations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('integrations');
    expect(res.body).toHaveProperty('checkedAt');
  });

  test('adapters carriers : signature stable', () => {
    for (const adapter of [DHL_ADAPTER, FEDEX_ADAPTER, UPS_ADAPTER]) {
      expect(typeof adapter.carrier).toBe('string');
      expect(Array.isArray(adapter.envVars)).toBe(true);
      expect(adapter.envVars.length).toBeGreaterThanOrEqual(2);
      expect(typeof adapter.isConfigured).toBe('function');
      expect(typeof adapter.estimate).toBe('function');
    }
  });

  test('adapters non configurés : estimate retourne null', async () => {
    // Env vars volontairement vides → isConfigured false → null.
    const saved = {
      DHL_API_KEY: process.env.DHL_API_KEY,
      DHL_API_SECRET: process.env.DHL_API_SECRET,
      DHL_ACCOUNT_NUMBER: process.env.DHL_ACCOUNT_NUMBER
    };
    delete process.env.DHL_API_KEY;
    delete process.env.DHL_API_SECRET;
    delete process.env.DHL_ACCOUNT_NUMBER;
    expect(DHL_ADAPTER.isConfigured()).toBe(false);
    const r = await DHL_ADAPTER.estimate({ origin: 'SN', destination: 'FR', weightKg: 1 });
    expect(r).toBeNull();
    // Restore.
    for (const [k, v] of Object.entries(saved)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('adapters configurés mais non implémentés : estimate throws (V2)', async () => {
    process.env.DHL_API_KEY = 'x';
    process.env.DHL_API_SECRET = 'y';
    process.env.DHL_ACCOUNT_NUMBER = 'z';
    expect(DHL_ADAPTER.isConfigured()).toBe(true);
    await expect(DHL_ADAPTER.estimate({ origin: 'SN', destination: 'FR', weightKg: 1 })).rejects.toThrow(/V2/);
    delete process.env.DHL_API_KEY;
    delete process.env.DHL_API_SECRET;
    delete process.env.DHL_ACCOUNT_NUMBER;
  });

  test('carriersConfigurationReport : 3 entrées, pas de leak', () => {
    const r = carriersConfigurationReport();
    expect(r).toHaveLength(3);
    for (const c of r) {
      expect(c).toHaveProperty('carrier');
      expect(c).toHaveProperty('configured');
      expect(Array.isArray(c.missing)).toBe(true);
    }
  });
});
