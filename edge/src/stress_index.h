#pragma once
/**
 * stress_index.h
 * Composite Stress Index computation (0–100).
 * Combines OBD-2, biometric, and CV signals.
 */

#include <cstdint>
#include <deque>

namespace ivis {

/** All inputs to the stress computation */
struct StressInputs {
    // OBD
    float    speed_kmh        { 0.0f };
    uint32_t rpm              { 0 };
    float    throttle_pct     { 0.0f };
    float    engine_load_pct  { 0.0f };
    uint8_t  gear             { 0 };

    // Biometrics (smartwatch)
    uint8_t  heart_rate       { 0 };    ///< 0 = unavailable
    float    hrv_rmssd        { -1.0f };///< −1 = unavailable

    // CV signals (from NPU inference)
    float    tailgating_risk  { 0.0f }; ///< 0–100
    float    lane_drift       { 0.0f }; ///< 0–100
    float    head_pose_score  { 0.0f }; ///< 0–100

    // Baseline (loaded from user profile)
    uint8_t  hr_baseline      { 72 };
    float    hrv_baseline     { 45.0f };
    float    trigger_threshold{ 65.0f };
};

class StressIndex {
public:
    explicit StressIndex(size_t window_size = 15);

    /**
     * Compute composite stress index from current inputs.
     * Maintains a rolling window for variance calculation.
     * @returns float 0–100
     */
    float compute(const StressInputs& inputs);

    bool isAboveThreshold(float score, float threshold) const;

    void reset();

private:
    static constexpr float W_OBD   = 0.40f;
    static constexpr float W_BIO   = 0.40f;
    static constexpr float W_CV    = 0.20f;

    size_t window_size_;
    std::deque<float> speed_window_;
    std::deque<float> prev_speed_;

    float computeOBDScore(const StressInputs& in);
    float computeBioScore(const StressInputs& in);
    float computeCVScore(const StressInputs& in);

    float speedVarianceScore() const;
    float harshBrakingScore(float current_speed);
    float harshAccelScore(float current_speed, float throttle);
    float gearMismatchScore(uint8_t gear, uint32_t rpm);
};

} // namespace ivis
