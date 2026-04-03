/**
 * auth.js (route)
 * Firebase Auth integration – verifies OTP sign-in and issues session.
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const { query } = require('../db/db');

const router = express.Router();

/**
 * POST /auth/verify
 * Body: { idToken: string }
 * Verifies a Firebase ID token. On success, returns user profile and a backend JWT.
 */
router.post(
  '/verify',
  [body('idToken').isString().notEmpty().withMessage('idToken required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { idToken } = req.body;
      let app;
      try {
        app = admin.app('thunai');
      } catch {
        let credential;
        if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
          const fs = require('fs');
          const path = require('path');
          try {
            const saPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            const saJson = JSON.parse(fs.readFileSync(saPath, 'utf8'));
            credential = admin.credential.cert(saJson);
          } catch (fileErr) {
            throw new Error('Failed to load Firebase service account credentials');
          }
        } else {
          credential = admin.credential.applicationDefault();
        }
        app = admin.initializeApp({ credential }, 'thunai');
      }

      const decoded = await app.auth().verifyIdToken(idToken);

      // Upsert user
      const result = await query(
        `INSERT INTO users (firebase_uid, name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (firebase_uid) DO UPDATE
           SET name = COALESCE(NULLIF($2, ''), users.name),
               updated_at = now()
         RETURNING id, name, email, anxiety_profile, tts_language, created_at`,
        [decoded.uid, decoded.name || '', decoded.email || '']
      );

      const user = result.rows[0];

      // Issue a short-lived backend JWT (7d default)
      const token = jwt.sign(
        { uid: decoded.uid, userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || '7d' }
      );

      // Audit log successful sign-in
      await query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.id,
          'USER_SIGNIN',
          'user',
          user.id,
          JSON.stringify({ email: user.email, timestamp: new Date().toISOString() }),
        ]
      );

      res.json({
        token: `thun_${token}`,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          anxietyProfile: user.anxiety_profile,
          ttsLanguage: user.tts_language,
          createdAt: user.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /auth/profile
 * Update the authenticated user's anxiety profile.
 */
router.put(
  '/profile',
  require('../middleware/auth'),
  [body('anxietyProfile').isObject().withMessage('anxietyProfile must be an object')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { anxietyProfile, ttsLanguage } = req.body;
      await query(
        `UPDATE users SET anxiety_profile = $1, tts_language = COALESCE($2, tts_language)
         WHERE id = $3`,
        [JSON.stringify(anxietyProfile), ttsLanguage || null, req.user.userId]
      );

      // Audit log profile update
      await query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'USER_PROFILE_UPDATED',
          'user',
          req.user.userId,
          JSON.stringify({ ttsLanguage, hasAnxietyProfile: !!anxietyProfile }),
        ]
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
