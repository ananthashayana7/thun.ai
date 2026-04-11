# Physical Device Bring-Up

This repository now includes the runtime guardrails needed to move from a demo build to first-device pilot bring-up. The goal of this document is simple: provision the backend, mobile app, and RV1126 edge unit so the next step is plugging into actual hardware and validating behavior in the vehicle.

## 1. Backend

Required before pilot traffic:

- Set `DATABASE_URL`.
- Set a strong `JWT_SECRET` with at least 32 non-placeholder characters.
- Set Firebase credentials with either `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`.
- Set `ALLOWED_ORIGINS`.
- Set `SENTRY_DSN`.
- Run migrations, including `V3__add_privacy_controls.sql`.

Bring-up checks:

```bash
cd backend
npm install
npm run migrate
npm test
npm start
```

Health endpoints:

- `GET /health`
- `GET /health/providers`
- `GET /health/startup`

Device provisioning note:

- Pilot devices can be provisioned with the backend JWT returned by `POST /auth/verify`.
- That token can now be saved directly in the mobile app Settings screen so protected routes authenticate immediately during pilot setup.

## 2. Python Runtime Profiles

Two deployment overlays are now available:

- `config/profiles/pilot.yaml`
- `config/profiles/production.yaml`

Recommended usage:

```bash
set THUNAI_PROFILE=pilot
thunai status
thunai manifest
```

Production validation intentionally blocks stub perception or stub SLM paths outside development so configuration errors fail before field testing.

## 3. Edge Unit (RV1126)

The edge build now supports explicit runtime inputs instead of silent defaults.

Required environment variables:

```bash
export IVIS_CAN_IFACE=can0
export IVIS_CAMERA_DEVICE=/dev/video0
export IVIS_BLE_DEVICE_NAME=IVIS-Edge
export IVIS_BLE_KEY_FILE=/opt/ivis/secrets/ble.key
export IVIS_YOLO_MODEL_PATH=/opt/ivis/models/yolo_emergency.rknn
export IVIS_LANE_MODEL_PATH=/opt/ivis/models/lanenet.rknn
```

Bring-up steps:

```bash
cd edge
mkdir -p build-rv1126 && cd build-rv1126
cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=../../toolchains/rv1126.cmake
make -j
./ivis_selftest
```

`ivis_selftest` now fails if any of these are missing:

- CAN interface not present in `/sys/class/net`
- camera device node missing
- BLE key file missing or empty
- YOLO model missing
- lane model missing

Crypto behavior:

- BLE payload encryption now fails closed unless a real key is present.
- When OpenSSL is available, the edge build uses AES-256-GCM instead of placeholder protection.

## 4. Mobile App

Production-oriented mobile hardening now includes:

- keystore-backed database key retrieval on Android
- no fallback production SQLCipher passphrase
- sync queue health and replay on foreground recovery
- degraded-mode warnings for OBD, watch, and backend sync
- privacy controls stored locally and queueable to backend
- manual backend token provisioning for pilot devices

Pilot checklist:

1. Install the Android build with the native secure runtime module.
2. Open Settings and confirm `Secure local storage` is `Keystore-backed`.
3. Paste the backend token returned by `POST /auth/verify`.
4. Save privacy settings and confirm they either sync or queue for replay.
5. Verify OBD, watch, and backend status from the dashboard and drive screen.

## 5. End-to-End Validation

Run these checks before first in-vehicle testing:

1. Backend `/health/startup` returns `ok` or only non-blocking warnings.
2. `thunai status` reports the expected deployment profile and no blockers.
3. `ivis_selftest` passes on the target RV1126 device.
4. Mobile Settings shows secure storage and a provisioned backend session.
5. Mobile offline replay works by disabling connectivity, generating queued actions, then restoring connectivity.
6. Camera, CAN, BLE output, and mobile sync all stay healthy through app foreground/background transitions.

## 6. What Still Requires Physical Validation

These cannot be completed purely in software and must be validated on actual hardware:

- real CAN frame ingestion from the target vehicle
- BLE interoperability with the target watch/mobile pairing path
- camera initialization and sustained frame rate on the RV1126
- perception accuracy under real road conditions
- latency envelopes under actual sensor load
- degraded-mode behavior during disconnects and reconnects

The repo is now set up so those checks become the next step rather than a future refactor.
