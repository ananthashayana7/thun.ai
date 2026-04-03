# THUN.AI PRODUCTION READINESS - DETAILED TASK BREAKDOWN

**Total Tasks:** 87  
**Estimated Effort:** 220–360 engineer-days  
**Duration:** 8–12 weeks (3 FTE)

---

## PHASE 1: FOUNDATION (WEEKS 1–2)

### Backend: Database Migrations

- [ ] **TASK-001:** Set up Flyway config and migrations directory structure
  - **Description:** Create `backend/migrations/` folder, add `flyway.conf`
  - **Acceptance Criteria:** `npm run migrate:info` returns "1 migration" (baseline)
  - **Effort:** 1 day
  - **Files:** backend/CMakeLists.txt, backend/flyway.conf, backend/migrations/

- [ ] **TASK-002:** Create V1__Initial_Schema migration from existing schema.sql
  - **Description:** Convert [backend/src/db/schema.sql](backend/src/db/schema.sql) to v1 migration file
  - **Acceptance Criteria:** `npm run migrate` applies schema and tests pass
  - **Effort:** 1 day
  - **Files:** backend/migrations/V1__initial_schema.sql

- [ ] **TASK-003:** Create V2__Add_Audit_Table migration
  - **Description:** Add `audit_log` table with (user_id, action, timestamp, old_values, new_values)
  - **Acceptance Criteria:** Schema includes audit_log with proper indexes
  - **Effort:** 1 day
  - **Files:** backend/migrations/V2__add_audit_table.sql

- [ ] **TASK-004:** Create migrations.md documentation
  - **Description:** Document naming conventions, best practices, rollback procedures
  - **Acceptance Criteria:** Developer can create new migration without asking
  - **Effort:** 1 day
  - **Files:** docs/MIGRATIONS.md

### Backend: Rate Limiting

- [ ] **TASK-005:** Integrate Redis client
  - **Description:** Add `redis@5.0.0` to package.json, connect in [backend/src/index.js](backend/src/index.js)
  - **Acceptance Criteria:** Redis connection pool initialized, `npm start` logs "Redis connected"
  - **Effort:** 1 day
  - **Files:** backend/src/index.js, backend/package.json

- [ ] **TASK-006:** Implement per-user rate limiter middleware
  - **Description:** Refactor [backend/src/middleware/rateLimiter.js](backend/src/middleware/rateLimiter.js) to use Redis sliding window
  - **Acceptance Criteria:** 
    - User A limited to 100 req/min
    - User B doesn't see User A's limits
    - LLM endpoints limited to 10 req/min per user
    - Headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - **Effort:** 2 days
  - **Files:** backend/src/middleware/rateLimiter.js

- [ ] **TASK-007:** Add therapist conversation limit (5 per 24h)
  - **Description:** Implement per-user per-24h limit on therapist endpoint (premium feature)
  - **Acceptance Criteria:** User can start 5 conversations, 6th returns 429
  - **Effort:** 1 day
  - **Files:** backend/src/routes/feedback.js

### Backend: LLM Timeout

- [ ] **TASK-008:** Refactor [backend/src/services/llmService.js](backend/src/services/llmService.js) for global timeout
  - **Description:** Implement AbortController with 30s total budget (8s per provider)
  - **Acceptance Criteria:** 
    - No request hangs > 35s
    - Circuit breaker prevents repeated failures
    - Logs include request ID
    - P95 latency < 35s
  - **Effort:** 2 days
  - **Files:** backend/src/services/llmService.js

- [ ] **TASK-009:** Add circuit breaker pattern
  - **Description:** Track consecutive LLM failures, skip provider after 5 failures for 5 min
  - **Acceptance Criteria:** Failed provider skipped on next request, re-enabled after timeout
  - **Effort:** 1 day
  - **Files:** backend/src/services/llmService.js

- [ ] **TASK-010:** Add `/health/providers` endpoint
  - **Description:** Return circuit breaker state for Gemini, Claude, OpenAI
  - **Acceptance Criteria:** Endpoint returns circuit state (closed/open/half-open)
  - **Effort:** 1 day
  - **Files:** backend/src/index.js

### Backend: Input Validation

- [ ] **TASK-011:** Add payload size limits
  - **Description:** Cap express.json limit to 2mb, add per-field validation
  - **Acceptance Criteria:** 
    - Requests > 2 MB return 413
    - String fields capped (e.g., description < 500 chars)
    - stressEvents array < 200 items
  - **Effort:** 1 day
  - **Files:** backend/src/index.js, backend/src/routes/feedback.js

### Backend: Request ID Tracing

- [ ] **TASK-012:** Add request ID middleware
  - **Description:** Generate UUID or ulid for each request, include in all logs and error responses
  - **Acceptance Criteria:** Every log line includes request ID, correlatable across services
  - **Effort:** 1 day
  - **Files:** backend/src/middleware/, backend/src/index.js

---

## PHASE 2: MOBILE HARDENING (WEEKS 3–4)

### Mobile: Error Recovery

- [ ] **TASK-013:** Implement exponential backoff for OBDService
  - **Description:** Retry BT connection with 1s → 2s → 4s → 8s → 16s → 32s delays
  - **Acceptance Criteria:** 
    - Reconnects automatically
    - User notified after 5 failures ("OBD connecting...")
    - Stops after 10 failures
  - **Effort:** 2 days
  - **Files:** mobile/src/services/OBDService.js

- [ ] **TASK-014:** Implement stress index fallback
  - **Description:** If OBD unavailable, use HR/HRV only; if watch unavailable, use OBD only
  - **Acceptance Criteria:** Degraded stress index within ±10% of normal
  - **Effort:** 2 days
  - **Files:** mobile/src/services/StressIndexService.js

- [ ] **TASK-015:** Implement network retry queue
  - **Description:** Queue failed POST requests to SQLite, retry on network restore
  - **Acceptance Criteria:** 
    - Failed requests stored in `telemetry_queue` table
    - Retry on `NetInfo.isConnected` event
    - Max queue size 1000, drop oldest if full
    - Survives app restart
  - **Effort:** 3 days
  - **Files:** mobile/src/services/LocalStorage.js, mobile/src/services/TelemetryService.js (new)

- [ ] **TASK-016:** Add error tracking service
  - **Description:** New ErrorTracker service to log errors locally, sync with backend
  - **Acceptance Criteria:** Errors stored in SQLite, synced on next successful POST
  - **Effort:** 2 days
  - **Files:** mobile/src/services/ErrorTracker.js (new)

### Mobile: Security

- [ ] **TASK-017:** Enable SQLite encryption
  - **Description:** Encrypt database at rest using PRAGMA key
  - **Acceptance Criteria:** Database file unreadable without key
  - **Effort:** 1 day
  - **Files:** mobile/src/services/LocalStorage.js

- [ ] **TASK-018:** Implement TLS certificate pinning
  - **Description:** Pin backend server certificate thumbprint in axios config
  - **Acceptance Criteria:** MITM attacks blocked (self-signed certs rejected)
  - **Effort:** 2 days
  - **Files:** mobile/src/services/ApiClient.js (new)

### Mobile: Unit Tests

- [ ] **TASK-019:** Write tests for StressIndexService
  - **Description:** 15+ test cases (weight verification, edge cases, thresholds)
  - **Acceptance Criteria:** 100% coverage, all assertions pass
  - **Effort:** 3 days
  - **Files:** mobile/tests/StressIndexService.test.js (new)

- [ ] **TASK-020:** Write tests for IVISEngine
  - **Description:** 20+ test cases (intervention queueing, cooldown, speed gate, emergency override)
  - **Acceptance Criteria:** 100% coverage
  - **Effort:** 4 days
  - **Files:** mobile/tests/IVISEngine.test.js (new)

- [ ] **TASK-021:** Write tests for OBDService
  - **Description:** 20+ test cases (connection, reconnect, frame parsing, errors)
  - **Acceptance Criteria:** 100% coverage, mocks BT correctly
  - **Effort:** 4 days
  - **Files:** mobile/tests/OBDService.test.js (new)

- [ ] **TASK-022:** Write tests for WatchService
  - **Description:** 10+ test cases (BLE streaming, disconnect, data format)
  - **Acceptance Criteria:** 100% coverage
  - **Effort:** 2 days
  - **Files:** mobile/tests/WatchService.test.js (new)

- [ ] **TASK-023:** Write E2E test (emulator)
  - **Description:** Full flow: OnboardingScreen → DriveScreen → PostDriveScreen on iOS/Android simulator
  - **Acceptance Criteria:** Test completes without errors, stress data flows correctly
  - **Effort:** 5 days
  - **Files:** mobile/tests/E2E.test.js (new)

---

## PHASE 3: EDGE HARDWARE (WEEKS 5–10)

### Edge: CAN Bus

- [ ] **TASK-024:** Implement real CAN socket initialization
  - **Description:** Open `/dev/can0` at 500 kbps, set up OBD-2 filtering
  - **Acceptance Criteria:** 
    - Socket opens successfully
    - OBD frames received (verify with test harness)
    - Can filter by PID
  - **Effort:** 5 days
  - **Files:** edge/src/obd_parser.cpp/.h

- [ ] **TASK-025:** Add CAN error handling
  - **Description:** Handle connection loss, invalid frames, timeout
  - **Acceptance Criteria:** Graceful fallback if CAN unavailable
  - **Effort:** 2 days
  - **Files:** edge/src/obd_parser.cpp/.h

### Edge: RKNN NPU

- [ ] **TASK-026:** Integrate RKNN SDK
  - **Description:** Load RKNN model file, allocate NPU memory, verify inference
  - **Acceptance Criteria:** 
    - Model loads successfully
    - Inference latency < 30 ms
    - Memory usage < 500 MB
  - **Effort:** 6 days
  - **Files:** edge/src/ivis_engine.cpp/.h, edge/CMakeLists.txt

- [ ] **TASK-027:** Implement YOLO emergency vehicle detection
  - **Description:** Load YOLO weights (use YOLOv8s-obb), run inference on each frame
  - **Acceptance Criteria:** 
    - Detects emergency vehicles (police, fire, ambulance) with > 0.7 confidence
    - Outputs bounding box + confidence
    - Latency < 20 ms
  - **Effort:** 7 days
  - **Files:** edge/src/ivis_engine.cpp/.h

### Edge: BLE

- [ ] **TASK-028:** Implement BLE peripheral (broadcast)
  - **Description:** Advertise stress score service, push updated value every 200 ms
  - **Acceptance Criteria:** 
    - Mobile can scan and discover service
    - Stress value updates visible on mobile
    - Latency: publish every 200 ms ± 10%
  - **Effort:** 5 days
  - **Files:** edge/src/ivis_engine.cpp/.h

### Edge: Camera

- [ ] **TASK-029:** Integrate GMSL2 camera
  - **Description:** Open V4L2 device, capture frames at 30 FPS, 640×480
  - **Acceptance Criteria:** Frames feed into RKNN inference pipeline
  - **Effort:** 6 days
  - **Files:** edge/src/ivis_engine.cpp/.h

### Edge: Latency & Performance

- [ ] **TASK-030:** Add instrumentation for latency measurement
  - **Description:** Log start/end times for CAN parse, RKNN inference, event dispatch
  - **Acceptance Criteria:** 
    - Mean latency < 50 ms
    - P99 latency < 100 ms
    - Logged per operation
  - **Effort:** 2 days
  - **Files:** edge/src/ivis_engine.cpp/.h

- [ ] **TASK-031:** Validate latency budget
  - **Description:** Run on RV1126 under load, collect 1000 cycles, verify SLA
  - **Acceptance Criteria:** Latency profiling shows < 50 ms mean, < 100 ms p99
  - **Effort:** 3 days
  - **Files:** edge/tests/ (new)

### Edge: Unit Tests

- [ ] **TASK-032:** Write tests for OBD parser
  - **Description:** 15+ test cases (Mode 01 frames, errors, edge cases)
  - **Acceptance Criteria:** All paths covered, no crashes on invalid input
  - **Effort:** 3 days
  - **Files:** edge/tests/test_obd_parser.cpp (new)

- [ ] **TASK-033:** Write tests for stress_index
  - **Description:** 15+ test cases (verify algorithm matches Python/JS, weights)
  - **Acceptance Criteria:** Output identical to other implementations
  - **Effort:** 3 days
  - **Files:** edge/tests/test_stress_index.cpp (new)

- [ ] **TASK-034:** Write tests for intervention_dispatcher
  - **Description:** 10+ test cases (rule precedence, RPM gate, speed gate, cooldown)
  - **Acceptance Criteria:** All rules enforced correctly
  - **Effort:** 2 days
  - **Files:** edge/tests/test_dispatcher.cpp (new)

- [ ] **TASK-035:** Write tests for RKNN inference
  - **Description:** Mock model calls, verify outputs
  - **Acceptance Criteria:** Inference correctly feeds into stress computation
  - **Effort:** 2 days
  - **Files:** edge/tests/test_rknn.cpp (new)

### Edge: Integration (RV1126)

- [ ] **TASK-036:** Deploy to real RV1126 and validate
  - **Description:** Cross-compile, flash firmware, verify all hardware works end-to-end
  - **Acceptance Criteria:** 
    - CAN connects to test harness
    - RKNN inference runs
    - BLE advertises to mobile
    - Stress signal publishes every 200 ms
  - **Effort:** 5 days
  - **Files:** All edge code

---

## PHASE 4: PYTHON CORE (WEEKS 5–8)

### Python: SLM (Small Language Model)

- [ ] **TASK-037:** Implement Phi3 GGUF direct integration
  - **Description:** Download model on first run, use llama-cpp-python for inference
  - **Acceptance Criteria:** 
    - Model downloads to `~/.thunai/models/phi-3-mini.gguf` on first run
    - Inference latency < 5s for IVIS prompts
    - Fallback to Ollama if local fails
  - **Effort:** 4 days
  - **Files:** src/thunai/intelligence/slm/phi3.py

- [ ] **TASK-038:** Add Ollama retry logic with exponential backoff
  - **Description:** Retry failed Ollama calls with 1s → 2s → 4s delays
  - **Acceptance Criteria:** 
    - Retries up to 3 times before failing
    - Backoff implemented correctly
    - Logged with timestamps
  - **Effort:** 2 days
  - **Files:** src/thunai/intelligence/slm/ollama.py

- [ ] **TASK-039:** Implement circuit breaker for SLM
  - **Description:** Track Ollama/Phi3 failures, skip after 5 consecutive failures
  - **Acceptance Criteria:** Circuit breaker prevents cascading failures
  - **Effort:** 2 days
  - **Files:** src/thunai/intelligence/slm/factory.py

### Python: Perception/CV

- [ ] **TASK-040:** Implement YOLO integration
  - **Description:** Load YOLOv8s weights, export to RKNN format for edge unit
  - **Acceptance Criteria:** Model runs on both desktop (ONNX) and edge (RKNN)
  - **Effort:** 8 days
  - **Files:** src/thunai/perception/yolo.py (new)

- [ ] **TASK-041:** Implement lane detection
  - **Description:** Use LaneNet or similar pre-trained model, output lane boundaries
  - **Acceptance Criteria:** Lane position detected within 10 pixels (validate on test video)
  - **Effort:** 6 days
  - **Files:** src/thunai/perception/lane_detector.py (new)

- [ ] **TASK-042:** Implement driver gaze/drowsiness detection
  - **Description:** Use RKNN-compatible face + eye detector, output eye aspect ratio
  - **Acceptance Criteria:** Detects eye closure < 500 ms latency
  - **Effort:** 6 days
  - **Files:** src/thunai/perception/gaze_detector.py (new)

- [ ] **TASK-043:** Integrate perception into IVIS event loop
  - **Description:** Call perception detectors, feed results to intervention logic
  - **Acceptance Criteria:** CV detections trigger appropriate interventions
  - **Effort:** 3 days
  - **Files:** src/thunai/features/ivis.py

### Python: VLM (Vision Language Model)

- [ ] **TASK-044:** Implement Gemini VLM streaming
  - **Description:** Refactor [src/thunai/intelligence/vlm/gemini.py](src/thunai/intelligence/vlm/gemini.py) to use actual `generate_content_stream()`
  - **Acceptance Criteria:** 
    - Camera frames analyzed (0.5 FPS max)
    - Responses are coherent scene descriptions
    - Streaming latency < 5s per frame
  - **Effort:** 4 days
  - **Files:** src/thunai/intelligence/vlm/gemini.py

### Python: Error Handling & Testing

- [ ] **TASK-045:** Add missing error test cases
  - **Description:** Add negative tests for missing config, invalid inputs, API failures
  - **Acceptance Criteria:** 95%+ test coverage on intelligence modules
  - **Effort:** 4 days
  - **Files:** tests/intelligence/

- [ ] **TASK-046:** Add integration test: Python ↔ Backend
  - **Description:** Mock backend API, verify feedback generation flow works
  - **Acceptance Criteria:** Full flow from OBD data to narrative generation
  - **Effort:** 3 days
  - **Files:** tests/integration/ (new)

---

## PHASE 5: TESTING & DOCUMENTATION (WEEKS 9–12)

### Backend: Additional Tests

- [ ] **TASK-047:** Database integration tests
  - **Description:** Real PostgreSQL, not mocked (use test container)
  - **Acceptance Criteria:** All CRUD operations tested
  - **Effort:** 3 days
  - **Files:** backend/tests/db.integration.test.js (new)

- [ ] **TASK-048:** Auth integration tests
  - **Description:** Test Firebase token verification (mock Firebase API)
  - **Acceptance Criteria:** Valid/expired/invalid tokens handled
  - **Effort:** 2 days
  - **Files:** backend/tests/auth.integration.test.js (new)

- [ ] **TASK-049:** Load testing
  - **Description:** 1000 concurrent users, 5 min test, measure latency/errors
  - **Acceptance Criteria:** 
    - P95 latency < 2s
    - Error rate < 0.1%
    - No memory leaks
  - **Effort:** 4 days
  - **Files:** backend/tests/load.test.js (new), artillery.yml (new)

### Integration Tests (Mobile ↔ Backend ↔ Python)

- [ ] **TASK-050:** Full onboarding flow E2E test
  - **Description:** Start app → fill questionnaire → authenticate → ready to drive
  - **Acceptance Criteria:** Flow completes without errors
  - **Effort:** 4 days
  - **Files:** tests/E2E/onboarding.test.js (new)

- [ ] **TASK-051:** Drive session flow E2E test
  - **Description:** Create session → stream OBD data → trigger intervention → end session
  - **Acceptance Criteria:** Data persisted, feedback generated
  - **Effort:** 4 days
  - **Files:** tests/E2E/drive_session.test.js (new)

- [ ] **TASK-052:** Therapist conversation E2E test
  - **Description:** Start conversation → send message → receive LLM response → end
  - **Acceptance Criteria:** Streaming works, conversation history persisted
  - **Effort:** 3 days
  - **Files:** tests/E2E/therapist.test.js (new)

### Documentation

- [ ] **TASK-053:** Create OpenAPI 3.0 specification
  - **Description:** Document all endpoints, request/response schemas, error codes
  - **Acceptance Criteria:** 
    - Auto-generates Swagger UI
    - All endpoints documented with examples
  - **Effort:** 4 days
  - **Files:** docs/openapi.yaml (new)

- [ ] **TASK-054:** Write operational runbooks
  - **Description:** "OBD Down", "Gemini Rate Limited", "DB Backup", "Certificate Rotation", "Zero-Downtime Deployment"
  - **Acceptance Criteria:** Each runbook tested, ops team trained
  - **Effort:** 5 days
  - **Files:** docs/RUNBOOKS.md (new)

- [ ] **TASK-055:** Create Architecture Decision Records (ADRs)
  - **Description:** Explain design choices (stress weights, intervention cooldown, speed gate, etc.)
  - **Acceptance Criteria:** 
    - ADR-001: Stress Index Weights (0.4, 0.4, 0.2)
    - ADR-002: Intervention Cooldown (30s)
    - ADR-003: Speed Gate (80 km/h)
    - ADR-004: Route Weights
    - ADR-005: Fallback Chain (Gemini → Claude → OpenAI)
  - **Effort:** 4 days
  - **Files:** docs/ADRs/ (new)

- [ ] **TASK-056:** Update README files
  - **Description:** Add deployment instructions, architecture overview, troubleshooting
  - **Acceptance Criteria:** New developer can set up in 1 hour
  - **Effort:** 2 days
  - **Files:** README.md, docs/LOCAL_SETUP_WINDOWS.md (updated)

- [ ] **TASK-057:** Create deployment guide
  - **Description:** Container images, k8s manifests (if using), secrets management, DNS, TLS
  - **Acceptance Criteria:** DevOps can deploy to prod without asking questions
  - **Effort:** 3 days
  - **Files:** docs/DEPLOYMENT.md (new)

- [ ] **TASK-058:** Create troubleshooting guide
  - **Description:** Common issues (OBD offline, LLM timeout, DB slow, etc.) and solutions
  - **Acceptance Criteria:** Support team can self-serve 80% of issues
  - **Effort:** 3 days
  - **Files:** docs/TROUBLESHOOTING.md (new)

### Configuration & OEM Customization

- [ ] **TASK-059:** Expand [config/default.yaml](config/default.yaml) with all customizable params
  - **Description:** Move hardcoded values (stress thresholds, cooldown, speed gate, route weights, etc.) to config
  - **Acceptance Criteria:** All parameters configurable without code changes
  - **Effort:** 2 days
  - **Files:** config/default.yaml

- [ ] **TASK-060:** Create per-OEM config loading
  - **Description:** Load `customer-config.yaml` after `default.yaml` for OEM overrides
  - **Acceptance Criteria:** Each OEM gets own config without code changes
  - **Effort:** 1 day
  - **Files:** src/thunai/config.py (updated)

---

## PHASE 6: DEPLOYMENT PREP (WEEK 12)

### Monitoring & Observability

- [ ] **TASK-061:** Set up Prometheus metrics
  - **Description:** Measure request latency (histogram), error rate (counter), LLM availability (gauge)
  - **Acceptance Criteria:** Metrics exposed on `/metrics` endpoint
  - **Effort:** 2 days
  - **Files:** backend/src/middleware/metrics.js (new), src/thunai/metrics.py (new)

- [ ] **TASK-062:** Set up Grafana dashboard
  - **Description:** Graph latency, error rate, throughput, LLM provider status
  - **Acceptance Criteria:** Dashboard auto-updates, SLA violations highlighted
  - **Effort:** 2 days
  - **Files:** Docker Compose or k8s deployment

- [ ] **TASK-063:** Configure Sentry error tracking
  - **Description:** Integrate with backend, mobile, Python; alert on errors
  - **Acceptance Criteria:** Errors automatically reported with context
  - **Effort:** 1 day
  - **Files:** backend/src/index.js, mobile/App.js, src/thunai/sentry.py (new)

- [ ] **TASK-064:** Set up log aggregation (ELK)
  - **Description:** Centralize logs from backend, edge, mobile for debugging
  - **Acceptance Criteria:** Searchable logs with timestamp, context, request ID
  - **Effort:** 2 days
  - **Files:** Docker Compose, Logstash config

- [ ] **TASK-065:** Configure Slack alerting
  - **Description:** Critical errors → Slack #incidents, daily SLA report
  - **Acceptance Criteria:** Alerts actionable, not noisy
  - **Effort:** 1 day
  - **Files:** lambda.js (if AWS), or alert rules in Prometheus

### Database & Backup

- [ ] **TASK-066:** Implement automated database backups
  - **Description:** Daily backups to S3 with retention policy (30 days)
  - **Acceptance Criteria:** Can restore from backup in < 5 min
  - **Effort:** 2 days
  - **Files:** backup.sh, cron config

- [ ] **TASK-067:** Test backup/restore procedure
  - **Description:** Simulate data loss, verify recovery works
  - **Acceptance Criteria:** Full DR test passed, RTO < 5 min, RPO < 1 day
  - **Effort:** 1 day
  - **Files:** tests/DR.test.js (new)

### Deployment

- [ ] **TASK-068:** Create Docker images (backend, Python core)
  - **Description:** Containerize for easy deployment
  - **Acceptance Criteria:** Images build, pass health checks
  - **Effort:** 2 days
  - **Files:** backend/Dockerfile, src/Dockerfile

- [ ] **TASK-069:** Set up CI/CD pipeline (GitHub Actions)
  - **Description:** Run tests, build images, push to registry on every merge
  - **Acceptance Criteria:** Pipeline passes before production deploy
  - **Effort:** 2 days
  - **Files:** .github/workflows/

- [ ] **TASK-070:** Document zero-downtime deployment
  - **Description:** Blue-green or canary strategy, rolling updates
  - **Acceptance Criteria:** Can deploy without downtime
  - **Effort:** 1 day
  - **Files:** docs/DEPLOYMENT.md (updated)

### Security Audit

- [ ] **TASK-071:** Conduct OWASP Top 10 security review
  - **Description:** Scan for SQL injection, XSS, CSRF, auth bypass, etc.
  - **Acceptance Criteria:** 0 critical, 0 high vulnerabilities
  - **Effort:** 3 days
  - **Files:** SECURITY_AUDIT.md (new)

- [ ] **TASK-072:** TLS certificate setup & rotation
  - **Description:** Purchase certificate, auto-rotate every 12 months
  - **Acceptance Criteria:** HTTPS working, certificate valid
  - **Effort:** 1 day
  - **Files:** TLS cert + renewal automation

### Staff Training

- [ ] **TASK-073:** Train ops team on runbooks
  - **Description:** How to respond to OBD down, LLM timeout, DB slow, etc.
  - **Acceptance Criteria:** Ops team can handle incidents independently
  - **Effort:** 1 day (4 hours training + 2 hours hands-on)

- [ ] **TASK-074:** Train support team on troubleshooting
  - **Description:** How to query audit logs, check system health, escalate
  - **Acceptance Criteria:** Support resolves 80% of user issues without escalation
  - **Effort:** 1 day (4 hours training)

---

## CROSS-CUTTING CONCERNS

### Accessibility & Localization

- [ ] **TASK-075:** Validate Sarvam TTS for all supported languages
  - **Description:** Test Hindi, Tamil, Telugu, Marathi TTS quality
  - **Acceptance Criteria:** All languages sound natural, no errors
  - **Effort:** 2 days
  - **Files:** src/thunai/interaction/sarvam.py

### Compliance & Legal

- [ ] **TASK-076:** Define data retention policy
  - **Description:** Document how long each data type is stored (sessions: 90 days, audit: 2 years, etc.)
  - **Acceptance Criteria:** Policy written, deletions automated
  - **Effort:** 1 day
  - **Files:** docs/DATA_RETENTION.md (new)

- [ ] **TASK-077:** Implement GDPR deletion endpoint
  - **Description:** POST /admin/users/{id}/delete → purge all personal data
  - **Acceptance Criteria:** User fully deleted (including audit trail, sessions, biometrics)
  - **Effort:** 2 days
  - **Files:** backend/src/routes/admin.js (new)

- [ ] **TASK-078:** Document incident response plan
  - **Description:** How to respond to security breach, data loss, outage
  - **Acceptance Criteria:** Plan reviewed by legal/compliance
  - **Effort:** 1 day
  - **Files:** docs/INCIDENT_RESPONSE.md (new)

---

## QUALITY ASSURANCE

### Test Coverage Goals

- [ ] **TASK-079:** Achieve 80%+ code coverage on all modules
  - **Description:** Run coverage tool, identify and test uncovered paths
  - **Acceptance Criteria:** Coverage report shows >= 80% across all modules
  - **Effort:** 5 days (spread across phases)
  - **Files:** .nycrc, .istanbul.yml

- [ ] **TASK-080:** Mutation testing (identify weak tests)
  - **Description:** Use Stryker to mutate code, verify tests catch mutations
  - **Acceptance Criteria:** > 80% mutation score
  - **Effort:** 2 days
  - **Files:** stryker.conf.js

### Performance Profiling

- [ ] **TASK-081:** Profile backend API latency
  - **Description:** Identify slow endpoints, optimize hot paths
  - **Acceptance Criteria:** All endpoints < 2s P95
  - **Effort:** 3 days
  - **Files:**  backend/src/ (optimizations)

- [ ] **TASK-082:** Profile mobile battery usage
  - **Description:** Identify power-hungry services (BT, GPS, TTS), optimize
  - **Acceptance Criteria:** Device battery lasts 8+ hours on full drive
  - **Effort:** 3 days
  - **Files:** mobile/src/services/

- [ ] **TASK-083:** Profile edge memory usage
  - **Description:** Verify no memory leaks, < 100 MB steady state
  - **Acceptance Criteria:** Memory usage stable after 24h continuous operation
  - **Effort:** 2 days
  - **Files:** edge/src/ + Valgrind

---

## FINAL VERIFICATION

- [ ] **TASK-084:** Pre-launch checklist
  - **Description:** All items from "Definition of Done" verified
  - **Acceptance Criteria:** Checklist 100% complete
  - **Effort:** 1 day
  - **Files:** LAUNCH_CHECKLIST.md

- [ ] **TASK-085:** OEM customer training
  - **Description:** Training materials, API docs, onboarding guide
  - **Acceptance Criteria:** OEM can integrate and deploy independently
  - **Effort:** 3 days
  - **Files:** docs/OEM_INTEGRATION_GUIDE.md (new)

- [ ] **TASK-086:** Post-launch support plan
  - **Description:** SLA terms, escalation procedures, support contacts
  - **Acceptance Criteria:** Support team trained and ready
  - **Effort:** 1 day
  - **Files:** docs/SUPPORT_SLA.md (new)

- [ ] **TASK-087:** Archive & handoff documentation
  - **Description:** Centralize all docs, create knowledge base
  - **Acceptance Criteria:** All documentation indexed, searchable
  - **Effort:** 1 day
  - **Files:** docs/INDEX.md (new)

---

## SUMMARY BY PHASE

| Phase | Duration | Effort | FTE | Key Deliverables |
|-------|----------|--------|-----|------------------|
| 1: Foundation | 2 wks | 18 days | 1.5 | Migrations, rate limiting, timeouts, validation |
| 2: Mobile | 2 wks | 28 days | 2 | Error recovery, security, 500+ tests |
| 3: Edge | 6 wks | 60 days | 2.5 | Hardware init, CV integration, 100+ tests |
| 4: Python | 4 wks | 40 days | 1.5 | SLM, VLM, perception, circuit breaker |
| 5: Testing | 4 wks | 45 days | 1.5 | Integration tests, documentation, security audit |
| 6: Deployment | 1 wk | 15 days | 1 | Monitoring, backup, CI/CD, training |
| **Total** | **12 wks** | **206 days** | **2.5 avg** | **Production-ready** |

---

## TASK DEPENDENCY GRAPH

```
PHASE 1 (Sequential)
├─ Tasks 001–004 (Migrations)
├─ Tasks 005–007 (Rate limiting)
├─ Tasks 008–010 (LLM timeout)
├─ Tasks 011–012 (Input validation)
└─ Task 012 (Request tracing) → used in later phases

PHASE 2 & 3 (Parallel)
├─ Tasks 013–023 (Mobile) — can start independently
├─ Tasks 024–036 (Edge) — can start after Phase 1, but hardware critical path
└─ Tasks 045–046 (Python error tests) — can be done anytime

PHASE 4 (Depends on Phase 3 hardware)
├─ Tasks 037–039 (SLM) — independent
├─ Tasks 040–043 (Perception) — must have edge HW
└─ Tasks 044–046 (VLM + testing) — independent

PHASE 5 (Depends on Phases 1–4)
├─ All backend/integration tests
└─ All documentation (can start in parallel with Phase 4)

PHASE 6 (Final phase)
└─ Depends on completion of all phases
```

---

## HOW TO USE THIS BREAKDOWN

1. **Copy tasks into your project tracker** (Jira, Linear, Asana, GitHub Projects)
2. **Assign to engineers** based on skillset:
   - Backend engineer: Tasks 001–012, 047–049, 061–065
   - Mobile engineer: Tasks 013–023, 073
   - Edge/Hardware engineer: Tasks 024–036
   - Python engineer: Tasks 037–046, 074
   - DevOps/QA: Tasks 050–058, 066–072
3. **Review weekly** to identify blockers
4. **Mark tasks complete** as code review passes
5. **Re-baseline** if scope changes

---

**Version:** 1.0  
**Created:** 2026-04-03  
**Last Updated:** 2026-04-03  
**Total Tasks:** 87  
**Status:** Ready for distribution
