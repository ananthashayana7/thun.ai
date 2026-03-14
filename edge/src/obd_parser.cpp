/**
 * obd_parser.cpp
 * OBD-2 CAN bus parser – decodes standard Mode 01 PIDs from CAN frames.
 *
 * Supported PIDs:
 *   0x0C – Engine RPM
 *   0x0D – Vehicle speed
 *   0x11 – Throttle position
 *   0x04 – Engine load
 *   0x05 – Coolant temperature
 */

#include "obd_parser.h"
#include <ctime>
#include <stdexcept>

namespace ivis {

// OBD-2 standard CAN IDs
static constexpr uint32_t OBD_REQUEST_ID  = 0x7DF;
static constexpr uint32_t OBD_RESPONSE_ID = 0x7E8;

// ─── Public ───────────────────────────────────────────────────────────────────

void OBDParser::parseFrame(const CANFrame& frame) {
    // Only process OBD response frames
    if (frame.id != OBD_RESPONSE_ID) return;
    if (frame.dlc < 3) return;

    const uint8_t length = frame.data[0];
    const uint8_t mode   = frame.data[1];
    const uint8_t pid    = frame.data[2];

    (void)length; // unused in simple parsing

    if (mode == 0x41) { // Mode 01 response (0x40 + 0x01)
        handleMode01(pid, frame.data + 3, frame.dlc - 3);
    }

    // Update timestamp
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    snapshot_.timestamp_us = static_cast<uint64_t>(ts.tv_sec) * 1'000'000ULL
                           + static_cast<uint64_t>(ts.tv_nsec) / 1'000ULL;
}

CANFrame OBDParser::buildQuery(uint8_t mode, uint8_t pid) {
    CANFrame f{};
    f.id      = OBD_REQUEST_ID;
    f.dlc     = 8;
    f.data[0] = 0x02; // 2 additional bytes
    f.data[1] = mode;
    f.data[2] = pid;
    // Remaining bytes padded with 0x55 (ISO 15765-2 padding)
    for (int i = 3; i < 8; ++i) f.data[i] = 0x55;
    return f;
}

// ─── Private ──────────────────────────────────────────────────────────────────

void OBDParser::handleMode01(uint8_t pid, const uint8_t* data, uint8_t len) {
    if (len < 1) return;

    const uint8_t A = data[0];
    const uint8_t B = (len >= 2) ? data[1] : 0;

    switch (pid) {
        case 0x0C: // Engine RPM: ((A * 256) + B) / 4
            snapshot_.rpm = static_cast<uint32_t>((A * 256U + B) / 4U);
            snapshot_.gear = inferGear(snapshot_.speed_kmh, snapshot_.rpm);
            break;

        case 0x0D: // Vehicle speed: A km/h
            snapshot_.speed_kmh = static_cast<float>(A);
            snapshot_.gear = inferGear(snapshot_.speed_kmh, snapshot_.rpm);
            break;

        case 0x11: // Throttle position: A * 100 / 255 %
            snapshot_.throttle_pct = static_cast<float>(A) * 100.0f / 255.0f;
            break;

        case 0x04: // Engine load: A * 100 / 255 %
            snapshot_.engine_load_pct = static_cast<float>(A) * 100.0f / 255.0f;
            break;

        case 0x05: // Coolant temperature: A − 40 °C
            snapshot_.coolant_temp_c = static_cast<int16_t>(static_cast<int>(A) - 40);
            break;

        default:
            break;
    }
}

uint8_t OBDParser::inferGear(float speed_kmh, uint32_t rpm) const {
    if (rpm < 500 || speed_kmh < 2.0f) return 0; // neutral or off

    // Speed / (RPM / 1000) ratio heuristic for typical petrol passenger car
    const float ratio = speed_kmh / (static_cast<float>(rpm) / 1000.0f);

    if (ratio < 5.0f)  return 1;
    if (ratio < 9.0f)  return 2;
    if (ratio < 13.0f) return 3;
    if (ratio < 18.0f) return 4;
    if (ratio < 24.0f) return 5;
    return 6;
}

} // namespace ivis
