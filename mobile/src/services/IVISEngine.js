/**
 * IVISEngine.js
 * Real-time on-device intervention orchestration.
 *
 * Intervention types:
 *   • calm_audio     – soothing verbal prompt via TTS
 *   • hud_icon       – overlay icon on HUD (passed to DriveScreen)
 *   • breathing_cue  – 4-7-8 breathing animation trigger
 *   • lane_guidance  – directional lane suggestion
 *   • emergency_vehicle – priority override, instruct driver to yield
 *   • stall_protocol – RPM=0 + stationary + elevated stress
 *
 * Rules:
 *   • Speed gate: mute voice > 60 km/h
 *   • Stall protocol: RPM=0 + speed=0 + stress > threshold
 *   • AI Therapist: only when RPM=0 (stationary)
 *   • Emergency vehicle: priority override all other interventions
 *   • Cooldown: minimum 30 s between repeated interventions of same type
 */
import StressIndexService from './StressIndexService';
import TTSService from './TTSService';
import OBDService from './OBDService';
import WatchService from './WatchService';
import LocalStorage from './LocalStorage';
import { INTERVENTION, SEVERITY, SPEED_GATE_KMH, DRIVE_STATE } from '../utils/constants';

const CALM_PROMPTS = [
  "Take a slow, deep breath. You're doing great.",
  "Ease off and let the traffic flow. You're safe.",
  "Shoulders down, hands loose on the wheel.",
  "You've handled this before. One step at a time.",
  "It's okay to pull over safely if you need a moment.",
];

const BREATHING_CUE_SCRIPT = 'Breathe in for 4… hold for 7… breathe out for 8.';
const EMERGENCY_SCRIPT = 'Emergency vehicle approaching. Move to the left and slow down.';
const STALL_SCRIPT = "You've stopped safely. Take a moment to breathe before continuing.";

const INTERVENTION_COOLDOWN_MS = 30_000;

class IVISEngine {
  constructor() {
    this._sessionId = null;
    this._profile = null;
    this._driveState = DRIVE_STATE.IDLE;
    this._lastIntervention = {};       // type → timestamp
    this._hudListeners = [];           // callbacks to DriveScreen
    this._breathingListeners = [];
    this._stressHistory = [];
    this._telemetryTick = null;
    this._emergencyActive = false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(sessionId, profile) {
    this._sessionId = sessionId;
    this._profile = profile;
    this._driveState = DRIVE_STATE.ACTIVE;
    this._stressHistory = [];
    this._lastIntervention = {};
    StressIndexService.reset();
    TTSService.setSpeed(0);
    console.log('[IVISEngine] started session:', sessionId);
  }

  stop() {
    this._driveState = DRIVE_STATE.COMPLETED;
    TTSService.stopAll();
    this._emergencyActive = false;
    StressIndexService.reset();
    console.log('[IVISEngine] stopped session:', this._sessionId);
  }

  // ─── Primary tick (called every 200 ms from DriveScreen) ───────────────────

  /**
   * @param {object} obd - live OBD telemetry
   * @param {object} biometrics - { hr, hrv }
   * @param {object} cvSignals - { tailgatingRisk, laneDrift, headPose, emergencyVehicle }
   */
  async processTick(obd, biometrics, cvSignals) {
    if (this._driveState !== DRIVE_STATE.ACTIVE && this._driveState !== DRIVE_STATE.STALLED) {
      return;
    }

    const speed = obd?.speed ?? 0;
    const rpm = obd?.rpm ?? 0;

    TTSService.setSpeed(speed);

    // ── Emergency vehicle: priority override ──────────────────────────────────
    if (cvSignals?.emergencyVehicle && !this._emergencyActive) {
      await this._triggerEmergency();
      return; // skip normal flow during emergency
    } else if (!cvSignals?.emergencyVehicle) {
      this._emergencyActive = false;
    }

    // ── Compute composite stress index ────────────────────────────────────────
    const stressScore = StressIndexService.compute(obd, biometrics, cvSignals, this._profile);
    this._stressHistory.push({ score: stressScore, ts: Date.now(), speed, rpm });

    // ── Stall protocol ────────────────────────────────────────────────────────
    if (rpm === 0 && speed === 0 && StressIndexService.isAboveThreshold(stressScore, this._profile)) {
      this._driveState = DRIVE_STATE.STALLED;
      await this._triggerStallProtocol(stressScore);
      return;
    } else if (rpm > 0) {
      this._driveState = DRIVE_STATE.ACTIVE;
    }

    // ── Normal intervention dispatch ──────────────────────────────────────────
    if (StressIndexService.isAboveThreshold(stressScore, this._profile)) {
      await this._dispatchIntervention(stressScore, speed, rpm, cvSignals);
    }
  }

  // ─── Intervention dispatch ──────────────────────────────────────────────────

  async _dispatchIntervention(stressScore, speed, rpm, cvSignals) {
    const severity = this._scoreSeverity(stressScore);

    // Lane drift → lane guidance
    if (cvSignals?.laneDrift > 60 && this._cooldownPassed(INTERVENTION.LANE_GUIDANCE)) {
      await this._triggerLaneGuidance(cvSignals.laneDrift, severity);
    }

    // High stress → breathing cue (medium+ severity, speed gate applies)
    if (stressScore >= 75 && severity >= SEVERITY.MEDIUM && this._cooldownPassed(INTERVENTION.BREATHING_CUE)) {
      await this._triggerBreathingCue(severity);
    }

    // Moderate stress → calm audio (speed gate enforced by TTSService)
    if (stressScore >= 65 && this._cooldownPassed(INTERVENTION.CALM_AUDIO)) {
      await this._triggerCalmAudio(severity);
    }

    // HUD icon always visible regardless of speed
    if (this._cooldownPassed(INTERVENTION.HUD_ICON)) {
      this._triggerHUD(stressScore, severity);
    }
  }

  async _triggerCalmAudio(severity) {
    const prompt = CALM_PROMPTS[Math.floor(Math.random() * CALM_PROMPTS.length)];
    await TTSService.speak(prompt, { priority: severity >= SEVERITY.HIGH ? 'high' : 'normal' });
    this._recordIntervention(INTERVENTION.CALM_AUDIO, severity);
  }

  async _triggerBreathingCue(severity) {
    await TTSService.speak(BREATHING_CUE_SCRIPT, { priority: 'high' });
    this._breathingListeners.forEach((cb) => cb({ active: true }));
    this._recordIntervention(INTERVENTION.BREATHING_CUE, severity);
  }

  _triggerHUD(stressScore, severity) {
    this._hudListeners.forEach((cb) => cb({ stressScore, severity, type: INTERVENTION.HUD_ICON }));
    this._recordIntervention(INTERVENTION.HUD_ICON, severity);
  }

  async _triggerLaneGuidance(driftScore, severity) {
    const msg = driftScore > 80
      ? 'Gently steer right, you are drifting left.'
      : 'Watch your lane position.';
    await TTSService.speak(msg, { priority: 'high' });
    this._hudListeners.forEach((cb) => cb({ type: INTERVENTION.LANE_GUIDANCE, severity }));
    this._recordIntervention(INTERVENTION.LANE_GUIDANCE, severity);
  }

  async _triggerEmergency() {
    this._emergencyActive = true;
    await TTSService.speak(EMERGENCY_SCRIPT, { priority: 'high' });
    this._hudListeners.forEach((cb) =>
      cb({ type: INTERVENTION.EMERGENCY_VEHICLE, severity: SEVERITY.CRITICAL })
    );
    this._recordIntervention(INTERVENTION.EMERGENCY_VEHICLE, SEVERITY.CRITICAL);
  }

  async _triggerStallProtocol(stressScore) {
    await TTSService.speak(STALL_SCRIPT, { priority: 'high' });
    this._hudListeners.forEach((cb) =>
      cb({ type: INTERVENTION.STALL_PROTOCOL, severity: SEVERITY.HIGH, stressScore })
    );
    this._breathingListeners.forEach((cb) => cb({ active: true }));
    this._recordIntervention(INTERVENTION.STALL_PROTOCOL, SEVERITY.HIGH);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _scoreSeverity(stressScore) {
    if (stressScore >= 90) return SEVERITY.CRITICAL;
    if (stressScore >= 80) return SEVERITY.HIGH;
    if (stressScore >= 65) return SEVERITY.MEDIUM;
    if (stressScore >= 40) return SEVERITY.LOW;
    return SEVERITY.INFO;
  }

  _cooldownPassed(type) {
    const last = this._lastIntervention[type] ?? 0;
    return Date.now() - last >= INTERVENTION_COOLDOWN_MS;
  }

  _recordIntervention(type, severity) {
    this._lastIntervention[type] = Date.now();
    if (this._sessionId) {
      LocalStorage.logIntervention(this._sessionId, type, severity).catch(() => {});
    }
  }

  /** Called only when vehicle is stationary (RPM = 0) */
  isTherapistAvailable() {
    const obd = OBDService.getLastData();
    return (obd?.rpm ?? 0) === 0;
  }

  // ─── Event listeners for DriveScreen ────────────────────────────────────────

  onHUDUpdate(cb) {
    this._hudListeners.push(cb);
    return () => { this._hudListeners = this._hudListeners.filter((c) => c !== cb); };
  }

  onBreathingCue(cb) {
    this._breathingListeners.push(cb);
    return () => { this._breathingListeners = this._breathingListeners.filter((c) => c !== cb); };
  }

  /** Public accessor for current stress score (avoids direct private field access) */
  getLastStressScore() {
    return this._stressHistory.slice(-1)[0]?.score ?? 0;
  }

  // ─── Session summary ─────────────────────────────────────────────────────────

  getSessionSummary() {
    const scores = this._stressHistory.map((h) => h.score);
    if (scores.length === 0) return null;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const peak = Math.max(...scores);
    const stressEvents = this._stressHistory.filter((h) => h.score >= 65);
    return {
      anxietyScoreAvg: Math.round(avg),
      peakStress: peak,
      stressEventCount: stressEvents.length,
      stressEvents: stressEvents.slice(-50), // keep up to last 50
    };
  }
}

export default new IVISEngine();
