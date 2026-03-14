# thun.ai – Architecture Overview

## System Overview

thun.ai is a three-tier AI-powered driving companion:

```
Mobile App  ←──BLE──→  Edge Unit (RV1126)
     │
     │ HTTPS / TLS 1.3
     ▼
Backend API (Node.js + PostgreSQL)
     │
     ├──→ Anthropic Claude (primary LLM)
     └──→ OpenAI GPT-4o-mini (fallback LLM)
```

---

## Component Architecture

### 1. Mobile App (`mobile/`)

**Framework:** React Native 0.73 (iOS + Android)

```
mobile/src/
├── navigation/
│   └── AppNavigator.js        # Root navigation (Stack + BottomTabs)
├── screens/
│   ├── OnboardingScreen.js    # Anxiety profiling questionnaire
│   ├── HomeScreen.js          # Dashboard + drive history
│   ├── PreDriveScreen.js      # Peace of Mind route selection
│   ├── DriveScreen.js         # Real-time IVIS HUD
│   ├── PostDriveScreen.js     # LLM feedback report
│   ├── TherapistScreen.js     # AI Driving Therapist (stationary)
│   └── SettingsScreen.js      # User preferences
├── services/
│   ├── IVISEngine.js          # Intervention orchestration
│   ├── StressIndexService.js  # Composite Stress Index (0–100)
│   ├── RouteScoring.js        # Peace of Mind route scoring
│   ├── OBDService.js          # OBD-2 via Bluetooth Classic
│   ├── WatchService.js        # BLE HR/HRV from smartwatch
│   ├── TTSService.js          # Sarvam AI TTS + native fallback
│   └── LocalStorage.js        # SQLite (90-day drive history)
├── store/
│   └── anxietyProfile.js      # Zustand global state
└── utils/
    └── constants.js           # Thresholds, colors, intervention types
```

**State Management:** Zustand (lightweight, no boilerplate)  
**Persistence:** SQLite via react-native-sqlite-storage  
**Networking:** Axios with 10 s timeout  

#### Data Flow (during drive)

```
OBDService (200ms) ─┐
WatchService (1s)   ├──► StressIndexService ──► IVISEngine ──► Interventions
Edge CVSignals      ┘         (0–100)              │
                                              ┌────┴─────────────────────────┐
                                              │ calm_audio (TTS + speed gate)│
                                              │ hud_icon (always visible)    │
                                              │ breathing_cue (animated)     │
                                              │ lane_guidance (TTS + HUD)    │
                                              │ emergency_vehicle (priority) │
                                              │ stall_protocol (RPM=0)       │
                                              └──────────────────────────────┘
```

---

### 2. Backend (`backend/`)

**Framework:** Express 4 on Node.js 18+  
**Database:** PostgreSQL 15  
**Auth:** Firebase Auth (ID token) → backend JWT (7d)  

```
backend/src/
├── index.js                   # Express entry, middleware setup
├── routes/
│   ├── auth.js                # Firebase verify + JWT issue
│   ├── drive.js               # Drive session CRUD
│   ├── route.js               # Accident zone scoring
│   └── feedback.js            # LLM narrative + therapist + trajectory
├── services/
│   ├── llmService.js          # Claude primary / GPT-4o-mini fallback
│   └── routeScoring.js        # Polyline → accident zone DB query
├── db/
│   ├── db.js                  # pg Pool wrapper
│   └── schema.sql             # PostgreSQL schema
└── middleware/
    ├── auth.js                # Firebase token + JWT verification
    └── rateLimiter.js         # Global + LLM-specific rate limits
```

**LLM Strategy:**

```
Request → Claude 3.5 Sonnet
             │ (error / timeout)
             └──► GPT-4o-mini
```

- Confidence narrative: 200–350 words, < 30 s
- Scenario variants: 10–20 items, JSON array
- Therapist: 2–3 sentence responses, streaming-ready

**Security layers:**
1. `helmet` – HTTP security headers
2. `cors` – origin allowlist
3. `express-rate-limit` – 100 req/min global, 10 req/min LLM
4. `express-validator` – input validation on all POST/PUT
5. Firebase ID token verified via Admin SDK
6. Backend JWT for session persistence
7. PostgreSQL SSL in production

---

### 3. Edge Unit (`edge/`)

**Hardware:** Rockchip RV1126 (ARM Cortex-A7 @ 1.5 GHz, 2 TOPS RKNN NPU)

```
edge/src/
├── ivis_engine.cpp/.h         # Main engine: sensor fusion + CV dispatch
├── obd_parser.cpp/.h          # CAN bus OBD-2 Mode 01 frame parser
├── stress_index.cpp/.h        # C++ StressIndex (mirrors JS version)
└── intervention_dispatcher.cpp/.h  # Rule-based intervention selection
```

**Processing pipeline (50 ms budget):**

```
CAN frame (1 ms)
    + BLE biometrics (2 ms)
    + RKNN NPU inference (15–25 ms)
         │
         ▼
    StressIndex::compute() (< 1 ms)
         │
         ▼
    InterventionDispatcher::dispatch() (< 1 ms)
         │
         ▼
    BLE output to mobile (5 ms)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: < 35 ms (target < 50 ms)
```

**CV Models (RKNN):**
- Object detection: emergency vehicles, heavy trucks
- Lane departure: pixel-level lane marking analysis
- Driver monitoring: head pose estimation (distraction)

---

## Database Schema

```sql
users                    -- Firebase UID, anxiety_profile (JSONB)
drive_sessions           -- telemetry, stress_events, LLM narrative
ivis_interventions       -- per-trigger log with severity
confidence_trajectory    -- longitudinal confidence scores
```

---

## Deployment

### Mobile
- iOS: App Store (TestFlight for beta)
- Android: Play Store (internal track for beta)
- OTA updates via CodePush

### Backend
- Containerised (Docker)
- Recommended: Railway, Render, or AWS ECS Fargate
- PostgreSQL: Supabase or RDS
- Environment variables via secrets manager (not .env in production)

### Edge
- Cross-compiled for ARM Cortex-A7 (RV1126)
- Deployed via SSH + systemd service
- No cloud connectivity from edge device

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Zustand over Redux | Minimal boilerplate for small global state |
| SQLite on-device | 90-day offline history, no cloud dependency for history |
| Claude primary / GPT fallback | Claude 3.5 Sonnet is best for empathetic narrative; GPT-4o-mini is fast/cheap fallback |
| Speed gate at 60 km/h | Prevents voice distraction at highway speeds |
| 30 s intervention cooldown | Prevents alert fatigue |
| Firebase Auth + backend JWT | Firebase handles OTP/social login; JWT reduces Firebase calls on every request |
| C++ for edge | < 50 ms latency requirement; JS runtime overhead not acceptable |
