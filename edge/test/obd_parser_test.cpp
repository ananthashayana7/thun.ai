/**
 * obd_parser_test.cpp
 * Unit tests for the C++ OBDParser class.
 */

#include <gtest/gtest.h>
#include "../src/obd_parser.h"

namespace ivis {

class OBDParserTest : public ::testing::Test {
protected:
    void SetUp() override {
        parser = new OBDParser();
    }

    void TearDown() override {
        delete parser;
    }

    OBDParser* parser;
};

TEST_F(OBDParserTest, BuildQueryFormat) {
    auto frame = parser->buildQuery(0x01, 0x0C); // Mode 01, PID 0x0C (RPM)
    EXPECT_EQ(frame.id, 0x7DF);
    EXPECT_EQ(frame.dlc, 8);
    EXPECT_EQ(frame.data[0], 0x02);
    EXPECT_EQ(frame.data[1], 0x01);
    EXPECT_EQ(frame.data[2], 0x0C);
}

TEST_F(OBDParserTest, ParseRPM) {
    CANFrame frame{};
    frame.id = 0x7E8;
    frame.dlc = 8;
    frame.data[0] = 0x04; // 4 bytes of data
    frame.data[1] = 0x41; // Response to mode 01
    frame.data[2] = 0x0C; // PID 0x0C
    frame.data[3] = 0x0F; // A = 15
    frame.data[4] = 0xA0; // B = 160
    // RPM = ((15 * 256) + 160) / 4 = 1000
    
    parser->parseFrame(frame);
    auto snap = parser->getSnapshot();
    EXPECT_EQ(snap.rpm, 1000);
}

TEST_F(OBDParserTest, ParseSpeed) {
    CANFrame frame{};
    frame.id = 0x7E8;
    frame.dlc = 8;
    frame.data[0] = 0x03; // 3 bytes
    frame.data[1] = 0x41;
    frame.data[2] = 0x0D; // PID 0x0D
    frame.data[3] = 0x50; // A = 80 km/h
    
    parser->parseFrame(frame);
    auto snap = parser->getSnapshot();
    EXPECT_NEAR(snap.speed_kmh, 80.0f, 0.1f);
}

TEST_F(OBDParserTest, InferGearLogic) {
    // 80 km/h @ 2000 RPM
    // ratio = 80 / 2.0 = 40.0??
    // Based on obd_parser.cpp: ratio = speed / (rpm / 1000)
    // ratio = 80 / 2.0 = 40.0.
    // 40.0 > 24.0 -> Gear 6.
    
    CANFrame f_speed{};
    f_speed.id = 0x7E8; f_speed.dlc = 8; f_speed.data[1] = 0x41; f_speed.data[2] = 0x0D; f_speed.data[3] = 80;
    parser->parseFrame(f_speed);
    
    CANFrame f_rpm{};
    f_rpm.id = 0x7E8; f_rpm.dlc = 8; f_rpm.data[1] = 0x41; f_rpm.data[2] = 0x0C; f_rpm.data[3] = 0x1F; f_rpm.data[4] = 0x40; // 2000 RPM
    parser->parseFrame(f_rpm);
    
    auto snap = parser->getSnapshot();
    EXPECT_EQ(snap.gear, 6);
}

TEST_F(OBDParserTest, IgnoreNonOBDIDs) {
    CANFrame frame{};
    frame.id = 0x123; // Random ID
    frame.dlc = 8;
    parser->parseFrame(frame);
    auto snap = parser->getSnapshot();
    EXPECT_EQ(snap.rpm, 0); // Should remain default
}

} // namespace ivis
