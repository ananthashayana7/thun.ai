/**
 * feedback.js (route)
 * Post-drive LLM feedback generation and AI Therapist chat proxy.
 * API keys are server-side only – never exposed to mobile client.
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { llmRateLimiter } = require('../middleware/rateLimiter');
const {
  generateConfidenceNarrative,
  generateScenarioVariants,
  generateTherapistResponse,
} = require('../services/llmService');
const { query, withTransaction } = require('../db/db');

const router = express.Router();

// Apply strict rate limiting to all feedback endpoints
router.use(llmRateLimiter);

/**
 * POST /feedback/generate
 * Generate post-drive confidence narrative + scenario variants.
 */
router.post(
  '/generate',
  [
    body('sessionId').isString().notEmpty(),
    body('anxietyScoreAvg').isFloat({ min: 0, max: 100 }),
    body('peakStress').isFloat({ min: 0, max: 100 }),
    body('stressEvents').optional().isArray({ max: 200 }),
    body('routeMeta').optional().isObject(),
    body('driverProfile').optional().isObject(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { sessionId, anxietyScoreAvg, peakStress, stressEvents, routeMeta, driverProfile } = req.body;

      // Check if narrative already cached
      const cached = await query(
        `SELECT confidence_narrative FROM drive_sessions WHERE id = $1 AND user_id = $2`,
        [sessionId, req.user.userId]
      );
      if (cached.rows[0]?.confidence_narrative) {
        return res.json({
          narrative: cached.rows[0].confidence_narrative,
          scenarios: [],
          cached: true,
        });
      }

      // Generate in parallel where possible
      const [narrative, scenarios] = await Promise.all([
        generateConfidenceNarrative({
          driverName: driverProfile?.name,
          anxietyScoreAvg,
          peakStress,
          stressEvents,
          routeMeta,
        }),
        generateScenarioVariants(stressEvents || [], driverProfile || {}),
      ]);

      // Persist narrative and confidence trajectory atomically so the DB
      // is never left in a partially-written state.
      const confidenceScore = Math.max(0, 100 - anxietyScoreAvg);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE drive_sessions SET confidence_narrative = $1 WHERE id = $2 AND user_id = $3`,
          [narrative, sessionId, req.user.userId]
        );
        await client.query(
          `INSERT INTO confidence_trajectory (user_id, session_id, confidence_score, scenario_variants)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [req.user.userId, sessionId, confidenceScore, JSON.stringify(scenarios)]
        );
      });

      res.json({ narrative, scenarios });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /feedback/therapist
 * AI Driving Therapist chat.
 */
router.post(
  '/therapist',
  [
    body('messages').isArray({ min: 1, max: 20 }).withMessage('messages array required (max 20)'),
    body('messages.*.role').isIn(['user', 'assistant']),
    body('messages.*.content').isString().notEmpty().isLength({ max: 1000 }),
    body('systemContext').optional().isString().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { messages, systemContext } = req.body;

      // Sanitise: keep last 10 messages, enforce content length
      const safeMessages = messages
        .slice(-10)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1000) }));

      const safeContext = systemContext ? String(systemContext).slice(0, 500) : undefined;
      const response = await generateTherapistResponse(safeMessages, safeContext);
      res.json({ response });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /feedback/trajectory
 * Return confidence score history (last 30 sessions).
 */
router.get('/trajectory', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ct.confidence_score, ct.recorded_at, ds.anxiety_score_avg, ds.peak_stress,
              ds.route_meta->>'summary' AS route_summary
       FROM confidence_trajectory ct
       JOIN drive_sessions ds ON ds.id = ct.session_id
       WHERE ct.user_id = $1
       ORDER BY ct.recorded_at DESC
       LIMIT 30`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
