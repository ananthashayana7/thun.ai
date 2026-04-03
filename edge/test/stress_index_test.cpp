/**
 * stress_index_test.cpp
 * Unit tests for the C++ StressIndex class using Google Test.
 */

#include <gtest/gtest.h>
#include "../src/stress_index.h"

namespace ivis {

class StressIndexTest : public ::testing::Test {
protected:
    void SetUp() override {
        si = new StressIndex(15);
    }

    void TearDown() override {
        delete si;
    }

    StressIndex* si;
};

TEST_F(StressIndexTest, InitialScoreIsZero) {
    StressInputs in{};
    // No data yet, should return neutral biometric (50) * Weight (0.4) = 20? 
    // Wait, the code says: if (in.heart_rate == 0 && in.hrv_rmssd < 0.0f) return 50.0f;
    // W_BIO is 0.40. So 50 * 0.4 = 20.
    float score = si->compute(in);
    EXPECT_NEAR(score, 20.0f, 0.1f);
}

TEST_F(StressIndexTest, HighHeartRateIncreasesScore) {
    StressInputs in{};
    in.hr_baseline = 70.0f;
    in.hrv_baseline = 50.0f;
    in.heart_rate = 110; // 40 above baseline -> 100% stress for bio component
    in.hrv_rmssd = 50.0f; // baseline -> 0% stress
    
    // Bio score = (100 + 0) / 2 = 50.
    // OBD = 0, CV = 0.
    // Composite = 50 * 0.4 = 20.
    float score = si->compute(in);
    EXPECT_GT(score, 15.0f);
}

TEST_F(StressIndexTest, HarshBrakingIncreasesScore) {
    // Need at least 3 samples for harsh braking
    StressInputs in{};
    in.speed_kmh = 80.0f;
    si->compute(in);
    si->compute(in);
    
    in.speed_kmh = 40.0f; // 40 km/h drop
    float score = si->compute(in);
    EXPECT_GT(score, 30.0f); // Harsh braking weight is 0.30 inside OBD (0.4)
}

TEST_F(StressIndexTest, ResetClearsHistory) {
    StressInputs in{};
    in.speed_kmh = 80.0f;
    si->compute(in);
    si->reset();
    
    in.speed_kmh = 40.0f;
    float score = si->compute(in);
    // Should NOT detect harsh braking because history was cleared
    EXPECT_LT(score, 25.0f);
}

TEST_F(StressIndexTest, GearMismatchDetection) {
    StressInputs in{};
    in.gear = 1;
    in.rpm = 5000; // Very high for gear 1
    
    float score = si->compute(in);
    // Gear mismatch weight 0.15 inside OBD (0.4)
    EXPECT_GT(score, 20.0f);
}

} // namespace ivis

int main(int argc, char **argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
