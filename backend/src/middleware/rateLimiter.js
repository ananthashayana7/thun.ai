/**
 * rateLimiter.js
 * Per-user rate limiter using Redis for distributed systems.
 * Supports global limits, per-user limits, and per-endpoint limits.
 */
'use strict';

const { getRedis } = require('../db/redis');

/**
 * Create per-user rate limiter with Redis sliding window.
 * @param {object} opts - { windowMs, max, endpoint }
 */
function createPerUserRateLimiter(opts = {}) {
  const {
    windowMs = 60_000,  // 1 minute
    max = 100,          // requests per window
    endpoint = 'api',   // used in Redis key
  } = opts;

  return async (req, res, next) => {
    try {
      // Skip health checks
      if (req.path === '/health') {
        return next();
      }

      // Get user ID or IP
      const userId = req.user?.userId || req.ip;
      const redisKey = `ratelimit:${endpoint}:${userId}`;
      const redis = getRedis();

      // Get current count
      const current = await redis.get(redisKey);
      const count = parseInt(current || '0', 10);

      if (count >= max) {
        res.set('X-RateLimit-Limit', max);
        res.set('X-RateLimit-Remaining', '0');
        res.set('X-RateLimit-Reset', new Date(Date.now() + windowMs).toISOString());
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil(windowMs / 1000),
        });
      }

      // Increment counter
      const newCount = count + 1;
      await redis.set(redisKey, newCount, { EX: Math.ceil(windowMs / 1000) });

      // Set response headers
      res.set('X-RateLimit-Limit', max);
      res.set('X-RateLimit-Remaining', Math.max(0, max - newCount));
      res.set('X-RateLimit-Reset', new Date(Date.now() + windowMs).toISOString());

      next();
    } catch (err) {
      console.error('[RateLimit] Error:', err.message);
      // Fail open: if Redis is down, allow request
      next();
    }
  };
}

/**
 * Global rate limiter: 100 req/min per user/IP
 */
const globalRateLimiter = createPerUserRateLimiter({
  windowMs: 60_000,
  max: 100,
  endpoint: 'global',
});

/**
 * LLM rate limiter: 10 req/min per user
 */
const llmRateLimiter = createPerUserRateLimiter({
  windowMs: 60_000,
  max: 10,
  endpoint: 'llm',
});

/**
 * Therapist rate limiter: 5 conversations per 24h per user (premium feature)
 */
const therapistRateLimiter = createPerUserRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,  // 24 hours
  max: 5,
  endpoint: 'therapist',
});

module.exports = {
  createPerUserRateLimiter,
  globalRateLimiter,
  llmRateLimiter,
  therapistRateLimiter,
};
