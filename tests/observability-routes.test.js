import { jest } from '@jest/globals';
import { authenticate } from '../src/middlewares/auth.middleware.js';
import { requireRoles } from '../src/middlewares/rbac.middleware.js';
import { ObservabilityUnavailableError } from '../src/utils/errors.js';

const getLogsMock = jest.fn();
const parseObservabilityQueryMock = jest.fn();

jest.unstable_mockModule('../src/modules/observability/observability.service.js', () => ({
  parseObservabilityQuery: parseObservabilityQueryMock,
  getLogs: getLogsMock,
  getSummary: jest.fn(),
  getServices: jest.fn(),
  exportLogs: jest.fn()
}));

const observabilityController = await import('../src/modules/observability/observability.controller.js');
const { observabilityRouter } = await import('../src/modules/observability/observability.routes.js');

function responseDouble() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn((status) => {
    res.statusCode = status;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

function requestDouble(role = 'super_admin') {
  return {
    query: {},
    headers: {},
    user: { id: '00000000-0000-4000-8000-000000000001', role, status: 'active' },
    requestId: '00000000-0000-4000-8000-000000000002',
    log: { error: jest.fn(), warn: jest.fn() }
  };
}

beforeEach(() => {
  parseObservabilityQueryMock.mockReset().mockReturnValue({});
  getLogsMock.mockReset().mockResolvedValue({
    logs: [{ id: 'entry-1', severity: 'error', source: 'api' }],
    page: { limit: 50, hasMore: false, nextCursor: null }
  });
});

describe('observability route security', () => {
  it('rejects a request without a bearer token before any database query', () => {
    const next = jest.fn();
    authenticate({ headers: {} }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('rejects support users because stacks are super-admin only', () => {
    const next = jest.fn();
    requireRoles('super_admin')(requestDouble('support'), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('allows a super admin through the role guard', () => {
    const next = jest.fn();
    requireRoles('super_admin')(requestDouble(), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('mounts the four documented read/export routes', () => {
    const paths = observabilityRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);
    expect(paths).toEqual(['/summary', '/logs', '/services', '/export']);
  });
});

describe('observability list controller', () => {
  it('returns normalized logs to a super admin', async () => {
    const req = requestDouble();
    const res = responseDouble();
    await observabilityController.list(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.page.hasMore).toBe(false);
  });

  it('returns a stable 503 envelope and logs the upstream failure', async () => {
    getLogsMock.mockRejectedValueOnce(new ObservabilityUnavailableError());
    const req = requestDouble();
    const res = responseDouble();
    await observabilityController.list(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error.code).toBe('OBSERVABILITY_UNAVAILABLE');
    expect(req.log.error).toHaveBeenCalled();
  });
});
