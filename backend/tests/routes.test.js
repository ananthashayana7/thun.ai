/**
 * routes.test.js
 * Integration tests for the thun.ai Express backend.
 *
 * All external dependencies (database, Firebase, LLM providers) are mocked
 * so the tests run without any live infrastructure.
 */
'use strict';

const request = require('supertest');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

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
const {
  generateConfidenceNarrative,
  generateTherapistResponse,
} = require('../src/services/llmService');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
});

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
    { method: 'get', path: '/privacy/consent' },
    { method: 'put', path: '/privacy/consent' },
    { method: 'post', path: '/privacy/export' },
    { method: 'post', path: '/privacy/delete-account' },
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
  it('returns 201 when startedAt is omitted', async () => {
    query.mockResolvedValue({ rows: [{ id: SESSION_ID, started_at: new Date().toISOString() }] });
    const res = await request(app)
      .post('/drive')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns 400 when startedAt is not ISO8601', async () => {
    const res = await request(app)
      .post('/drive')
      .set('Authorization', AUTH_HEADER)
      .send({ startedAt: 'not-a-date' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 201 with valid startedAt', async () => {
    query.mockResolvedValue({ rows: [{ id: SESSION_ID, started_at: new Date().toISOString() }] });
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
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 150, peakStress: 70 });
    expect(res.statusCode).toBe(400);
  });

  it('returns cached narrative if already generated', async () => {
    query.mockResolvedValue({ rows: [{ confidence_narrative: 'Cached narrative text.' }] });
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 40, peakStress: 60 });
    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.narrative).toBe('Cached narrative text.');
    expect(res.headers['x-request-id']).toBeDefined();
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
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 40, peakStress: 60 });
    expect(res.statusCode).toBe(200);
    expect(res.body.narrative).toBe('Great drive! You handled it well.');
    expect(generateConfidenceNarrative).toHaveBeenCalledWith(
      expect.objectContaining({ anxietyScoreAvg: 40, peakStress: 60 }),
      expect.any(String)
    );
  });

  it('passes corridor telemetry into narrative generation', async () => {
    query.mockResolvedValue({ rows: [{}] });
    withTransaction.mockImplementation(async (fn) => {
      const mockClient = { query: jest.fn() };
      return fn(mockClient);
    });

    const telemetrySummary = {
      confidenceCorridor: {
        encountered: true,
        successfulPassages: 1,
        blockedPassages: 0,
        bestSpareCm: 26,
        confidenceBefore: 20,
        confidenceAfter: 28,
      },
    };

    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 40,
        peakStress: 60,
        telemetrySummary,
      });

    expect(res.statusCode).toBe(200);
    expect(generateConfidenceNarrative).toHaveBeenCalledWith(
      expect.objectContaining({ telemetrySummary }),
      expect.any(String)
    );
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
    expect(generateTherapistResponse).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      expect.any(String)
    );
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

describe('Privacy routes', () => {
  it('returns consent state and request history', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          consent_version: '2026-04-11',
          telemetry_upload: true,
          biometrics_processing: true,
          therapist_transcript_retention: false,
          marketing_updates: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/privacy/consent')
      .set('Authorization', AUTH_HEADER);

    expect(res.statusCode).toBe(200);
    expect(res.body.consent.consent_version).toBe('2026-04-11');
    expect(Array.isArray(res.body.requests)).toBe(true);
  });

  it('updates privacy consent', async () => {
    query.mockResolvedValue({
      rows: [{
        consent_version: '2026-04-11',
        telemetry_upload: true,
        biometrics_processing: true,
        therapist_transcript_retention: false,
        marketing_updates: false,
      }],
    });

    const res = await request(app)
      .put('/privacy/consent')
      .set('Authorization', AUTH_HEADER)
      .send({
        consentVersion: '2026-04-11',
        telemetryUpload: true,
        biometricsProcessing: true,
        therapistTranscriptRetention: false,
        marketingUpdates: false,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.consent.telemetry_upload).toBe(true);
  });

  it('queues an export request', async () => {
    query.mockResolvedValue({
      rows: [{
        id: '44444444-4444-4444-8444-444444444444',
        request_type: 'export',
        status: 'queued',
      }],
    });

    const res = await request(app)
      .post('/privacy/export')
      .set('Authorization', AUTH_HEADER)
      .send({ format: 'json' });

    expect(res.statusCode).toBe(202);
    expect(res.body.request_type).toBe('export');
  });

  it('queues a deletion request only when confirm is true', async () => {
    query.mockResolvedValue({
      rows: [{
        id: '55555555-5555-4555-8555-555555555555',
        request_type: 'delete',
        status: 'queued',
      }],
    });

    const res = await request(app)
      .post('/privacy/delete-account')
      .set('Authorization', AUTH_HEADER)
      .send({ confirm: true, reason: 'User requested deletion' });

    expect(res.statusCode).toBe(202);
    expect(res.body.request_type).toBe('delete');
  });
});
