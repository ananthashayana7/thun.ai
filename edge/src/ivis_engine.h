#pragma once
/**
 * ivis_engine.h
 * Main IVIS engine interface.
 * Target: Rockchip RV1126, end-to-end latency < 50 ms.
 */

#include <cstdint>
#include <string>
#include <functional>
#include "obd_parser.h"
#include "stress_index.h"
#include "intervention_dispatcher.h"

namespace ivis {

/** Camera frame descriptor (GMSL2 input) */
struct CameraFrame {
    const uint8_t* data;       ///< Raw frame bytes (NV12 or RGB)
    uint32_t       width;
    uint32_t       height;
    uint32_t       stride;
    uint64_t       timestamp_us; ///< Monotonic microseconds
};

/** BLE biometric packet from smartwatch */
struct BiometricPacket {
    uint8_t  heart_rate;       ///< bpm
    uint16_t rr_interval_ms;   ///< Last R-R interval (ms)
    float    hrv_rmssd;        ///< Computed HRV RMSSD (ms)
    bool     valid;
};

/** Output from one engine tick */
struct EngineOutput {
    InterventionType intervention;
    uint8_t          severity;        ///< 1–5
    float            stress_index;    ///< 0–100
    bool             emergency_override;
    char             message[128];    ///< Human-readable reason
};

using OutputCallback = std::function<void(const EngineOutput&)>;

class IVISEngine {
public:
    IVISEngine();
    ~IVISEngine();

    /** Initialise hardware I/O (CAN bus, camera, BLE). Returns true on success. */
    bool init();

    /** Shut down all I/O gracefully. */
    void shutdown();

    /** Register callback invoked on each output (called from processing thread). */
    void setOutputCallback(OutputCallback cb);

    /**
     * Primary processing tick.
     * Call at ≥ 20 Hz (every 50 ms) from the main loop.
     * Internally runs sensor fusion + stress computation + intervention dispatch.
     *
     * @param obd      Latest OBD telemetry snapshot
     * @param bio      Latest biometric packet
     * @param frame    Latest camera frame (may be nullptr if no new frame)
     */
    EngineOutput tick(
        const OBDSnapshot&    obd,
        const BiometricPacket& bio,
        const CameraFrame*     frame
    );

    /** Return the current stress index (thread-safe). */
    float currentStressIndex() const;

    /** True when the vehicle is stationary (RPM==0 && speed==0). */
    bool isStationary() const;

private:
    StressIndex          stress_index_;
    InterventionDispatcher dispatcher_;

    OBDSnapshot   last_obd_{};
    BiometricPacket last_bio_{};
    float         current_stress_{ 0.0f };
    bool          stationary_{ false };
    bool          emergency_active_{ false };

    OutputCallback output_cb_;

    /** Lightweight CV inference: detect emergency vehicles, lane drift. */
    struct CVSignals {
        float tailgating_risk;   ///< 0–100
        float lane_drift;        ///< 0–100
        float head_pose_score;   ///< 0–100 (distraction proxy)
        bool  emergency_vehicle;
    };

    CVSignals runCVInference(const CameraFrame* frame);
};

} // namespace ivis
