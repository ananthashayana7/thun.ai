#pragma once
/**
 * intervention_dispatcher.h
 * Decides which intervention to trigger based on stress index and context.
 */

#include <cstdint>
#include <string>
#include <unordered_map>
#include <chrono>

namespace ivis {

enum class InterventionType : uint8_t {
    NONE            = 0,
    CALM_AUDIO      = 1,
    HUD_ICON        = 2,
    BREATHING_CUE   = 3,
    LANE_GUIDANCE   = 4,
    EMERGENCY_VEHICLE = 5,
    STALL_PROTOCOL  = 6,
};

struct DispatchInput {
    float    stress_index    { 0.0f };
    float    speed_kmh       { 0.0f };
    uint32_t rpm             { 0 };
    float    lane_drift      { 0.0f };
    bool     emergency_vehicle{ false };
    bool     stationary      { false };
    float    trigger_threshold{ 65.0f };
};

struct DispatchResult {
    InterventionType type     { InterventionType::NONE };
    uint8_t          severity { 0 };  ///< 1–5
    std::string      message;
};

class InterventionDispatcher {
public:
    explicit InterventionDispatcher(uint32_t cooldown_ms = 30'000);

    DispatchResult dispatch(const DispatchInput& in);

private:
    uint32_t cooldown_ms_;
    std::unordered_map<uint8_t, std::chrono::steady_clock::time_point> last_triggered_;

    bool cooldownPassed(InterventionType type) const;
    void recordTrigger(InterventionType type);
    uint8_t computeSeverity(float stress) const;
};

} // namespace ivis
