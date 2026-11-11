import { jest } from '@jest/globals';

const findManyMock = jest.fn();
const createManyMock = jest.fn();
const groupByMock = jest.fn();

jest.unstable_mockModule('../src/config/prisma.js', () => ({
  prisma: {
    anomalyEvent: {
      findMany: findManyMock,
      createMany: createManyMock,
      groupBy: groupByMock
    }
  }
}));

const { journalizeAnomalies, countAnomaliesSince } = await import(
  '../src/utils/anomaly-journal.js'
);

afterEach(() => {
  findManyMock.mockReset();
  createManyMock.mockReset();
  groupByMock.mockReset();
});

describe('journalizeAnomalies', () => {
  test('ne fait rien si la liste de findings est vide', async () => {
    const r = await journalizeAnomalies({ parcelId: 'p1', findings: [] });
    expect(r).toEqual({ persisted: 0 });
    expect(createManyMock).not.toHaveBeenCalled();
  });

  test('persiste les findings normalisés snake_case → camelCase', async () => {
    findManyMock.mockResolvedValue([]);
    createManyMock.mockResolvedValue({ count: 2 });
    const r = await journalizeAnomalies({
      parcelId: 'p1',
      findings: [
        { type: 'gps_silence', severity: 'warning', details: { silenceMinutes: 20 } },
        { type: 'prolonged_stop', severity: 'warning', details: {} }
      ]
    });
    expect(r).toEqual({ persisted: 2 });
    const { data } = createManyMock.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ parcelId: 'p1', type: 'gpsSilence', severity: 'warning' });
    expect(data[1]).toMatchObject({ parcelId: 'p1', type: 'prolongedStop' });
  });

  test('déduplique un finding déjà signalé dans la fenêtre récente', async () => {
    findManyMock.mockResolvedValue([{ type: 'gpsSilence' }]);
    createManyMock.mockResolvedValue({ count: 1 });
    const r = await journalizeAnomalies({
      parcelId: 'p1',
      findings: [
        { type: 'gps_silence', severity: 'warning' },
        { type: 'route_deviation', severity: 'critical' }
      ]
    });
    expect(r).toEqual({ persisted: 1 });
    const { data } = createManyMock.mock.calls[0][0];
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('routeDeviation');
  });

  test('tolère un crash lors de la journalisation', async () => {
    findManyMock.mockResolvedValue([]);
    createManyMock.mockRejectedValue(new Error('table missing'));
    const r = await journalizeAnomalies({
      parcelId: 'p1',
      findings: [{ type: 'gps_silence' }]
    });
    expect(r).toEqual({ persisted: 0 });
  });
});

describe('countAnomaliesSince', () => {
  test('retourne un dict rempli à partir du groupBy', async () => {
    groupByMock.mockResolvedValue([
      { type: 'gpsSilence', _count: 4 },
      { type: 'prolongedStop', _count: 2 },
      { type: 'routeDeviation', _count: 1 }
    ]);
    const r = await countAnomaliesSince(new Date('2026-11-01'));
    expect(r).toEqual({ gpsSilence: 4, prolongedStop: 2, routeDeviation: 1 });
  });

  test('retourne un dict à zéro si la table est vide', async () => {
    groupByMock.mockResolvedValue([]);
    const r = await countAnomaliesSince(null);
    expect(r).toEqual({ gpsSilence: 0, prolongedStop: 0, routeDeviation: 0 });
  });

  test('tolère un crash Prisma', async () => {
    groupByMock.mockRejectedValue(new Error('db down'));
    const r = await countAnomaliesSince(new Date());
    expect(r).toEqual({ gpsSilence: 0, prolongedStop: 0, routeDeviation: 0 });
  });
});
