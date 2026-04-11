#pragma once

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace ivis {

struct RuntimeConfig {
    std::string can_interface = "can0";
    std::string camera_device = "/dev/video0";
    std::string ble_device_name = "IVIS-Edge";
    std::string ble_key_file;
    std::string yolo_model_path = "yolo_emergency.rknn";
    std::string lane_model_path = "lanenet.rknn";
};

inline std::string getenvOrDefault(const char* key, const std::string& fallback) {
    const char* value = std::getenv(key);
    return value && *value ? std::string(value) : fallback;
}

inline RuntimeConfig loadRuntimeConfig() {
    RuntimeConfig config;
    config.can_interface = getenvOrDefault("IVIS_CAN_IFACE", config.can_interface);
    config.camera_device = getenvOrDefault("IVIS_CAMERA_DEVICE", config.camera_device);
    config.ble_device_name = getenvOrDefault("IVIS_BLE_DEVICE_NAME", config.ble_device_name);
    config.ble_key_file = getenvOrDefault("IVIS_BLE_KEY_FILE", "");
    config.yolo_model_path = getenvOrDefault("IVIS_YOLO_MODEL_PATH", config.yolo_model_path);
    config.lane_model_path = getenvOrDefault("IVIS_LANE_MODEL_PATH", config.lane_model_path);
    return config;
}

inline std::string trim(const std::string& value) {
    const auto start = value.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) {
        return "";
    }
    const auto end = value.find_last_not_of(" \t\r\n");
    return value.substr(start, end - start + 1);
}

inline std::string readTrimmedFile(const std::string& path) {
    std::ifstream input(path);
    if (!input.is_open()) {
        return "";
    }

    std::ostringstream buffer;
    buffer << input.rdbuf();
    return trim(buffer.str());
}

inline bool pathExists(const std::string& path) {
    return !path.empty() && std::filesystem::exists(path);
}

inline bool canInterfaceExists(const std::string& interfaceName) {
    return !interfaceName.empty() && std::filesystem::exists("/sys/class/net/" + interfaceName);
}

inline std::vector<std::string> validateRuntimeConfig(const RuntimeConfig& config, bool checkHardwarePaths = false) {
    std::vector<std::string> blockers;
    if (config.can_interface.empty()) {
        blockers.push_back("IVIS_CAN_IFACE is not set");
    }
    if (config.camera_device.empty()) {
        blockers.push_back("IVIS_CAMERA_DEVICE is not set");
    }
    if (config.ble_key_file.empty()) {
        blockers.push_back("IVIS_BLE_KEY_FILE is not set");
    }
    if (config.yolo_model_path.empty()) {
        blockers.push_back("IVIS_YOLO_MODEL_PATH is not set");
    }
    if (config.lane_model_path.empty()) {
        blockers.push_back("IVIS_LANE_MODEL_PATH is not set");
    }

    if (checkHardwarePaths) {
        if (!canInterfaceExists(config.can_interface)) {
            blockers.push_back("CAN interface not found at /sys/class/net/" + config.can_interface);
        }
        if (!pathExists(config.camera_device)) {
            blockers.push_back("Camera device not found at " + config.camera_device);
        }
        if (!pathExists(config.ble_key_file)) {
            blockers.push_back("BLE key file not found at " + config.ble_key_file);
        }
        if (!pathExists(config.yolo_model_path)) {
            blockers.push_back("YOLO model not found at " + config.yolo_model_path);
        }
        if (!pathExists(config.lane_model_path)) {
            blockers.push_back("Lane model not found at " + config.lane_model_path);
        }
    }

    return blockers;
}

}  // namespace ivis
