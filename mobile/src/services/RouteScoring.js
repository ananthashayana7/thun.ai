/**
 * RouteScoring.js
 * Peace of Mind route scoring – scores candidate routes 0–100 (anxiety score).
 * Lower = calmer route. Combines static factors with live traffic data.
 *
 * Data sources:
 *   • Google Maps Directions API (route geometry, traffic)
 *   • Google Maps Roads API / Places (heavy vehicle routes, narrow roads)
 *   • Backend route scoring API (accident zone database)
 */
import axios from 'axios';
import { ROUTE_WEIGHT, API } from '../utils/constants';

const GMAPS_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

class RouteScoring {
  constructor() {
    this._apiKey = null; // injected at runtime from secure storage
  }

  setApiKey(key) {
    this._apiKey = key;
  }

  /**
   * Score multiple candidate routes for a given origin → destination.
   * @param {string} origin - "lat,lng" or address
   * @param {string} destination - "lat,lng" or address
   * @param {object} options - { alternatives: true }
   * @returns {Array<{route, anxietyScore, breakdown}>} sorted by anxietyScore ASC
   */
  async scoreRoutes(origin, destination, options = {}) {
    let routes;
    try {
      routes = await this._fetchRoutes(origin, destination, options);
    } catch (err) {
      console.error('[RouteScoring] fetchRoutes error, falling back:', err);
      routes = await this._fallbackRoutes(origin, destination);
    }

    const scored = await Promise.all(
      routes.map((route) => this._scoreRoute(route, options.triggerPreferences || {}))
    );

    return scored.sort((a, b) => a.anxietyScore - b.anxietyScore);
  }

  async _fetchRoutes(origin, destination, options) {
    if (!this._apiKey) throw new Error('Google Maps API key not set');

    const params = {
      origin,
      destination,
      alternatives: options.alternatives !== false ? 'true' : 'false',
      departure_time: 'now',
      traffic_model: 'best_guess',
      key: this._apiKey,
    };

    const resp = await axios.get(GMAPS_DIRECTIONS_URL, { params, timeout: 8000 });
    if (resp.data.status !== 'OK') {
      throw new Error(`Google Maps error: ${resp.data.status}`);
    }
    return resp.data.routes;
  }

  async _scoreRoute(route, triggerPreferences = {}) {
    const leg = route.legs[0];

    // ── Factor 1: Live traffic congestion (from Google duration_in_traffic) ──
    const durationNormal = leg.duration?.value ?? 0;
    const durationTraffic = leg.duration_in_traffic?.value ?? durationNormal;
    const congestionRatio = durationTraffic / Math.max(durationNormal, 1);
    const liveTrafficScore = Math.min(100, (congestionRatio - 1) * 200);

    // ── Factor 2: Highway merges (count steps with "merge" in instructions) ──
    const steps = leg.steps ?? [];
    const mergeCount = steps.filter((s) =>
      /merge|ramp|enter.*highway|motorway/i.test(s.html_instructions ?? '')
    ).length;
    const highwayMergeScore = Math.min(100, mergeCount * 20);

    // ── Factor 3: Accident zones (server-side lookup) ──
    let accidentScore = 0;
    try {
      const resp = await axios.post(
        `${API.BASE_URL}/route/accident-zones`,
        { polyline: route.overview_polyline?.points },
        { timeout: API.TIMEOUT_MS }
      );
      accidentScore = resp.data?.score ?? 0;
    } catch {
      accidentScore = 30; // neutral fallback
    }

    // ── Factor 4: Heavy vehicle density (truck routes via Roads API) ──
    const heavyVehicleScore = await this._estimateHeavyVehicles(leg);

    // ── Factor 5: Narrow lanes (infer from road type in steps) ──
    const narrowLaneScore = this._estimateNarrowLanes(steps);
    const customTriggerScore = this._estimateCustomTriggerPenalty(steps, triggerPreferences);

    const breakdown = {
      liveTraffic: Math.round(liveTrafficScore),
      highwayMerge: Math.round(highwayMergeScore),
      accidentZones: Math.round(accidentScore),
      heavyVehicles: Math.round(heavyVehicleScore),
      narrowLanes: Math.round(narrowLaneScore),
      customTriggers: Math.round(customTriggerScore),
    };

    const baseAnxietyScore = (
      breakdown.heavyVehicles * ROUTE_WEIGHT.HEAVY_VEHICLE_DENSITY +
      breakdown.highwayMerge * ROUTE_WEIGHT.HIGHWAY_MERGE_FREQ +
      breakdown.accidentZones * ROUTE_WEIGHT.ACCIDENT_ZONES +
      breakdown.narrowLanes * ROUTE_WEIGHT.NARROW_LANES +
      breakdown.liveTraffic * ROUTE_WEIGHT.LIVE_TRAFFIC
    );
    const anxietyScore = Math.round(baseAnxietyScore + customTriggerScore * 0.15);

    return {
      route,
      anxietyScore: Math.min(100, anxietyScore),
      breakdown,
      summary: leg.summary,
      duration: leg.duration_in_traffic?.text ?? leg.duration?.text,
      distance: leg.distance?.text,
    };
  }

  async _estimateHeavyVehicles(leg) {
    // Heuristic: routes with highway/national road tags likely have more trucks
    const stepsText = leg.steps?.map((s) => s.html_instructions ?? '').join(' ') ?? '';
    const highwayKeywords = /NH|SH|national highway|expressway|bypass/i;
    return highwayKeywords.test(stepsText) ? 60 : 25;
  }

  _estimateNarrowLanes(steps) {
    const narrowKeywords = /lane|gully|service road|alley|internal road/i;
    const count = steps.filter((s) => narrowKeywords.test(s.html_instructions ?? '')).length;
    return Math.min(100, count * 15);
  }

  _estimateCustomTriggerPenalty(steps, triggerPreferences = {}) {
    if (!triggerPreferences || Object.values(triggerPreferences).every((enabled) => !enabled)) {
      return 0;
    }

    const instructions = steps.map((step) => step.html_instructions ?? '').join(' ');
    let penalty = 0;

    if (triggerPreferences.avoidFlyovers && /flyover|overpass|elevated/i.test(instructions)) {
      penalty += 45;
    }

    if (triggerPreferences.avoidUTurns && /u-turn|u turn/i.test(instructions)) {
      penalty += 55;
    }

    if (triggerPreferences.avoidHighwayMerges && /merge|ramp|motorway|expressway/i.test(instructions)) {
      penalty += 40;
    }

    if (triggerPreferences.avoidNarrowLanes && /lane|gully|service road|alley|internal road/i.test(instructions)) {
      penalty += 50;
    }

    return Math.min(100, penalty);
  }

  /** Minimal fallback: single route with neutral scores */
  async _fallbackRoutes(origin, destination) {
    return [
      {
        legs: [
          {
            summary: 'Default route',
            duration: { value: 1800, text: '30 mins' },
            duration_in_traffic: { value: 1800, text: '30 mins' },
            distance: { text: '15 km' },
            steps: [],
          },
        ],
        overview_polyline: { points: '' },
      },
    ];
  }
}

export default new RouteScoring();
