# thun.ai Operational Runbooks

**Last Updated:** 2026-04-03  
**Audience:** Operations team, on-call engineers, DevOps  
**Severity Levels:** P0 (critical) → P3 (low)

---

## Table of Contents

1. [OBD Service Down (Edge Unit Recovery)](#1-obd-service-down-edge-unit-recovery)
2. [Gemini API Rate Limited / Unavailable](#2-gemini-api-rate-limited--unavailable)
3. [Database Backup and Restore](#3-database-backup-and-restore)
4. [TLS Certificate Rotation](#4-tls-certificate-rotation)
5. [Zero-Downtime Deployment](#5-zero-downtime-deployment)
6. [Querying Audit Logs for Support](#6-querying-audit-logs-for-support)
7. [Redis Outage](#7-redis-outage)
8. [Mobile App Crash Investigation](#8-mobile-app-crash-investigation)
9. [Circuit Breaker Recovery](#9-circuit-breaker-recovery)
10. [High Latency Investigation](#10-high-latency-investigation)

---

## 1. OBD Service Down (Edge Unit Recovery)

**Severity:** P0 (if during active drive), P2 (if idle)  
**Impact:** No vehicle telemetry → no stress computation → no interventions  
**Alerting:** Sentry error: `OBDService reconnect failed after 10 attempts`

### Symptoms
- Mobile app shows "OBD Disconnected" banner
- Stress index falls back to biometrics-only mode
- No CAN frames received for > 30 seconds

### Resolution Steps

1. **Verify Bluetooth connection**
   ```
   Check: Is the OBD-II adapter powered on?
   Check: Is the adapter paired in phone Bluetooth settings?
   Check: Is the adapter LED blinking (data mode)?
   ```

2. **Restart the OBD adapter**
   - Unplug the adapter from the OBD-II port
   - Wait 10 seconds
   - Replug and wait for LED to stabilize

3. **Restart the edge unit (if applicable)**
   ```bash
   ssh root@<edge-ip>
   systemctl restart ivis-engine
   journalctl -u ivis-engine -n 50  # Check startup logs
   ```

4. **Check CAN bus status (RV1126)**
   ```bash
   ip link show can0
   candump can0 -n 5  # Should show OBD-II frames
   ```

5. **If CAN socket is down:**
   ```bash
   ip link set can0 type can bitrate 500000
   ip link set can0 up
   ```

6. **Fallback:** If OBD remains unavailable, the system automatically falls back to biometrics-only stress computation with adjusted weights (HR/HRV = 66.7%, CV = 33.3%).

### Prevention
- Schedule weekly OBD adapter firmware checks
- Monitor reconnection attempt metrics in Grafana
- Set alert for > 5 consecutive reconnection failures

---

## 2. Gemini API Rate Limited / Unavailable

**Severity:** P1  
**Impact:** Post-drive feedback delayed; LLM-powered features degraded  
**Alerting:** Circuit breaker state change → Slack notification

### Symptoms
- `/feedback/generate` responses include `X-Fallback: true` header
- Circuit breaker for `gemini` shows state `open` on `/health/providers`
- Sentry logs: `[CircuitBreaker] gemini OPEN after 5 failures`

### Resolution Steps

1. **Check circuit breaker status**
   ```bash
   curl https://api.thun.ai/health/providers | jq .
   ```

2. **Verify API key and quota**
   - Log into Google AI Studio → Check usage and billing
   - Verify `GEMINI_API_KEY` env var is set correctly
   - Check if daily/monthly quota is exhausted

3. **If rate limited (429):**
   - The system automatically falls back: Gemini → Claude → OpenAI
   - Monitor fallback latency in Grafana
   - If all providers are rate limited, synthetic fallback narrative is returned

4. **If API is down (5xx):**
   - Check [Google Cloud Status Dashboard](https://status.cloud.google.com)
   - Wait for resolution; circuit breaker will auto-recover after 5 minutes

5. **Manual circuit breaker reset (if needed):**
   ```bash
   # Via admin API (when implemented)
   curl -X POST https://api.thun.ai/admin/circuit-breaker/reset?provider=gemini
   ```

6. **Switch default provider:**
   ```bash
   # Update environment
   export LLM_PRIMARY_PROVIDER=claude
   # Restart backend
   pm2 restart thunai-backend
   ```

### Prevention
- Set up budget alerts in Google Cloud Console
- Monitor daily API call volume
- Maintain at least 2 active LLM API keys

---

## 3. Database Backup and Restore

**Severity:** P0 (data loss), P3 (routine backup)  
**Schedule:** Daily automated backup at 02:00 UTC

### Backup Procedure

1. **Automated backup (cron):**
   ```bash
   pg_dump -h $DB_HOST -U $DB_USER -d thunai \
     --format=custom --compress=9 \
     -f /backups/thunai_$(date +%Y%m%d_%H%M%S).dump
   ```

2. **Upload to S3:**
   ```bash
   aws s3 cp /backups/thunai_*.dump s3://thunai-backups/daily/ \
     --storage-class STANDARD_IA
   ```

3. **Verify backup integrity:**
   ```bash
   pg_restore --list /backups/thunai_latest.dump | head -20
   ```

### Restore Procedure

1. **Stop the application:**
   ```bash
   pm2 stop thunai-backend
   ```

2. **Restore from backup:**
   ```bash
   # Download latest backup
   aws s3 cp s3://thunai-backups/daily/thunai_latest.dump /tmp/

   # Restore (WARNING: this drops existing data)
   pg_restore -h $DB_HOST -U $DB_USER -d thunai \
     --clean --if-exists /tmp/thunai_latest.dump
   ```

3. **Run pending migrations:**
   ```bash
   cd backend && npm run migrate
   ```

4. **Restart application:**
   ```bash
   pm2 start thunai-backend
   ```

5. **Verify:**
   ```bash
   curl https://api.thun.ai/health
   psql -h $DB_HOST -U $DB_USER -d thunai -c "SELECT COUNT(*) FROM users;"
   ```

### Retention Policy
- **Daily backups:** retained for 30 days
- **Weekly backups:** retained for 90 days
- **Monthly backups:** retained for 2 years
- **Audit logs:** retained for 2 years (configurable)

---

## 4. TLS Certificate Rotation

**Severity:** P0 (certificate expiry = service outage)  
**Schedule:** Every 12 months (set calendar reminder)  
**Alert:** 30 days before expiry via monitoring

### Rotation Steps

1. **Generate new certificate:**
   ```bash
   certbot renew --cert-name api.thun.ai
   ```

2. **Verify new certificate:**
   ```bash
   openssl x509 -in /etc/letsencrypt/live/api.thun.ai/fullchain.pem \
     -noout -dates -subject
   ```

3. **Update mobile TLS pinning (IMPORTANT):**
   - Generate new SHA-256 pin:
     ```bash
     openssl x509 -in fullchain.pem -pubkey -noout | \
       openssl pkey -pubin -outform DER | \
       openssl dgst -sha256 -binary | openssl enc -base64
     ```
   - Update pin in mobile app configuration
   - Release new mobile app version with updated pins
   - **Include BOTH old and new pins during transition period**

4. **Restart backend with new cert:**
   ```bash
   pm2 restart thunai-backend
   ```

5. **Verify:**
   ```bash
   curl -v https://api.thun.ai/health 2>&1 | grep "SSL certificate"
   ```

### Critical Notes
- Always include both old AND new certificate pins in mobile app during rotation
- Schedule mobile app release 2 weeks before certificate rotation
- Never let certificates expire — set multiple reminders

---

## 5. Zero-Downtime Deployment

**Severity:** P3 (planned maintenance)

### Pre-Deployment Checklist
- [ ] All tests passing on CI
- [ ] Database migrations reviewed (no breaking changes)
- [ ] Feature flags for new features configured
- [ ] Rollback plan documented

### Deployment Steps

1. **Run database migrations first:**
   ```bash
   cd backend && npm run migrate
   npm run migrate:info  # Verify migration status
   ```

2. **Deploy with rolling restart:**
   ```bash
   # If using PM2 cluster mode
   pm2 reload thunai-backend --update-env

   # If using Docker
   docker-compose up -d --no-deps --build backend
   ```

3. **Verify health:**
   ```bash
   curl https://api.thun.ai/health
   curl https://api.thun.ai/health/providers
   ```

4. **Monitor for 15 minutes:**
   - Check error rate in Grafana (should be < 0.1%)
   - Check latency P95 (should be < 2s)
   - Check Sentry for new errors

### Rollback Procedure

1. **Revert code:**
   ```bash
   git revert HEAD
   pm2 reload thunai-backend
   ```

2. **Revert database migration (if applicable):**
   ```bash
   cd backend && flyway undo
   ```

---

## 6. Querying Audit Logs for Support

**Severity:** P3  
**Use Case:** User dispute ("I didn't ask for this intervention"), GDPR request

### Query Examples

```sql
-- All actions by a specific user in the last 24 hours
SELECT action, resource_type, resource_id, timestamp, ip_address
FROM audit_log
WHERE user_id = '550e8400-...'
  AND timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- All therapist conversations in the last week
SELECT user_id, timestamp, new_values->>'messageCount' AS msg_count
FROM audit_log
WHERE action = 'THERAPIST_CHAT'
  AND timestamp > NOW() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- All interventions delivered to a user
SELECT resource_id, new_values, timestamp
FROM audit_log
WHERE user_id = '550e8400-...'
  AND action = 'INTERVENTION_DELIVERED'
ORDER BY timestamp DESC;

-- GDPR: All data for a user (for deletion request)
SELECT * FROM audit_log WHERE user_id = '550e8400-...'
ORDER BY timestamp ASC;
```

### API Endpoint (Admin)
```bash
curl "https://api.thun.ai/admin/audit?user_id=550e8400-...&action=THERAPIST_CHAT&date_range=2026-04-01,2026-04-03" \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

---

## 7. Redis Outage

**Severity:** P2  
**Impact:** Rate limiting falls back to in-memory (per-instance, not distributed)  
**Alerting:** `[Redis] Failed to initialize` in logs

### Resolution Steps

1. **Check Redis status:**
   ```bash
   redis-cli ping  # Should return PONG
   redis-cli info server | head -10
   ```

2. **Restart Redis:**
   ```bash
   systemctl restart redis
   ```

3. **If Redis is unreachable:**
   - The app automatically falls back to in-memory rate limiting
   - This means limits are per-instance, not shared across pods
   - Log a warning: `[RateLimit] Error: ... (failing open)`

4. **Verify recovery:**
   ```bash
   redis-cli set test_key test_value
   redis-cli get test_key
   ```

---

## 8. Mobile App Crash Investigation

**Severity:** P1  
**Tools:** Sentry, device logs

### Steps

1. Check Sentry for crash reports and stack traces
2. Filter by device, OS version, app version
3. Check if crash is related to OBD/BLE disconnect
4. Review device logs:
   ```bash
   # Android
   adb logcat | grep -i "thunai\|react\|crash"
   
   # iOS
   # Check Xcode Organizer → Crashes
   ```

---

## 9. Circuit Breaker Recovery

**Severity:** P2

### When a circuit breaker is stuck open:

1. Check `/health/providers` to see which provider is affected
2. Verify the external service is actually available
3. Wait for automatic recovery (5 minutes after last failure)
4. If needed, manually reset via admin API or restart the service

---

## 10. High Latency Investigation

**Severity:** P1 (if exceeding SLA)

### SLA Targets

| Operation | Target | P95 | P99 |
|-----------|--------|-----|-----|
| POST /feedback/generate | 30s | 35s | 45s |
| Stress index computation | 200ms | 250ms | 400ms |
| Edge intervention dispatch | 50ms | 60ms | 100ms |

### Steps

1. Check Grafana dashboard for latency trends
2. Identify slow endpoint from `X-Request-ID` trace
3. Common causes:
   - LLM provider slowdown → check circuit breaker states
   - Database query slow → check `pg_stat_activity`
   - Network issue → check DNS resolution time
4. If database is slow:
   ```sql
   SELECT query, calls, mean_time, max_time
   FROM pg_stat_statements
   ORDER BY mean_time DESC LIMIT 10;
   ```
