/**
 * intervention_dispatcher.cpp
 * Rule-based intervention selection.
 *
 * Priority order (highest first):
 *   1. EMERGENCY_VEHICLE  – override everything
 *   2. STALL_PROTOCOL     – RPM=0 + stationary + elevated stress
 *   3. LANE_GUIDANCE      – lane drift > 60
 *   4. BREATHING_CUE      – high stress (>= 75) + below speed gate
 *   5. CALM_AUDIO         – moderate stress (>= 65)
 *   6. HUD_ICON           – always when above threshold
 *
 * Speed gate: CALM_AUDIO and BREATHING_CUE muted above 60 km/h.
 */

#include "intervention_dispatcher.h"
#include <algorithm>

namespace ivis {

static constexpr float SPEED_GATE_KMH = 60.0f;

InterventionDispatcher::InterventionDispatcher(uint32_t cooldown_ms)
    : cooldown_ms_(cooldown_ms)
{}

DispatchResult InterventionDispatcher::dispatch(const DispatchInput& in) {
    DispatchResult result{};

    const uint8_t severity = computeSeverity(in.stress_index);

    // ── 1. Emergency vehicle override ────────────────────────────────────────
    if (in.emergency_vehicle) {
        if (cooldownPassed(InterventionType::EMERGENCY_VEHICLE)) {
            recordTrigger(InterventionType::EMERGENCY_VEHICLE);
            result.type     = InterventionType::EMERGENCY_VEHICLE;
            result.severity = 5;
            result.message  = "Emergency vehicle detected – move left and slow down";
        }
        return result; // always return after emergency, even if in cooldown
    }

    // Below trigger threshold → no intervention
    if (in.stress_index < in.trigger_threshold) {
        return result;
    }

    // ── 2. Stall protocol ─────────────────────────────────────────────────────
    if (in.stationary && in.rpm == 0) {
        if (cooldownPassed(InterventionType::STALL_PROTOCOL)) {
            recordTrigger(InterventionType::STALL_PROTOCOL);
            result.type     = InterventionType::STALL_PROTOCOL;
            result.severity = 4;
            result.message  = "Vehicle stopped safely – breathe before continuing";
            return result;
        }
    }

    // ── 3. Lane guidance ──────────────────────────────────────────────────────
    if (in.lane_drift > 60.0f && cooldownPassed(InterventionType::LANE_GUIDANCE)) {
        recordTrigger(InterventionType::LANE_GUIDANCE);
        result.type     = InterventionType::LANE_GUIDANCE;
        result.severity = severity;
        result.message  = in.lane_drift > 80.0f
            ? "Steer right – you are drifting left"
            : "Check your lane position";
        return result;
    }

    // ── 4. Breathing cue (speed-gated) ────────────────────────────────────────
    if (in.stress_index >= 75.0f
        && in.speed_kmh <= SPEED_GATE_KMH
        && cooldownPassed(InterventionType::BREATHING_CUE))
    {
        recordTrigger(InterventionType::BREATHING_CUE);
        result.type     = InterventionType::BREATHING_CUE;
        result.severity = severity;
        result.message  = "Breathe in 4 – hold 7 – out 8";
        return result;
    }

    // ── 5. Calm audio (speed-gated) ───────────────────────────────────────────
    if (in.speed_kmh <= SPEED_GATE_KMH && cooldownPassed(InterventionType::CALM_AUDIO)) {
        recordTrigger(InterventionType::CALM_AUDIO);
        result.type     = InterventionType::CALM_AUDIO;
        result.severity = severity;
        result.message  = "Ease off – you are doing well";
        return result;
    }

    // ── 6. HUD icon (no speed gate) ───────────────────────────────────────────
    if (cooldownPassed(InterventionType::HUD_ICON)) {
        recordTrigger(InterventionType::HUD_ICON);
        result.type     = InterventionType::HUD_ICON;
        result.severity = severity;
        result.message  = "Stress elevated";
        return result;
    }

    return result; // all in cooldown
}

// ─── Private ──────────────────────────────────────────────────────────────────

bool InterventionDispatcher::cooldownPassed(InterventionType type) const {
    const auto key = static_cast<uint8_t>(type);
    auto it = last_triggered_.find(key);
    if (it == last_triggered_.end()) return true;

    const auto elapsed = std::chrono::steady_clock::now() - it->second;
    return std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()
           >= static_cast<long>(cooldown_ms_);
}

void InterventionDispatcher::recordTrigger(InterventionType type) {
    last_triggered_[static_cast<uint8_t>(type)] = std::chrono::steady_clock::now();
}

uint8_t InterventionDispatcher::computeSeverity(float stress) const {
    if (stress >= 90.0f) return 5;
    if (stress >= 80.0f) return 4;
    if (stress >= 65.0f) return 3;
    if (stress >= 40.0f) return 2;
    return 1;
}

} // namespace ivis
