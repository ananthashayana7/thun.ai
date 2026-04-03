/**
 * IVISEngine.test.js
 * Unit tests for the IVIS intervention orchestration logic.
 * 
 * Coverage:
 *  - Intervention dispatch based on stress levels
 *  - Cooldown logic (30s)
 *  - Speed gate (60 km/h)
 *  - Priority overrides (emergency vehicle)
 */

const { INTERVENTION, SPEED_GATE_KMH, SEVERITY } = require('../utils/constants');

// Mock services
const StressIndexService = {
  compute: jest.fn(),
  onScore: jest.fn(),
};

const TTSService = {
  speak: jest.fn(),
  setSpeed: jest.fn(),
};

const HUDService = {
  showIcon: jest.fn(),
  hideIcon: jest.fn(),
};

// Simplified IVISEngine for testing
class IVISEngine {
  constructor() {
    this._lastInterventionTime = {};
    const COOLDOWN = 30000;
    this._cooldowns = {
      default: COOLDOWN,
      [INTERVENTION.EMERGENCY_VEHICLE]: 0, // no cooldown for emergency
    };
  }

  processTick(score, obd, cvSignals) {
    const speed = obd?.speed || 0;
    
    // Speed gate check
    const voiceMuted = speed > SPEED_GATE_KMH;
    
    if (cvSignals?.emergencyVehicle) {
      this._dispatch(INTERVENTION.EMERGENCY_VEHICLE, SEVERITY.CRITICAL);
      return;
    }

    if (score >= 85) {
      this._dispatch(INTERVENTION.STALL_PROTOCOL, SEVERITY.CRITICAL);
    } else if (score >= 65) {
      if (!voiceMuted) {
        this._dispatch(INTERVENTION.BREATHING_CUE, SEVERITY.HIGH);
      }
      this._dispatch(INTERVENTION.HUD_ICON, SEVERITY.MEDIUM);
    } else if (score >= 40) {
      this._dispatch(INTERVENTION.CALM_AUDIO, SEVERITY.LOW);
    }
  }

  _dispatch(type, severity) {
    const now = Date.now();
    const lastTime = this._lastInterventionTime[type] || 0;
    const cooldown = this._cooldowns[type] ?? this._cooldowns.default;

    if (now - lastTime < cooldown) {
      return; // suppressed by cooldown
    }

    this._lastInterventionTime[type] = now;
    this._executeIntervention(type, severity);
  }

  _executeIntervention(type, severity) {
    // In real code, this would call TTS/HUD services
    this.lastIntervention = { type, severity, timestamp: Date.now() };
  }
}

describe('IVISEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new IVISEngine();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('dispatches calm audio for moderate stress (40-64)', () => {
    engine.processTick(50, { speed: 30 }, {});
    expect(engine.lastIntervention.type).toBe(INTERVENTION.CALM_AUDIO);
  });

  test('dispatches breathing cue for high stress (65-84)', () => {
    engine.processTick(70, { speed: 30 }, {});
    expect(engine.lastIntervention.type).toBe(INTERVENTION.BREATHING_CUE);
  });

  test('dispatches stall protocol for critical stress (>= 85)', () => {
    engine.processTick(90, { speed: 30 }, {});
    expect(engine.lastIntervention.type).toBe(INTERVENTION.STALL_PROTOCOL);
  });

  test('respects 30s cooldown for same intervention type', () => {
    engine.processTick(50, { speed: 30 }, {});
    const firstTime = engine.lastIntervention.timestamp;
    
    // Advance 10s
    jest.advanceTimersByTime(10000);
    engine.processTick(50, { speed: 30 }, {});
    
    // Should NOT have updated
    expect(engine.lastIntervention.timestamp).toBe(firstTime);

    // Advance another 25s (total 35s)
    jest.advanceTimersByTime(25000);
    engine.processTick(50, { speed: 30 }, {});
    
    // SHOULD have updated
    expect(engine.lastIntervention.timestamp).toBeGreaterThan(firstTime);
  });

  test('speed gate mutes breathing cue above 60 km/h', () => {
    engine.processTick(70, { speed: 75 }, {});
    // Should NOT be breathing_cue (voice), should be HUD_ICON (visual)
    expect(engine.lastIntervention.type).toBe(INTERVENTION.HUD_ICON);
  });

  test('emergency vehicle ignores speed gate and cooldown', () => {
    // Dispatch once
    engine.processTick(40, { speed: 80 }, { emergencyVehicle: true });
    expect(engine.lastIntervention.type).toBe(INTERVENTION.EMERGENCY_VEHICLE);
    const firstTime = engine.lastIntervention.timestamp;

    // Advance 1s and dispatch again
    jest.advanceTimersByTime(1000);
    engine.processTick(40, { speed: 80 }, { emergencyVehicle: true });
    
    // Should have updated (no cooldown)
    expect(engine.lastIntervention.timestamp).toBeGreaterThan(firstTime);
  });
});
