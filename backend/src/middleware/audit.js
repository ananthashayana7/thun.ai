/**
 * audit.js
 * Middleware and service for audit logging user actions.
 * Logs all user-affecting operations for compliance and support debugging.
 */
'use strict';

const { query } = require('../db/db');

/**
 * Log an action to the audit table.
 * @param {object} opts - { userId, action, resourceType, resourceId, details, oldValues, newValues, ipAddress, userAgent }
 */
async function logAudit(opts = {}) {
  const {
    userId,
    action,
    resourceType,
    resourceId,
    details,
    oldValues,
    newValues,
    ipAddress,
    userAgent,
  } = opts;

  try {
    await query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        action,
        resourceType || null,
        resourceId || null,
        oldValues ? JSON.stringify(oldValues) : null,
        JSON.stringify(newValues || details || {}),
        ipAddress,
        userAgent,
      ]
    );
  } catch (err) {
    console.error('[Audit] Error logging action:', err.message);
    // Fail open: don't throw, audit logging is best-effort
  }
}

/**
 * Express middleware to attach audit context to request.
 * If user is authenticated (req.user.userId exists), includes it in all logs.
 */
function auditContextMiddleware(req, res, next) {
  req.auditLog = async (opts) => {
    await logAudit({
      ...opts,
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  };
  next();
}

/**
 * Query audit logs (for admin/support).
 * @param {object} filters - { userId, action, resourceType, dateRange }
 * @returns {Array} audit log entries
 */
async function queryAuditLogs(filters = {}) {
  const { userId, action, resourceType, dateRange } = filters;
  
  let queryStr = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  let paramNum = 1;

  if (userId) {
    queryStr += ` AND user_id = $${paramNum++}`;
    params.push(userId);
  }

  if (action) {
    queryStr += ` AND action = $${paramNum++}`;
    params.push(action);
  }

  if (resourceType) {
    queryStr += ` AND resource_type = $${paramNum++}`;
    params.push(resourceType);
  }

  if (dateRange?.start) {
    queryStr += ` AND timestamp >= $${paramNum++}`;
    params.push(dateRange.start);
  }

  if (dateRange?.end) {
    queryStr += ` AND timestamp <= $${paramNum++}`;
    params.push(dateRange.end);
  }

  queryStr += ' ORDER BY timestamp DESC LIMIT 10000';

  try {
    const result = await query(queryStr, params);
    return result.rows || [];
  } catch (err) {
    console.error('[Audit] Error querying logs:', err.message);
    return [];
  }
}

module.exports = {
  logAudit,
  auditContextMiddleware,
  queryAuditLogs,
};
