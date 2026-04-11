/**
 * startup.js
 * Centralised startup validation for production and pilot environments.
 */
'use strict';

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function hasStrongSecret(secret) {
  if (!secret) return false;
  if (secret.length < 32) return false;
  return !/change-me|placeholder|example|secret-string/i.test(secret);
}

function collectStartupStatus() {
  const environment = process.env.NODE_ENV || 'development';
  const strictStartup = environment === 'production' || isTruthy(process.env.STRICT_STARTUP_VALIDATION);
  const blockers = [];
  const warnings = [];

  const checks = {
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    jwtSecretStrong: hasStrongSecret(process.env.JWT_SECRET),
    allowedOriginsConfigured: Boolean((process.env.ALLOWED_ORIGINS || '').trim()),
    firebaseCredentialsConfigured: Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS
    ),
    sentryConfigured: Boolean(process.env.SENTRY_DSN),
  };

  const providers = {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  };

  if (!checks.databaseUrlConfigured) {
    blockers.push('Database configuration is missing.');
  }

  if (!checks.jwtSecretStrong) {
    blockers.push('JWT signing secret is missing or too weak.');
  }

  if (!checks.firebaseCredentialsConfigured) {
    blockers.push('Firebase credentials are missing.');
  }

  if (strictStartup && !checks.allowedOriginsConfigured) {
    blockers.push('Allowed client origins are not configured.');
  }

  if (strictStartup && !checks.sentryConfigured) {
    blockers.push('Error tracking is not configured.');
  }

  if (!Object.values(providers).some(Boolean)) {
    warnings.push('No cloud LLM provider API key is configured; feedback will fall back to deterministic responses.');
  }

  return {
    environment,
    strictStartup,
    blockers,
    warnings,
    checks,
    providers,
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ok',
  };
}

function assertStartupReady() {
  const status = collectStartupStatus();
  if (status.strictStartup && status.blockers.length > 0) {
    const error = new Error(`Startup validation failed: ${status.blockers.join(' ')}`);
    error.startupStatus = status;
    throw error;
  }
  return status;
}

module.exports = {
  collectStartupStatus,
  assertStartupReady,
};
