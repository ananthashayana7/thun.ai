/**
 * drive.js (route)
 * Drive session CRUD – create, update, list, and retrieve sessions.
 */
'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── POST /drive ────────────────────────────────────────────────────────────────
// Create a new drive session
router.post(
  '/',
  [
    body('startedAt').isISO8601().withMessage('startedAt must be ISO8601'),
    body('routeMeta').optional().isObject(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { startedAt, routeMeta } = req.body;
      const id = uuidv4();
      const result = await query(
        `INSERT INTO drive_sessions (id, user_id, started_at, route_meta)
         VALUES ($1, $2, $3, $4)
         RETURNING id, started_at`,
        [id, req.user.userId, startedAt, JSON.stringify(routeMeta || {})]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /drive/:id ─────────────────────────────────────────────────────────────
// Complete / update a drive session
router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('endedAt').optional().isISO8601(),
    body('anxietyScoreAvg').optional().isFloat({ min: 0, max: 100 }),
    body('peakStress').optional().isFloat({ min: 0, max: 100 }),
    body('stressEvents').optional().isArray(),
    body('telemetrySummary').optional().isObject(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { id } = req.params;
      const { endedAt, anxietyScoreAvg, peakStress, stressEvents, telemetrySummary, routeMeta } = req.body;

      const result = await query(
        `UPDATE drive_sessions
         SET ended_at = COALESCE($1, ended_at),
             anxiety_score_avg = COALESCE($2, anxiety_score_avg),
             peak_stress = COALESCE($3, peak_stress),
             stress_events = COALESCE($4, stress_events),
             telemetry_summary = COALESCE($5, telemetry_summary),
             route_meta = COALESCE($6, route_meta)
         WHERE id = $7 AND user_id = $8
         RETURNING id`,
        [
          endedAt || null,
          anxietyScoreAvg ?? null,
          peakStress ?? null,
          stressEvents ? JSON.stringify(stressEvents) : null,
          telemetrySummary ? JSON.stringify(telemetrySummary) : null,
          routeMeta ? JSON.stringify(routeMeta) : null,
          id,
          req.user.userId,
        ]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
      res.json({ success: true, id });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /drive ─────────────────────────────────────────────────────────────────
// List sessions (last 30)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);
    const result = await query(
      `SELECT id, started_at, ended_at, route_meta, anxiety_score_avg, peak_stress, created_at
       FROM drive_sessions
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [req.user.userId, limit]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /drive/:id ─────────────────────────────────────────────────────────────
router.get(
  '/:id',
  [param('id').isUUID()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const result = await query(
        `SELECT * FROM drive_sessions WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
