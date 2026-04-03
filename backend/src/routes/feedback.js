/**
 * feedback.js (route)
 * Post-drive LLM feedback generation and AI Therapist chat proxy.
 * API keys are server-side only – never exposed to mobile client.
 */
'use strict';

const express = require('express');
const { llmRateLimiter, therapistRateLimiter } = require('../middleware/rateLimiter');
const {
  generateConfidenceNarrative,
  generateScenarioVariants,
  generateTherapistResponse,
} = require('../services/llmService');
const { query, withTransaction } = require('../db/db');
const {
  feedbackGenerateSchema,
  therapistChatSchema,
} = require('../validation/schemas');

const router = express.Router();

/**
 * POST /feedback/generate
 * Generate post-drive confidence narrative + scenario variants.
 */
router.post(
  '/generate',
  llmRateLimiter,
  feedbackGenerateSchema,
  async (req, res, next) => {
    try {
      const { sessionId, anxietyScoreAvg, peakStress, stressEvents, routeMeta, driverProfile } = req.body;

      // Check if narrative already cached
      const cached = await query(
        `SELECT confidence_narrative FROM drive_sessions WHERE id = $1 AND user_id = $2`,
        [sessionId, req.user.userId]
      );
      if (cached.rows[0]?.confidence_narrative) {
        // Log cached narrative access
        await req.auditLog({
          action: 'FEEDBACK_GENERATE_CACHED',
          resourceType: 'drive_session',
          resourceId: sessionId,
          details: { sessionId },
        });
        return res.json({
          narrative: cached.rows[0].confidence_narrative,
          scenarios: [],
          cached: true,
        });
      }

      // Generate in parallel where possible
      // Pass request ID for distributed tracing
      const [narrative, scenarios] = await Promise.all([
        generateConfidenceNarrative({
          driverName: driverProfile?.name,
          anxietyScoreAvg,
          peakStress,
          stressEvents,
          routeMeta,
        }, req.id),
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

      // Audit log feedback generation
      await req.auditLog({
        action: 'FEEDBACK_GENERATE',
        resourceType: 'drive_session',
        resourceId: sessionId,
        details: {
          sessionId,
          confidenceScore,
          scenarioCount: scenarios.length,
          narrativeLength: narrative.length,
        },
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
  therapistRateLimiter,
  therapistChatSchema,
  async (req, res, next) => {
    try {
      const { messages, systemContext } = req.body;

      // Sanitise: keep last 10 messages, enforce content length
      const safeMessages = messages
        .slice(-10)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1000) }));

      const safeContext = systemContext ? String(systemContext).slice(0, 500) : undefined;

      // Generate response with request ID for tracing
      const response = await generateTherapistResponse(
        safeMessages,
        safeContext,
        req.id
      );

      // Audit log therapist conversation
      await req.auditLog({
        action: 'THERAPIST_CHAT',
        resourceType: 'therapist',
        details: {
          messageCount: messages.length,
          hasSystemContext: !!systemContext,
          responseLength: response.length,
        },
      });

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
