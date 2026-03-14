/**
 * rateLimiter.js
 * Configurable rate limiter factory using express-rate-limit.
 * Exports both a default global limiter and a strict limiter for LLM endpoints.
 */
'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Create a rate limiter middleware.
 * @param {object} opts - { windowMs, max, message }
 */
function createRateLimiter(opts = {}) {
  return rateLimit({
    windowMs: opts.windowMs ?? 60_000,
    max: opts.max ?? 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: opts.message ?? 'Too many requests. Please try again later.',
    },
    keyGenerator: (req) => {
      // Rate-limit per authenticated user if available, otherwise per IP
      return req.user?.userId || req.ip;
    },
    skip: (req) => {
      // Never rate-limit health checks
      return req.path === '/health';
    },
  });
}

/** Strict limiter for expensive LLM endpoints (10 req/min per user) */
const llmRateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

module.exports = { createRateLimiter, llmRateLimiter };
