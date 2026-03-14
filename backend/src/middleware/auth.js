/**
 * auth.js (middleware)
 * Verifies Firebase ID token OR a backend-issued JWT for service-to-service calls.
 * Attaches req.user = { uid, userId } on success.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const { query } = require('../db/db');

// Lazy-init Firebase Admin (once)
let firebaseApp;
function getFirebaseApp() {
  if (!firebaseApp) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Read and parse the service account file; do not use dynamic require()
      const saPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const saJson = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      credential = admin.credential.cert(saJson);
    } else {
      credential = admin.credential.applicationDefault();
    }
    firebaseApp = admin.initializeApp({ credential }, 'thunai');
  }
  return firebaseApp;
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  // ── Try backend JWT first (for internal / service tokens) ────────────────
  if (token.startsWith('thun_')) {
    try {
      const payload = jwt.verify(token.slice(5), process.env.JWT_SECRET);
      req.user = { uid: payload.uid, userId: payload.userId };
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid service token' });
    }
  }

  // ── Firebase ID token ─────────────────────────────────────────────────────
  try {
    const app = getFirebaseApp();
    const decoded = await app.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // Look up internal user record (create on first auth)
    const result = await query(
      `INSERT INTO users (firebase_uid, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [uid, decoded.name || '', decoded.email || '']
    );

    req.user = { uid, userId: result.rows[0].id };
    return next();
  } catch (err) {
    console.error('[auth] Firebase verify error:', err.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = authMiddleware;
