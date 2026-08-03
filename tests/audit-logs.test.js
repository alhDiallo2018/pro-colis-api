import { jest } from '@jest/globals';
import { requireRoles } from '../src/middlewares/rbac.middleware.js';
import { serializeAuditLog } from '../src/utils/mobile-serializers.js';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  actorId: '22222222-2222-4222-8222-222222222222',
  actorRole: 'super_admin',
  actor: {
    id: '22222222-2222-4222-8222-222222222222',
    fullName: 'Awa Diop',
    phone: '+221770000000',
    role: 'super_admin'
  },
  action: 'wallet.withdrawal.approve',
  entityType: 'withdrawal',
  entityId: '33333333-3333-4333-8333-333333333333',
  beforeData: { status: 'pending', amount: 125000 },
  afterData: { status: 'approved', amount: 125000 },
  ipAddress: '41.82.0.1',
  userAgent: 'Mozilla/5.0',
  requestId: '44444444-4444-4444-8444-444444444444',
  createdAt: new Date('2026-08-02T10:00:00.000Z')
};

function requestDouble(role) {
  return { user: { id: row.actorId, role, status: 'active' } };
}

describe('audit log access', () => {
  const guard = requireRoles('super_admin', 'support', 'support_technique');

  it('lets support_technique read the trail', () => {
    const next = jest.fn();
    guard(requestDouble('support_technique'), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('still refuses roles outside the staff scope', () => {
    for (const role of ['support_commercial', 'admin', 'driver', 'client']) {
      const next = jest.fn();
      guard(requestDouble(role), {}, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
  });
});

describe('audit log serialization', () => {
  it('exposes the before/after snapshots to a super admin', () => {
    const serialized = serializeAuditLog(row, { detailed: true });
    expect(serialized.beforeData).toEqual({ status: 'pending', amount: 125000 });
    expect(serialized.afterData).toEqual({ status: 'approved', amount: 125000 });
    expect(serialized.redacted).toBe(false);
    expect(serialized.hasChangeSnapshot).toBe(true);
  });

  it('hides the snapshots from a restricted role but keeps the trail readable', () => {
    const serialized = serializeAuditLog(row, { detailed: false });
    expect(serialized.beforeData).toBeUndefined();
    expect(serialized.afterData).toBeUndefined();
    expect(serialized.redacted).toBe(true);
    // Ce qui fait la valeur du journal pour le support reste lisible.
    expect(serialized.action).toBe('wallet.withdrawal.approve');
    expect(serialized.actor.fullName).toBe('Awa Diop');
    expect(serialized.requestId).toBe(row.requestId);
    expect(serialized.hasChangeSnapshot).toBe(true);
    expect(JSON.stringify(serialized)).not.toContain('125000');
  });

  it('reports the absence of a snapshot rather than an empty object', () => {
    const serialized = serializeAuditLog({ ...row, beforeData: null, afterData: null }, { detailed: false });
    expect(serialized.hasChangeSnapshot).toBe(false);
  });

  it('keeps the detailed view as the default for existing callers', () => {
    expect(serializeAuditLog(row).beforeData).toEqual({ status: 'pending', amount: 125000 });
    expect(serializeAuditLog(null)).toBeNull();
  });
});
