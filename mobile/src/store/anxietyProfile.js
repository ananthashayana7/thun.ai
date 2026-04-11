/**
 * anxietyProfile.js
 * Zustand store – persists the user's anxiety profile and calibration data
 */
import { create } from 'zustand';
import LocalStorage from '../services/LocalStorage';
import { PRIVACY, VEHICLE_DEFAULTS } from '../utils/constants';

const DEFAULT_PROFILE = {
  onboardingComplete: false,
  userId: null,
  email: '',
  authToken: null,
  name: '',
  anxietySensitivityScore: 35,
  // Anxiety questionnaire responses (GAD-7 inspired, driving-specific)
  questionnaire: {},
  triggerPreferences: {
    avoidFlyovers: false,
    avoidUTurns: false,
    avoidHighwayMerges: false,
    avoidNarrowLanes: false,
  },
  vehicleProfile: {
    label: VEHICLE_DEFAULTS.LABEL,
    bodyWidthCm: VEHICLE_DEFAULTS.BODY_WIDTH_CM,
    mirrorWidthCm: VEHICLE_DEFAULTS.MIRROR_WIDTH_CM,
  },
  // Calibrated thresholds (auto-tuned per session)
  thresholds: {
    stressIndexTrigger: 65,   // 0-100, above this → intervention
    hrRestingBaseline: 72,    // bpm
    hrvBaseline: 45,          // ms RMSSD
    speedVarianceLimit: 15,   // km/h²
  },
  // Preferred interventions (user can disable individual types)
  interventionPrefs: {
    calmAudio: true,
    hudOverlay: true,
    breathingCue: true,
    laneGuidance: true,
    confidenceCorridor: true,
  },
  // Language for TTS (Sarvam AI supports Indian regional langs)
  ttsLanguage: 'en-IN',
  confidenceMemory: {
    tightPassageSuccesses: 0,
    tightPassageSessions: 0,
    spatialConfidenceScore: 18,
    bestTightPassageSpareCm: null,
    lastPassageAt: null,
  },
  // Running stats for adaptive threshold calibration
  calibration: {
    sessionCount: 0,
    avgBaselineStress: null,
    lastCalibrated: null,
  },
  privacy: {
    version: PRIVACY.CONSENT_VERSION,
    ...PRIVACY.DEFAULTS,
  },
};

export const useAnxietyProfileStore = create((set, get) => ({
  profile: DEFAULT_PROFILE,

  /** Load profile from SQLite on app start */
  loadProfile: async () => {
    try {
      const stored = await LocalStorage.getProfile();
      const privacy = await LocalStorage.getPrivacySettings?.();
      if (stored) {
        set({
          profile: {
            ...DEFAULT_PROFILE,
            ...stored,
            privacy: { ...DEFAULT_PROFILE.privacy, ...(privacy || stored.privacy || {}) },
          },
        });
      } else if (privacy) {
        set({ profile: { ...DEFAULT_PROFILE, privacy: { ...DEFAULT_PROFILE.privacy, ...privacy } } });
      }
    } catch (err) {
      console.error('[AnxietyStore] loadProfile error:', err);
    }
  },

  /** Merge partial updates and persist */
  updateProfile: async (updates) => {
    const next = { ...get().profile, ...updates };
    set({ profile: next });
    try {
      await LocalStorage.saveProfile(next);
      if (updates.privacy) {
        await LocalStorage.savePrivacySettings(updates.privacy);
      }
    } catch (err) {
      console.error('[AnxietyStore] updateProfile error:', err);
    }
  },

  /** Update calibrated thresholds after a drive session */
  updateThresholds: async (newThresholds) => {
    const next = {
      ...get().profile,
      thresholds: { ...get().profile.thresholds, ...newThresholds },
      calibration: {
        ...get().profile.calibration,
        lastCalibrated: new Date().toISOString(),
        sessionCount: (get().profile.calibration.sessionCount || 0) + 1,
      },
    };
    set({ profile: next });
    try {
      await LocalStorage.saveProfile(next);
    } catch (err) {
      console.error('[AnxietyStore] updateThresholds error:', err);
    }
  },

  /** Reset to defaults (used during re-onboarding) */
  resetProfile: async () => {
    set({ profile: DEFAULT_PROFILE });
    await LocalStorage.clearAllData();
    await LocalStorage.saveProfile(DEFAULT_PROFILE);
  },
}));
