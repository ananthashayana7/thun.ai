/**
 * audit.test.js
 * Tests for audit logging middleware and query functions.
 */
'use strict';

// ─── Mock database ──────────────────────────────────────────────────────────
const mockQuery = jest.fn();

jest.mock('../src/db/db', () => ({
  query: mockQuery,
}));

const {
  logAudit,
  auditContextMiddleware,
  queryAuditLogs,
} = require('../src/middleware/audit');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── logAudit: Actions logged to DB with correct fields ─────────────────────
describe('logAudit', () => {
  it('inserts audit record with all fields', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logAudit({
      userId: 'user-123',
      action: 'drive.create',
      resourceType: 'drive',
      resourceId: 'drive-456',
      details: { duration: 30 },
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_log');
    expect(params[0]).toBe('user-123');        // user_id
    expect(params[1]).toBe('drive.create');     // action
    expect(params[2]).toBe('drive');            // resource_type
    expect(params[3]).toBe('drive-456');        // resource_id
    expect(params[6]).toBe('192.168.1.1');      // ip_address
    expect(params[7]).toBe('Mozilla/5.0');      // user_agent
  });

  it('handles oldValues and newValues correctly', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logAudit({
      userId: 'user-1',
      action: 'profile.update',
      oldValues: { name: 'Old' },
      newValues: { name: 'New' },
      ipAddress: '10.0.0.1',
      userAgent: 'Test',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[4]).toBe(JSON.stringify({ name: 'Old' }));  // old_values
    expect(params[5]).toBe(JSON.stringify({ name: 'New' }));  // new_values
  });

  it('uses details when newValues is not provided', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logAudit({
      userId: 'user-1',
      action: 'drive.start',
      details: { started: true },
      ipAddress: '10.0.0.1',
      userAgent: 'Test',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[5]).toBe(JSON.stringify({ started: true }));
  });

  it('sets null for missing optional fields', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logAudit({
      userId: 'user-1',
      action: 'test',
      ipAddress: '10.0.0.1',
      userAgent: 'Test',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBeNull();  // resourceType
    expect(params[3]).toBeNull();  // resourceId
    expect(params[4]).toBeNull();  // oldValues
  });
});

// ─── Fail-open: logging failure doesn't crash ───────────────────────────────
describe('Fail-open behavior', () => {
  it('does not throw when DB insert fails', async () => {
    mockQuery.mockRejectedValue(new Error('Connection error'));

    await expect(
      logAudit({
        userId: 'user-1',
        action: 'test',
        ipAddress: '10.0.0.1',
        userAgent: 'Test',
      })
    ).resolves.toBeUndefined();
  });

  it('logs error to console when DB fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockQuery.mockRejectedValue(new Error('DB down'));

    await logAudit({
      userId: 'user-1',
      action: 'test',
      ipAddress: '10.0.0.1',
      userAgent: 'Test',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Audit]'),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

// ─── auditContextMiddleware: IP and user agent captured ─────────────────────
describe('auditContextMiddleware', () => {
  it('attaches auditLog function to request', () => {
    const req = {
      user: { userId: 'user-abc' },
      ip: '192.168.1.100',
      get: jest.fn((header) => {
        if (header === 'user-agent') return 'TestAgent/1.0';
        return undefined;
      }),
    };
    const res = {};
    const next = jest.fn();

    auditContextMiddleware(req, res, next);

    expect(req.auditLog).toBeDefined();
    expect(typeof req.auditLog).toBe('function');
    expect(next).toHaveBeenCalled();
  });

  it('auditLog uses correct IP and user agent from request', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const req = {
      user: { userId: 'user-xyz' },
      ip: '10.20.30.40',
      get: jest.fn((header) => {
        if (header === 'user-agent') return 'MyApp/2.0';
        return undefined;
      }),
    };
    const res = {};
    const next = jest.fn();

    auditContextMiddleware(req, res, next);
    await req.auditLog({ action: 'test.action' });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('user-xyz');       // userId from req.user
    expect(params[6]).toBe('10.20.30.40');    // ipAddress from req.ip
    expect(params[7]).toBe('MyApp/2.0');      // userAgent from req.get
  });

  it('auditLog works when user is not authenticated', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const req = {
      user: undefined,
      ip: '127.0.0.1',
      get: jest.fn(() => 'CurlBot'),
    };
    const res = {};
    const next = jest.fn();

    auditContextMiddleware(req, res, next);
    await req.auditLog({ action: 'anonymous.action' });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeUndefined();  // no userId
  });
});

// ─── queryAuditLogs: Query by userId, action, date range ─────────────────────
describe('queryAuditLogs', () => {
  it('queries all logs with no filters', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, action: 'test' }],
    });

    const logs = await queryAuditLogs();
    expect(logs).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM audit_log'),
      []
    );
  });

  it('filters by userId', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await queryAuditLogs({ userId: 'user-1' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('user_id = $1');
    expect(params).toEqual(['user-1']);
  });

  it('filters by action', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await queryAuditLogs({ action: 'drive.create' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('action = $1');
    expect(params).toEqual(['drive.create']);
  });

  it('filters by date range', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const start = '2024-01-01T00:00:00Z';
    const end = '2024-12-31T23:59:59Z';
    await queryAuditLogs({ dateRange: { start, end } });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('timestamp >= $1');
    expect(sql).toContain('timestamp <= $2');
    expect(params).toEqual([start, end]);
  });

  it('combines multiple filters', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await queryAuditLogs({
      userId: 'user-1',
      action: 'drive.create',
      resourceType: 'drive',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('action = $2');
    expect(sql).toContain('resource_type = $3');
    expect(params).toEqual(['user-1', 'drive.create', 'drive']);
  });

  it('returns empty array on query failure', async () => {
    mockQuery.mockRejectedValue(new Error('Query failed'));

    const logs = await queryAuditLogs({ userId: 'user-1' });
    expect(logs).toEqual([]);
  });

  it('orders by timestamp DESC with LIMIT 10000', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await queryAuditLogs();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY timestamp DESC LIMIT 10000');
  });
});
