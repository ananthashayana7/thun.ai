/**
 * routes.test.js
 * Integration tests for the thun.ai Express backend.
 *
 * All external dependencies (database, Firebase, LLM providers) are mocked
 * so the tests run without any live infrastructure.
 */
'use strict';

const request = require('supertest');

// ─── Mock pg pool before requiring app ───────────────────────────────────────
jest.mock('../src/db/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  withTransaction: jest.fn(async (fn) => {
    const mockClient = { query: jest.fn() };
    return fn(mockClient);
  }),
  closePool: jest.fn(),
}));

// ─── Mock Firebase Admin ─────────────────────────────────────────────────────
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
  credential: {
    applicationDefault: jest.fn(),
    cert: jest.fn(),
  },
}));

// ─── Mock jsonwebtoken ────────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock.jwt.token'),
  verify: jest.fn((token) => {
    if (token === 'valid.jwt.token') return { uid: 'test-uid', userId: 'user-uuid' };
    throw new Error('invalid token');
  }),
}));

// ─── Mock LLM service ────────────────────────────────────────────────────────
jest.mock('../src/services/llmService', () => ({
  generateConfidenceNarrative: jest.fn().mockResolvedValue('Great drive! You handled it well.'),
  generateScenarioVariants: jest.fn().mockResolvedValue([]),
  generateTherapistResponse: jest.fn().mockResolvedValue('Take a deep breath. You are safe.'),
}));

// ─── Mock route scoring service ───────────────────────────────────────────────
jest.mock('../src/services/routeScoring', () => ({
  scoreAccidentZones: jest.fn().mockResolvedValue(30),
}));

const { query, withTransaction } = require('../src/db/db');
const app = require('../src/index');

// ─── Helper: auth header with valid backend JWT ───────────────────────────────
const AUTH_HEADER = 'Bearer thun_valid.jwt.token';

// ─── Health check ─────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ts).toBeDefined();
  });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
describe('Unknown routes', () => {
  it('returns 404 for unknown path', async () => {
    const res = await request(app).get('/unknown-path-xyz');
    expect(res.statusCode).toBe(404);
  });
});

// ─── Auth route ───────────────────────────────────────────────────────────────
describe('POST /auth/verify', () => {
  beforeEach(() => {
    query.mockResolvedValue({
      rows: [{
        id: 'user-uuid',
        name: 'Test User',
        email: 'test@example.com',
        anxiety_profile: null,
        tts_language: 'en-IN',
        created_at: new Date().toISOString(),
      }],
    });
  });

  it('returns 400 if idToken is missing', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('returns 400 if idToken is empty string', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({ idToken: '' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with token and user on valid idToken', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({ idToken: 'firebase-id-token' });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toMatch(/^thun_/);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe('user-uuid');
  });
});

// ─── Protected routes without auth ───────────────────────────────────────────
describe('Protected routes require auth', () => {
  const routes = [
    { method: 'get', path: '/drive' },
    { method: 'post', path: '/drive' },
    { method: 'post', path: '/feedback/generate' },
    { method: 'post', path: '/feedback/therapist' },
    { method: 'get', path: '/feedback/trajectory' },
    { method: 'post', path: '/route/accident-zones' },
  ];

  routes.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} returns 401 without Authorization header`, async () => {
      const res = await request(app)[method](path).send({});
      expect(res.statusCode).toBe(401);
    });
  });
});

// ─── Drive routes ─────────────────────────────────────────────────────────────
describe('POST /drive', () => {
  it('returns 400 when startedAt is missing', async () => {
    const res = await request(app)
      .post('/drive')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when startedAt is not ISO8601', async () => {
    const res = await request(app)
      .post('/drive')
      .set('Authorization', AUTH_HEADER)
      .send({ startedAt: 'not-a-date' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 201 with valid startedAt', async () => {
    query.mockResolvedValue({ rows: [{ id: 'session-uuid', started_at: new Date().toISOString() }] });
    const res = await request(app)
      .post('/drive')
      .set('Authorization', AUTH_HEADER)
      .send({ startedAt: new Date().toISOString() });
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBeDefined();
  });
});

describe('GET /drive', () => {
  it('returns list of sessions', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/drive')
      .set('Authorization', AUTH_HEADER);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('caps limit at 100', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/drive?limit=999')
      .set('Authorization', AUTH_HEADER);
    expect(res.statusCode).toBe(200);
  });
});

// ─── Feedback routes ──────────────────────────────────────────────────────────
describe('POST /feedback/generate', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ anxietyScoreAvg: 50, peakStress: 70 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when anxietyScoreAvg is out of range', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: 'abc', anxietyScoreAvg: 150, peakStress: 70 });
    expect(res.statusCode).toBe(400);
  });

  it('returns cached narrative if already generated', async () => {
    query.mockResolvedValue({ rows: [{ confidence_narrative: 'Cached narrative text.' }] });
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: 'session-uuid', anxietyScoreAvg: 40, peakStress: 60 });
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.narrative).toBe('Cached narrative text.');
  });

  it('generates new narrative when not cached', async () => {
    query.mockResolvedValue({ rows: [{}] }); // no cached narrative
    withTransaction.mockImplementation(async (fn) => {
      const mockClient = { query: jest.fn() };
      return fn(mockClient);
    });
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: 'session-uuid', anxietyScoreAvg: 40, peakStress: 60 });
    expect(res.statusCode).toBe(200);
    expect(res.body.narrative).toBe('Great drive! You handled it well.');
  });
});

describe('POST /feedback/therapist', () => {
  it('returns 400 when messages array is missing', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when messages array is empty', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({ messages: [] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when message role is invalid', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({ messages: [{ role: 'system', content: 'hello' }] });
    expect(res.statusCode).toBe(400);
  });

  it('returns therapist response on valid request', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({ messages: [{ role: 'user', content: "I'm feeling anxious" }] });
    expect(res.statusCode).toBe(200);
    expect(res.body.response).toBe('Take a deep breath. You are safe.');
  });
});

// ─── Route scoring ────────────────────────────────────────────────────────────
describe('POST /route/accident-zones', () => {
  it('returns 400 when polyline is missing', async () => {
    const res = await request(app)
      .post('/route/accident-zones')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when polyline is not a string', async () => {
    const res = await request(app)
      .post('/route/accident-zones')
      .set('Authorization', AUTH_HEADER)
      .send({ polyline: 12345 });
    expect(res.statusCode).toBe(400);
  });

  it('returns accident zone score on valid polyline', async () => {
    const res = await request(app)
      .post('/route/accident-zones')
      .set('Authorization', AUTH_HEADER)
      .send({ polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.score).toBe('number');
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
  });
});

// ─── Confidence trajectory ────────────────────────────────────────────────────
describe('GET /feedback/trajectory', () => {
  it('returns array of trajectory data', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/feedback/trajectory')
      .set('Authorization', AUTH_HEADER);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
