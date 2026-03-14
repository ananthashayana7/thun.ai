/**
 * routeScoring.js (backend service)
 * Server-side route anxiety scoring – accident zone database lookup.
 * Called by the mobile app when computing route anxiety scores.
 */
'use strict';

const { query } = require('../db/db');

const NEUTRAL_ACCIDENT_SCORE = 30; // neutral fallback when DB or polyline unavailable

/**
 * Score a route polyline against known accident zones stored in DB.
 * Returns a score 0–100 (higher = more accident-prone path).
 *
 * @param {string} polyline - Google Maps encoded polyline
 * @returns {number} accident zone score 0–100
 */
async function scoreAccidentZones(polyline) {
  if (!polyline) return NEUTRAL_ACCIDENT_SCORE;

  try {
    // Decode polyline to bounding box for efficient spatial query
    const bbox = decodeToBoundingBox(polyline);
    if (!bbox) return NEUTRAL_ACCIDENT_SCORE;

    const result = await query(
      `SELECT COUNT(*) AS cnt
       FROM accident_zones
       WHERE ST_Intersects(
         geom,
         ST_MakeEnvelope($1, $2, $3, $4, 4326)
       )`,
      [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]
    );

    const count = parseInt(result.rows[0]?.cnt ?? '0', 10);
    // Normalise: >= 10 accident zones → score = 100
    return Math.min(100, count * 10);
  } catch (err) {
    // Table may not exist yet or DB unavailable
    console.warn('[routeScoring] accident zone query failed:', err.message);
    return NEUTRAL_ACCIDENT_SCORE;
  }
}

/**
 * Decode a Google Maps encoded polyline to a bounding box.
 * Minimal implementation – handles standard precision 5 encoding.
 */
function decodeToBoundingBox(encoded) {
  try {
    let index = 0;
    let lat = 0;
    let lng = 0;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

    while (index < encoded.length) {
      [lat, index] = decodeCoord(encoded, index, lat);
      [lng, index] = decodeCoord(encoded, index, lng);

      const latD = lat / 1e5;
      const lngD = lng / 1e5;
      if (latD < minLat) minLat = latD;
      if (latD > maxLat) maxLat = latD;
      if (lngD < minLng) minLng = lngD;
      if (lngD > maxLng) maxLng = lngD;
    }

    return { minLat, maxLat, minLng, maxLng };
  } catch {
    return null;
  }
}

function decodeCoord(encoded, index, prev) {
  let result = 0;
  let shift = 0;
  let byte;
  do {
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  const delta = result & 1 ? ~(result >> 1) : result >> 1;
  return [prev + delta, index];
}

module.exports = { scoreAccidentZones };
