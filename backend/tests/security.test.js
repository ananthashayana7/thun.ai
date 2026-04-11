/**
 * security.test.js
 * Tests for security: no stack traces, no API keys, sanitized error output.
 */
'use strict';

const request = require('supertest');

// ─── Mock dependencies ──────────────────────────────────────────────────────
jest.mock('../src/db/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  getClient: jest.fn(),
  withTransaction: jest.fn(async (fn) => {
    const mockClient = { query: jest.fn() };
    return fn(mockClient);
  }),
  closePool: jest.fn(),
}));

jest.mock('firebase-admin', () => ({
  apps: [],
  app: jest.fn(() => { throw new Error('not found'); }),
  initializeApp: jest.fn(() => ({
    auth: () => ({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'test-uid',
        name: 'Test User',
        email: 'test@example.com',
      }),
    }),
  })),
  credential: { applicationDefault: jest.fn(), cert: jest.fn() },
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock.jwt.token'),
  verify: jest.fn((token) => {
    if (token === 'valid.jwt.token') return { uid: 'test-uid', userId: 'user-uuid' };
    throw new Error('invalid token');
  }),
}));

jest.mock('../src/services/llmService', () => ({
  generateConfidenceNarrative: jest.fn().mockResolvedValue('Narrative.'),
  generateScenarioVariants: jest.fn().mockResolvedValue([]),
  generateTherapistResponse: jest.fn().mockResolvedValue('Response.'),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({}),
}));

jest.mock('../src/services/routeScoring', () => ({
  scoreAccidentZones: jest.fn().mockResolvedValue(30),
}));

const app = require('../src/index');
const AUTH_HEADER = 'Bearer thun_valid.jwt.token';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── No stack traces in error responses ──────────────────────────────────────
describe('No stack traces in error responses', () => {
  it('404 response does not contain stack trace', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.statusCode).toBe(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('at ');
    expect(body).not.toContain('Error:');
    expect(body).not.toContain('.js:');
  });

  it('401 response does not contain stack trace', async () => {
    const res = await request(app)
      .get('/drive')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.statusCode).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('at Function');
  });

  it('400 validation error does not contain stack trace', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.statusCode).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('at ');
    expect(body).not.toContain('node_modules');
  });
});

// ─── No API keys in error responses ─────────────────────────────────────────
describe('No API keys in error responses', () => {
  it('error responses do not contain API key patterns', async () => {
    const res = await request(app).get('/nonexistent');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/sk-[a-zA-Z0-9]/);     // OpenAI keys
    expect(body).not.toMatch(/AIza[a-zA-Z0-9]/);     // Google API keys
    expect(body).not.toMatch(/sk-ant-[a-zA-Z0-9]/);  // Anthropic keys
  });

  it('401 response does not leak credentials', async () => {
    const res = await request(app)
      .get('/drive')
      .set('Authorization', 'Bearer bad-token');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('JWT_SECRET');
    expect(body).not.toContain('FIREBASE');
    expect(body).not.toContain('API_KEY');
  });
});

// ─── Request ID present in error responses ───────────────────────────────────
describe('Request ID in error responses', () => {
  it('404 includes X-Request-ID header', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('401 includes X-Request-ID header', async () => {
    const res = await request(app)
      .get('/drive')
      .set('Authorization', 'Bearer invalid');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('400 includes X-Request-ID header', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('uses client-provided X-Request-ID when present', async () => {
    const customId = 'custom-trace-id-12345';
    const res = await request(app)
      .get('/health')
      .set('X-Request-ID', customId);
    expect(res.headers['x-request-id']).toBe(customId);
  });
});

// ─── Sanitized error output ──────────────────────────────────────────────────
describe('Sanitized error output', () => {
  it('404 returns only error field', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.body.error).toBe('Not found');
    // Should not have extra debug info
    expect(res.body.stack).toBeUndefined();
    expect(res.body.code).toBeUndefined();
  });

  it('401 returns clean error message', async () => {
    const res = await request(app)
      .post('/drive')
      .send({});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.stack).toBeUndefined();
  });

  it('health check returns clean response without internal details', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    // Should not expose internal config
    expect(res.body.database).toBeUndefined();
    expect(res.body.redis).toBeUndefined();
  });

  it('startup health does not leak secret values', async () => {
    const res = await request(app).get('/health/startup');
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('JWT_SECRET');
    expect(body).not.toContain('DATABASE_URL');
    expect(res.body.checks).toBeDefined();
  });
});
