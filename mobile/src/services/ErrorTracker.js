/**
 * ErrorTracker.js
 * Integration with Sentry for production error tracking and breadcrumbs.
 */
import * as Sentry from '@sentry/react-native';

const isProduction = !__DEV__;

function init() {
  if (isProduction) {
    Sentry.init({
      dsn: 'https://placeholder-dsn@sentry.io/project',
      // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
      tracesSampleRate: 1.0,
    });
  }
}

/**
 * Capture an exception with optional context.
 */
function captureError(error, context = {}) {
  console.error('[ErrorTracker]', error, context);
  if (isProduction) {
    Sentry.captureException(error, {
      extra: context,
    });
  }
}

/**
 * Log a breadcrumb for easier debugging of the path to an error.
 */
function addBreadcrumb(message, category = 'action', level = 'info') {
  console.log(`[Breadcrumb] [${category}] ${message}`);
  if (isProduction) {
    Sentry.addBreadcrumb({
      category,
      message,
      level,
    });
  }
}

/**
 * Set user context for Sentry reports.
 */
function setUser(user) {
  if (isProduction) {
    Sentry.setUser(user ? { id: user.id, email: user.email } : null);
  }
}

export default {
  init,
  captureError,
  addBreadcrumb,
  setUser,
};
