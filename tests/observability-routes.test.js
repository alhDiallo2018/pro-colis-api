import { jest } from '@jest/globals';
import { authenticate } from '../src/middlewares/auth.middleware.js';
import { requireRoles } from '../src/middlewares/rbac.middleware.js';
import { ObservabilityUnavailableError } from '../src/utils/errors.js';

const getLogsMock = jest.fn();
const parseObservabilityQueryMock = jest.fn();

const exportLogsMock = jest.fn();
// Marqueur volontairement distinct de la vraie redaction : le test de route
// verifie la delegation selon le role, pas le contenu masque, couvert par
// observability-service.test.js.
const redactEntriesForSupportMock = jest.fn((entries) =>
  entries.map((entry) => ({ id: entry.id, redacted: true }))
);

jest.unstable_mockModule('../src/modules/observability/observability.service.js', () => ({
  parseObservabilityQuery: parseObservabilityQueryMock,
  getLogs: getLogsMock,
  getSummary: jest.fn(),
  getServices: jest.fn(),
  exportLogs: exportLogsMock,
  OBSERVABILITY_FULL_ACCESS_ROLES: ['super_admin'],
  redactEntriesForSupport: redactEntriesForSupportMock
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
  redactEntriesForSupportMock.mockClear();
  exportLogsMock.mockReset();
  getLogsMock.mockReset().mockResolvedValue({
    logs: [
      {
        id: 'entry-1',
        severity: 'error',
        source: 'api',
        userId: 'user-1',
        context: { tenant: 'dakar' },
        error: { name: 'Error', code: 'INTERNAL_ERROR', message: 'boom', stack: 'at handler' }
      }
    ],
    page: { limit: 50, hasMore: false, nextCursor: null }
  });
});

describe('observability route security', () => {
  it('rejects a request without a bearer token before any database query', () => {
    const next = jest.fn();
    authenticate({ headers: {} }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('rejects the historic support role, which has no technical mandate', () => {
    const next = jest.fn();
    requireRoles('super_admin', 'support_technique')(requestDouble('support'), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('lets support_technique read but never export', () => {
    const readNext = jest.fn();
    requireRoles('super_admin', 'support_technique')(requestDouble('support_technique'), {}, readNext);
    expect(readNext).toHaveBeenCalledWith();

    const exportNext = jest.fn();
    requireRoles('super_admin')(requestDouble('support_technique'), {}, exportNext);
    expect(exportNext).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
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
    expect(res.body.logs[0].error.stack).toBe('at handler');
    expect(redactEntriesForSupportMock).not.toHaveBeenCalled();
    expect(res.body.page.hasMore).toBe(false);
  });

  it('redacts the entries served to support_technique but keeps the cursor page', async () => {
    const req = requestDouble('support_technique');
    const res = responseDouble();
    await observabilityController.list(req, res);
    expect(redactEntriesForSupportMock).toHaveBeenCalledTimes(1);
    expect(res.body.logs).toEqual([{ id: 'entry-1', redacted: true }]);
    expect(res.body.page).toEqual({ limit: 50, hasMore: false, nextCursor: null });
  });

  it('refuses an export to support_technique before querying Loki', async () => {
    const req = requestDouble('support_technique');
    const res = responseDouble();
    await observabilityController.exportEntries(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(exportLogsMock).not.toHaveBeenCalled();
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
