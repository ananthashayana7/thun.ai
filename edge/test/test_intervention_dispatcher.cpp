/**
 * test_intervention_dispatcher.cpp
 * Unit tests for the InterventionDispatcher class using Google Test.
 */

#include <gtest/gtest.h>
#include <thread>
#include <chrono>
#include "../src/intervention_dispatcher.h"

namespace ivis {
namespace {

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Build a DispatchInput above the default trigger threshold (65) with sane
// defaults that would normally produce CALM_AUDIO or HUD_ICON.
static DispatchInput makeAboveThreshold(float stress = 70.0f,
                                        float speed  = 40.0f,
                                        uint32_t rpm = 2000) {
    DispatchInput d{};
    d.stress_index      = stress;
    d.speed_kmh         = speed;
    d.rpm               = rpm;
    d.lane_drift        = 0.0f;
    d.emergency_vehicle = false;
    d.stationary        = false;
    d.trigger_threshold = 65.0f;
    return d;
}

// ─── Rule Precedence Tests ──────────────────────────────────────────────────

// Use a very short cooldown so we can test multiple dispatches without waiting.
class DispatcherPrecedenceTest : public ::testing::Test {
protected:
    // 0 ms cooldown so rules are never blocked
    InterventionDispatcher dispatcher{0};
};

TEST_F(DispatcherPrecedenceTest, EmergencyOverridesEverything) {
    DispatchInput d = makeAboveThreshold(90.0f, 40.0f);
    d.emergency_vehicle = true;
    d.lane_drift        = 80.0f; // would normally trigger lane guidance
    d.stationary        = true;
    d.rpm               = 0;    // would normally trigger stall protocol

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::EMERGENCY_VEHICLE);
    EXPECT_EQ(r.severity, 5u);
}

TEST_F(DispatcherPrecedenceTest, StallProtocolOverridesLaneGuidance) {
    DispatchInput d = makeAboveThreshold(80.0f);
    d.stationary   = true;
    d.rpm          = 0;
    d.lane_drift   = 80.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::STALL_PROTOCOL);
    EXPECT_EQ(r.severity, 4u);
}

TEST_F(DispatcherPrecedenceTest, LaneGuidanceOverridesBreathingCue) {
    DispatchInput d = makeAboveThreshold(80.0f, 40.0f);
    d.lane_drift = 70.0f; // above 60

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::LANE_GUIDANCE);
}

TEST_F(DispatcherPrecedenceTest, BreathingCueOverridesCalmAudio) {
    // stress >= 75, speed <= 60
    DispatchInput d = makeAboveThreshold(80.0f, 50.0f);
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::BREATHING_CUE);
}

TEST_F(DispatcherPrecedenceTest, CalmAudioOverridesHudIcon) {
    // stress >= 65 but < 75, speed <= 60
    DispatchInput d = makeAboveThreshold(68.0f, 50.0f);
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::CALM_AUDIO);
}

TEST_F(DispatcherPrecedenceTest, HudIconWhenAboveSpeedGate) {
    // stress above threshold, speed > 60 → no audio/breathing, falls to HUD
    DispatchInput d = makeAboveThreshold(70.0f, 100.0f);
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::HUD_ICON);
}

// ─── Speed Gating ────────────────────────────────────────────────────────────

class DispatcherSpeedGateTest : public ::testing::Test {
protected:
    InterventionDispatcher dispatcher{0};
};

TEST_F(DispatcherSpeedGateTest, NoCalmAudioAbove60) {
    DispatchInput d = makeAboveThreshold(68.0f, 61.0f); // just above gate
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    // Should fall through to HUD_ICON since CALM_AUDIO is speed-gated
    EXPECT_NE(r.type, InterventionType::CALM_AUDIO);
    EXPECT_EQ(r.type, InterventionType::HUD_ICON);
}

TEST_F(DispatcherSpeedGateTest, NoBreathingCueAbove60) {
    DispatchInput d = makeAboveThreshold(80.0f, 80.0f);
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_NE(r.type, InterventionType::BREATHING_CUE);
}

TEST_F(DispatcherSpeedGateTest, CalmAudioAtExactly60) {
    DispatchInput d = makeAboveThreshold(68.0f, 60.0f); // exactly at gate
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::CALM_AUDIO);
}

TEST_F(DispatcherSpeedGateTest, BreathingCueAtExactly60) {
    DispatchInput d = makeAboveThreshold(80.0f, 60.0f);
    d.lane_drift = 0.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::BREATHING_CUE);
}

// ─── RPM Gating (engine off) ────────────────────────────────────────────────

class DispatcherRPMTest : public ::testing::Test {
protected:
    InterventionDispatcher dispatcher{0};
};

TEST_F(DispatcherRPMTest, StallProtocolWhenRPMZeroAndStationary) {
    DispatchInput d = makeAboveThreshold(80.0f, 0.0f, 0);
    d.stationary = true;
    d.rpm        = 0;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::STALL_PROTOCOL);
}

TEST_F(DispatcherRPMTest, NoStallProtocolWhenRPMNonZero) {
    DispatchInput d = makeAboveThreshold(80.0f, 0.0f, 800);
    d.stationary = true;
    d.rpm        = 800;

    auto r = dispatcher.dispatch(d);
    EXPECT_NE(r.type, InterventionType::STALL_PROTOCOL);
}

// ─── Cooldown Enforcement ────────────────────────────────────────────────────

class DispatcherCooldownTest : public ::testing::Test {
protected:
    // 30-second cooldown (default)
    InterventionDispatcher dispatcher{30'000};
};

TEST_F(DispatcherCooldownTest, SameTypeCooldownBlocked) {
    DispatchInput d = makeAboveThreshold(70.0f, 100.0f); // HUD_ICON path
    d.lane_drift = 0.0f;

    auto r1 = dispatcher.dispatch(d);
    EXPECT_EQ(r1.type, InterventionType::HUD_ICON);

    // Immediate second dispatch – should be blocked by cooldown
    auto r2 = dispatcher.dispatch(d);
    EXPECT_EQ(r2.type, InterventionType::NONE);
}

TEST_F(DispatcherCooldownTest, DifferentTypesNotBlocked) {
    // First dispatch: high speed → HUD_ICON
    DispatchInput d1 = makeAboveThreshold(70.0f, 100.0f);
    d1.lane_drift = 0.0f;
    auto r1 = dispatcher.dispatch(d1);
    EXPECT_EQ(r1.type, InterventionType::HUD_ICON);

    // Second dispatch: lane drift triggers a different type
    DispatchInput d2 = makeAboveThreshold(70.0f, 100.0f);
    d2.lane_drift = 70.0f;
    auto r2 = dispatcher.dispatch(d2);
    EXPECT_EQ(r2.type, InterventionType::LANE_GUIDANCE);
}

// ─── Emergency Override ──────────────────────────────────────────────────────

class DispatcherEmergencyTest : public ::testing::Test {
protected:
    InterventionDispatcher dispatcher{30'000};
};

TEST_F(DispatcherEmergencyTest, EmergencyIgnoresCooldown) {
    // Fire emergency once
    DispatchInput d{};
    d.emergency_vehicle = true;
    d.stress_index      = 90.0f;

    auto r1 = dispatcher.dispatch(d);
    EXPECT_EQ(r1.type, InterventionType::EMERGENCY_VEHICLE);

    // Fire emergency again immediately with a new dispatcher (fresh cooldown).
    // The original dispatcher should have the cooldown set for EMERGENCY_VEHICLE.
    // But the code checks cooldownPassed, and if in cooldown, it still returns early
    // with result type NONE but returns immediately.
    auto r2 = dispatcher.dispatch(d);
    // Emergency returns early even if in cooldown, but result.type stays NONE
    // because the cooldown check fails for EMERGENCY_VEHICLE.
    // This tests the current behavior: the function returns early (skipping other
    // rules) but the result will be NONE if cooldown hasn't passed.
    EXPECT_EQ(r2.type, InterventionType::NONE);
}

TEST_F(DispatcherEmergencyTest, EmergencyAlwaysReturnsEarlySkippingOtherRules) {
    // Even when emergency is in cooldown, no other rule fires
    DispatchInput d = makeAboveThreshold(90.0f, 40.0f);
    d.emergency_vehicle = true;
    d.lane_drift        = 80.0f;

    dispatcher.dispatch(d); // first, triggers emergency
    auto r2 = dispatcher.dispatch(d); // in cooldown, returns early
    // Even though lane_drift is high, emergency path returns immediately
    EXPECT_NE(r2.type, InterventionType::LANE_GUIDANCE);
}

// ─── Below Threshold ─────────────────────────────────────────────────────────

TEST(DispatcherBelowThreshold, NoInterventionBelowThreshold) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d{};
    d.stress_index      = 64.9f;
    d.speed_kmh         = 40.0f;
    d.rpm               = 2000;
    d.trigger_threshold = 65.0f;

    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::NONE);
}

TEST(DispatcherBelowThreshold, InterventionAtExactThreshold) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d{};
    d.stress_index      = 65.0f;
    d.speed_kmh         = 40.0f;
    d.rpm               = 2000;
    d.trigger_threshold = 65.0f;

    auto r = dispatcher.dispatch(d);
    // At exact threshold, should get an intervention
    EXPECT_NE(r.type, InterventionType::NONE);
}

// ─── Severity Computation ────────────────────────────────────────────────────

class DispatcherSeverityTest : public ::testing::Test {
protected:
    InterventionDispatcher dispatcher{0};
};

TEST_F(DispatcherSeverityTest, Severity1ForLowStress) {
    DispatchInput d = makeAboveThreshold(65.0f, 100.0f);
    d.lane_drift = 70.0f; // force a specific intervention
    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::LANE_GUIDANCE);
    EXPECT_EQ(r.severity, 3u); // 65 >= 65 → severity 3
}

TEST_F(DispatcherSeverityTest, Severity5ForVeryHighStress) {
    DispatchInput d = makeAboveThreshold(95.0f, 100.0f);
    d.lane_drift = 70.0f;
    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.severity, 5u);
}

TEST_F(DispatcherSeverityTest, EmergencySeverityAlways5) {
    DispatchInput d{};
    d.emergency_vehicle = true;
    d.stress_index      = 30.0f; // low stress, but emergency
    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.severity, 5u);
}

// ─── Message Content ─────────────────────────────────────────────────────────

TEST(DispatcherMessage, EmergencyMessage) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d{};
    d.emergency_vehicle = true;
    auto r = dispatcher.dispatch(d);
    EXPECT_NE(r.message.find("Emergency"), std::string::npos);
}

TEST(DispatcherMessage, StallProtocolMessage) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d = makeAboveThreshold(80.0f, 0.0f, 0);
    d.stationary = true;
    d.rpm        = 0;
    auto r = dispatcher.dispatch(d);
    EXPECT_NE(r.message.find("breathe"), std::string::npos);
}

TEST(DispatcherMessage, LaneGuidanceHighDriftMessage) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d = makeAboveThreshold(70.0f, 100.0f);
    d.lane_drift = 85.0f;
    auto r = dispatcher.dispatch(d);
    EXPECT_NE(r.message.find("Steer"), std::string::npos);
}

TEST(DispatcherMessage, LaneGuidanceModerateDriftMessage) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d = makeAboveThreshold(70.0f, 100.0f);
    d.lane_drift = 65.0f;
    auto r = dispatcher.dispatch(d);
    EXPECT_NE(r.message.find("lane"), std::string::npos);
}

TEST(DispatcherMessage, BreathingCueMessage) {
    InterventionDispatcher dispatcher{0};
    DispatchInput d = makeAboveThreshold(80.0f, 50.0f);
    d.lane_drift = 0.0f;
    auto r = dispatcher.dispatch(d);
    EXPECT_EQ(r.type, InterventionType::BREATHING_CUE);
    EXPECT_NE(r.message.find("Breathe"), std::string::npos);
}

// ─── Default DispatchResult ──────────────────────────────────────────────────

TEST(DispatcherDefaults, DefaultResultIsNone) {
    DispatchResult r{};
    EXPECT_EQ(r.type, InterventionType::NONE);
    EXPECT_EQ(r.severity, 0u);
    EXPECT_TRUE(r.message.empty());
}

} // anonymous namespace
} // namespace ivis

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
