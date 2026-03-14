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
  if (_db) return _db;
  _db = await SQLite.openDatabase({ name: DB.NAME, location: 'default' });
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
  closeDb,
};
