#include "runtime_config.h"

#include <filesystem>
#include <iostream>

int main() {
    const auto config = ivis::loadRuntimeConfig();
    const auto blockers = ivis::validateRuntimeConfig(config, true);

    auto print_check = [](const std::string& label, const std::string& value, bool ok) {
        std::cout << label << ": " << value << " [" << (ok ? "ok" : "missing") << "]\n";
    };

    std::cout << "thun.ai edge self-test\n";
    std::cout << "----------------------\n";
    print_check("CAN interface", config.can_interface, ivis::canInterfaceExists(config.can_interface));
    print_check("Camera device", config.camera_device, ivis::pathExists(config.camera_device));
    print_check("BLE device name", config.ble_device_name, !config.ble_device_name.empty());
    print_check("BLE key file", config.ble_key_file, ivis::pathExists(config.ble_key_file));
    print_check("YOLO model", config.yolo_model_path, ivis::pathExists(config.yolo_model_path));
    print_check("Lane model", config.lane_model_path, ivis::pathExists(config.lane_model_path));

    if (!blockers.empty()) {
        std::cout << "\nBlockers:\n";
        for (const auto& blocker : blockers) {
            std::cout << " - " << blocker << "\n";
        }
        return 1;
    }

    const auto bleKey = ivis::readTrimmedFile(config.ble_key_file);
    if (bleKey.empty()) {
        std::cout << "\nBlockers:\n - BLE key file is empty or unreadable\n";
        return 1;
    }

    std::cout << "\nRuntime manifest looks ready for device bring-up.\n";
    return 0;
}
