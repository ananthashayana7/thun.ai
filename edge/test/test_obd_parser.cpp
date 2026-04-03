/**
 * test_obd_parser.cpp
 * Unit tests for the OBDParser class using Google Test.
 */

#include <gtest/gtest.h>
#include "../src/obd_parser.h"

namespace ivis {
namespace {

// OBD-2 standard CAN IDs (must match obd_parser.cpp)
static constexpr uint32_t OBD_REQUEST_ID  = 0x7DF;
static constexpr uint32_t OBD_RESPONSE_ID = 0x7E8;

// Helper: build a Mode 01 response frame for a given PID with A and B data bytes.
static CANFrame makeMode01Response(uint8_t pid, uint8_t A, uint8_t B = 0x00,
                                   uint8_t dlc = 8) {
    CANFrame f{};
    f.id      = OBD_RESPONSE_ID;
    f.dlc     = dlc;
    f.data[0] = 0x03;  // length
    f.data[1] = 0x41;  // Mode 01 response
    f.data[2] = pid;
    f.data[3] = A;
    f.data[4] = B;
    for (int i = 5; i < 8; ++i) f.data[i] = 0x55;
    return f;
}

// ─── Speed (PID 0x0D) ────────────────────────────────────────────────────────

class OBDParserSpeedTest : public ::testing::Test {
protected:
    OBDParser parser;
};

TEST_F(OBDParserSpeedTest, ParsesZeroSpeed) {
    parser.parseFrame(makeMode01Response(0x0D, 0));
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 0.0f);
}

TEST_F(OBDParserSpeedTest, ParsesTypicalSpeed) {
    // A = 60 → 60 km/h
    parser.parseFrame(makeMode01Response(0x0D, 60));
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 60.0f);
}

TEST_F(OBDParserSpeedTest, ParsesMaxSpeed) {
    // A = 255 → 255 km/h
    parser.parseFrame(makeMode01Response(0x0D, 255));
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 255.0f);
}

// ─── RPM (PID 0x0C) ─────────────────────────────────────────────────────────

class OBDParserRPMTest : public ::testing::Test {
protected:
    OBDParser parser;
};

TEST_F(OBDParserRPMTest, ParsesIdleRPM) {
    // RPM = ((A*256)+B)/4 = ((3*256)+32)/4 = 800/4 = 200 ... let's use 800 RPM
    // 800 = ((A*256)+B)/4 → (A*256)+B = 3200 → A=12, B=128
    parser.parseFrame(makeMode01Response(0x0C, 12, 128));
    EXPECT_EQ(parser.getSnapshot().rpm, 800u);
}

TEST_F(OBDParserRPMTest, ParsesZeroRPM) {
    parser.parseFrame(makeMode01Response(0x0C, 0, 0));
    EXPECT_EQ(parser.getSnapshot().rpm, 0u);
}

TEST_F(OBDParserRPMTest, ParsesMaxRPM) {
    // Max: A=0xFF, B=0xFF → (255*256+255)/4 = 65535/4 = 16383 (integer)
    parser.parseFrame(makeMode01Response(0x0C, 0xFF, 0xFF));
    EXPECT_EQ(parser.getSnapshot().rpm, 16383u);
}

TEST_F(OBDParserRPMTest, ParsesTypicalRPM) {
    // 3000 RPM → (A*256+B)/4 = 3000 → A*256+B = 12000 → A=46, B=224
    parser.parseFrame(makeMode01Response(0x0C, 46, 224));
    EXPECT_EQ(parser.getSnapshot().rpm, 3000u);
}

// ─── Throttle (PID 0x11) ────────────────────────────────────────────────────

TEST(OBDParserThrottleTest, ParsesFullThrottle) {
    OBDParser parser;
    parser.parseFrame(makeMode01Response(0x11, 255));
    EXPECT_NEAR(parser.getSnapshot().throttle_pct, 100.0f, 0.5f);
}

TEST(OBDParserThrottleTest, ParsesZeroThrottle) {
    OBDParser parser;
    parser.parseFrame(makeMode01Response(0x11, 0));
    EXPECT_FLOAT_EQ(parser.getSnapshot().throttle_pct, 0.0f);
}

TEST(OBDParserThrottleTest, ParsesHalfThrottle) {
    OBDParser parser;
    // A=128 → 128*100/255 ≈ 50.2%
    parser.parseFrame(makeMode01Response(0x11, 128));
    EXPECT_NEAR(parser.getSnapshot().throttle_pct, 50.2f, 0.5f);
}

// ─── Engine Load (PID 0x04) ─────────────────────────────────────────────────

TEST(OBDParserEngineLoadTest, ParsesFullLoad) {
    OBDParser parser;
    parser.parseFrame(makeMode01Response(0x04, 255));
    EXPECT_NEAR(parser.getSnapshot().engine_load_pct, 100.0f, 0.5f);
}

TEST(OBDParserEngineLoadTest, ParsesZeroLoad) {
    OBDParser parser;
    parser.parseFrame(makeMode01Response(0x04, 0));
    EXPECT_FLOAT_EQ(parser.getSnapshot().engine_load_pct, 0.0f);
}

// ─── Coolant Temperature (PID 0x05) ──────────────────────────────────────────

TEST(OBDParserCoolantTest, ParsesNormalTemp) {
    OBDParser parser;
    // A=130 → 130-40 = 90°C
    parser.parseFrame(makeMode01Response(0x05, 130));
    EXPECT_EQ(parser.getSnapshot().coolant_temp_c, 90);
}

TEST(OBDParserCoolantTest, ParsesMinTemp) {
    OBDParser parser;
    // A=0 → 0-40 = -40°C
    parser.parseFrame(makeMode01Response(0x05, 0));
    EXPECT_EQ(parser.getSnapshot().coolant_temp_c, -40);
}

TEST(OBDParserCoolantTest, ParsesMaxTemp) {
    OBDParser parser;
    // A=255 → 255-40 = 215°C
    parser.parseFrame(makeMode01Response(0x05, 255));
    EXPECT_EQ(parser.getSnapshot().coolant_temp_c, 215);
}

// ─── Gear Inference ──────────────────────────────────────────────────────────

class OBDParserGearTest : public ::testing::Test {
protected:
    OBDParser parser;

    // Set speed and RPM, then read the inferred gear.
    uint8_t inferGearAt(float speed_kmh, uint32_t rpm) {
        // Set speed first
        parser.parseFrame(makeMode01Response(0x0D, static_cast<uint8_t>(speed_kmh)));
        // Set RPM: (A*256+B)/4 = rpm → A*256+B = rpm*4
        uint16_t raw = static_cast<uint16_t>(rpm * 4);
        uint8_t A = static_cast<uint8_t>(raw >> 8);
        uint8_t B = static_cast<uint8_t>(raw & 0xFF);
        parser.parseFrame(makeMode01Response(0x0C, A, B));
        return parser.getSnapshot().gear;
    }
};

TEST_F(OBDParserGearTest, NeutralWhenLowRPM) {
    // rpm < 500 → neutral
    EXPECT_EQ(inferGearAt(50, 400), 0u);
}

TEST_F(OBDParserGearTest, NeutralWhenLowSpeed) {
    // speed < 2 → neutral
    EXPECT_EQ(inferGearAt(1, 2000), 0u);
}

TEST_F(OBDParserGearTest, InfersGear1) {
    // ratio = speed / (rpm/1000) < 5  → gear 1
    // speed=10, rpm=3000 → ratio = 10/3 = 3.33
    EXPECT_EQ(inferGearAt(10, 3000), 1u);
}

TEST_F(OBDParserGearTest, InfersGear2) {
    // ratio 5–9 → gear 2
    // speed=14, rpm=2000 → ratio = 14/2 = 7
    EXPECT_EQ(inferGearAt(14, 2000), 2u);
}

TEST_F(OBDParserGearTest, InfersGear3) {
    // ratio 9–13 → gear 3
    // speed=20, rpm=2000 → ratio = 20/2 = 10
    EXPECT_EQ(inferGearAt(20, 2000), 3u);
}

TEST_F(OBDParserGearTest, InfersGear4) {
    // ratio 13–18 → gear 4
    // speed=30, rpm=2000 → ratio = 30/2 = 15
    EXPECT_EQ(inferGearAt(30, 2000), 4u);
}

TEST_F(OBDParserGearTest, InfersGear5) {
    // ratio 18–24 → gear 5
    // speed=40, rpm=2000 → ratio = 40/2 = 20
    EXPECT_EQ(inferGearAt(40, 2000), 5u);
}

TEST_F(OBDParserGearTest, InfersGear6) {
    // ratio >= 24 → gear 6
    // speed=50, rpm=2000 → ratio = 50/2 = 25
    EXPECT_EQ(inferGearAt(50, 2000), 6u);
}

// ─── Edge Cases ─────────────────────────────────────────────────────────────

TEST(OBDParserEdgeCases, IgnoresNonOBDResponseID) {
    OBDParser parser;
    CANFrame f{};
    f.id = 0x123; // not OBD response ID
    f.dlc = 8;
    f.data[0] = 0x03;
    f.data[1] = 0x41;
    f.data[2] = 0x0D;
    f.data[3] = 120;
    parser.parseFrame(f);
    // Speed should remain at default 0
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 0.0f);
}

TEST(OBDParserEdgeCases, IgnoresShortDLC) {
    OBDParser parser;
    CANFrame f{};
    f.id  = OBD_RESPONSE_ID;
    f.dlc = 2; // too short (need at least 3)
    f.data[0] = 0x03;
    f.data[1] = 0x41;
    parser.parseFrame(f);
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 0.0f);
}

TEST(OBDParserEdgeCases, IgnoresUnknownPID) {
    OBDParser parser;
    // PID 0xFF is not handled
    parser.parseFrame(makeMode01Response(0xFF, 42));
    // No field should change from default
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 0.0f);
    EXPECT_EQ(parser.getSnapshot().rpm, 0u);
}

TEST(OBDParserEdgeCases, IgnoresNonMode01) {
    OBDParser parser;
    CANFrame f{};
    f.id  = OBD_RESPONSE_ID;
    f.dlc = 8;
    f.data[0] = 0x03;
    f.data[1] = 0x42; // Mode 02 response, not Mode 01
    f.data[2] = 0x0D;
    f.data[3] = 100;
    parser.parseFrame(f);
    EXPECT_FLOAT_EQ(parser.getSnapshot().speed_kmh, 0.0f);
}

TEST(OBDParserEdgeCases, TimestampUpdatedOnParse) {
    OBDParser parser;
    EXPECT_EQ(parser.getSnapshot().timestamp_us, 0u);
    parser.parseFrame(makeMode01Response(0x0D, 50));
    EXPECT_GT(parser.getSnapshot().timestamp_us, 0u);
}

TEST(OBDParserEdgeCases, MultipleFramesAccumulate) {
    OBDParser parser;
    parser.parseFrame(makeMode01Response(0x0D, 80));   // speed 80
    parser.parseFrame(makeMode01Response(0x05, 130));  // coolant 90°C

    const auto& snap = parser.getSnapshot();
    EXPECT_FLOAT_EQ(snap.speed_kmh, 80.0f);
    EXPECT_EQ(snap.coolant_temp_c, 90);
}

// ─── Query Frame Building ────────────────────────────────────────────────────

class OBDParserQueryTest : public ::testing::Test {};

TEST_F(OBDParserQueryTest, QueryHasCorrectID) {
    auto q = OBDParser::buildQuery(0x01, 0x0D);
    EXPECT_EQ(q.id, OBD_REQUEST_ID);
}

TEST_F(OBDParserQueryTest, QueryHasDLC8) {
    auto q = OBDParser::buildQuery(0x01, 0x0D);
    EXPECT_EQ(q.dlc, 8u);
}

TEST_F(OBDParserQueryTest, QueryDataBytesCorrect) {
    auto q = OBDParser::buildQuery(0x01, 0x0C);
    EXPECT_EQ(q.data[0], 0x02); // 2 additional bytes
    EXPECT_EQ(q.data[1], 0x01); // mode
    EXPECT_EQ(q.data[2], 0x0C); // PID
}

TEST_F(OBDParserQueryTest, QueryPaddedWith0x55) {
    auto q = OBDParser::buildQuery(0x01, 0x0D);
    for (int i = 3; i < 8; ++i) {
        EXPECT_EQ(q.data[i], 0x55) << "Byte " << i << " should be ISO padding 0x55";
    }
}

TEST_F(OBDParserQueryTest, QueryDifferentModeAndPID) {
    auto q = OBDParser::buildQuery(0x09, 0x02); // VIN query
    EXPECT_EQ(q.data[1], 0x09);
    EXPECT_EQ(q.data[2], 0x02);
}

} // anonymous namespace
} // namespace ivis

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
