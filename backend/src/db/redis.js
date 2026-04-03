/**
 * redis.js
 * Redis client initialization with fallback to in-memory if unavailable.
 */
'use strict';

const redis = require('redis');

let client = null;
let fallbackMode = false;

/**
 * Initialize Redis client with fallback to in-memory storage.
 */
async function initRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    client = redis.createClient({ url: redisUrl });

    client.on('error', (err) => {
      console.warn('[Redis] Error:', err.message);
    });

    client.on('connect', () => {
      console.log('[Redis] Connected');
      fallbackMode = false;
    });

    client.on('reconnecting', () => {
      console.warn('[Redis] Reconnecting...');
    });

    await client.connect();
    return client;
  } catch (err) {
    console.warn('[Redis] Connection failed, using in-memory fallback:', err.message);
    fallbackMode = true;

    // Return in-memory mock for development
    return createInMemoryFallback();
  }
}

/**
 * In-memory fallback for Redis (development/testing).
 * WARNING: Not suitable for production multi-instance deployments.
 */
function createInMemoryFallback() {
  const store = new Map();
  const timeouts = new Map();

  return {
    get: async (key) => store.get(key) || null,
    set: async (key, value, opts) => {
      store.set(key, value);
      if (opts?.EX) {
        const existing = timeouts.get(key);
        if (existing) clearTimeout(existing);
        const timeout = setTimeout(() => {
          store.delete(key);
          timeouts.delete(key);
        }, opts.EX * 1000);
        timeouts.set(key, timeout);
      }
      return 'OK';
    },
    del: async (key) => {
      const existing = timeouts.get(key);
      if (existing) clearTimeout(existing);
      timeouts.delete(key);
      return store.delete(key) ? 1 : 0;
    },
    incr: async (key) => {
      const val = (store.get(key) || 0) + 1;
      store.set(key, val);
      return val;
    },
    incrBy: async (key, amount) => {
      const val = (store.get(key) || 0) + amount;
      store.set(key, val);
      return val;
    },
  };
}

/**
 * Get Redis client or fallback.
 */
function getRedis() {
  return client || createInMemoryFallback();
}

/**
 * Check if Redis is in fallback mode (multi-instance deployments will fail silently).
 */
function isFallback() {
  return fallbackMode;
}

/**
 * Close Redis connection gracefully.
 */
async function closeRedis() {
  if (client && !fallbackMode) {
    await client.quit();
    client = null;
  }
}

module.exports = {
  initRedis,
  getRedis,
  isFallback,
  closeRedis,
};
