/**
 * ConfidenceCorridorService.js
 * Builds the "will I fit?" confidence corridor for narrow passages and
 * converts successful passages into long-term spatial confidence memory.
 */
import {
  CONFIDENCE_CORRIDOR,
  VEHICLE_DEFAULTS,
} from '../utils/constants';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildVehicleProfile(profile) {
  const vehicleProfile = profile?.vehicleProfile ?? {};
  const bodyWidthCm = clamp(
    Number(vehicleProfile.bodyWidthCm || VEHICLE_DEFAULTS.BODY_WIDTH_CM),
    140,
    220
  );
  const mirrorWidthCm = clamp(
    Number(vehicleProfile.mirrorWidthCm || bodyWidthCm || VEHICLE_DEFAULTS.MIRROR_WIDTH_CM),
    145,
    240
  );

  return {
    label: vehicleProfile.label || VEHICLE_DEFAULTS.LABEL,
    bodyWidthCm,
    mirrorWidthCm,
  };
}

function getBaseConfidenceMemory(profile) {
  return {
    tightPassageSuccesses: profile?.confidenceMemory?.tightPassageSuccesses ?? 0,
    tightPassageSessions: profile?.confidenceMemory?.tightPassageSessions ?? 0,
    spatialConfidenceScore: profile?.confidenceMemory?.spatialConfidenceScore ?? 18,
    bestTightPassageSpareCm: profile?.confidenceMemory?.bestTightPassageSpareCm ?? null,
    lastPassageAt: profile?.confidenceMemory?.lastPassageAt ?? null,
  };
}

function classifySpare(spareCm) {
  if (spareCm >= CONFIDENCE_CORRIDOR.GO_SPARE_CM) {
    return {
      status: 'clear',
      statusLabel: 'Green Corridor',
      recommendedSpeedKmh: 16,
      message: `You have ${spareCm} cm to spare. Keep a steady line and continue.`,
    };
  }

  if (spareCm >= CONFIDENCE_CORRIDOR.CAUTION_SPARE_CM) {
    return {
      status: 'caution',
      statusLabel: 'Slow And Center',
      recommendedSpeedKmh: 8,
      message: `You will fit with ${spareCm} cm to spare. Slow down and keep both mirrors even.`,
    };
  }

  return {
    status: 'stop',
    statusLabel: 'Pause Here',
    recommendedSpeedKmh: 0,
    message: 'The gap is too tight. Stop before committing and choose another line.',
  };
}

function buildSegmentLabel(narrowLaneScore) {
  if (narrowLaneScore >= 65) return 'Tight market lane';
  if (narrowLaneScore >= 40) return 'Residential pinch point';
  return 'Urban side street';
}

class ConfidenceCorridorService {
  constructor() {
    this.stopSession();
  }

  buildRoutePreview(routeLike, profile) {
    const breakdown = routeLike?.breakdown ?? {};
    const anxietyScore = routeLike?.anxietyScore ?? 0;
    const narrowLaneScore = breakdown.narrowLanes ?? 0;
    const heavyVehicleScore = breakdown.heavyVehicles ?? 0;
    const triggerPreferences = profile?.triggerPreferences ?? {};
    const vehicleProfile = buildVehicleProfile(profile);

    const shouldArm = narrowLaneScore >= 25 || anxietyScore >= 40;
    const preferenceBias = triggerPreferences.avoidNarrowLanes ? 6 : 0;
    const predictedSpareCm = clamp(
      Math.round(54 - narrowLaneScore * 0.35 - heavyVehicleScore * 0.08 - anxietyScore * 0.1 - preferenceBias),
      10,
      46
    );
    const leftClearanceCm = clamp(
      Math.round(predictedSpareCm / 2 - (narrowLaneScore >= 60 ? 4 : 2)),
      5,
      28
    );
    const rightClearanceCm = clamp(predictedSpareCm - leftClearanceCm, 5, 32);
    const classification = classifySpare(predictedSpareCm);

    return {
      available: shouldArm,
      segmentLabel: buildSegmentLabel(narrowLaneScore),
      predictedSpareCm,
      leftClearanceCm,
      rightClearanceCm,
      availableWidthCm: vehicleProfile.mirrorWidthCm + predictedSpareCm,
      recommendedSpeedKmh: classification.recommendedSpeedKmh,
      status: classification.status,
      source: 'route_model',
    };
  }

  startSession(profile, routeMeta = {}) {
    this._profile = profile ?? {};
    this._routeMeta = routeMeta ?? {};
    this._vehicleProfile = buildVehicleProfile(profile);
    this._confidenceMemory = getBaseConfidenceMemory(profile);
    this._preview = routeMeta?.confidenceCorridor?.available
      ? routeMeta.confidenceCorridor
      : this.buildRoutePreview(routeMeta, profile);
    this._passages = [];
    this._activePassage = null;
    this._lastOutcome = null;
    this._currentState = this._preview?.available
      ? this._buildArmedState()
      : this._buildIdleState();
  }

  stopSession() {
    this._profile = {};
    this._routeMeta = {};
    this._vehicleProfile = buildVehicleProfile(null);
    this._confidenceMemory = getBaseConfidenceMemory(null);
    this._preview = null;
    this._passages = [];
    this._activePassage = null;
    this._lastOutcome = null;
    this._currentState = this._buildIdleState();
  }

  update({ elapsedSeconds = 0, speedKmh = 0, stressScore = 0, cvSignals = {} } = {}) {
    if (!this._preview?.available) {
      this._currentState = this._buildIdleState();
      return this._currentState;
    }

    const measurement = this._resolveMeasurement(elapsedSeconds, speedKmh, cvSignals);
    if (!measurement.active) {
      if (this._activePassage) {
        this._finalizePassage();
      }

      this._currentState = this._lastOutcome
        ? this._buildCompletedState()
        : this._buildArmedState();
      return this._currentState;
    }

    const spareCm = measurement.leftClearanceCm + measurement.rightClearanceCm;
    const classification = classifySpare(spareCm);
    this._touchActivePassage({
      ...measurement,
      spareCm,
      status: classification.status,
      stressScore,
    });

    this._currentState = {
      mode: 'active',
      available: true,
      source: measurement.source,
      status: classification.status,
      statusLabel: classification.statusLabel,
      message: classification.message,
      segmentLabel: this._preview.segmentLabel,
      vehicleWidthCm: this._vehicleProfile.mirrorWidthCm,
      availableWidthCm: this._vehicleProfile.mirrorWidthCm + spareCm,
      spareCm,
      leftClearanceCm: measurement.leftClearanceCm,
      rightClearanceCm: measurement.rightClearanceCm,
      recommendedSpeedKmh: classification.recommendedSpeedKmh,
      progress: measurement.progress,
      spatialConfidenceScore: this._confidenceMemory.spatialConfidenceScore,
      tightPassageSuccesses: this._confidenceMemory.tightPassageSuccesses,
      nextMilestoneCount: Math.max(
        0,
        CONFIDENCE_CORRIDOR.GOAL_SUCCESSFUL_PASSES - this._confidenceMemory.tightPassageSuccesses
      ),
      lastOutcome: this._lastOutcome,
    };

    return this._currentState;
  }

  getCurrentState() {
    return this._currentState;
  }

  getSessionSummary() {
    if (this._activePassage) {
      this._finalizePassage();
    }

    const successfulPassages = this._passages.filter((passage) => passage.successful).length;
    const cautionPassages = this._passages.filter((passage) => passage.status === 'caution').length;
    const blockedPassages = this._passages.filter((passage) => passage.blocked).length;
    const bestSpareCm = this._passages.length > 0
      ? Math.max(...this._passages.map((passage) => passage.tightestSpareCm))
      : null;
    const nextMemory = this.mergeProfileConfidence(this._profile, {
      encountered: this._passages.length > 0,
      successfulPassages,
      cautionPassages,
      blockedPassages,
      bestSpareCm,
      lastPassageAt: this._lastOutcome?.completedAt ?? null,
    });

    return {
      encountered: this._passages.length > 0,
      segmentLabel: this._preview?.segmentLabel ?? null,
      successfulPassages,
      cautionPassages,
      blockedPassages,
      bestSpareCm,
      lastPassageAt: this._lastOutcome?.completedAt ?? null,
      confidenceBefore: this._confidenceMemory.spatialConfidenceScore,
      confidenceAfter: nextMemory.spatialConfidenceScore,
      passages: this._passages.slice(),
    };
  }

  mergeProfileConfidence(profile, summary) {
    const confidenceMemory = getBaseConfidenceMemory(profile);
    if (!summary?.encountered) {
      return confidenceMemory;
    }

    const tightPassageSuccesses = confidenceMemory.tightPassageSuccesses + (summary.successfulPassages ?? 0);
    const tightPassageSessions = confidenceMemory.tightPassageSessions + 1;
    const spatialConfidenceScore = clamp(
      Math.round(
        confidenceMemory.spatialConfidenceScore * 0.7
        + tightPassageSuccesses * 6
        + (summary.cautionPassages ?? 0) * 2
        - (summary.blockedPassages ?? 0) * 5
        + (summary.bestSpareCm ?? 0) * 0.18
      ),
      12,
      100
    );

    return {
      ...confidenceMemory,
      tightPassageSuccesses,
      tightPassageSessions,
      spatialConfidenceScore,
      bestTightPassageSpareCm: Math.max(
        confidenceMemory.bestTightPassageSpareCm ?? 0,
        summary.bestSpareCm ?? 0
      ) || null,
      lastPassageAt: summary.lastPassageAt ?? confidenceMemory.lastPassageAt,
    };
  }

  _resolveMeasurement(elapsedSeconds, speedKmh, cvSignals) {
    const hasSensorClearance = Number.isFinite(cvSignals?.leftClearanceCm)
      && Number.isFinite(cvSignals?.rightClearanceCm);

    if (hasSensorClearance) {
      return {
        active: true,
        source: 'sensor_fusion',
        progress: clamp(Number(cvSignals.progress ?? 0.5), 0, 1),
        leftClearanceCm: clamp(Math.round(cvSignals.leftClearanceCm), 3, 60),
        rightClearanceCm: clamp(Math.round(cvSignals.rightClearanceCm), 3, 60),
      };
    }

    const corridorStartSec = 12;
    const corridorDurationSec = 55;
    const corridorEndSec = corridorStartSec + corridorDurationSec;
    if (elapsedSeconds < corridorStartSec || elapsedSeconds > corridorEndSec || speedKmh > 28) {
      return { active: false, source: 'route_model' };
    }

    const progress = clamp((elapsedSeconds - corridorStartSec) / corridorDurationSec, 0, 1);
    const pinchFactor = Math.sin(progress * Math.PI);
    const extraClearanceCm = Math.round((1 - pinchFactor) * 10);

    return {
      active: true,
      source: 'route_model',
      progress,
      leftClearanceCm: clamp(this._preview.leftClearanceCm + Math.round(extraClearanceCm * 0.6), 5, 40),
      rightClearanceCm: clamp(this._preview.rightClearanceCm + Math.round(extraClearanceCm * 0.4), 5, 40),
    };
  }

  _touchActivePassage(passageSnapshot) {
    if (!this._activePassage) {
      this._activePassage = {
        enteredAt: new Date().toISOString(),
        segmentLabel: this._preview.segmentLabel,
        source: passageSnapshot.source,
        lowestStatus: passageSnapshot.status,
        tightestSpareCm: passageSnapshot.spareCm,
      };
    }

    this._activePassage.lowestStatus = this._getLowerStatus(
      this._activePassage.lowestStatus,
      passageSnapshot.status
    );
    this._activePassage.tightestSpareCm = Math.min(
      this._activePassage.tightestSpareCm,
      passageSnapshot.spareCm
    );
  }

  _finalizePassage() {
    if (!this._activePassage) return;

    const blocked = this._activePassage.lowestStatus === 'stop';
    const entry = {
      segmentLabel: this._activePassage.segmentLabel,
      source: this._activePassage.source,
      status: this._activePassage.lowestStatus,
      successful: !blocked,
      blocked,
      tightestSpareCm: this._activePassage.tightestSpareCm,
      completedAt: new Date().toISOString(),
    };

    this._passages.push(entry);
    this._lastOutcome = entry;
    this._activePassage = null;
  }

  _getLowerStatus(left, right) {
    const statusPriority = { clear: 1, caution: 2, stop: 3 };
    return statusPriority[right] > statusPriority[left] ? right : left;
  }

  _buildIdleState() {
    return {
      mode: 'idle',
      available: false,
      message: 'No tight-space corridor predicted on this route.',
      spatialConfidenceScore: this._confidenceMemory.spatialConfidenceScore,
      tightPassageSuccesses: this._confidenceMemory.tightPassageSuccesses,
      nextMilestoneCount: Math.max(
        0,
        CONFIDENCE_CORRIDOR.GOAL_SUCCESSFUL_PASSES - this._confidenceMemory.tightPassageSuccesses
      ),
      lastOutcome: this._lastOutcome,
    };
  }

  _buildArmedState() {
    return {
      mode: 'armed',
      available: true,
      source: this._preview.source,
      status: this._preview.status,
      statusLabel: 'Watching Ahead',
      segmentLabel: this._preview.segmentLabel,
      vehicleWidthCm: this._vehicleProfile.mirrorWidthCm,
      availableWidthCm: this._preview.availableWidthCm,
      spareCm: this._preview.predictedSpareCm,
      leftClearanceCm: this._preview.leftClearanceCm,
      rightClearanceCm: this._preview.rightClearanceCm,
      recommendedSpeedKmh: this._preview.recommendedSpeedKmh,
      message: 'Watching the next narrow passage. We will show the real clearance before you commit.',
      spatialConfidenceScore: this._confidenceMemory.spatialConfidenceScore,
      tightPassageSuccesses: this._confidenceMemory.tightPassageSuccesses,
      nextMilestoneCount: Math.max(
        0,
        CONFIDENCE_CORRIDOR.GOAL_SUCCESSFUL_PASSES - this._confidenceMemory.tightPassageSuccesses
      ),
      lastOutcome: this._lastOutcome,
    };
  }

  _buildCompletedState() {
    const lastOutcome = this._lastOutcome ?? {};
    return {
      mode: 'completed',
      available: true,
      source: lastOutcome.source ?? this._preview.source,
      status: lastOutcome.status,
      statusLabel: lastOutcome.blocked ? 'Choose Another Line' : 'Passage Cleared',
      segmentLabel: lastOutcome.segmentLabel ?? this._preview.segmentLabel,
      message: lastOutcome.blocked
        ? 'You stopped before the gap got too tight. That is the correct call when the space is not real.'
        : `Passage cleared with ${lastOutcome.tightestSpareCm} cm to spare. This becomes part of your spatial confidence memory.`,
      spareCm: lastOutcome.tightestSpareCm ?? this._preview.predictedSpareCm,
      vehicleWidthCm: this._vehicleProfile.mirrorWidthCm,
      availableWidthCm: (lastOutcome.tightestSpareCm ?? this._preview.predictedSpareCm) + this._vehicleProfile.mirrorWidthCm,
      recommendedSpeedKmh: 0,
      spatialConfidenceScore: this._confidenceMemory.spatialConfidenceScore,
      tightPassageSuccesses: this._confidenceMemory.tightPassageSuccesses,
      nextMilestoneCount: Math.max(
        0,
        CONFIDENCE_CORRIDOR.GOAL_SUCCESSFUL_PASSES - this._confidenceMemory.tightPassageSuccesses
      ),
      lastOutcome,
    };
  }
}

export default new ConfidenceCorridorService();
