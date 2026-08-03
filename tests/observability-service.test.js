import { jest } from '@jest/globals';
import {
  buildLogQuery,
  exportLogs,
  getLogs,
  getServices,
  normalizeLokiStreams,
  normalizeSeverity,
  parseObservabilityQuery
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
