import { jest } from '@jest/globals';

const findManyMock = jest.fn();

jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    systemConfig: { findMany: findManyMock }
  }
}));

const { readDriverScoringConfig, invalidateDriverScoringCache } = await import(
  '../src/utils/driver-scoring-config.js'
);
const { DRIVER_SCORING_DEFAULTS } = await import('../src/utils/driver-scoring.js');

beforeEach(() => {
  findManyMock.mockReset();
  invalidateDriverScoringCache();
});

describe('readDriverScoringConfig', () => {
  test('retourne les defaults quand rien en DB', async () => {
    findManyMock.mockResolvedValue([]);
    const cfg = await readDriverScoringConfig();
    expect(cfg.weightPrice).toBe(DRIVER_SCORING_DEFAULTS.weightPrice);
    expect(cfg.enabled).toBe(true);
  });

  test('override un poids partiellement', async () => {
    findManyMock.mockResolvedValue([
      { key: 'driverScoring.weightPrice', value: 0.5 }
    ]);
    const cfg = await readDriverScoringConfig();
    expect(cfg.weightPrice).toBe(0.5);
    expect(cfg.weightRating).toBe(DRIVER_SCORING_DEFAULTS.weightRating);
  });

  test('désactive via driverScoring.enabled=false', async () => {
    findManyMock.mockResolvedValue([{ key: 'driverScoring.enabled', value: false }]);
    const cfg = await readDriverScoringConfig();
    expect(cfg.enabled).toBe(false);
  });

  test('tolère un flag en string ("off")', async () => {
    findManyMock.mockResolvedValue([{ key: 'driverScoring.enabled', value: 'off' }]);
    const cfg = await readDriverScoringConfig();
    expect(cfg.enabled).toBe(false);
  });

  test('ignore une valeur non numérique silencieusement', async () => {
    findManyMock.mockResolvedValue([
      { key: 'driverScoring.maxDistanceKm', value: 'not-a-number' }
    ]);
    const cfg = await readDriverScoringConfig();
    expect(cfg.maxDistanceKm).toBe(DRIVER_SCORING_DEFAULTS.maxDistanceKm);
  });

  test('ignore les clés hors KEY_MAP', async () => {
    findManyMock.mockResolvedValue([
      { key: 'driverScoring.unknown', value: 42 },
      { key: 'driverScoring.weightPrice', value: 0.4 }
    ]);
    const cfg = await readDriverScoringConfig();
    expect(cfg).not.toHaveProperty('unknown');
    expect(cfg.weightPrice).toBe(0.4);
  });

  test('cache 10 s — une seule requête DB sur 3 appels', async () => {
    findManyMock.mockResolvedValue([{ key: 'driverScoring.weightPrice', value: 0.4 }]);
    await readDriverScoringConfig();
    await readDriverScoringConfig();
    await readDriverScoringConfig();
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  test('invalidateDriverScoringCache force une relecture', async () => {
    findManyMock.mockResolvedValueOnce([{ key: 'driverScoring.weightPrice', value: 0.4 }]);
    const first = await readDriverScoringConfig();
    expect(first.weightPrice).toBe(0.4);

    findManyMock.mockResolvedValueOnce([{ key: 'driverScoring.weightPrice', value: 0.6 }]);
    invalidateDriverScoringCache();
    const second = await readDriverScoringConfig();
    expect(second.weightPrice).toBe(0.6);
  });
});
