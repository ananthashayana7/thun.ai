#pragma once
/**
 * obd_parser.h
 * OBD-2 CAN bus parser for standard ELM327 / ISO 15765-4 PIDs.
 */

#include <cstdint>
#include <cstring>

namespace ivis {

/** Snapshot of OBD-2 telemetry (one polling cycle) */
struct OBDSnapshot {
    float    speed_kmh      { 0.0f };
    uint32_t rpm            { 0 };
    float    throttle_pct   { 0.0f };   ///< 0–100 %
    float    engine_load_pct{ 0.0f };   ///< 0–100 %
    int16_t  coolant_temp_c { 0 };      ///< −40 to +215 °C
    uint8_t  gear           { 0 };      ///< 0 = neutral/unknown
    uint64_t timestamp_us   { 0 };      ///< Monotonic microseconds
};

/** Raw CAN frame (11-bit standard ID, up to 8 data bytes) */
struct CANFrame {
    uint32_t id;
    uint8_t  dlc;        ///< Data length code (0–8)
    uint8_t  data[8];
};

class OBDParser {
public:
    OBDParser() = default;

    /**
     * Parse a raw CAN frame and update the internal snapshot.
     * Call this for every frame received from the CAN bus.
     */
    void parseFrame(const CANFrame& frame);

    /** Get the most recently assembled OBD snapshot. */
    const OBDSnapshot& getSnapshot() const { return snapshot_; }

    /** Request all monitored PIDs (builds OBD-2 query frames). */
    static CANFrame buildQuery(uint8_t mode, uint8_t pid);

private:
    OBDSnapshot snapshot_;

    void handleMode01(uint8_t pid, const uint8_t* data, uint8_t len);
    uint8_t inferGear(float speed_kmh, uint32_t rpm) const;
};

} // namespace ivis
