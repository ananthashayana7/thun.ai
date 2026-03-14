# thun.ai Edge – IVIS Engine (Rockchip RV1126)

## Overview

The edge component runs the IVIS (In-Vehicle Intelligence System) engine on a **Rockchip RV1126** SoC embedded in the vehicle dashboard unit. It handles:

| Input | Interface | Rate |
|-------|-----------|------|
| Camera (driver + forward) | GMSL2 → MIPI CSI | 30 fps |
| OBD-2 telemetry | CAN bus (ISO 15765-4) | 5 Hz |
| Smartwatch biometrics | BLE 5.0 | 1 Hz |

| Output | Target latency |
|--------|---------------|
| Intervention type + severity | **< 50 ms** end-to-end |
| Stress index (0–100) | streamed over BLE to mobile |

---

## Prerequisites

### Host build (Linux x86_64)
```bash
sudo apt-get install -y cmake build-essential g++ libpthread-stubs0-dev
```

### Cross-compilation for RV1126 (ARM Cortex-A7)
```bash
sudo apt-get install -y gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf
```

Download and extract the Rockchip RV1126 SDK toolchain:
```
https://github.com/rockchip-linux/rknn-toolkit2/releases
```

---

## Build

### Host debug build (simulation mode)
```bash
mkdir -p edge/build && cd edge/build
cmake .. -DCMAKE_BUILD_TYPE=Debug
make -j$(nproc)
./ivis_test
```

### Cross-compile for RV1126
```bash
mkdir -p edge/build-rv1126 && cd edge/build-rv1126
cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=../../toolchains/rv1126.cmake \
  -DCMAKE_INSTALL_PREFIX=/opt/ivis
make -j$(nproc)
make install
```

### Toolchain file (`toolchains/rv1126.cmake`)
```cmake
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(TOOLCHAIN_PREFIX arm-linux-gnueabihf)
set(CMAKE_C_COMPILER   ${TOOLCHAIN_PREFIX}-gcc)
set(CMAKE_CXX_COMPILER ${TOOLCHAIN_PREFIX}-g++)

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

---

## Flash to RV1126

1. **Copy binary to device** (replace `192.168.1.100` with your device IP):
   ```bash
   scp build-rv1126/libivis.so root@192.168.1.100:/usr/lib/
   scp build-rv1126/ivis_test  root@192.168.1.100:/usr/bin/
   ```

2. **Set up systemd service** on the device:
   ```bash
   scp deploy/ivis.service root@192.168.1.100:/etc/systemd/system/
   ssh root@192.168.1.100 systemctl enable --now ivis
   ```

3. **Verify** the service is running:
   ```bash
   ssh root@192.168.1.100 journalctl -u ivis -f
   ```

---

## Module Descriptions

| File | Responsibility |
|------|----------------|
| `ivis_engine.cpp/.h` | Main engine: sensor fusion, tick loop, CV inference dispatch |
| `obd_parser.cpp/.h` | CAN bus frame parsing, OBD-2 Mode 01 PIDs |
| `stress_index.cpp/.h` | Composite Stress Index computation (OBD + biometric + CV) |
| `intervention_dispatcher.cpp/.h` | Rule-based intervention selection with cooldown logic |

---

## RKNN NPU Integration (production)

Replace the software-stub CV in `ivis_engine.cpp::runCVInference()` with:

```cpp
// Load RKNN model
rknn_context ctx;
rknn_init(&ctx, "models/ivis_detector.rknn", nullptr, 0, nullptr);

// Set inputs (camera frame)
rknn_input inputs[1];
inputs[0].buf = frame->data;
rknn_inputs_set(ctx, 1, inputs);

// Run inference
rknn_run(ctx, nullptr);

// Get outputs
rknn_output outputs[3]; // [tailgating, lane_drift, emergency_vehicle]
rknn_outputs_get(ctx, 3, outputs, nullptr);
```

RKNN Toolkit 2 documentation: https://github.com/rockchip-linux/rknn-toolkit2

---

## Latency Budget

| Stage | Budget |
|-------|--------|
| CAN frame read | ~1 ms |
| OBD parse | < 1 ms |
| BLE biometric read | ~2 ms |
| RKNN NPU inference | ~15–25 ms |
| Stress index compute | < 1 ms |
| Intervention dispatch | < 1 ms |
| BLE output write | ~5 ms |
| **Total** | **< 35 ms** (target < 50 ms) |

---

## Security

- The edge device communicates with the mobile app over **BLE with encrypted pairing** (BLE Secure Connections, MITM protection).
- No cloud connectivity from edge – all cloud calls go through the mobile app.
- CAN bus access requires physical vehicle access; no remote attack surface.
