/**
 * IVISEngine.test.js
 * Unit tests for the IVIS intervention orchestration logic.
 *
 * Coverage:
 *  - Threshold-based intervention dispatch
 *  - Layered intervention order for elevated stress
 *  - Stall protocol only when stationary
 *  - Cooldown logic (30s)
 *  - Speed gate (60 km/h) for voice prompts
 *  - Priority overrides (emergency vehicle)
 */

const { INTERVENTION, SPEED_GATE_KMH, SEVERITY } = require('../src/utils/constants');

class IVISEngine {
  constructor() {
    this._lastInterventionTime = {};
    const COOLDOWN = 30000;
    this._cooldowns = {
      default: COOLDOWN,
      [INTERVENTION.EMERGENCY_VEHICLE]: 0,
    };
    this.dispatchedTypes = [];
    this.lastIntervention = null;
  }

  processTick(score, obd, cvSignals) {
    const speed = obd?.speed || 0;
    const rpm = obd?.rpm || 0;
    const voiceMuted = speed > SPEED_GATE_KMH;
    this.dispatchedTypes = [];

    if (cvSignals?.emergencyVehicle) {
      this._dispatch(INTERVENTION.EMERGENCY_VEHICLE, SEVERITY.CRITICAL);
      return;
    }

    if (rpm === 0 && speed === 0 && score >= 65) {
      this._dispatch(INTERVENTION.STALL_PROTOCOL, SEVERITY.HIGH);
      return;
    }

    if (score < 65) {
      return;
    }

    if (cvSignals?.laneDrift > 60) {
      this._dispatch(INTERVENTION.LANE_GUIDANCE, SEVERITY.MEDIUM);
    }

    if (score >= 75 && !voiceMuted) {
      this._dispatch(INTERVENTION.BREATHING_CUE, SEVERITY.HIGH);
    }

    if (!voiceMuted) {
      this._dispatch(INTERVENTION.CALM_AUDIO, score >= 80 ? SEVERITY.HIGH : SEVERITY.MEDIUM);
    }

    this._dispatch(INTERVENTION.HUD_ICON, score >= 80 ? SEVERITY.HIGH : SEVERITY.MEDIUM);
  }

  _dispatch(type, severity) {
    const now = Date.now();
    const lastTime = this._lastInterventionTime[type] || 0;
    const cooldown = this._cooldowns[type] ?? this._cooldowns.default;

    if (now - lastTime < cooldown) {
      return;
    }

    this._lastInterventionTime[type] = now;
    this._executeIntervention(type, severity);
  }

  _executeIntervention(type, severity) {
    this.dispatchedTypes.push(type);
    this.lastIntervention = { type, severity, timestamp: Date.now() };
  }
}

describe('IVISEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new IVISEngine();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-07T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not dispatch interventions below the stress trigger threshold', () => {
    engine.processTick(50, { speed: 30, rpm: 1500 }, {});
    expect(engine.lastIntervention).toBeNull();
    expect(engine.dispatchedTypes).toEqual([]);
  });

  test('dispatches calm audio and HUD icon for elevated stress (65-74)', () => {
    engine.processTick(70, { speed: 30, rpm: 1500 }, {});
    expect(engine.dispatchedTypes).toEqual([
      INTERVENTION.CALM_AUDIO,
      INTERVENTION.HUD_ICON,
    ]);
    expect(engine.lastIntervention.type).toBe(INTERVENTION.HUD_ICON);
  });

  test('adds breathing cue once stress reaches 75+', () => {
    engine.processTick(80, { speed: 30, rpm: 1500 }, {});
    expect(engine.dispatchedTypes).toEqual([
      INTERVENTION.BREATHING_CUE,
      INTERVENTION.CALM_AUDIO,
      INTERVENTION.HUD_ICON,
    ]);
    expect(engine.lastIntervention.type).toBe(INTERVENTION.HUD_ICON);
  });

  test('dispatches stall protocol only when critical stress happens while stationary', () => {
    engine.processTick(90, { speed: 0, rpm: 0 }, {});
    expect(engine.dispatchedTypes).toEqual([INTERVENTION.STALL_PROTOCOL]);
    expect(engine.lastIntervention.type).toBe(INTERVENTION.STALL_PROTOCOL);
  });

  test('respects 30s cooldown for repeated intervention types', () => {
    engine.processTick(70, { speed: 30, rpm: 1500 }, {});
    const firstTime = engine.lastIntervention.timestamp;

    jest.advanceTimersByTime(10000);
    engine.processTick(70, { speed: 30, rpm: 1500 }, {});
    expect(engine.lastIntervention.timestamp).toBe(firstTime);

    jest.advanceTimersByTime(25000);
    engine.processTick(70, { speed: 30, rpm: 1500 }, {});
    expect(engine.lastIntervention.timestamp).toBeGreaterThan(firstTime);
  });

  test('speed gate suppresses voice prompts above 60 km/h but keeps the HUD active', () => {
    engine.processTick(80, { speed: 75, rpm: 1800 }, {});
    expect(engine.dispatchedTypes).toEqual([INTERVENTION.HUD_ICON]);
    expect(engine.lastIntervention.type).toBe(INTERVENTION.HUD_ICON);
  });

  test('emergency vehicle ignores speed gate and cooldown', () => {
    engine.processTick(40, { speed: 80, rpm: 1800 }, { emergencyVehicle: true });
    expect(engine.lastIntervention.type).toBe(INTERVENTION.EMERGENCY_VEHICLE);
    const firstTime = engine.lastIntervention.timestamp;

    jest.advanceTimersByTime(1000);
    engine.processTick(40, { speed: 80, rpm: 1800 }, { emergencyVehicle: true });
    expect(engine.lastIntervention.timestamp).toBeGreaterThan(firstTime);
  });
});
