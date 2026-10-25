import { jest } from '@jest/globals';
import {
  buildLogQuery,
  exportLogs,
  getLogs,
  getServices,
  getSummary,
  normalizeLokiStreams,
  normalizeSeverity,
  parseObservabilityQuery,
  redactEntriesForSupport,
  redactEntryForSupport
} from '../src/modules/observability/observability.service.js';
import { sanitizeForLog } from '../src/config/logger.js';

const from = new Date('2026-08-02T00:00:00.000Z');
const to = new Date('2026-08-02T01:00:00.000Z');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('observability query validation', () => {
  it('rejects unknown sources and ranges longer than fourteen days', () => {
    expect(() => parseObservabilityQuery({ source: 'filesystem' })).toThrow('Filtres d observabilite invalides');
    expect(() => parseObservabilityQuery({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-02T00:00:00.000Z'
    })).toThrow('Filtres d observabilite invalides');
  });

  it('builds a fixed selector and keeps user text inside a literal filter', () => {
    const query = buildLogQuery({
      source: 'api',
      levels: ['error', 'critical'],
      q: 'failure" } |~ ".*',
      requestId: 'request-123'
    });

    expect(query).toBe(
      '{environment="production",service="api",severity=~"error|critical"}'
      + ' |= "failure\\" } |~ \\".*" | json | requestId="request-123"'
    );
  });

  it('limits exports to twenty four hours', () => {
    expect(() => parseObservabilityQuery({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-02T00:00:01.000Z',
      format: 'csv'
    }, { exportMode: true })).toThrow('Filtres d observabilite invalides');
  });
});

describe('observability normalization', () => {
  it('maps Pino and PostgreSQL levels to the public severity vocabulary', () => {
    expect(normalizeSeverity(undefined, 60)).toBe('critical');
    expect(normalizeSeverity('PANIC')).toBe('emergency');
    expect(normalizeSeverity('warn')).toBe('warning');
    expect(normalizeSeverity(undefined, 'error')).toBe('error');
    expect(normalizeSeverity('50')).toBe('error');
  });

  it('normalizes Loki streams and redacts secrets while preserving diagnostic codes', () => {
    const payload = {
      data: {
        resultType: 'streams',
        result: [{
          stream: { service: 'api', environment: 'production', severity: 'error' },
          values: [[
            '1785630608000000000',
            JSON.stringify({
              level: 50,
              msg: 'Database write failed',
              requestId: 'request-123',
              token: 'top-secret',
              error: { name: 'PrismaError', code: 'P2002', message: 'Duplicate' }
            })
          ]]
        }]
      }
    };

    const [entry] = normalizeLokiStreams(payload);
    expect(entry.source).toBe('api');
    expect(entry.severity).toBe('error');
    expect(entry.error.code).toBe('P2002');
    expect(entry.context.token).toBe('[REDACTED]');
  });

  it('redacts a verification code but preserves a nested error code', () => {
    expect(sanitizeForLog({ body: { code: '123456' }, error: { code: 'P2025' } })).toEqual({
      body: { code: '[REDACTED]' },
      error: { code: 'P2025' }
    });
  });

  it('redacts bearer tokens, JWTs and database passwords embedded in strings', () => {
    const sanitized = sanitizeForLog({
      message: 'Authorization: Bearer abc.def-123',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      database: 'postgresql://user:plain-password@postgres:5432/procolis'
    });
    expect(sanitized.message).toContain('Bearer [REDACTED]');
    expect(sanitized.jwt).toBe('[REDACTED_JWT]');
    expect(sanitized.database).toContain('user:[REDACTED]@postgres');

    const error = new Error('Request failed with Bearer abc.def.ghi');
    error.code = 'UPSTREAM_FAILURE';
    expect(sanitizeForLog(error)).toMatchObject({
      message: 'Request failed with Bearer [REDACTED]',
      code: 'UPSTREAM_FAILURE'
    });
  });

  it('redacts contact and location data from structured log context', () => {
    expect(sanitizeForLog({
      phone: '771234567',
      senderEmail: 'sender@example.com',
      receiverAddress: 'Dakar Plateau',
      profile: { fullName: 'Awa Diop', latitude: 14.7, longitude: -17.4 },
      message: 'Contact admin@example.com or +221 77 123 45 67'
    })).toEqual({
      phone: '[REDACTED]',
      senderEmail: '[REDACTED]',
      receiverAddress: '[REDACTED]',
      profile: {
        fullName: '[REDACTED]',
        latitude: '[REDACTED]',
        longitude: '[REDACTED]'
      },
      message: 'Contact [REDACTED_EMAIL] or [REDACTED_PHONE]'
    });
  });
});

describe('observability upstream clients', () => {
  it('keeps summary counters and latest entry scoped to the requested search', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const query = url.searchParams.get('query');
      let data = { resultType: 'vector', result: [] };
      if (url.pathname.endsWith('query_range')) data = { resultType: 'streams', result: [] };
      else if (query.includes('sum by (severity)')) data.result = [{ metric: { severity: 'error' }, value: [1, '3'] }];
      else if (query.includes('sum by (service)')) data.result = [{ metric: { service: 'api' }, value: [1, '3'] }];
      return { ok: true, json: async () => ({ status: 'success', data }) };
    });
    const summary = await getSummary({ source: 'api', levels: ['error'], q: 'failure', requestId: 'request-123', from, to });
    expect(summary.total).toBe(3);
    expect(summary.bySource).toEqual({ api: 3 });
    const queries = global.fetch.mock.calls.map(([url]) => url.searchParams.get('query'));
    for (const query of queries.filter((query) => query.includes('count_over_time'))) {
      expect(query).toContain('severity=~"error"');
      expect(query).toContain('|= "failure"');
      expect(query).toContain('requestId="request-123"');
      expect(query).toContain('__error__=""');
    }
  });

  it('keeps nanosecond order and resumes without skipping entries in the same millisecond', async () => {
    // Toutes les entrees ont le meme ISO public en millisecondes : la seconde
    // page doit pourtant recuperer les nanosecondes precedant le curseur.
    const values = Array.from({ length: 24 }, (_, index) => [
      (1785630608000000000n + BigInt(index + 1)).toString(), JSON.stringify({ msg: `entry-${index}` })
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const end = BigInt(url.searchParams.get('end'));
      const limit = Number(url.searchParams.get('limit'));
      return { ok: true, json: async () => ({ data: { resultType: 'streams', result: [{
        stream: { service: 'api' },
        values: values.filter(([time]) => BigInt(time) <= end).reverse().slice(0, limit)
      }] } }) };
    });
    const filters = { from, to, limit: 20 };
    const first = await getLogs(filters);
    expect(first.logs.map((entry) => entry.message)).toEqual(values.slice(4).reverse().map(([, line]) => JSON.parse(line).msg));
    const cursor = JSON.parse(Buffer.from(first.page.nextCursor, 'base64url').toString());
    const second = await getLogs({ ...filters, cursor });
    expect(second.logs.map((entry) => entry.message)).toEqual(['entry-3', 'entry-2', 'entry-1', 'entry-0']);
    expect(second.page.hasMore).toBe(false);
    expect(global.fetch.mock.calls[1][0].searchParams.get('end')).toBe(cursor.timestamp);
  });

  it('normalizes Caddy request fields and preserves zero duration', () => {
    const payload = { data: { resultType: 'streams', result: [{ stream: { service: 'caddy' }, values: [
      ['1785630608000000000', JSON.stringify({ level: 'error', msg: 'request failed', status: 502,
        request: { method: 'GET', uri: '/health' }, duration: 0.125 })],
      ['1785630607000000000', JSON.stringify({ durationMs: 0, responseTime: 20, msg: 'cached' })]
    ] }] } };
    const [caddy, cached] = normalizeLokiStreams(payload);
    expect(caddy).toMatchObject({ severity: 'error', route: '/health', method: 'GET', statusCode: 502, durationMs: 125 });
    expect(cached.durationMs).toBe(0);
  });

  it('reports invalid upstream data as unavailable instead of a false empty list', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'error' }) });
    await expect(getLogs({ from, to, limit: 20 })).rejects.toMatchObject({ code: 'OBSERVABILITY_UNAVAILABLE' });
    await expect(getSummary({ from, to, limit: 20 })).rejects.toMatchObject({ code: 'OBSERVABILITY_UNAVAILABLE' });
  });

  it('queries Loki and returns normalized logs', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          resultType: 'streams',
          result: [{
            stream: { service: 'postgres', environment: 'production', severity: 'error' },
            values: [['1785630608000000000', '{"severity":"ERROR","message":"constraint failed"}']]
          }]
        }
      })
    });

    const result = await getLogs({
      source: 'postgres', levels: [], from, to, limit: 20, cursor: null
    });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({ source: 'postgres', severity: 'error' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toContain('/loki/api/v1/query_range');
  });

  it('maps Prometheus up metrics to the expected service list', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            { metric: { service: 'api' }, value: [1, '1'] },
            { metric: { service: 'postgres' }, value: [1, '0'] },
            { metric: { service: 'caddy' }, value: [1, '1'] }
          ]
        }
      })
    });

    const services = await getServices();
    expect(services.find((service) => service.service === 'api').status).toBe('healthy');
    expect(services.find((service) => service.service === 'postgres').status).toBe('unavailable');
    expect(services.find((service) => service.service === 'loki').status).toBe('unavailable');
  });

  it('neutralizes spreadsheet formulas in CSV exports', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          resultType: 'streams',
          result: [{
            stream: { service: 'api', environment: 'production', severity: 'error' },
            values: [['1785630608000000000', '{"severity":"error","message":"=HYPERLINK(\\"https://invalid\\")"}']]
          }]
        }
      })
    });

    const exported = await exportLogs({
      source: 'api', levels: [], from, to, limit: 50, cursor: null, format: 'csv'
    });
    expect(exported.content).toContain("'=HYPERLINK");
    expect(exported.count).toBe(1);
  });
});

describe('support redaction', () => {
  const entry = {
    id: 'entry-1',
    timestamp: '2026-08-02T00:15:08.000Z',
    severity: 'error',
    source: 'api',
    message: 'Unhandled API error',
    requestId: 'req-1',
    route: '/api/v1/parcels',
    method: 'GET',
    statusCode: 500,
    durationMs: 42,
    userId: 'a3f0c1e2-0000-4000-8000-000000000001',
    error: { name: 'PrismaClientKnownRequestError', code: 'P2002', message: 'unique constraint', stack: 'at handler' },
    context: { parcelId: 'p-1' }
  };

  it('keeps the triage fields a support agent needs', () => {
    const redacted = redactEntryForSupport(entry);
    expect(redacted).toMatchObject({
      id: 'entry-1',
      severity: 'error',
      source: 'api',
      message: 'Unhandled API error',
      requestId: 'req-1',
      route: '/api/v1/parcels',
      statusCode: 500,
      redacted: true
    });
    expect(redacted.error).toEqual({ name: 'PrismaClientKnownRequestError', code: 'P2002' });
  });

  it('drops the stack, the free-form context and the impacted user', () => {
    const redacted = redactEntryForSupport(entry);
    expect(redacted.error.stack).toBeUndefined();
    expect(redacted.error.message).toBeUndefined();
    expect(redacted.context).toBeUndefined();
    expect(redacted.userId).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain('at handler');
    expect(JSON.stringify(redacted)).not.toContain('p-1');
  });

  it('leaves an entry without error object intact', () => {
    const [redacted] = redactEntriesForSupport([{ id: 'entry-2', severity: 'info', message: 'started' }]);
    expect(redacted).toEqual({ id: 'entry-2', severity: 'info', message: 'started', error: undefined, redacted: true });
  });

  it('does not mutate the source entry', () => {
    redactEntryForSupport(entry);
    expect(entry.error.stack).toBe('at handler');
    expect(entry.context).toEqual({ parcelId: 'p-1' });
  });
});
