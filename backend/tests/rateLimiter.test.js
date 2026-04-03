/**
 * rateLimiter.test.js
 * Tests for per-user rate limiting middleware.
 */
'use strict';

// ─── Mock Redis ──────────────────────────────────────────────────────────────
const mockRedisStore = {};
const mockRedis = {
  get: jest.fn(async (key) => mockRedisStore[key] ?? null),
  set: jest.fn(async (key, value, _opts) => {
    mockRedisStore[key] = String(value);
  }),
};

jest.mock('../src/db/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
  initRedis: jest.fn(),
}));

const {
  createPerUserRateLimiter,
  globalRateLimiter,
  llmRateLimiter,
  therapistRateLimiter,
} = require('../src/middleware/rateLimiter');

function makeReqRes(overrides = {}) {
  const req = {
    path: overrides.path || '/api/test',
    ip: overrides.ip || '127.0.0.1',
    user: overrides.user || undefined,
    headers: {},
  };
  const res = {
    statusCode: 200,
    _headers: {},
    set: jest.fn(function (k, v) { this._headers[k] = v; }),
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mock store
  Object.keys(mockRedisStore).forEach((k) => delete mockRedisStore[k]);
});

// ─── Per-user rate limiting (100 req/min) ────────────────────────────────────
describe('globalRateLimiter (100 req/min)', () => {
  it('allows requests under the limit', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:global:127.0.0.1'] = '5';
    await globalRateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks requests at the limit (100)', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:global:127.0.0.1'] = '100';
    await globalRateLimiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Too many requests' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('uses userId when user is authenticated', async () => {
    const { req, res, next } = makeReqRes({ user: { userId: 'user-123' } });
    await globalRateLimiter(req, res, next);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'ratelimit:global:user-123',
      expect.any(Number),
      expect.any(Object)
    );
    expect(next).toHaveBeenCalled();
  });
});

// ─── LLM endpoint limits (10 req/min) ────────────────────────────────────────
describe('llmRateLimiter (10 req/min)', () => {
  it('allows first request', async () => {
    const { req, res, next } = makeReqRes();
    await llmRateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks requests at limit (10)', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:llm:127.0.0.1'] = '10';
    await llmRateLimiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── Therapist limit (5 per 24h) ─────────────────────────────────────────────
describe('therapistRateLimiter (5 per 24h)', () => {
  it('allows requests under the limit', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:therapist:127.0.0.1'] = '4';
    await therapistRateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks at 5 requests', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:therapist:127.0.0.1'] = '5';
    await therapistRateLimiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── Rate limit headers ──────────────────────────────────────────────────────
describe('Rate limit headers (X-RateLimit-*)', () => {
  it('sets X-RateLimit-Limit header on success', async () => {
    const { req, res, next } = makeReqRes();
    await globalRateLimiter(req, res, next);
    expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
  });

  it('sets X-RateLimit-Remaining header on success', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:global:127.0.0.1'] = '50';
    await globalRateLimiter(req, res, next);
    expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 49);
  });

  it('sets X-RateLimit-Reset header on success', async () => {
    const { req, res, next } = makeReqRes();
    await globalRateLimiter(req, res, next);
    const resetCalls = res.set.mock.calls.filter((c) => c[0] === 'X-RateLimit-Reset');
    expect(resetCalls.length).toBe(1);
    expect(new Date(resetCalls[0][1]).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('sets headers to 0 remaining on rate limit', async () => {
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:global:127.0.0.1'] = '100';
    await globalRateLimiter(req, res, next);
    expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });
});

// ─── Health check bypass ─────────────────────────────────────────────────────
describe('Health check bypass', () => {
  it('skips rate limiting for /health path', async () => {
    const { req, res, next } = makeReqRes({ path: '/health' });
    mockRedisStore['ratelimit:global:127.0.0.1'] = '999';
    await globalRateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── Redis unavailability (fail-open) ────────────────────────────────────────
describe('Redis unavailability falls back (fail-open)', () => {
  it('allows request when Redis throws', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Connection refused'));
    const { req, res, next } = makeReqRes();
    await globalRateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── One user can't block another ────────────────────────────────────────────
describe('User isolation', () => {
  it('rate limiting is per-user, not global', async () => {
    // User A at limit
    mockRedisStore['ratelimit:global:10.0.0.1'] = '100';

    // User B should still be allowed
    const { req: reqB, res: resB, next: nextB } = makeReqRes({ ip: '10.0.0.2' });
    await globalRateLimiter(reqB, resB, nextB);
    expect(nextB).toHaveBeenCalled();
    expect(resB.status).not.toHaveBeenCalled();

    // User A should be blocked
    const { req: reqA, res: resA, next: nextA } = makeReqRes({ ip: '10.0.0.1' });
    await globalRateLimiter(reqA, resA, nextA);
    expect(resA.status).toHaveBeenCalledWith(429);
  });
});

// ─── Custom rate limiter ─────────────────────────────────────────────────────
describe('createPerUserRateLimiter', () => {
  it('creates a limiter with custom window and max', async () => {
    const limiter = createPerUserRateLimiter({
      windowMs: 10_000,
      max: 3,
      endpoint: 'custom',
    });
    const { req, res, next } = makeReqRes();
    mockRedisStore['ratelimit:custom:127.0.0.1'] = '3';
    await limiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
