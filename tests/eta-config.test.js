import { jest } from '@jest/globals';

/**
 * Tests du reader de configuration ETA. Mocke `prisma.systemConfig.findMany`
 * pour éviter la DB. Vérifie :
 *  - les defaults quand aucune clé n'existe en base ;
 *  - l'override partiel d'une constante numérique ;
 *  - le flag `enabled` (true par défaut, désactivable via DB) ;
 *  - le cache 10 s et son invalidation explicite.
 */

const findManyMock = jest.fn();

// Mocke le client Prisma AVANT d'importer eta-config.
jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findMany: findManyMock
    }
  }
}));

const { readEtaConfig, invalidateEtaConfigCache } = await import('../src/utils/eta-config.js');
const { ETA_DEFAULTS } = await import('../src/utils/eta-calculator.js');

beforeEach(() => {
  findManyMock.mockReset();
  invalidateEtaConfigCache();
});

describe('readEtaConfig()', () => {
  test('retourne les defaults quand aucune clé eta.* n\'est en base', async () => {
    findManyMock.mockResolvedValue([]);
    const cfg = await readEtaConfig();
    expect(cfg.routeFactor).toBe(ETA_DEFAULTS.routeFactor);
    expect(cfg.defaultSpeedKmh).toBe(ETA_DEFAULTS.defaultSpeedKmh);
    expect(cfg.stalePositionMaxAgeSec).toBe(ETA_DEFAULTS.stalePositionMaxAgeSec);
    expect(cfg.enabled).toBe(true);
  });

  test('applique un override numérique partiel sans toucher aux autres', async () => {
    findManyMock.mockResolvedValue([
      { key: 'eta.routeFactor', value: 1.5 },
      { key: 'eta.defaultSpeedKmh', value: 30 }
    ]);
    const cfg = await readEtaConfig();
    expect(cfg.routeFactor).toBe(1.5);
    expect(cfg.defaultSpeedKmh).toBe(30);
    expect(cfg.minSpeedKmh).toBe(ETA_DEFAULTS.minSpeedKmh);
    expect(cfg.enabled).toBe(true);
  });

  test('désactive le calcul quand eta.enabled = false', async () => {
    findManyMock.mockResolvedValue([{ key: 'eta.enabled', value: false }]);
    const cfg = await readEtaConfig();
    expect(cfg.enabled).toBe(false);
  });

  test('tolère eta.enabled en string ("false", "0", "off")', async () => {
    for (const falsy of ['false', '0', 'off', 'no']) {
      findManyMock.mockResolvedValue([{ key: 'eta.enabled', value: falsy }]);
      invalidateEtaConfigCache();
      const cfg = await readEtaConfig();
      expect(cfg.enabled).toBe(false);
    }
  });

  test('tolère eta.enabled en string ("true", "1", "on")', async () => {
    for (const truthy of ['true', '1', 'on', 'yes']) {
      findManyMock.mockResolvedValue([{ key: 'eta.enabled', value: truthy }]);
      invalidateEtaConfigCache();
      const cfg = await readEtaConfig();
      expect(cfg.enabled).toBe(true);
    }
  });

  test('ignore silencieusement une valeur numérique invalide (retombe sur default)', async () => {
    findManyMock.mockResolvedValue([{ key: 'eta.routeFactor', value: 'not a number' }]);
    const cfg = await readEtaConfig();
    expect(cfg.routeFactor).toBe(ETA_DEFAULTS.routeFactor);
  });

  test('ignore les clés hors KEY_MAP (pas de pollution)', async () => {
    findManyMock.mockResolvedValue([
      { key: 'eta.unknownKnob', value: 42 },
      { key: 'eta.routeFactor', value: 1.4 }
    ]);
    const cfg = await readEtaConfig();
    expect(cfg).not.toHaveProperty('unknownKnob');
    expect(cfg.routeFactor).toBe(1.4);
  });

  test('met en cache la config et ne re-lit pas la DB dans la fenêtre 10 s', async () => {
    findManyMock.mockResolvedValue([{ key: 'eta.routeFactor', value: 1.4 }]);
    await readEtaConfig();
    await readEtaConfig();
    await readEtaConfig();
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  test('invalidateEtaConfigCache() force une relecture DB', async () => {
    findManyMock.mockResolvedValueOnce([{ key: 'eta.routeFactor', value: 1.4 }]);
    const first = await readEtaConfig();
    expect(first.routeFactor).toBe(1.4);

    findManyMock.mockResolvedValueOnce([{ key: 'eta.routeFactor', value: 1.6 }]);
    invalidateEtaConfigCache();
    const second = await readEtaConfig();
    expect(second.routeFactor).toBe(1.6);
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });
});
