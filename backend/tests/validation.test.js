/**
 * validation.test.js
 * Tests for input validation schemas.
 */
'use strict';

const request = require('supertest');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

// ─── Mock dependencies ──────────────────────────────────────────────────────
jest.mock('../src/db/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{}] }),
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
}));

jest.mock('../src/services/routeScoring', () => ({
  scoreAccidentZones: jest.fn().mockResolvedValue(30),
}));

const app = require('../src/index');
const AUTH_HEADER = 'Bearer thun_valid.jwt.token';

// ─── Missing required fields (400) ───────────────────────────────────────────
describe('Missing required fields', () => {
  it('returns 400 when sessionId is missing for /feedback/generate', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ anxietyScoreAvg: 50, peakStress: 70 });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeDefined();
  });

  it('returns 400 when anxietyScoreAvg is missing for /feedback/generate', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, peakStress: 70 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when peakStress is missing for /feedback/generate', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 50 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when messages array is missing for /feedback/therapist', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.statusCode).toBe(400);
  });
});

// ─── Invalid UUID format ─────────────────────────────────────────────────────
describe('Invalid UUID format', () => {
  it('rejects non-UUID sessionId', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: 'not-a-uuid', anxietyScoreAvg: 50, peakStress: 70 });
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'sessionId' }),
      ])
    );
  });

  it('rejects invalid drive ID in PUT /drive/:id', async () => {
    const res = await request(app)
      .put('/drive/invalid-id')
      .set('Authorization', AUTH_HEADER)
      .send({ endedAt: new Date().toISOString() });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Invalid number ranges ───────────────────────────────────────────────────
describe('Invalid number ranges', () => {
  it('rejects anxietyScoreAvg > 100', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 150, peakStress: 70 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects anxietyScoreAvg < 0', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: -5, peakStress: 70 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects peakStress > 100', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 50, peakStress: 200 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects peakStress < 0', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({ sessionId: SESSION_ID, anxietyScoreAvg: 50, peakStress: -1 });
    expect(res.statusCode).toBe(400);
  });
});

// ─── stressEvents array max 200 items ────────────────────────────────────────
describe('stressEvents array limits', () => {
  it('rejects stressEvents with more than 200 items', async () => {
    const events = Array.from({ length: 201 }, (_, i) => ({
      score: 50,
      speed: 40,
      description: `event ${i}`,
    }));
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 50,
        peakStress: 70,
        stressEvents: events,
      });
    expect(res.statusCode).toBe(400);
  });

  it('accepts stressEvents with exactly 200 items', async () => {
    const { query } = require('../src/db/db');
    query.mockResolvedValue({ rows: [{}] });

    const events = Array.from({ length: 200 }, (_, i) => ({
      score: 50,
      speed: 40,
    }));
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 50,
        peakStress: 70,
        stressEvents: events,
      });
    expect(res.statusCode).toBe(200);
  });
});

// ─── String field length limits ──────────────────────────────────────────────
describe('String field length limits', () => {
  it('rejects event description over 500 chars', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 50,
        peakStress: 70,
        stressEvents: [{ score: 50, description: 'x'.repeat(501) }],
      });
    expect(res.statusCode).toBe(400);
  });

  it('rejects routeMeta.summary over 200 chars', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 50,
        peakStress: 70,
        routeMeta: { summary: 'x'.repeat(201) },
      });
    expect(res.statusCode).toBe(400);
  });

  it('rejects driverProfile.name over 100 chars', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 50,
        peakStress: 70,
        driverProfile: { name: 'x'.repeat(101) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts telemetrySummary confidence corridor payload', async () => {
    const res = await request(app)
      .post('/feedback/generate')
      .set('Authorization', AUTH_HEADER)
      .send({
        sessionId: SESSION_ID,
        anxietyScoreAvg: 50,
        peakStress: 70,
        telemetrySummary: {
          confidenceCorridor: {
            encountered: true,
            successfulPassages: 1,
            bestSpareCm: 28,
            confidenceBefore: 24,
            confidenceAfter: 31,
          },
        },
      });
    expect(res.statusCode).toBe(200);
  });

  it('rejects therapist message content over 2000 chars', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({
        messages: [{ role: 'user', content: 'x'.repeat(2001) }],
      });
    expect(res.statusCode).toBe(400);
  });

  it('rejects systemContext over 500 chars', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({
        messages: [{ role: 'user', content: 'hello' }],
        systemContext: 'x'.repeat(501),
      });
    expect(res.statusCode).toBe(400);
  });

  it('rejects more than 100 therapist messages', async () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }));
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({ messages });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Therapist message role validation ───────────────────────────────────────
describe('Therapist message role validation', () => {
  it('rejects invalid role in messages', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({ messages: [{ role: 'system', content: 'hello' }] });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty messages array', async () => {
    const res = await request(app)
      .post('/feedback/therapist')
      .set('Authorization', AUTH_HEADER)
      .send({ messages: [] });
    expect(res.statusCode).toBe(400);
  });
});
