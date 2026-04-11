/**
 * validation.js
 * Input validation schemas and middleware for all POST/PUT endpoints.
 * Prevents payload bomb attacks, oversized fields, and invalid data.
 */
'use strict';

const { body, param, validationResult } = require('express-validator');

/**
 * Middleware to handle validation errors.
 * Returns 400 with detailed error messages.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
}

/**
 * Validation schema for POST /feedback/generate
 */
const feedbackGenerateSchema = [
  body('sessionId')
    .isUUID()
    .withMessage('Invalid or missing session ID'),

  body('anxietyScoreAvg')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Anxiety score must be 0–100'),

  body('peakStress')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Peak stress must be 0–100'),

  body('stressEvents')
    .optional()
    .isArray()
    .withMessage('Stress events must be an array')
    .custom((arr) => {
      if (arr.length > 200) throw new Error('Max 200 stress events allowed');
      const totalSize = Buffer.byteLength(JSON.stringify(arr));
      if (totalSize > 50_000) throw new Error('Stress events payload too large (max 50KB)');
      return true;
    })
    .custom((arr) => {
      arr.forEach((event, idx) => {
        if (typeof event.score !== 'number' || event.score < 0 || event.score > 100) {
          throw new Error(`Event ${idx}: score must be 0–100`);
        }
        if (event.description && event.description.length > 500) {
          throw new Error(`Event ${idx}: description max 500 chars`);
        }
      });
      return true;
    }),

  body('routeMeta')
    .optional()
    .isObject()
    .withMessage('Route metadata must be an object')
    .custom((obj) => {
      if (obj.summary && obj.summary.length > 200) {
        throw new Error('Route summary max 200 chars');
      }
      return true;
    }),

  body('telemetrySummary')
    .optional()
    .isObject()
    .withMessage('Telemetry summary must be an object')
    .custom((obj) => {
      const totalSize = Buffer.byteLength(JSON.stringify(obj));
      if (totalSize > 20_000) {
        throw new Error('Telemetry summary payload too large (max 20KB)');
      }
      return true;
    }),

  body('driverProfile')
    .optional()
    .isObject()
    .withMessage('Driver profile must be an object')
    .custom((obj) => {
      if (obj.name && obj.name.length > 100) {
        throw new Error('Driver name max 100 chars');
      }
      return true;
    }),

  handleValidationErrors,
];

/**
 * Validation schema for POST /feedback/therapist
 */
const therapistChatSchema = [
  body('messages')
    .isArray()
    .withMessage('Messages must be an array')
    .custom((arr) => {
      if (arr.length === 0) throw new Error('Messages array cannot be empty');
      if (arr.length > 100) throw new Error('Conversation exceeds 100 messages');
      return true;
    })
    .custom((arr) => {
      arr.forEach((msg, idx) => {
        if (!['user', 'assistant'].includes(msg.role)) {
          throw new Error(`Message ${idx}: role must be 'user' or 'assistant'`);
        }
        if (!msg.content || typeof msg.content !== 'string') {
          throw new Error(`Message ${idx}: content must be non-empty string`);
        }
        if (msg.content.length > 2000) {
          throw new Error(`Message ${idx}: content max 2000 chars`);
        }
      });
      return true;
    }),

  body('systemContext')
    .optional()
    .isString()
    .withMessage('System context must be a string')
    .isLength({ max: 500 })
    .withMessage('System context max 500 chars'),

  handleValidationErrors,
];

/**
 * Validation schema for POST /drive
 */
const driveCreateSchema = [
  body('startedAt')
    .optional()
    .isISO8601()
    .withMessage('startedAt must be ISO8601'),

  body('routeMeta')
    .optional()
    .isObject()
    .withMessage('Route metadata must be an object')
    .custom((obj) => {
      if (obj.summary && obj.summary.length > 200) {
        throw new Error('Route summary max 200 chars');
      }
      return true;
    }),

  handleValidationErrors,
];

/**
 * Validation schema for PUT /drive/:id
 */
const driveUpdateSchema = [
  param('id').isUUID().withMessage('Invalid drive ID'),

  body('stressEvents')
    .optional()
    .isArray()
    .custom((arr) => {
      if (arr.length > 200) throw new Error('Max 200 stress events');
      return true;
    }),

  body('endedAt')
    .optional()
    .isISO8601()
    .withMessage('endedAt must be ISO8601'),

  body('anxietyScoreAvg')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Anxiety score must be 0–100'),

  body('peakStress')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Peak stress must be 0–100'),

  body('telemetrySummary')
    .optional()
    .isObject()
    .withMessage('Telemetry summary must be an object'),

  body('routeMeta')
    .optional()
    .isObject()
    .withMessage('Route metadata must be an object'),

  handleValidationErrors,
];

const privacyConsentSchema = [
  body('consentVersion')
    .optional()
    .isString()
    .isLength({ min: 1, max: 40 })
    .withMessage('consentVersion must be 1-40 chars'),

  body('telemetryUpload')
    .isBoolean()
    .withMessage('telemetryUpload must be boolean'),

  body('biometricsProcessing')
    .isBoolean()
    .withMessage('biometricsProcessing must be boolean'),

  body('therapistTranscriptRetention')
    .isBoolean()
    .withMessage('therapistTranscriptRetention must be boolean'),

  body('marketingUpdates')
    .optional()
    .isBoolean()
    .withMessage('marketingUpdates must be boolean'),

  handleValidationErrors,
];

const privacyExportRequestSchema = [
  body('format')
    .optional()
    .isIn(['json'])
    .withMessage('format must be json'),

  handleValidationErrors,
];

const privacyDeletionRequestSchema = [
  body('confirm')
    .custom((value) => value === true)
    .withMessage('confirm must be true'),

  body('reason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('reason max 500 chars'),

  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  feedbackGenerateSchema,
  therapistChatSchema,
  driveCreateSchema,
  driveUpdateSchema,
  privacyConsentSchema,
  privacyExportRequestSchema,
  privacyDeletionRequestSchema,
};
