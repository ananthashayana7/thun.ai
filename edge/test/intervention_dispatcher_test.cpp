/**
 * intervention_dispatcher_test.cpp
 * Unit tests for the C++ InterventionDispatcher class.
 */

#include <gtest/gtest.h>
#include "../src/intervention_dispatcher.h"
#include <chrono>
#include <thread>

namespace ivis {

class InterventionDispatcherTest : public ::testing::Test {
protected:
    void SetUp() override {
        dispatcher = new InterventionDispatcher(100); // 100 ms cooldown for testing
    }

    void TearDown() override {
        delete dispatcher;
    }

    InterventionDispatcher* dispatcher;
};

TEST_F(InterventionDispatcherTest, EmergencyVehiclePriority) {
    DispatchInput in{};
    in.emergency_vehicle = true;
    in.stress_index = 20.0f; // low stress
    
    auto res = dispatcher->dispatch(in);
    EXPECT_EQ(res.type, InterventionType::EMERGENCY_VEHICLE);
    EXPECT_EQ(res.severity, 5);
}

TEST_F(InterventionDispatcherTest, StallProtocol) {
    DispatchInput in{};
    in.stationary = true;
    in.rpm = 0;
    in.stress_index = 70.0f;
    in.trigger_threshold = 40.0f;
    
    auto res = dispatcher->dispatch(in);
    EXPECT_EQ(res.type, InterventionType::STALL_PROTOCOL);
    EXPECT_EQ(res.severity, 4);
}

TEST_F(InterventionDispatcherTest, SpeedGateMutesBreathing) {
    DispatchInput in{};
    in.stress_index = 80.0f;
    in.trigger_threshold = 40.0f;
    in.speed_kmh = 80.0f; // Above 60 km/h speed gate
    
    auto res = dispatcher->dispatch(in);
    // Should NOT be BREATHING_CUE (muted)
    // Should NOT be CALM_AUDIO (muted)
    // Should be HUD_ICON (no speed gate)
    EXPECT_EQ(res.type, InterventionType::HUD_ICON);
}

TEST_F(InterventionDispatcherTest, CooldownLogic) {
    DispatchInput in{};
    in.stress_index = 80.0f;
    in.trigger_threshold = 40.0f;
    in.speed_kmh = 10.0f;
    
    auto res1 = dispatcher->dispatch(in);
    EXPECT_EQ(res1.type, InterventionType::BREATHING_CUE);
    
    auto res2 = dispatcher->dispatch(in);
    // Should be in cooldown for BREATHING_CUE
    // Should NOT be BREATHING_CUE again
    EXPECT_NE(res2.type, InterventionType::BREATHING_CUE);
    
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    
    auto res3 = dispatcher->dispatch(in);
    // After 150 ms (> 100 ms cooldown), should be allowed again
    EXPECT_EQ(res3.type, InterventionType::BREATHING_CUE);
}

TEST_F(InterventionDispatcherTest, SeverityComputation) {
    DispatchInput in{};
    in.stress_index = 95.0f;
    in.trigger_threshold = 40.0f;
    in.speed_kmh = 10.0f;
    
    auto res = dispatcher->dispatch(in);
    EXPECT_EQ(res.severity, 5);
    
    dispatcher = new InterventionDispatcher(100); // fresh start
    in.stress_index = 45.0f;
    res = dispatcher->dispatch(in);
    EXPECT_EQ(res.severity, 2);
}

} // namespace ivis
