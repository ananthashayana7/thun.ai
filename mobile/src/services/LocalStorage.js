/**
 * LocalStorage.js
 * SQLite wrapper – persists anxiety profile and 90-day drive history on device.
 * Uses react-native-sqlite-storage.
 */
import SQLite from 'react-native-sqlite-storage';
import { DB } from '../utils/constants';
import dayjs from 'dayjs';

SQLite.enablePromise(true);

let _db = null;

async function getDb() {
  _db = await SQLite.openDatabase({
    name: DB.NAME,
    location: 'default',
    // In production, we must use SQLite encryption (SQLCipher) to protect biometric data at rest.
    // The key should be obtained from a secure source like the phone's Keychain/Keystore.
    key: process.env.DB_ENCRYPTION_KEY || 'default-secure-passphrase-0x987654321', // TODO: use native key management
  });
  await _initSchema(_db);
  return _db;
}

async function _initSchema(db) {
  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS drive_sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      route_meta TEXT,
      telemetry_summary TEXT,
      stress_events TEXT,
      anxiety_score_avg REAL,
      peak_stress REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS interventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity INTEGER NOT NULL,
      triggered_at TEXT NOT NULL,
      acknowledged INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES drive_sessions(id)
    );
  `);

  // Index for fast per-session intervention lookups.
  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS idx_interventions_session_id ON interventions (session_id);
  `);

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_key TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      body TEXT,
      headers TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      response_data TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.executeSql(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status_attempt ON sync_queue (status, next_attempt_at);
  `);

  // Purge sessions older than 90 days automatically
  const cutoff = dayjs().subtract(DB.DRIVE_HISTORY_DAYS, 'day').toISOString();
  await db.executeSql(`DELETE FROM drive_sessions WHERE created_at < ?;`, [cutoff]);
}

// ─── Profile CRUD ─────────────────────────────────────────────────────────────

async function getProfile() {
  const db = await getDb();
  const [result] = await db.executeSql(`SELECT data FROM profile WHERE id = 1;`);
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows.item(0).data);
}

async function saveProfile(profile) {
  const db = await getDb();
  await db.executeSql(
    `INSERT OR REPLACE INTO profile (id, data) VALUES (1, ?);`,
    [JSON.stringify(profile)]
  );
}

// ─── Drive Session CRUD ───────────────────────────────────────────────────────

async function saveDriveSession(session) {
  const db = await getDb();
  await db.executeSql(
    `INSERT OR REPLACE INTO drive_sessions
       (id, started_at, ended_at, route_meta, telemetry_summary, stress_events, anxiety_score_avg, peak_stress)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      session.id,
      session.startedAt,
      session.endedAt || null,
      JSON.stringify(session.routeMeta || {}),
      JSON.stringify(session.telemetrySummary || {}),
      JSON.stringify(session.stressEvents || []),
      session.anxietyScoreAvg || 0,
      session.peakStress || 0,
    ]
  );
}

async function getDriveSessions(limit = 30) {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM drive_sessions ORDER BY started_at DESC LIMIT ?;`,
    [limit]
  );
  const sessions = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    sessions.push({
      ...row,
      routeMeta: JSON.parse(row.route_meta || '{}'),
      telemetrySummary: JSON.parse(row.telemetry_summary || '{}'),
      stressEvents: JSON.parse(row.stress_events || '[]'),
    });
  }
  return sessions;
}

async function getDriveSession(id) {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM drive_sessions WHERE id = ?;`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows.item(0);
  return {
    ...row,
    routeMeta: JSON.parse(row.route_meta || '{}'),
    telemetrySummary: JSON.parse(row.telemetry_summary || '{}'),
    stressEvents: JSON.parse(row.stress_events || '[]'),
  };
}

// ─── Intervention Logging ─────────────────────────────────────────────────────

async function logIntervention(sessionId, type, severity) {
  const db = await getDb();
  await db.executeSql(
    `INSERT INTO interventions (session_id, type, severity, triggered_at) VALUES (?, ?, ?, ?);`,
    [sessionId, type, severity, new Date().toISOString()]
  );
}

async function getInterventionsForSession(sessionId) {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM interventions WHERE session_id = ? ORDER BY triggered_at ASC;`,
    [sessionId]
  );
  const interventions = [];
  for (let i = 0; i < result.rows.length; i++) {
    interventions.push(result.rows.item(i));
  }
  return interventions;
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function getSyncRequest(requestKey) {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT * FROM sync_queue WHERE request_key = ? LIMIT 1;`,
    [requestKey]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows.item(0);
  return {
    ...row,
    body: parseJsonField(row.body, null),
    headers: parseJsonField(row.headers, {}),
    responseData: parseJsonField(row.response_data, null),
  };
}

async function saveSyncRequest(request) {
  const db = await getDb();
  const existing = await getSyncRequest(request.requestKey);

  if (existing) {
    await db.executeSql(
      `UPDATE sync_queue
       SET method = ?,
           url = ?,
           body = ?,
           headers = ?,
           status = ?,
           response_data = ?,
           attempt_count = ?,
           last_error = ?,
           next_attempt_at = ?,
           updated_at = datetime('now')
       WHERE request_key = ?;`,
      [
        request.method,
        request.url,
        JSON.stringify(request.body ?? null),
        JSON.stringify(request.headers ?? {}),
        request.status,
        JSON.stringify(request.responseData ?? null),
        request.attemptCount ?? 0,
        request.lastError ?? null,
        request.nextAttemptAt ?? new Date().toISOString(),
        request.requestKey,
      ]
    );
  } else {
    await db.executeSql(
      `INSERT INTO sync_queue
         (request_key, method, url, body, headers, status, response_data, attempt_count, last_error, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        request.requestKey,
        request.method,
        request.url,
        JSON.stringify(request.body ?? null),
        JSON.stringify(request.headers ?? {}),
        request.status,
        JSON.stringify(request.responseData ?? null),
        request.attemptCount ?? 0,
        request.lastError ?? null,
        request.nextAttemptAt ?? new Date().toISOString(),
      ]
    );
  }

  return getSyncRequest(request.requestKey);
}

async function getPendingSyncRequests(limit = 20) {
  const db = await getDb();
  const [result] = await db.executeSql(
    `SELECT *
     FROM sync_queue
     WHERE status IN ('pending', 'processing')
       AND next_attempt_at <= ?
     ORDER BY created_at ASC
     LIMIT ?;`,
    [new Date().toISOString(), limit]
  );

  const requests = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    requests.push({
      ...row,
      body: parseJsonField(row.body, null),
      headers: parseJsonField(row.headers, {}),
      responseData: parseJsonField(row.response_data, null),
    });
  }

  return requests;
}

async function updateSyncRequestStatus(requestKey, status, updates = {}) {
  const existing = await getSyncRequest(requestKey);
  if (!existing) return null;

  return saveSyncRequest({
    requestKey,
    method: updates.method ?? existing.method,
    url: updates.url ?? existing.url,
    body: updates.body ?? existing.body,
    headers: updates.headers ?? existing.headers,
    status,
    responseData: Object.prototype.hasOwnProperty.call(updates, 'responseData') ? updates.responseData : existing.responseData,
    attemptCount: updates.attemptCount ?? existing.attempt_count,
    lastError: Object.prototype.hasOwnProperty.call(updates, 'lastError') ? updates.lastError : existing.last_error,
    nextAttemptAt: updates.nextAttemptAt ?? existing.next_attempt_at,
  });
}

async function getLatestCompletedSyncResult(requestKey) {
  const request = await getSyncRequest(requestKey);
  if (!request || request.status !== 'completed') return null;
  return request;
}

async function deleteSyncRequest(requestKey) {
  const db = await getDb();
  await db.executeSql(`DELETE FROM sync_queue WHERE request_key = ?;`, [requestKey]);
}

async function closeDb() {
  if (_db) {
    await _db.close();
    _db = null;
  }
}

export default {
  getProfile,
  saveProfile,
  saveDriveSession,
  getDriveSessions,
  getDriveSession,
  logIntervention,
  getInterventionsForSession,
  getSyncRequest,
  saveSyncRequest,
  getPendingSyncRequests,
  updateSyncRequestStatus,
  getLatestCompletedSyncResult,
  deleteSyncRequest,
  closeDb,
};
