/**
 * privacy.js (route)
 * Consent, export, and deletion request APIs.
 */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db/db');
const {
  privacyConsentSchema,
  privacyExportRequestSchema,
  privacyDeletionRequestSchema,
} = require('../validation/schemas');

const router = express.Router();

const DEFAULT_CONSENT = {
  consent_version: process.env.PRIVACY_CONSENT_VERSION || '2026-04-11',
  telemetry_upload: true,
  biometrics_processing: true,
  therapist_transcript_retention: false,
  marketing_updates: false,
  consented_at: null,
  revoked_at: null,
  deletion_requested_at: null,
};

router.get('/consent', async (req, res, next) => {
  try {
    const consentResult = await query(
      `SELECT consent_version, telemetry_upload, biometrics_processing,
              therapist_transcript_retention, marketing_updates,
              consented_at, revoked_at, deletion_requested_at, updated_at
       FROM privacy_consents
       WHERE user_id = $1`,
      [req.user.userId]
    );

    const requestResult = await query(
      `SELECT id, request_type, status, requested_at, completed_at
       FROM privacy_requests
       WHERE user_id = $1
       ORDER BY requested_at DESC
       LIMIT 20`,
      [req.user.userId]
    );

    res.json({
      consent: consentResult.rows[0] || DEFAULT_CONSENT,
      requests: requestResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/consent', privacyConsentSchema, async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const consentVersion = req.body.consentVersion || process.env.PRIVACY_CONSENT_VERSION || '2026-04-11';
    const nextConsent = {
      telemetryUpload: req.body.telemetryUpload,
      biometricsProcessing: req.body.biometricsProcessing,
      therapistTranscriptRetention: req.body.therapistTranscriptRetention,
      marketingUpdates: req.body.marketingUpdates ?? false,
    };
    const revokedAt = Object.values(nextConsent).every((value) => value === false) ? now : null;

    const result = await query(
      `INSERT INTO privacy_consents (
          user_id,
          consent_version,
          telemetry_upload,
          biometrics_processing,
          therapist_transcript_retention,
          marketing_updates,
          consented_at,
          revoked_at
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
          consent_version = EXCLUDED.consent_version,
          telemetry_upload = EXCLUDED.telemetry_upload,
          biometrics_processing = EXCLUDED.biometrics_processing,
          therapist_transcript_retention = EXCLUDED.therapist_transcript_retention,
          marketing_updates = EXCLUDED.marketing_updates,
          consented_at = EXCLUDED.consented_at,
          revoked_at = EXCLUDED.revoked_at,
          updated_at = now()
       RETURNING consent_version, telemetry_upload, biometrics_processing,
                 therapist_transcript_retention, marketing_updates,
                 consented_at, revoked_at, deletion_requested_at, updated_at`,
      [
        req.user.userId,
        consentVersion,
        nextConsent.telemetryUpload,
        nextConsent.biometricsProcessing,
        nextConsent.therapistTranscriptRetention,
        nextConsent.marketingUpdates,
        now,
        revokedAt,
      ]
    );

    await req.auditLog({
      action: 'PRIVACY_CONSENT_UPDATED',
      resourceType: 'privacy_consent',
      resourceId: req.user.userId,
      details: {
        consentVersion,
        ...nextConsent,
      },
    });

    res.json({ consent: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/export', privacyExportRequestSchema, async (req, res, next) => {
  try {
    const id = uuidv4();
    const format = req.body.format || 'json';
    const result = await query(
      `INSERT INTO privacy_requests (id, user_id, request_type, status, details)
       VALUES ($1, $2, 'export', 'queued', $3)
       RETURNING id, request_type, status, requested_at`,
      [id, req.user.userId, JSON.stringify({ format })]
    );

    await req.auditLog({
      action: 'PRIVACY_EXPORT_REQUESTED',
      resourceType: 'privacy_request',
      resourceId: id,
      details: { format },
    });

    res.status(202).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/delete-account', privacyDeletionRequestSchema, async (req, res, next) => {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const reason = req.body.reason || null;

    const result = await query(
      `INSERT INTO privacy_requests (id, user_id, request_type, status, details)
       VALUES ($1, $2, 'delete', 'queued', $3)
       RETURNING id, request_type, status, requested_at`,
      [id, req.user.userId, JSON.stringify({ reason })]
    );

    await query(
      `INSERT INTO privacy_consents (user_id, consent_version, telemetry_upload, biometrics_processing,
                                     therapist_transcript_retention, marketing_updates, consented_at, deletion_requested_at)
       VALUES ($1, $2, false, false, false, false, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         telemetry_upload = false,
         biometrics_processing = false,
         therapist_transcript_retention = false,
         marketing_updates = false,
         revoked_at = $3,
         deletion_requested_at = $3,
         updated_at = now()`,
      [
        req.user.userId,
        process.env.PRIVACY_CONSENT_VERSION || '2026-04-11',
        now,
      ]
    );

    await req.auditLog({
      action: 'PRIVACY_DELETION_REQUESTED',
      resourceType: 'privacy_request',
      resourceId: id,
      details: { reason },
    });

    res.status(202).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
