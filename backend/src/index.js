/**
 * index.js
 * thun.ai backend – Express server entry point
 */
'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const requestIdMiddleware = require('./middleware/requestId');
const { auditContextMiddleware } = require('./middleware/audit');
const { initRedis } = require('./db/redis');
const { globalRateLimiter } = require('./middleware/rateLimiter');
const { captureException, initErrorTracker } = require('./services/errorTracker');
const { collectStartupStatus, assertStartupReady } = require('./config/startup');
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const driveRoutes = require('./routes/drive');
const routeRoutes = require('./routes/route');
const feedbackRoutes = require('./routes/feedback');
const privacyRoutes = require('./routes/privacy');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const app = express();

// ─── Security headers ────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl)
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ─── Request ID middleware (for tracing) ──────────────────────────────────────
app.use(requestIdMiddleware);

// ─── Audit context middleware (for audit logging) ───────────────────────────────
app.use(auditContextMiddleware);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ─── Global rate limiter (100 req/min per user/IP) ──────────────────────────────────────
app.use(globalRateLimiter);

// ─── Health check (NOT rate limited) ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Health check (deep) - checks dependencies ─────────────────────────────────
app.get('/health/providers', (_req, res) => {
  const { getCircuitBreakerStatus } = require('./services/llmService');
  res.json({
    status: 'ok',
    providers: getCircuitBreakerStatus(),
  });
});

app.get('/health/startup', (_req, res) => {
  res.json(collectStartupStatus());
});

// ─── Public routes ────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);

// ─── Protected routes (require valid JWT) ────────────────────────────────────
app.use('/drive', authMiddleware, driveRoutes);
app.use('/route', authMiddleware, routeRoutes);
app.use('/feedback', authMiddleware, feedbackRoutes);
app.use('/privacy', authMiddleware, privacyRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`[${req.id}] Error: ${err.message}`);
  captureException(err, {
    requestId: req.id,
    userId: req.user?.userId,
    path: req.path,
    method: req.method,
  });
  
  // Sanitize error response (don't leak secrets)
  let status = err.status || 500;
  let message = err.message;
  
  if (status === 500) {
    message = 'Internal server error';
  }
  
  res.status(status).json({
    error: message,
    request_id: req.id,
    timestamp: new Date().toISOString(),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    const validatedStartupStatus = assertStartupReady();
    initErrorTracker({ environment: validatedStartupStatus.environment });
    console.log(`[Startup] readiness=${validatedStartupStatus.status}`);

    // Initialize Redis (with fallback to in-memory)
    await initRedis();
    console.log('[Redis] Initialized');
  } catch (err) {
    console.error('[Redis] Failed to initialize:', err.message);
  }

  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`[thun.ai backend] listening on port ${PORT} (${process.env.NODE_ENV})`);
    });
  }
}

// Only start if this is the main module (not imported for tests)
if (require.main === module) {
  start().catch((err) => {
    console.error('[Startup] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = app; // exported for tests
