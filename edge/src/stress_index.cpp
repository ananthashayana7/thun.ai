/**
 * stress_index.cpp
 * Composite Stress Index computation.
 * Mirrors StressIndexService.js logic in C++ for < 50 ms edge processing.
 */

#include "stress_index.h"
#include <cmath>
#include <algorithm>
#include <numeric>

namespace ivis {

StressIndex::StressIndex(size_t window_size)
    : window_size_(window_size)
{}

// ─── Public ───────────────────────────────────────────────────────────────────

float StressIndex::compute(const StressInputs& in) {
    // Maintain speed history for variance/braking/accel
    speed_window_.push_back(in.speed_kmh);
    if (speed_window_.size() > window_size_) speed_window_.pop_front();

    const float obd = computeOBDScore(in);
    const float bio = computeBioScore(in);
    const float cv  = computeCVScore(in);

    const float composite = obd * W_OBD + bio * W_BIO + cv * W_CV;
    return std::min(100.0f, std::max(0.0f, composite));
}

bool StressIndex::isAboveThreshold(float score, float threshold) const {
    return score >= threshold;
}

void StressIndex::reset() {
    speed_window_.clear();
}

// ─── OBD Component ───────────────────────────────────────────────────────────

float StressIndex::computeOBDScore(const StressInputs& in) {
    const float vVar  = speedVarianceScore();
    const float brake = harshBrakingScore(in.speed_kmh);
    const float accel = harshAccelScore(in.speed_kmh, in.throttle_pct);
    const float gear  = gearMismatchScore(in.gear, in.rpm);

    return vVar * 0.35f + brake * 0.30f + accel * 0.20f + gear * 0.15f;
}

float StressIndex::speedVarianceScore() const {
    if (speed_window_.size() < 2) return 0.0f;

    const float mean = std::accumulate(speed_window_.begin(), speed_window_.end(), 0.0f)
                     / static_cast<float>(speed_window_.size());

    float variance = 0.0f;
    for (const float s : speed_window_) {
        variance += (s - mean) * (s - mean);
    }
    variance /= static_cast<float>(speed_window_.size());

    // Normalise: variance of 225 (std_dev = 15 km/h) → score = 100
    return std::min(100.0f, (variance / 225.0f) * 100.0f);
}

float StressIndex::harshBrakingScore(float current_speed) {
    if (speed_window_.size() < 3) return 0.0f;
    const float prev = speed_window_[speed_window_.size() - 3];
    const float drop = prev - current_speed;
    return drop > 15.0f ? std::min(100.0f, (drop / 30.0f) * 100.0f) : 0.0f;
}

float StressIndex::harshAccelScore(float current_speed, float throttle) {
    if (speed_window_.size() < 3) return 0.0f;
    const float prev = speed_window_[speed_window_.size() - 3];
    const float gain = current_speed - prev;
    return (gain > 20.0f && throttle > 70.0f)
        ? std::min(100.0f, (gain / 30.0f) * 100.0f)
        : 0.0f;
}

float StressIndex::gearMismatchScore(uint8_t gear, uint32_t rpm) {
    if (gear == 0 || rpm == 0) return 0.0f;

    static const float optimal_rpm[7] = { 0, 2500, 2500, 2200, 2000, 1900, 1800 };
    const uint8_t g = std::min(gear, static_cast<uint8_t>(6));
    const float ideal = optimal_rpm[g];
    const float deviation = std::abs(static_cast<float>(rpm) - ideal);
    return std::min(100.0f, (deviation / 2000.0f) * 100.0f);
}

// ─── Biometric Component ──────────────────────────────────────────────────────

float StressIndex::computeBioScore(const StressInputs& in) {
    if (in.heart_rate == 0 && in.hrv_rmssd < 0.0f) {
        return 50.0f; // no watch connected – neutral
    }

    float score = 0.0f;
    int   count = 0;

    if (in.heart_rate > 0) {
        const float delta = std::max(0.0f, static_cast<float>(in.heart_rate) - in.hr_baseline);
        score += std::min(100.0f, (delta / 40.0f) * 100.0f);
        ++count;
    }

    if (in.hrv_rmssd >= 0.0f) {
        const float ratio = std::max(0.0f, 1.0f - in.hrv_rmssd / in.hrv_baseline);
        score += std::min(100.0f, ratio * 100.0f);
        ++count;
    }

    return count > 0 ? score / static_cast<float>(count) : 50.0f;
}

// ─── CV Component ─────────────────────────────────────────────────────────────

float StressIndex::computeCVScore(const StressInputs& in) {
    return in.tailgating_risk * 0.40f
         + in.lane_drift      * 0.35f
         + in.head_pose_score * 0.25f;
}

} // namespace ivis
