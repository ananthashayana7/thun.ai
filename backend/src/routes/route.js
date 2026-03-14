/**
 * route.js (route handler)
 * Route anxiety scoring API – accident zone lookup.
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { scoreAccidentZones } = require('../services/routeScoring');

const router = express.Router();

/**
 * POST /route/accident-zones
 * Body: { polyline: string }
 * Returns: { score: number (0–100) }
 */
router.post(
  '/accident-zones',
  [body('polyline').isString().withMessage('polyline must be a string')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { polyline } = req.body;
      const score = await scoreAccidentZones(polyline);
      res.json({ score });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
