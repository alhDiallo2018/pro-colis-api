import { jest } from '@jest/globals';

const findManyMock = jest.fn();

jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    systemConfig: { findMany: findManyMock }
  }
}));

const { readAnomalyConfig, invalidateAnomalyConfigCache } = await import(
  '../src/utils/anomaly-config.js'
);
const { ANOMALY_DEFAULTS } = await import('../src/utils/anomaly-detector.js');

beforeEach(() => {
  findManyMock.mockReset();
  invalidateAnomalyConfigCache();
});

describe('readAnomalyConfig', () => {
  test('defaults complets sans override', async () => {
    findManyMock.mockResolvedValue([]);
    const cfg = await readAnomalyConfig();
    expect(cfg.gpsSilenceMinutes).toBe(ANOMALY_DEFAULTS.gpsSilenceMinutes);
    expect(cfg.deviationThresholdKm).toBe(ANOMALY_DEFAULTS.deviationThresholdKm);
    expect(cfg.enabled).toBe(true);
  });

  test('override numérique : gpsSilenceMinutes=10', async () => {
    findManyMock.mockResolvedValue([
      { key: 'anomaly.gpsSilenceMinutes', value: 10 }
    ]);
    const cfg = await readAnomalyConfig();
    expect(cfg.gpsSilenceMinutes).toBe(10);
  });

  test('désactive via anomaly.enabled=false', async () => {
    findManyMock.mockResolvedValue([{ key: 'anomaly.enabled', value: false }]);
    const cfg = await readAnomalyConfig();
    expect(cfg.enabled).toBe(false);
  });

  test('tolère anomaly.enabled en string "0"', async () => {
    findManyMock.mockResolvedValue([{ key: 'anomaly.enabled', value: '0' }]);
    const cfg = await readAnomalyConfig();
    expect(cfg.enabled).toBe(false);
  });

  test('cache 10 s — une seule requête DB', async () => {
    findManyMock.mockResolvedValue([]);
    await readAnomalyConfig();
    await readAnomalyConfig();
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  test('ignore une valeur non numérique silencieusement', async () => {
    findManyMock.mockResolvedValue([
      { key: 'anomaly.stopRadiusMeters', value: 'wrong' }
    ]);
    const cfg = await readAnomalyConfig();
    expect(cfg.stopRadiusMeters).toBe(ANOMALY_DEFAULTS.stopRadiusMeters);
  });

  test('invalidateAnomalyConfigCache force une relecture', async () => {
    findManyMock.mockResolvedValueOnce([{ key: 'anomaly.gpsSilenceMinutes', value: 10 }]);
    const first = await readAnomalyConfig();
    expect(first.gpsSilenceMinutes).toBe(10);
    findManyMock.mockResolvedValueOnce([{ key: 'anomaly.gpsSilenceMinutes', value: 20 }]);
    invalidateAnomalyConfigCache();
    const second = await readAnomalyConfig();
    expect(second.gpsSilenceMinutes).toBe(20);
  });
});
