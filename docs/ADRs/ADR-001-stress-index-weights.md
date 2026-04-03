# ADR-001: Composite Stress Index Weights (0.4 / 0.4 / 0.2)

## Status: Accepted

## Context

The Composite Stress Index (CSI) merges three heterogeneous signal streams — OBD-2 vehicle telemetry, smartwatch biometrics, and computer-vision cues — into a single 0–100 score that drives the intervention engine. The weight assigned to each stream directly affects when and how the system intervenes. Incorrect weighting can produce either false positives (unnecessary interventions that distract the driver) or false negatives (missed stress events that compromise safety).

## Decision

We allocate the following weights:

| Signal Source | Weight | Rationale |
|---------------|--------|-----------|
| OBD-2 driving signals | **0.40** | Driving behaviour (speed variance, harsh braking, gear mismatch) is the most direct proxy for situational stress on Indian roads |
| Biometrics (HR, HRV) | **0.40** | Physiological response is the ground-truth indicator of the driver's anxiety state |
| Computer vision | **0.20** | CV signals (tailgating, lane drift, head pose) are complementary context; they improve accuracy but are noisier and less reliable in diverse road conditions |

When a sensor stream is unavailable, the remaining streams are re-normalised to sum to 1.0. For example, if CV is offline: OBD = 0.50, Bio = 0.50.

## Rationale

1. **Equal OBD + Bio weighting** ensures neither source dominates. A calm driver in heavy traffic (low bio, high OBD) and a panicky driver on an empty road (high bio, low OBD) are both correctly detected.

2. **Lower CV weight** accounts for the current maturity of edge-based CV models. Emergency vehicle detection and lane departure are high-value but intermittent signals. As models improve, this weight can be increased to 0.30.

3. **Re-normalisation on sensor loss** prevents the index from collapsing. Single-sensor operation remains useful — a biometrics-only CSI still triggers interventions when the driver's heart rate spikes.

4. The OBD sub-weights (speed variance 0.35, harsh braking 0.30, harsh acceleration 0.20, gear mismatch 0.15) were tuned against a synthetic dataset of 500 simulated Bangalore drives.

## Consequences

- **Pro:** System remains functional with any 1-of-3 sensor streams active
- **Pro:** Balanced detection across situational and physiological stress
- **Con:** Equal OBD/Bio weight means a smartwatch disconnection halves the total weight, potentially reducing sensitivity — mitigated by the re-normalisation strategy
- **Con:** CV signals may be under-valued for scenarios where visual context is critical (e.g., truck approaching from behind) — monitor and adjust post-deployment

## References

- Thun.AI TRS, FR-011: "CSI shall combine: OBD-2 signals (40%), biometrics (40%), CV signals (20%)"
- StressIndexService.js, line 13–17
- edge/src/stress_index.cpp, line 37–43
