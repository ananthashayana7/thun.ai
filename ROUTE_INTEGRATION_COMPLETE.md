# Phase 1: Route Integration Complete

## Summary

Successfully integrated input validation, request ID logging, and audit logging across all backend routes.

## Changes Made

### 1. Validation Schema Updates (`backend/src/validation/schemas.js`)
- Fixed `feedbackGenerateSchema` to accept `sessionId` as body parameter (not param)
- Removed `sessionId` param from `therapistChatSchema` (uses message history instead)
- All schemas now properly validate payload sizes and field constraints

### 2. Feedback Routes (`backend/src/routes/feedback.js`)
- **Imports:** Added validation schemas and audit middleware
- **POST /feedback/generate:**
  - Replaced inline express-validator with `feedbackGenerateSchema`
  - Added request ID logging: `generateConfidenceNarrative(..., requestId: req.id)`
  - Added audit log: `FEEDBACK_GENERATE_CACHED` and `FEEDBACK_GENERATE` actions
  - Logs: sessionId, confidenceScore, scenarioCount, narrativeLength

- **POST /feedback/therapist:**
  - Replaced inline express-validator with `therapistChatSchema`
  - Added request ID to `generateTherapistResponse(messages, context, req.id)`
  - Added audit log: `THERAPIST_CHAT` action
  - Logs: messageCount, hasSystemContext, responseLength

### 3. Drive Routes (`backend/src/routes/drive.js`)
- **Imports:** Added validation schemas
- **POST /drive:**
  - Replaced inline express-validator with `driveCreateSchema`
  - Added audit log: `DRIVE_SESSION_CREATED`
  - Logs: sessionId, routeSummary

- **PUT /drive/:id:**
  - Replaced inline express-validator with `driveUpdateSchema`
  - Added audit log: `DRIVE_SESSION_UPDATED`
  - Logs: sessionId, updated fields (endedAt, anxietyScore, peakStress)

### 4. Auth Routes (`backend/src/routes/auth.js`)
- **POST /auth/verify:**
  - Added audit log: `USER_SIGNIN` action
  - Logs: email, timestamp (via direct query, not req.auditLog since user not yet context during auth)

- **PUT /auth/profile:**
  - Added audit log: `USER_PROFILE_UPDATED` action
  - Logs: ttsLanguage, hasAnxietyProfile

### 5. Audit Middleware (`backend/src/middleware/audit.js`)
- **Fixed database abstraction:** Changed from `db.query` to `query` from `db/db.js`
- **Updated schema:** Uses simplified `details` JSON field instead of resourceType/resourceId/oldValues/newValues
- **User context handling:** Automatically captures `req.user?.userId` when available
- **Query function:** Updated `queryAuditLogs` to work with simplified schema (removed resourceType filter)
- **Column names:** Updated timestamp column from `timestamp` to `recorded_at` to match migration schema

### 6. Backend App (`backend/src/index.js`)
- **Imports:** Added `auditContextMiddleware` from audit.js
- **Middleware chain:** Added `app.use(auditContextMiddleware)` after request ID middleware
- This makes `req.auditLog()` available to all routes (both authenticated and public)

## Validation Integration Status

| Endpoint | Schema | Validation |  Request ID | Audit Logging |
|----------|--------|-----------|------------|---------------|
| POST /auth/verify | ✅ inline | ✅ | N/A (public) | ✅ USER_SIGNIN |
| PUT /auth/profile | ✅ inline | ✅ | ✅ attached | ✅ USER_PROFILE_UPDATED |
| POST /drive | ✅ driveCreateSchema | ✅ | ✅ req.id | ✅ DRIVE_SESSION_CREATED |
| PUT /drive/:id | ✅ driveUpdateSchema | ✅ | ✅ req.id | ✅ DRIVE_SESSION_UPDATED |
| GET /drive | - | - | ✅ req.id | - |
| GET /drive/:id | ✅ inline | ✅ | ✅ req.id | - |
| POST /feedback/generate | ✅ feedbackGenerateSchema | ✅ | ✅ req.id → llm | ✅ FEEDBACK_GENERATE |
| POST /feedback/therapist | ✅ therapistChatSchema | ✅ | ✅ req.id → llm | ✅ THERAPIST_CHAT |
| GET /feedback/trajectory | - | - | ✅ req.id | - |

## Request Flow Example

```
Client Request
  ↓
requestIdMiddleware (generates req.id)
  ↓
auditContextMiddleware (attaches req.auditLog function)
  ↓
globalRateLimiter (checks Redis limits)
  ↓
authMiddleware (if protected route: sets req.user.userId)
  ↓
Route handler
  ├─ Validation schema executes
  ├─ LLM service called with req.id for tracing
  ├─ req.auditLog({ action: '...', details: {...} }) called
  │   └─ Automatically includes req.user.userId (if authenticated), req.ip, user-agent
  └─ Response sent
```

## Testing Recommendations

### Unit Tests
1. Validation schema tests:
   - Test payload size limits (50KB for stress events, 2MB global)
   - Test field count limits (200 stress events, 100 messages, etc.)
   - Test content length constraints

2. Request ID propagation:
   - Verify req.id is generated for each request
   - Verify req.id appears in error responses
   - Verify req.id is passed to LLM service

3. Audit logging:
   - Verify audit records are inserted for each action
   - Verify user_id, action, details, ip_address, user_agent are logged
   - Verify fails gracefully if audit_log table unavailable

### Integration Tests
1. End-to-end feedback generation:
   - POST /feedback/generate with valid payload
   - Verify validation passes
   - Verify LLM service receives request ID
   - Verify audit log entry created

2. End-to-end auth flow:
   - POST /auth/verify (generates USER_SIGNIN audit log)
   - PUT /auth/profile (generates USER_PROFILE_UPDATED audit log)

3. Negative test cases:
   - POST with oversized payload (should reject with 400)
   - POST with invalid JSON schema (should reject with 400)
   - Missing required fields (should reject with 400)

## Next Steps (Phase 1 Completion)

1. **Write integration tests** for all modified routes (3-5 days)
   - Test validation enforcement
   - Test audit logging
   - Test request ID propagation

2. **Load test** validation + audit logging overhead (2 days)
   - Measure latency impact of audit logging
   - Verify rate limiting works correctly

3. **Verify database setup** (1 day)
   - Run `npm run migrate` to create tables
   - Test audit logging to database
   - Verify retention cleanup job works

4. **Then begin Phase 2: Mobile Hardening**

## Code Quality Notes

- ✅ Validation schemas centralized in `validation/schemas.js`
- ✅ Audit logging consistent across all user-affecting endpoints
- ✅ Request ID automatically propagated to LLM service calls
- ✅ User context automatically captured if authenticated (gracefully degraded if not)
- ✅ Error handling maintains security (no secrets leaked)
- ⚠️  Audit logging is best-effort (won't block responses if audit table fails)
