const ConfidenceCorridorService = require('../src/services/ConfidenceCorridorService').default;

describe('ConfidenceCorridorService', () => {
  beforeEach(() => {
    ConfidenceCorridorService.stopSession();
  });

  test('builds a preview for routes with narrow-lane stress', () => {
    const preview = ConfidenceCorridorService.buildRoutePreview(
      {
        anxietyScore: 48,
        breakdown: {
          narrowLanes: 60,
          heavyVehicles: 22,
        },
      },
      {
        vehicleProfile: {
          mirrorWidthCm: 182,
        },
      }
    );

    expect(preview.available).toBe(true);
    expect(preview.predictedSpareCm).toBeGreaterThan(0);
    expect(preview.segmentLabel).toBeTruthy();
  });

  test('records a successful passage and improves confidence memory', () => {
    const profile = {
      vehicleProfile: {
        mirrorWidthCm: 182,
      },
      confidenceMemory: {
        tightPassageSuccesses: 2,
        tightPassageSessions: 1,
        spatialConfidenceScore: 30,
      },
    };

    ConfidenceCorridorService.startSession(profile, {
      confidenceCorridor: {
        available: true,
        segmentLabel: 'Tight market lane',
        predictedSpareCm: 32,
        leftClearanceCm: 14,
        rightClearanceCm: 18,
        recommendedSpeedKmh: 8,
        status: 'caution',
        source: 'route_model',
      },
    });

    expect(ConfidenceCorridorService.getCurrentState().mode).toBe('armed');

    ConfidenceCorridorService.update({
      elapsedSeconds: 20,
      speedKmh: 7,
      stressScore: 60,
    });
    expect(ConfidenceCorridorService.getCurrentState().mode).toBe('active');

    ConfidenceCorridorService.update({
      elapsedSeconds: 80,
      speedKmh: 10,
      stressScore: 55,
    });

    const summary = ConfidenceCorridorService.getSessionSummary();
    expect(summary.encountered).toBe(true);
    expect(summary.successfulPassages).toBe(1);

    const nextMemory = ConfidenceCorridorService.mergeProfileConfidence(profile, summary);
    expect(nextMemory.tightPassageSuccesses).toBe(3);
    expect(nextMemory.spatialConfidenceScore).toBeGreaterThan(30);
  });
});
