# thun.ai API Specification

**Version:** 1.0.0  
**Base URL:** `https://api.thun.ai`  
**Protocol:** HTTPS (TLS 1.3)  
**Authentication:** Firebase ID Token → JWT  
**Content-Type:** `application/json`

---

## Authentication

All protected endpoints require a valid JWT in the `Authorization` header:

```
Authorization: Bearer <JWT_TOKEN>
```

Tokens are obtained by verifying a Firebase ID token via `POST /auth/verify`.  
Tokens expire after **7 days**.

---

## Rate Limiting

All responses include rate limit headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests in the current window |
| `X-RateLimit-Remaining` | Remaining requests in the current window |
| `X-RateLimit-Reset` | ISO8601 timestamp when the window resets |

**Limits:**
| Scope | Limit | Window |
|-------|-------|--------|
| Global (per user/IP) | 100 requests | 1 minute |
| LLM endpoints | 10 requests | 1 minute |
| Therapist | 5 conversations | 24 hours |

When exceeded, the API returns `429 Too Many Requests`.

---

## Common Headers

**Request:**
| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes (protected) | `Bearer <JWT>` |
| `Content-Type` | Yes (POST/PUT) | `application/json` |
| `X-Request-ID` | No | Client-generated request ID for tracing |

**Response:**
| Header | Description |
|--------|-------------|
| `X-Request-ID` | Server-generated or echoed request ID |
| `X-RateLimit-*` | Rate limit status |

---

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "error": "Human-readable error message",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-04-03T10:00:00.000Z"
}
```

**Note:** 500 errors always return `"Internal server error"` — no stack traces or secrets are leaked.

---

## Error Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 400 | Bad Request | Validation failed (see `details` array) |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Token valid but insufficient permissions |
| 404 | Not Found | Resource does not exist |
| 413 | Payload Too Large | Request body exceeds 2 MB |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server-side failure |

---

## Endpoints

### 1. Authentication

#### POST `/auth/verify`

Verify a Firebase ID token and obtain a JWT for subsequent API calls.

**Auth:** Public (no JWT required)

**Request:**
```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "expiresIn": 604800
}
```

**cURL:**
```bash
curl -X POST https://api.thun.ai/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"idToken": "FIREBASE_ID_TOKEN"}'
```

---

#### PUT `/auth/profile`

Update the user's anxiety profile and calibrated thresholds.

**Auth:** JWT required

**Request:**
```json
{
  "name": "Priya",
  "anxietyLevel": 65,
  "triggers": ["highway", "heavy_traffic", "night_driving"],
  "thresholds": {
    "stressIndexTrigger": 60,
    "hrRestingBaseline": 72,
    "hrvBaseline": 45
  },
  "ttsLanguage": "hi-IN"
}
```

**Response (200):**
```json
{
  "message": "Profile updated",
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### 2. Drive Sessions

#### POST `/drive`

Create a new drive session.

**Auth:** JWT required

**Request:**
```json
{
  "startedAt": "2026-04-03T10:00:00.000Z",
  "routeMeta": {
    "summary": "Koramangala → Electronic City via Silk Board",
    "distance": "18.2 km",
    "duration": "45 min"
  }
}
```

**Response (201):**
```json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "createdAt": "2026-04-03T10:00:00.000Z"
}
```

---

#### PUT `/drive/:id`

Update a drive session with telemetry data (typically called at end of drive).

**Auth:** JWT required

**Request:**
```json
{
  "endedAt": "2026-04-03T10:45:00.000Z",
  "anxietyScoreAvg": 42.5,
  "peakStress": 78,
  "stressEvents": [
    {
      "score": 78,
      "speed": 85,
      "rpm": 3200,
      "timestamp": "2026-04-03T10:15:00.000Z",
      "description": "Sudden merge on highway"
    }
  ],
  "telemetrySummary": {
    "avgSpeed": 45.2,
    "maxSpeed": 95,
    "avgRpm": 2100,
    "distanceKm": 18.2
  },
  "routeMeta": {
    "summary": "Koramangala → Electronic City",
    "distance": "18.2 km",
    "duration": "45 min"
  }
}
```

**Validation Rules:**
- `stressEvents`: max 200 items, max 50 KB total
- `stressEvents[].score`: number, 0–100
- `stressEvents[].description`: max 500 characters
- `anxietyScoreAvg`: number, 0–100
- `peakStress`: number, 0–100

**Response (200):**
```json
{
  "message": "Session updated",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

---

#### GET `/drive`

List the user's drive sessions (most recent first).

**Auth:** JWT required

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 30 | Max sessions to return |

**Response (200):**
```json
[
  {
    "id": "a1b2c3d4-...",
    "started_at": "2026-04-03T10:00:00.000Z",
    "ended_at": "2026-04-03T10:45:00.000Z",
    "anxiety_score_avg": 42.5,
    "peak_stress": 78,
    "route_meta": { "summary": "Koramangala → Electronic City" }
  }
]
```

---

#### GET `/drive/:id`

Get a single drive session with full details.

**Auth:** JWT required

**Response (200):**
```json
{
  "id": "a1b2c3d4-...",
  "started_at": "2026-04-03T10:00:00.000Z",
  "ended_at": "2026-04-03T10:45:00.000Z",
  "anxiety_score_avg": 42.5,
  "peak_stress": 78,
  "stress_events": [...],
  "telemetry_summary": {...},
  "route_meta": {...},
  "confidence_narrative": "Dear Priya, ..."
}
```

---

### 3. Route Scoring

#### POST `/route/accident-zones`

Score a route segment for accident zone risk.

**Auth:** JWT required

**Request:**
```json
{
  "origin": { "lat": 12.9352, "lng": 77.6245 },
  "destination": { "lat": 12.8456, "lng": 77.6603 },
  "waypoints": []
}
```

**Response (200):**
```json
{
  "anxietyScore": 62,
  "factors": {
    "heavyVehicleDensity": 0.7,
    "highwayMergeFreq": 0.5,
    "accidentZones": 0.8,
    "narrowLanes": 0.3,
    "liveTraffic": 0.6
  }
}
```

---

### 4. Feedback Generation

#### POST `/feedback/generate`

Generate post-drive confidence narrative and practice scenarios.

**Auth:** JWT required  
**Rate Limit:** 10 req/min (LLM tier)

**Request:**
```json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "anxietyScoreAvg": 42.5,
  "peakStress": 78,
  "stressEvents": [
    { "score": 78, "speed": 85, "description": "Highway merge" }
  ],
  "routeMeta": {
    "summary": "Koramangala → Electronic City",
    "distance": "18.2 km",
    "duration": "45 min"
  },
  "driverProfile": {
    "name": "Priya"
  }
}
```

**Response (200):**
```json
{
  "narrative": "Dear Priya, thank you for completing this drive...",
  "scenarios": [
    {
      "title": "Gentle Highway Merge Practice",
      "suggestion": "Try merging onto a quiet highway during off-peak hours..."
    }
  ],
  "cached": false
}
```

**Response Headers (if fallback used):**
```
X-Fallback: true
```

**Timeout:** 30 seconds total (8s per provider × 3 providers + buffer)

---

#### POST `/feedback/therapist`

AI Driving Therapist chat endpoint (CBT-based conversational coaching).

**Auth:** JWT required  
**Rate Limit:** 5 conversations per 24h (therapist tier)

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "I get really anxious when trucks are around me on the highway." },
    { "role": "assistant", "content": "That's a very common concern..." },
    { "role": "user", "content": "How can I deal with it?" }
  ],
  "systemContext": "Driver has moderate highway anxiety. CSI avg: 55."
}
```

**Validation Rules:**
- `messages`: max 100 messages, content max 2000 chars each
- `systemContext`: max 500 characters
- Only last 10 messages are sent to the LLM

**Response (200):**
```json
{
  "response": "Let's work through this together. One technique that many drivers find helpful..."
}
```

---

#### GET `/feedback/trajectory`

Get the user's confidence score trajectory (last 30 sessions).

**Auth:** JWT required

**Response (200):**
```json
[
  {
    "confidence_score": 58,
    "recorded_at": "2026-04-03T11:00:00.000Z",
    "anxiety_score_avg": 42,
    "peak_stress": 78,
    "route_summary": "Koramangala → Electronic City"
  }
]
```

---

### 5. Health & Monitoring

#### GET `/health`

Basic health check (not rate limited).

**Auth:** Public

**Response (200):**
```json
{
  "status": "ok",
  "ts": "2026-04-03T10:00:00.000Z"
}
```

---

#### GET `/health/providers`

Deep health check showing LLM provider circuit breaker states.

**Auth:** Public

**Response (200):**
```json
{
  "status": "ok",
  "providers": {
    "gemini": { "state": "closed", "failures": 0 },
    "claude": { "state": "closed", "failures": 0 },
    "openai": { "state": "open", "failures": 5, "retry_after": 180 }
  }
}
```

---

## Appendix: Validation Error Response

When validation fails (400), the response includes a `details` array:

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "anxietyScoreAvg", "message": "Anxiety score must be 0–100" },
    { "field": "stressEvents", "message": "Max 200 stress events allowed" }
  ]
}
```
