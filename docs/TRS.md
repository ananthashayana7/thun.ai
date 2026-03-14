# thun.ai – Technical Requirements Specification (TRS)

**Version:** 1.0  
**Product:** thun.ai – AI-Powered In-Vehicle Intelligence System (IVIS)  
**Status:** Draft  

---

## 1. Product Overview

**thun.ai** is an AI-powered In-Vehicle Intelligence System (IVIS) designed to detect, monitor, and mitigate driving anxiety in real time. The system combines:

- **OBD-2 telematics** (vehicle speed, RPM, throttle, gear)
- **Smartwatch biometrics** (heart rate, HRV)
- **Computer vision** (forward/driver-facing cameras on edge hardware)
- **LLM-powered post-drive coaching** (confidence narrative, scenario variants)
- **AI Driving Therapist** (stationary-only conversational CBT coaching)

The product targets driving-anxious users in urban India, with multi-language voice support via Sarvam AI.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Mobile App (React Native)                                       │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────────┐  │
│  │ OBDService   │  │ WatchService│  │ IVISEngine (on-device)│  │
│  │ (BT Classic) │  │ (BLE HR/HRV)│  │ StressIndexService    │  │
│  └──────┬───────┘  └──────┬──────┘  └──────────┬────────────┘  │
│         └─────────────────┴──────────────────────┘             │
│                           │ BLE                                  │
└──────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Edge Unit (RV1126)        │
              │  ivis_engine.cpp           │
              │  GMSL2 Cameras             │
              │  CAN Bus                   │
              │  RKNN NPU (CV inference)   │
              └─────────────┬─────────────┘
                            │ HTTPS (TLS 1.3)
              ┌─────────────▼─────────────┐
              │  Backend (Node.js)         │
              │  PostgreSQL                │
              │  Claude / GPT-4o-mini      │
              │  Firebase Auth             │
              └───────────────────────────┘
```

---

## 3. Functional Requirements

### 3.1 Pre-Drive: Peace of Mind Route Selection

| ID | Requirement |
|----|-------------|
| FR-001 | System shall score candidate routes on: heavy vehicle density, highway merge frequency, accident zones, narrow lanes, live traffic congestion |
| FR-002 | Each scoring factor shall be weighted per `ROUTE_WEIGHT` constants |
| FR-003 | Routes shall be presented sorted by anxiety score (lowest first) |
| FR-004 | Anxiety score range: 0 (calmest) – 100 (most stressful) |
| FR-005 | System shall fall back to a single neutral-scored route when Google Maps API is unavailable |

### 3.2 Real-Time IVIS During Drive

| ID | Requirement |
|----|-------------|
| FR-010 | System shall compute a Composite Stress Index (CSI) at ≥ 5 Hz |
| FR-011 | CSI shall combine: OBD-2 signals (40%), biometrics (40%), CV signals (20%) |
| FR-012 | Interventions shall only trigger when CSI ≥ user-calibrated threshold |
| FR-013 | **Speed gate:** voice interventions shall be muted when vehicle speed > 60 km/h |
| FR-014 | Intervention cooldown: minimum 30 seconds between identical intervention types |
| FR-015 | **Emergency vehicle override:** immediate priority intervention, bypasses cooldown |
| FR-016 | **Stall protocol:** triggered when RPM=0, speed=0, and CSI ≥ threshold |
| FR-017 | **AI Therapist:** available only when RPM=0 (vehicle stationary) |

### 3.3 Intervention Types

| Type | Trigger | Speed Gate |
|------|---------|-----------|
| `calm_audio` | CSI ≥ threshold | Muted > 60 km/h |
| `hud_icon` | CSI ≥ threshold | None |
| `breathing_cue` | CSI ≥ 75 | Muted > 60 km/h |
| `lane_guidance` | Lane drift > 60 | None |
| `emergency_vehicle` | CV detection | None (priority) |
| `stall_protocol` | RPM=0 + speed=0 + CSI ≥ threshold | N/A |

### 3.4 Post-Drive Feedback

| ID | Requirement |
|----|-------------|
| FR-020 | System shall generate a confidence narrative of 200–350 words |
| FR-021 | Narrative shall be generated within 30 seconds |
| FR-022 | For stress events with score ≥ 75, system shall generate 10–20 synthetic practice scenarios |
| FR-023 | LLM API keys shall never be present in the mobile client |
| FR-024 | Backend shall cache narratives to avoid regeneration on repeated view |

### 3.5 Anxiety Profiling & Onboarding

| ID | Requirement |
|----|-------------|
| FR-030 | Onboarding shall include a 5-question driving anxiety questionnaire |
| FR-031 | Questionnaire responses shall calibrate initial CSI trigger threshold |
| FR-032 | Thresholds shall adapt after each drive session (weighted moving average) |
| FR-033 | User shall be able to manually override threshold in Settings |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|-------------|
| NFR-001 | Edge IVIS engine: end-to-end latency < 50 ms (target < 35 ms) |
| NFR-002 | Mobile CSI computation: < 5 ms per tick |
| NFR-003 | Backend LLM response: < 30 seconds (P95) |
| NFR-004 | Backend API response (non-LLM): < 500 ms (P99) |
| NFR-005 | OBD polling rate: 5 Hz (200 ms interval) |

### 4.2 Security

| ID | Requirement |
|----|-------------|
| NFR-010 | All backend API endpoints shall use TLS 1.3 in production |
| NFR-011 | LLM API keys (Anthropic, OpenAI) shall be server-side only |
| NFR-012 | Firebase Auth ID tokens verified server-side on every authenticated request |
| NFR-013 | JWT tokens shall expire after 7 days |
| NFR-014 | Rate limiting: 100 req/min globally; 10 req/min on LLM endpoints |
| NFR-015 | All user inputs validated with express-validator before processing |
| NFR-016 | No secrets committed to source code; all via environment variables |

### 4.3 Privacy

| ID | Requirement |
|----|-------------|
| NFR-020 | Drive history older than 90 days shall be purged from on-device SQLite |
| NFR-021 | User biometric data shall not be transmitted to cloud without explicit consent |
| NFR-022 | On-device data shall be encrypted at rest (SQLite encryption via device keystore) |

### 4.4 Reliability

| ID | Requirement |
|----|-------------|
| NFR-030 | TTS shall fall back to native react-native-tts if Sarvam AI is unavailable |
| NFR-031 | LLM shall fall back from Claude to GPT-4o-mini on any API error |
| NFR-032 | Route scoring shall fall back to single neutral route on API failure |
| NFR-033 | OBD polling shall degrade gracefully if BT connection drops |

---

## 5. Data Model

Refer to `backend/src/db/schema.sql` for the full PostgreSQL schema.

Key tables:
- **users** – Firebase UID, anxiety profile (JSONB), TTS language
- **drive_sessions** – telemetry summary, stress events, anxiety scores, LLM narrative
- **ivis_interventions** – per-intervention log with severity and acknowledgement
- **confidence_trajectory** – longitudinal confidence scores for progress visualisation

---

## 6. Hardware Requirements (Edge Unit)

| Component | Specification |
|-----------|--------------|
| SoC | Rockchip RV1126 (Cortex-A7 @ 1.5 GHz) |
| NPU | Integrated 2 TOPS RKNN NPU |
| Camera | GMSL2 × 2 (driver-facing + forward-facing) |
| CAN | ISO 15765-4, 500 kbps |
| BLE | 5.0, Secure Connections, encrypted pairing |
| RAM | ≥ 1 GB LPDDR4 |
| Storage | ≥ 8 GB eMMC |
| OS | Linux 5.10 (Rockchip BSP) |

---

## 7. API Surface

### Mobile → Backend

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/verify` | Public | Firebase token verification |
| PUT | `/auth/profile` | JWT | Update anxiety profile |
| POST | `/drive` | JWT | Create drive session |
| PUT | `/drive/:id` | JWT | Complete/update drive session |
| GET | `/drive` | JWT | List drive sessions |
| GET | `/drive/:id` | JWT | Get single session |
| POST | `/route/accident-zones` | JWT | Accident zone scoring |
| POST | `/feedback/generate` | JWT | Generate LLM narrative + scenarios |
| POST | `/feedback/therapist` | JWT | AI Therapist chat |
| GET | `/feedback/trajectory` | JWT | Confidence trajectory history |

---

## 8. Glossary

| Term | Definition |
|------|-----------|
| CSI | Composite Stress Index – weighted combination of OBD, biometric, and CV signals |
| HRV | Heart Rate Variability – RMSSD metric from R-R intervals |
| IVIS | In-Vehicle Intelligence System |
| Speed gate | Suppression of voice interventions above 60 km/h |
| Stall protocol | Special intervention sequence when vehicle stops under stress |
| RKNN | Rockchip Neural Network – NPU inference framework |
| GMSL2 | Gigabit Multimedia Serial Link 2 – automotive camera interface |
| OBD-2 | On-Board Diagnostics version 2 – standardised vehicle telemetry |
