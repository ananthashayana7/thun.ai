/**
 * StressIndexService.js
 * Composite Stress Index (0–100) combining:
 *   • OBD-2 driving signals (speed variance, harsh events, gear mismatch)
 *   • Smartwatch biometrics (HR, HRV)
 *   • Computer-vision signals from edge (passed in from IVISEngine)
 *
 * Returns a score 0–100 and fires intervention callbacks when threshold exceeded.
 */
import { STRESS, BIOMETRIC, OBD } from '../utils/constants';

// ─── Component weights ────────────────────────────────────────────────────────
const WEIGHTS = {
  obdDriving: 0.40,
  biometric: 0.40,
  cvSignal: 0.20,
};

// ─── OBD sub-weights ──────────────────────────────────────────────────────────
const OBD_WEIGHTS = {
  speedVariance: 0.35,
  harshBraking: 0.30,
  harshAcceleration: 0.20,
  gearMismatch: 0.15,
};

class StressIndexService {
  constructor() {
    this._history = [];        // rolling window of recent telemetry
    this._windowSize = 15;     // samples (~3 s at 5 Hz)
    this._lastScore = 0;
    this._callbacks = [];
  }

  /** Register a callback to receive stress score updates */
  onScore(cb) {
    this._callbacks.push(cb);
    return () => {
      this._callbacks = this._callbacks.filter((c) => c !== cb);
    };
  }

  /**
   * Main entry point – called on every telemetry tick.
   * @param {object} obd - OBD telemetry snapshot
   * @param {object} biometrics - { hr, hrv } from WatchService
   * @param {object} cvSignals - { tailgatingRisk, laneDrift, headPose } from edge
   * @param {object} profile - anxiety profile (contains calibrated thresholds)
   * @returns {number} composite stress index 0–100
   */
  compute(obd, biometrics, cvSignals, profile) {
    this._history.push({ obd, biometrics, timestamp: Date.now() });
    if (this._history.length > this._windowSize) {
      this._history.shift();
    }

    const obdScore = this._computeOBDScore(obd);
    const bioScore = this._computeBiometricScore(biometrics, profile);
    const cvScore = this._computeCVScore(cvSignals);

    const composite = Math.min(
      100,
      obdScore * WEIGHTS.obdDriving +
      bioScore * WEIGHTS.biometric +
      cvScore * WEIGHTS.cvSignal
    );

    const rounded = Math.round(composite);
    this._lastScore = rounded;
    this._callbacks.forEach((cb) => cb(rounded, { obdScore, bioScore, cvScore }));
    return rounded;
  }

  // ─── OBD Component ──────────────────────────────────────────────────────────

  _computeOBDScore(obd) {
    if (!obd) return 0;

    const speedVarianceScore = this._speedVarianceScore();
    const harshBrakingScore = this._harshBrakingScore(obd);
    const harshAccelScore = this._harshAccelScore(obd);
    const gearMismatchScore = this._gearMismatchScore(obd);

    return (
      speedVarianceScore * OBD_WEIGHTS.speedVariance +
      harshBrakingScore * OBD_WEIGHTS.harshBraking +
      harshAccelScore * OBD_WEIGHTS.harshAcceleration +
      gearMismatchScore * OBD_WEIGHTS.gearMismatch
    );
  }

  /** Variance of speed over the rolling window → 0–100 */
  _speedVarianceScore() {
    const speeds = this._history
      .map((h) => h.obd?.[OBD.SPEED])
      .filter((s) => s !== null && s !== undefined);
    if (speeds.length < 2) return 0;
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const variance = speeds.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / speeds.length;
    // Normalise: variance > 225 (std_dev=15 km/h) → score=100
    return Math.min(100, (variance / 225) * 100);
  }

  /** Detect harsh braking: sudden throttle drop + speed deceleration */
  _harshBrakingScore(obd) {
    if (this._history.length < 3) return 0;
    const prev = this._history[this._history.length - 3];
    const speedDrop = (prev.obd?.[OBD.SPEED] ?? 0) - (obd?.[OBD.SPEED] ?? 0);
    // > 15 km/h drop in ~0.6 s → harsh brake
    return speedDrop > 15 ? Math.min(100, (speedDrop / 30) * 100) : 0;
  }

  /** Detect harsh acceleration: rapid throttle + speed increase */
  _harshAccelScore(obd) {
    if (this._history.length < 3) return 0;
    const prev = this._history[this._history.length - 3];
    const speedGain = (obd?.[OBD.SPEED] ?? 0) - (prev.obd?.[OBD.SPEED] ?? 0);
    const throttle = obd?.[OBD.THROTTLE] ?? 0;
    // > 20 km/h gain in ~0.6 s with high throttle
    return speedGain > 20 && throttle > 70 ? Math.min(100, (speedGain / 30) * 100) : 0;
  }

  /** Gear mismatch: high RPM in low gear, or RPM drop in high gear */
  _gearMismatchScore(obd) {
    const rpm = obd?.[OBD.RPM];
    const gear = obd?.[OBD.GEAR];
    const speed = obd?.[OBD.SPEED];
    if (!rpm || !gear || !speed) return 0;

    // Optimal RPM band by gear (heuristic for petrol engine)
    const optimalRpm = { 1: 2500, 2: 2500, 3: 2200, 4: 2000, 5: 1900, 6: 1800 };
    const ideal = optimalRpm[gear] || 2000;
    const deviation = Math.abs(rpm - ideal);
    return Math.min(100, (deviation / 2000) * 100);
  }

  // ─── Biometric Component ────────────────────────────────────────────────────

  _computeBiometricScore(biometrics, profile) {
    if (!biometrics) return 50; // default neutral when no watch connected
    const { hr, hrv } = biometrics;

    const hrBaseline = profile?.thresholds?.hrRestingBaseline ?? 72;
    const hrvBaseline = profile?.thresholds?.hrvBaseline ?? 45;

    let score = 0;
    let count = 0;

    if (hr !== null && hr !== undefined) {
      // HR elevated above baseline: +stress
      const hrDelta = Math.max(0, hr - hrBaseline);
      score += Math.min(100, (hrDelta / 40) * 100); // 40 bpm above baseline = 100
      count++;
    }

    if (hrv !== null && hrv !== undefined) {
      // HRV below baseline: +stress (low HRV = stressed)
      const hrvRatio = Math.max(0, 1 - hrv / hrvBaseline);
      score += Math.min(100, hrvRatio * 100);
      count++;
    }

    return count > 0 ? score / count : 50;
  }

  // ─── CV Signal Component ─────────────────────────────────────────────────────

  _computeCVScore(cvSignals) {
    if (!cvSignals) return 0;
    const { tailgatingRisk = 0, laneDrift = 0, headPose = 0 } = cvSignals;
    // All inputs expected as 0–100 from edge
    return (tailgatingRisk * 0.4 + laneDrift * 0.35 + headPose * 0.25);
  }

  // ─── Intervention check ──────────────────────────────────────────────────────

  isAboveThreshold(score, profile) {
    const threshold = profile?.thresholds?.stressIndexTrigger ?? STRESS.HIGH;
    return score >= threshold;
  }

  getLastScore() {
    return this._lastScore;
  }

  reset() {
    this._history = [];
    this._lastScore = 0;
  }
}

export default new StressIndexService();
