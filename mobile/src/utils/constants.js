/**
 * constants.js
 * App-wide constants: thresholds, colors, API endpoints, intervention types
 */

// ─── Stress Index Thresholds ─────────────────────────────────────────────────
export const STRESS = {
  LOW: 0,
  MODERATE: 40,
  HIGH: 65,
  CRITICAL: 85,
};

// ─── Intervention Types ───────────────────────────────────────────────────────
export const INTERVENTION = {
  CALM_AUDIO: 'calm_audio',
  HUD_ICON: 'hud_icon',
  BREATHING_CUE: 'breathing_cue',
  LANE_GUIDANCE: 'lane_guidance',
  EMERGENCY_VEHICLE: 'emergency_vehicle',
  STALL_PROTOCOL: 'stall_protocol',
};

// ─── Speed Gate ───────────────────────────────────────────────────────────────
export const SPEED_GATE_KMH = 60; // mute voice interventions above this speed

// ─── OBD-2 Signal Keys ────────────────────────────────────────────────────────
export const OBD = {
  SPEED: 'speed',          // km/h
  RPM: 'rpm',
  THROTTLE: 'throttlePos',
  ENGINE_LOAD: 'engineLoad',
  COOLANT_TEMP: 'coolantTemp',
  GEAR: 'gear',
};

// ─── Route Anxiety Score Weights ─────────────────────────────────────────────
export const ROUTE_WEIGHT = {
  HEAVY_VEHICLE_DENSITY: 0.25,
  HIGHWAY_MERGE_FREQ: 0.20,
  ACCIDENT_ZONES: 0.25,
  NARROW_LANES: 0.15,
  LIVE_TRAFFIC: 0.15,
};

export const VEHICLE_DEFAULTS = {
  LABEL: 'Compact SUV',
  BODY_WIDTH_CM: 176,
  MIRROR_WIDTH_CM: 182,
};

export const CONFIDENCE_CORRIDOR = {
  GO_SPARE_CM: 30,
  CAUTION_SPARE_CM: 18,
  STOP_SPARE_CM: 8,
  GOAL_SUCCESSFUL_PASSES: 10,
};

// ─── Colors ───────────────────────────────────────────────────────────────────
export const COLORS = {
  primary: '#4F6EF7',
  accent: '#34C759',
  danger: '#FF3B30',
  warning: '#FF9500',
  background: '#0D0F14',
  surface: '#1A1D27',
  text: '#FFFFFF',
  textSecondary: '#9EA8B3',
  muted: '#3D4456',
};

// ─── Drive Session States ─────────────────────────────────────────────────────
export const DRIVE_STATE = {
  IDLE: 'idle',
  PRE_DRIVE: 'pre_drive',
  ACTIVE: 'active',
  STALLED: 'stalled',
  COMPLETED: 'completed',
};

// ─── Intervention Severity ────────────────────────────────────────────────────
export const SEVERITY = {
  INFO: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
};

// ─── API Endpoints ────────────────────────────────────────────────────────────
export const API = {
  BASE_URL: process.env.BACKEND_URL || 'https://api.thun.ai',
  TIMEOUT_MS: 10000,
  // Google API key – set GOOGLE_MAPS_API_KEY in your build environment / .env
  GOOGLE_MAPS_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
};

// ─── SQLite ───────────────────────────────────────────────────────────────────
export const DB = {
  NAME: 'thunai.db',
  VERSION: '1.0',
  DRIVE_HISTORY_DAYS: 90,
};

// ─── Biometric Ranges ─────────────────────────────────────────────────────────
export const BIOMETRIC = {
  HR_MIN: 40,
  HR_MAX: 200,
  HRV_MIN: 10,    // ms RMSSD – stressed
  HRV_MAX: 100,   // ms RMSSD – calm
};
