# Phase 1: Integration Test Plan

## Overview
After route integration completion, we now need to write comprehensive integration tests to verify:
1. Input validation enforced correctly
2. Request ID propagation works
3. Audit logging captures all actions
4. Rate limiting prevents abuse

## Test Structure

### Test Framework
- **Runtime:** jest (already in backend/package.json)
- **HTTP Client:** supertest
- **Database:** PostgreSQL with test fixtures
- **Redis Mock:** redis-mock or jest mock

### Test Files to Create

#### 1. `backend/tests/routes/auth.test.js`
**Tests for POST /auth/verify and PUT /auth/profile**

```javascript
describe('POST /auth/verify', () => {
  test('valid Firebase token + audit log created', async () => {
    // Mock Firebase admin.auth().verifyIdToken()
    // POST /auth/verify with valid token
    // Verify USER_SIGNIN audit log entry created
  });
  
  test('invalid token returns 401', async () => {
    // POST /auth/verify with invalid token
    // Verify error response
  });
});

describe('PUT /auth/profile', () => {
  test('authenticated user can update profile + audit log', async () => {
    // POST /auth/verify (get JWT)
    // PUT /auth/profile with anxietyProfile + JWT
    // Verify USER_PROFILE_UPDATED audit log
  });
  
  test('unauthenticated request returns 401', async () => {
    // PUT /auth/profile without JWT
    // Verify error
  });
});
```

#### 2. `backend/tests/routes/drive.test.js`
**Tests for POST /drive and PUT /drive/:id**

```javascript
describe('POST /drive', () => {
  test('create drive session + audit log', async () => {
    // POST /drive with routeMeta
    // Verify DRIVE_SESSION_CREATED audit log
  });
  
  test('invalid routeMeta rejected', async () => {
    // POST /drive with oversized routeMeta
    // Verify 400 validation error
  });
});

describe('PUT /drive/:id', () => {
  test('update drive session + audit log', async () => {
    // Create session first
    // PUT /drive/:id with anxietyScoreAvg
    // Verify DRIVE_SESSION_UPDATED audit log
  });
  
  test('stress events payload limit enforced', async () => {
    // PUT /drive/:id with 201 stress events (max 200)
    // Verify 400 error
  });
});
```

#### 3. `backend/tests/routes/feedback.test.js`
**Tests for POST /feedback/generate and POST /feedback/therapist**

```javascript
describe('POST /feedback/generate', () => {
  test('generates narrative + audit log + request ID passed to LLM', async () => {
    // Create drive session
    // POST /feedback/generate with valid payload
    // Verify FEEDBACK_GENERATE audit log
    // Verify request ID was passed to llmService (mock verification)
  });
  
  test('payload size limit enforced (50KB for stressEvents)', async () => {
    // POST /feedback/generate with 51KB stressEvents
    // Verify 400 validation error
  });
  
  test('max 200 stress events enforced', async () => {
    // POST /feedback/generate with 201 events
    // Verify 400 error
  });
  
  test('cached narrative returned if exists', async () => {
    // Make two identical requests
    // Second request should return cached: true
    // Both should have audit logs
  });
});

describe('POST /feedback/therapist', () => {
  test('generates response + audit log + request ID passed', async () => {
    // POST /feedback/therapist with valid messages
    // Verify THERAPIST_CHAT audit log
    // Verify request ID passed to llmService
  });
  
  test('max 100 messages enforced', async () => {
    // POST with 101 messages
    // Verify 400 error
  });
  
  test('max 2000 chars per message enforced', async () => {
    // POST with message > 2000 chars
    // Verify 400 error
  });
});
```

## Test Utilities to Create

### 1. `backend/tests/fixtures/database.js`
```javascript
// Setup/teardown PostgreSQL test database
// Create test user, drive session, etc.
async function setupTestDb() { }
async function teardownTestDb() { }
```

### 2. `backend/tests/fixtures/auth.js`
```javascript
// Mock Firebase and return JWT tokens for testing
async function getMockToken(userId = 'test-uid') { }
```

### 3. `backend/tests/fixtures/redis.js`
```javascript
// Use redis-mock for tests or in-memory mock
async function setupRedis() { }
```

## Test Coverage Goals

| Component | Coverage | Notes |
|-----------|----------|-------|
| Validation schemas | 90%+ | Test boundaries: max/min values |
| Request ID | 95%+ | Track through entire request flow |
| Audit logging | 90%+ | Verify all action types logged |
| Rate limiting | 85%+ | Test per-user limits + limits |
| Error handling | 85%+ | Verify error messages don't leak secrets |

## Execution Plan

### Step 1: Create test infrastructure (2 days)
- [ ] Create test database setup/teardown
- [ ] Create auth mocking utilities
- [ ] Add jest config for test environment

### Step 2: Write auth tests (1 day)
- [ ] POST /auth/verify tests
- [ ] PUT /auth/profile tests

### Step 3: Write drive tests (1 day)
- [ ] POST /drive tests
- [ ] PUT /drive/:id tests

### Step 4: Write feedback tests (2 days)
- [ ] POST /feedback/generate tests (complex due to LLM service)
- [ ] POST /feedback/therapist tests

### Step 5: Validation boundary tests (1 day)
- [ ] Test all payload size limits
- [ ] Test all field count limits
- [ ] Test all content length limits

### Step 6: Run tests + fix issues (1-2 days)
- [ ] Run full test suite
- [ ] Fix any failures
- [ ] Achieve 80%+ code coverage

**Total effort: 8-10 days**

## Mocking Strategy

### Firebase Authentication
```javascript
jest.mock('firebase-admin', () => ({
  app: jest.fn(),
  credential: {
    cert: jest.fn(),
    applicationDefault: jest.fn(),
  },
  initializeApp: jest.fn(() => ({
    auth: jest.fn(() => ({
      verifyIdToken: jest.fn(async (token) => {
        if (token === 'valid-token') {
          return { uid: 'test-uid', email: 'test@example.com' };
        }
        throw new Error('Invalid token');
      }),
    })),
  })),
}));
```

### LLM Service (for feedback tests)
```javascript
jest.mock('../src/services/llmService', () => ({
  generateConfidenceNarrative: jest.fn(async (params, requestId) => {
    // Verify requestId was passed
    expect(requestId).toBeDefined();
    return 'Mock narrative based on stress level...';
  }),
  generateTherapistResponse: jest.fn(async (messages, context, requestId) => {
    expect(requestId).toBeDefined();
    return 'Mock therapist response...';
  }),
}));
```

## Example Test File

```javascript
// backend/tests/routes/auth.test.js
const request = require('supertest');
const app = require('../../src/index');
const { setupTestDb, teardownTestDb } = require('../fixtures/database');
const { getMockToken } = require('../fixtures/auth');

describe('Auth Routes', () => {
  beforeAll(async () => {
    await setupTestDb();
  });
  
  afterAll(async () => {
    await teardownTestDb();
  });

  describe('POST /auth/verify', () => {
    test('should create user + return JWT + log USER_SIGNIN', async () => {
      const mockToken = await getMockToken('test-uid');
      
      const response = await request(app)
        .post('/auth/verify')
        .send({ idToken: mockToken })
        .expect(200);
      
      expect(response.body).toHaveProperty('token');
      expect(response.body.token).toMatch(/^thun_/);
      
      // Verify audit log created
      const auditLog = await db.query(
        'SELECT * FROM audit_log WHERE action = $1 ORDER BY recorded_at DESC LIMIT 1',
        ['USER_SIGNIN']
      );
      
      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0].details).toContain('test@example.com');
    });
  });
});
```

## Next Actions

After tests are passing:
1. Verify 80%+ code coverage
2. Run under load (ab or k6 load testing)
3. Verify rate limiting works correctly
4. Then move to Phase 2: Mobile Hardening
