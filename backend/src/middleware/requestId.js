/**
 * requestId.js
 * Add unique request ID to all requests for distributed tracing.
 * Includes request ID in all logs and error responses.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Express middleware to attach unique request ID.
 * Generates ulid or uuid for each request.
 */
function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || uuidv4();
  req.startTime = Date.now();

  // Attach to response headers for client correlation
  res.set('X-Request-ID', req.id);

  // Override console methods to include request ID (if desired)
  const originalLog = console.log;
  const originalError = console.error;

  // Log with request ID prefix in HTTP context
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const logLine = `[${req.id}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`;
    if (res.statusCode >= 400) {
      originalError(logLine);
    } else {
      originalLog(logLine);
    }
  });

  next();
}

module.exports = requestIdMiddleware;
