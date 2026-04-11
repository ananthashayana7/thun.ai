/**
 * errorTracker.js
 * Sentry integration for backend request/error telemetry.
 */
'use strict';

const Sentry = require('@sentry/node');

let trackerEnabled = false;

function initErrorTracker(options = {}) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    trackerEnabled = false;
    return false;
  }

  Sentry.init({
    dsn,
    environment: options.environment || process.env.NODE_ENV || 'development',
    release: options.release || process.env.RELEASE || 'backend@1.0.0',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  });
  trackerEnabled = true;
  return true;
}

function captureException(error, context = {}) {
  if (!trackerEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context.requestId) {
      scope.setTag('request_id', context.requestId);
    }
    if (context.userId) {
      scope.setUser({ id: context.userId });
    }
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(error);
  });
}

function isEnabled() {
  return trackerEnabled;
}

module.exports = {
  initErrorTracker,
  captureException,
  isEnabled,
};
