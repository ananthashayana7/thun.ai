/**
 * ivis_engine.cpp
 * Main IVIS engine – sensor fusion, stress computation, intervention dispatch.
 * Target: Rockchip RV1126, end-to-end latency target < 50 ms.
 *
 * Architecture:
 *   CAN bus (OBD-2) ─┐
 *   GMSL2 camera     ├─► Sensor fusion ─► StressIndex ─► InterventionDispatcher ─► Output
 *   BLE biometrics   ┘
 */

#include "ivis_engine.h"
#include <chrono>
#include <cstring>
#include <iostream>
#include <algorithm>

#ifdef IVIS_REAL_HARDWARE
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <unistd.h>
#include <linux/can.h>
#include <linux/can/raw.h>
#include <linux/videodev2.h>
#include <fcntl.h>
#endif

namespace ivis {

// ─── Constructor / Destructor ─────────────────────────────────────────────────

IVISEngine::IVISEngine()
    : stress_index_()
    , dispatcher_()
    , current_stress_(0.0f)
    , stationary_(false)
    , emergency_active_(false)
{}

IVISEngine::~IVISEngine() {
    shutdown();
}

// ─── Init / Shutdown ──────────────────────────────────────────────────────────

HardwareStatus IVISEngine::init() {
    HardwareStatus status;

#ifdef IVIS_REAL_HARDWARE
    // ── 1. CAN Bus (SocketCAN on can0) ───────────────────────────────────────
    std::cout << "[IVISEngine] Initializing SocketCAN (can0)...\n";
    if (system("ip link set can0 type can bitrate 500000") != 0) {
        status.error_msg = "Failed to set CAN bitrate on can0";
        return status;
    }
    if (system("ip link set can0 up") != 0) {
        status.error_msg = "Failed to bring up can0";
        return status;
    }

    socket_can_fd_ = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (socket_can_fd_ < 0) {
        status.error_msg = "Failed to open CAN socket";
        return status;
    }

    struct ifreq ifr{};
    std::strncpy(ifr.ifr_name, "can0", IFNAMSIZ - 1);
    if (ioctl(socket_can_fd_, SIOCGIFINDEX, &ifr) < 0) {
        close(socket_can_fd_);
        status.error_msg = "ioctl SIOCGIFINDEX failed for can0";
        return status;
    }

    struct sockaddr_can addr{};
    addr.can_family  = AF_CAN;
    addr.can_ifindex = ifr.ifr_ifindex;
    if (bind(socket_can_fd_, reinterpret_cast<struct sockaddr*>(&addr),
             sizeof(addr)) < 0) {
        close(socket_can_fd_);
        status.error_msg = "Failed to bind CAN socket to can0";
        return status;
    }
    std::cout << "[IVISEngine] CAN socket bound to can0\n";

    // ── 2. RKNN NPU – load CV models ────────────────────────────────────────
    std::cout << "[IVISEngine] Loading RKNN models to NPU...\n";
    if (rknn_init(&ctx_yolo_, "yolo_emergency.rknn", 0, 0, nullptr) < 0) {
        close(socket_can_fd_);
        status.error_msg = "Failed to load yolo_emergency.rknn";
        return status;
    }
    if (rknn_init(&ctx_lane_, "lanenet.rknn", 0, 0, nullptr) < 0) {
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        status.error_msg = "Failed to load lanenet.rknn";
        return status;
    }

    // Warm up: run a dummy inference to pre-fill NPU caches
    rknn_input warmup_input{};
    warmup_input.index = 0;
    warmup_input.size  = 640 * 480 * 3;
    std::vector<uint8_t> dummy_buf(warmup_input.size, 0);
    warmup_input.buf   = dummy_buf.data();
    warmup_input.type  = RKNN_TENSOR_UINT8;
    warmup_input.fmt   = RKNN_TENSOR_NHWC;
    rknn_inputs_set(ctx_yolo_, 1, &warmup_input);
    rknn_output warmup_out{};
    warmup_out.want_float = 1;
    rknn_run(ctx_yolo_, nullptr);
    rknn_outputs_get(ctx_yolo_, 1, &warmup_out, nullptr);
    rknn_outputs_release(ctx_yolo_, 1, &warmup_out);
    std::cout << "[IVISEngine] RKNN NPU warm-up complete\n";

    // ── 3. BLE peripheral – stress_level characteristic ──────────────────────
    std::cout << "[IVISEngine] Setting up BLE peripheral advertising...\n";
    ble_handle_ = ble_peripheral_init();
    if (ble_handle_ < 0) {
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        rknn_destroy(ctx_lane_);
        status.error_msg = "Failed to initialise BLE peripheral";
        return status;
    }

    // Register stress_level GATT characteristic (UUID 0x2A56)
    ble_characteristic_t stress_char{};
    stress_char.uuid       = 0x2A56;
    stress_char.properties = BLE_PROP_READ | BLE_PROP_NOTIFY;
    stress_char.value_len  = sizeof(float);
    if (ble_add_characteristic(ble_handle_, &stress_char) < 0) {
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        rknn_destroy(ctx_lane_);
        ble_peripheral_deinit(ble_handle_);
        status.error_msg = "Failed to add stress_level BLE characteristic";
        return status;
    }

    if (ble_start_advertising(ble_handle_, "IVIS-Edge") < 0) {
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        rknn_destroy(ctx_lane_);
        ble_peripheral_deinit(ble_handle_);
        status.error_msg = "Failed to start BLE advertising";
        return status;
    }
    std::cout << "[IVISEngine] BLE advertising as IVIS-Edge\n";

    // ── 4. Camera (V4L2) – 640×480 @ 30 fps ─────────────────────────────────
    std::cout << "[IVISEngine] Opening V4L2 camera /dev/video0...\n";
    camera_fd_ = open("/dev/video0", O_RDWR);
    if (camera_fd_ < 0) {
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        rknn_destroy(ctx_lane_);
        ble_stop_advertising(ble_handle_);
        ble_peripheral_deinit(ble_handle_);
        status.error_msg = "Failed to open /dev/video0";
        return status;
    }

    struct v4l2_format fmt{};
    fmt.type                = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width       = 640;
    fmt.fmt.pix.height      = 480;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_NV12;
    fmt.fmt.pix.field       = V4L2_FIELD_NONE;
    if (ioctl(camera_fd_, VIDIOC_S_FMT, &fmt) < 0) {
        close(camera_fd_);
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        rknn_destroy(ctx_lane_);
        ble_stop_advertising(ble_handle_);
        ble_peripheral_deinit(ble_handle_);
        status.error_msg = "Failed to set V4L2 format 640x480 NV12";
        return status;
    }

    struct v4l2_streamparm parm{};
    parm.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    parm.parm.capture.timeperframe.numerator   = 1;
    parm.parm.capture.timeperframe.denominator = 30;
    if (ioctl(camera_fd_, VIDIOC_S_PARM, &parm) < 0) {
        close(camera_fd_);
        close(socket_can_fd_);
        rknn_destroy(ctx_yolo_);
        rknn_destroy(ctx_lane_);
        ble_stop_advertising(ble_handle_);
        ble_peripheral_deinit(ble_handle_);
        status.error_msg = "Failed to set V4L2 framerate to 30 fps";
        return status;
    }
    std::cout << "[IVISEngine] Camera configured: 640x480 NV12 @ 30 fps\n";

#else
    // Desktop / simulation mode – no real hardware
    std::cout << "[IVISEngine] init() – running in software simulation mode\n";
#endif

    status.success = true;
    return status;
}

void IVISEngine::shutdown() {
#ifdef IVIS_REAL_HARDWARE
    if (socket_can_fd_ >= 0) {
        close(socket_can_fd_);
        socket_can_fd_ = -1;
    }
    system("ip link set can0 down");
    rknn_destroy(ctx_yolo_);
    rknn_destroy(ctx_lane_);
    if (ble_handle_ >= 0) {
        ble_stop_advertising(ble_handle_);
        ble_peripheral_deinit(ble_handle_);
        ble_handle_ = -1;
    }
    if (camera_fd_ >= 0) {
        close(camera_fd_);
        camera_fd_ = -1;
    }
#endif
    std::cout << "[IVISEngine] shutdown\n";
}

void IVISEngine::setOutputCallback(OutputCallback cb) {
    output_cb_ = std::move(cb);
}

// ─── Primary tick ─────────────────────────────────────────────────────────────

EngineOutput IVISEngine::tick(
    const OBDSnapshot&     obd,
    const BiometricPacket& bio,
    const CameraFrame*     frame
) {
    const auto t_start = std::chrono::high_resolution_clock::now();

    last_obd_ = obd;
    last_bio_ = bio;

    // Detect stationary condition
    stationary_ = (obd.rpm == 0) && (obd.speed_kmh < 1.0f);

    // ── CV inference (run even when stationary for emergency detection) ───────
    CVSignals cv = runCVInference(frame);

    // ── Compute composite stress index ────────────────────────────────────────
    StressInputs si{};
    si.speed_kmh         = obd.speed_kmh;
    si.rpm               = obd.rpm;
    si.throttle_pct      = obd.throttle_pct;
    si.engine_load_pct   = obd.engine_load_pct;
    si.gear              = obd.gear;
    si.heart_rate        = bio.valid ? bio.heart_rate : 0;
    si.hrv_rmssd         = bio.valid ? bio.hrv_rmssd  : -1.0f;
    si.tailgating_risk   = cv.tailgating_risk;
    si.lane_drift        = cv.lane_drift;
    si.head_pose_score   = cv.head_pose_score;

    current_stress_ = stress_index_.compute(si);

    // ── Build output ──────────────────────────────────────────────────────────
    EngineOutput out{};
    out.stress_index        = current_stress_;
    out.emergency_override  = cv.emergency_vehicle;

    // ── Intervention dispatch ─────────────────────────────────────────────────
    DispatchInput di{};
    di.stress_index      = current_stress_;
    di.speed_kmh         = obd.speed_kmh;
    di.rpm               = obd.rpm;
    di.lane_drift        = cv.lane_drift;
    di.emergency_vehicle = cv.emergency_vehicle;
    di.stationary        = stationary_;

    auto result = dispatcher_.dispatch(di);
    out.intervention = result.type;
    out.severity     = result.severity;
    std::strncpy(out.message, result.message.c_str(), sizeof(out.message) - 1);

    // ── Latency instrumentation ─────────────────────────────────────────────
    const auto t_end = std::chrono::high_resolution_clock::now();
    const auto elapsed_us = std::chrono::duration_cast<std::chrono::microseconds>(t_end - t_start).count();
    out.tick_latency_us = static_cast<uint32_t>(elapsed_us);
    if (elapsed_us > 45'000) { // 45 ms warning threshold (target < 50 ms)
        std::cerr << "[IVISEngine] WARNING: tick latency " << elapsed_us << " us\n";
    }

    if (output_cb_) {
        output_cb_(out);
    }

    return out;
}

// ─── CV Inference ─────────────────────────────────────────────────────────────

IVISEngine::CVSignals IVISEngine::runCVInference(const CameraFrame* frame) {
    CVSignals cv{};
    if (!frame || !frame->data) {
        return cv; // no frame – return zero signals
    }

    // On RV1126 production: invoke RKNN NPU models for:
    //   1. Object detection (emergency vehicles, trucks)
    //   2. Lane departure detection
    //   3. Driver head pose estimation
    //
    // This software stub generates plausible signals from OBD context.
    // Replace with RKNN API calls in production build.

    const float speed = last_obd_.speed_kmh;

    // Tailgating proxy: at high speed with high engine load
    cv.tailgating_risk = std::min(100.0f, (speed > 80.0f ? (speed - 80.0f) * 2.0f : 0.0f));

    // Lane drift: simulated via throttle variance (replace with actual CV)
    cv.lane_drift = 0.0f;

    // Head pose distraction: simulated (replace with actual model output)
    cv.head_pose_score = 0.0f;

    // Emergency vehicle: in production, detected by object detection model
    cv.emergency_vehicle = false;

    return cv;
}

// ─── Accessors ────────────────────────────────────────────────────────────────

float IVISEngine::currentStressIndex() const {
    return current_stress_;
}

bool IVISEngine::isStationary() const {
    return stationary_;
}

} // namespace ivis

// ─── Standalone test entry point ──────────────────────────────────────────────
#ifdef IVIS_STANDALONE_TEST
#include <thread>

int main() {
    ivis::IVISEngine engine;
    auto hw = engine.init();
    if (!hw.success) {
        std::cerr << "Init failed: " << hw.error_msg << "\n";
        return 1;
    }

    engine.setOutputCallback([](const ivis::EngineOutput& out) {
        std::cout << "stress=" << out.stress_index
                  << " intervention=" << static_cast<int>(out.intervention)
                  << " severity=" << static_cast<int>(out.severity)
                  << " msg=" << out.message << "\n";
    });

    // Simulate 100 ticks at 50 ms intervals
    for (int i = 0; i < 100; ++i) {
        ivis::OBDSnapshot obd{};
        obd.speed_kmh     = 60.0f + static_cast<float>(i % 20);
        obd.rpm           = 2000 + (i * 30);
        obd.throttle_pct  = 35.0f;
        obd.engine_load_pct = 45.0f;
        obd.gear          = 4;

        ivis::BiometricPacket bio{};
        bio.heart_rate   = 78 + (i % 10);
        bio.rr_interval_ms = 820;
        bio.hrv_rmssd    = 42.0f;
        bio.valid        = true;

        engine.tick(obd, bio, nullptr);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    engine.shutdown();
    return 0;
}
#endif
