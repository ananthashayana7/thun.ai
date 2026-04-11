/**
 * ErrorTracker.js
 * Optional Sentry wrapper with a safe no-dependency fallback.
 *
 * The repo does not bundle Sentry by default for mobile, so production builds
 * can opt in when the native dependency and DSN are wired. Until then this
 * module still provides structured logging and breadcrumbs without crashing.
 */
let Sentry = null;

const isProduction = !__DEV__;
let trackerEnabled = false;
let trackerConfig = {
  environment: isProduction ? 'production' : 'development',
  release: 'mobile@local',
};

function getSentry() {
  if (Sentry !== null) {
    return Sentry;
  }

  try {
    Sentry = require('@sentry/react-native');
  } catch {
    Sentry = false;
  }

  return Sentry;
}

function init(config = {}) {
  trackerConfig = {
    ...trackerConfig,
    ...config,
  };

  const sentry = getSentry();
  const dsn = config?.dsn;
  if (isProduction && sentry && dsn) {
    trackerEnabled = true;
    sentry.init({
      dsn,
      environment: trackerConfig.environment,
      release: trackerConfig.release,
      tracesSampleRate: config?.tracesSampleRate ?? 0.2,
    });
  } else {
    trackerEnabled = false;
  }
}

function captureError(error, context = {}) {
  console.error('[ErrorTracker]', error, context);
  if (trackerEnabled && getSentry()) {
    Sentry.withScope((scope) => {
      Object.entries(context || {}).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
      scope.setTag('runtime_environment', trackerConfig.environment);
      Sentry.captureException(error);
    });
  }
}

function addBreadcrumb(message, category = 'action', level = 'info') {
  console.log(`[Breadcrumb] [${category}] ${message}`);
  if (trackerEnabled && getSentry()) {
    Sentry.addBreadcrumb({
      category,
      message,
      level,
    });
  }
}

function setUser(user) {
  if (trackerEnabled && getSentry()) {
    Sentry.setUser(user ? { id: user.id, email: user.email } : null);
  }
}

function setContext(name, context) {
  if (trackerEnabled && getSentry()) {
    Sentry.setContext(name, context);
  }
}

export default {
  init,
  captureError,
  addBreadcrumb,
  setUser,
  setContext,
};
