/**
 * db.js
 * PostgreSQL connection pool using node-postgres (pg).
 */
'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Execute a parameterised query.
 * @param {string} text - SQL query with $1 placeholders
 * @param {Array} params - parameter values
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 2000) {
    console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 80));
  }
  return res;
}

/**
 * Acquire a client for transactions.
 * Always call client.release() in a finally block.
 */
async function getClient() {
  return pool.connect();
}

/**
 * Execute multiple queries atomically inside a transaction.
 *
 * @param {function(client): Promise<T>} fn - async function that receives a
 *   pg client. All queries executed on this client are part of the same
 *   transaction. Throw (or reject) to trigger an automatic ROLLBACK.
 * @returns {T} the value returned by `fn`
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
}

module.exports = { query, getClient, withTransaction, closePool };
