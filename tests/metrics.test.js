import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

const token = 'test-metrics-token-with-at-least-32-characters';
process.env.METRICS_TOKEN = token;

const { metricsHandler, metricsMiddleware } = await import('../src/observability/metrics.js');

function responseDouble() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.status = jest.fn((status) => {
    res.statusCode = status;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn((name, value) => {
    res.headers[name.toLowerCase()] = value;
  });
  res.send = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('internal Prometheus metrics', () => {
  it('rejects requests without the dedicated bearer token', async () => {
    const response = responseDouble();
    await metricsHandler({ headers: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns Prometheus text with the correct token', async () => {
    const measuredResponse = responseDouble();
    metricsMiddleware(
      { path: '/health', route: { path: '/health' }, baseUrl: '/api/v1', method: 'GET' },
      measuredResponse,
      jest.fn()
    );
    measuredResponse.emit('finish');

    const response = responseDouble();
    await metricsHandler({ headers: { authorization: `Bearer ${token}` } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('procolis_http_requests_total');
    expect(response.body).toContain('procolis_process_');
  });
});

afterAll(() => {
  delete process.env.METRICS_TOKEN;
  jest.restoreAllMocks();
});
