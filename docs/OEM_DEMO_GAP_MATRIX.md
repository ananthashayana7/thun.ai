# OEM Demo Gap Matrix

## Status Legend

- `Done` means implemented in the current repo and visible in product flow.
- `Partial` means a scaffold, heuristic, or limited version exists.
- `Missing` means there is no meaningful implementation yet.

## Demo-Ready Now

- Onboarding now captures driving experience, triggers, accident history, judgment sensitivity, avoidance frequency, and vehicle width.
- Pre-drive route selection now respects saved trigger preferences and previews a narrow-lane confidence corridor.
- In-drive UI now includes a spatial confidence corridor that tells the driver whether they will fit, how much room is left, and how that experience builds confidence memory.
- Post-drive flow now persists corridor outcomes and passes them into backend narrative generation.
- Dashboard now reinforces tight-space confidence progress for repeated successful passages.

## Coverage Matrix

| Area | TRS refs | Status | Current repo evidence | Remaining work |
|---|---|---|---|---|
| Onboarding profile capture | FR-ONB-01, FR-ONB-02 | Partial | `mobile/src/screens/OnboardingScreen.js` now captures core profile inputs plus vehicle width and derives anxiety sensitivity and trigger preferences. | Auto-save/resume under interruption and smartwatch pairing prompt are still missing. |
| Onboarding under 5 minutes | FR-ONB-03 | Partial | Flow is short and linear. | No timing instrumentation or saved draft recovery yet. |
| Profile editable in settings | FR-ONB-04 | Partial | `mobile/src/screens/SettingsScreen.js` now exposes threshold, vehicle width, intervention, and trigger preferences. | Questionnaire answers themselves are not yet editable in a structured form. |
| Watch pairing offer | FR-ONB-05 | Missing | No dedicated onboarding pairing step. | Add pairing prompt, skip flow, and connection health checks. |
| Peace of Mind route alternatives | FR-PDR-01 | Done | `mobile/src/screens/PreDriveScreen.js`, `mobile/src/services/RouteScoring.js` already fetch and sort alternative routes. | Replace direct client-side Google calls with backend proxy before production. |
| Route scoring factors | FR-PDR-02, FR-PDR-03 | Partial | Traffic, merges, accident zones, heavy vehicles, narrow lanes, and custom triggers are scored and displayed. | Heavy vehicle and narrow-lane scoring are still heuristic, not city-data-backed. |
| Coach persona / progressive exposure | FR-PDR-04 | Missing | No adaptive coach persona yet. | Add route challenge progression tied to confidence trajectory. |
| Route fallback | FR-PDR-05 | Done | `RouteScoring.js` falls back to a neutral default route. | Production fallback should come from backend, not a hardcoded client stub. |
| Custom trigger preferences | FR-PDR-06 | Partial | Settings now persist avoid-flyover, avoid-U-turn, avoid-highway-merge, and avoid-narrow-lane preferences; route scoring applies penalty heuristics. | Need server-backed scoring and clearer trigger explainability. |
| Composite stress index | FR-IVIS-01, FR-010, FR-011 | Partial | `mobile/src/services/StressIndexService.js` and `edge/src/stress_index.cpp` compute weighted composite stress. | Camera-based tension/grip detection and calibrated user thresholds from real data are still incomplete. |
| Threshold-based interventions | FR-IVIS-02, FR-012 | Done | `mobile/src/services/IVISEngine.js` dispatches only above threshold. | Per-user calibration should be validated against pilot data. |
| Sub-50 ms edge path | FR-IVIS-03, HW-NFR-01, NFR-P-01 | Partial | `edge/src/ivis_engine.cpp` instruments tick latency. | Real RV1126 bench measurements, camera load tests, and audio cue timing are still required. |
| Intervention set | FR-IVIS-04, FR-014 to FR-017 | Partial | Calm audio, HUD icon, breathing cue, lane guidance, stall protocol, speed gate, cooldown, and emergency override are implemented. | Directional lane guidance is still heuristic and the new confidence corridor is route-model-backed, not true side-clearance CV yet. |
| Emergency vehicle override | FR-IVIS-05, FR-015 | Partial | Dispatcher and mobile engine support override. | Real CV detector and validation against Indian traffic scenes are pending. |
| Stall protocol | FR-IVIS-06, FR-016 | Done | Mobile and edge engines both implement stall logic. | Needs vehicle-level validation with real RPM feeds. |
| Speed gate | FR-IVIS-07, FR-SW-TTS-04 | Done | `mobile/src/services/TTSService.js` enforces mute above 60 km/h. | Need Bluetooth call suppression and production telematics validation. |
| Fully on-device core logic | FR-IVIS-08, NFR-R-01 | Partial | Stress index and intervention logic run locally. | Maps, TTS, and some route logic still depend on cloud or build-time secrets. |
| Vehicle diagnostics overlays | FR-IVIS-09 | Missing | No surfaced battery / tyre / engine warning overlays. | Add OBD diagnostic parsing and non-urgent HUD presentation. |
| AI Therapist stationary-only | FR-AIT-01, FR-AIT-04 | Partial | `mobile/src/screens/TherapistScreen.js` blocks usage when moving and supports user-initiated entry. | No hardware shortcut, no RPM persistence from real OBD during app restarts. |
| Pre-drive CBT pep talk | FR-AIT-02 | Missing | No dedicated pre-drive pep talk generation step. | Generate before drive start using route difficulty, weather, and recent confidence trend. |
| Roadside recovery mode | FR-AIT-03 | Partial | Therapist can be used while stationary. | No automatic activation after sustained roadside stop yet. |
| Therapist storage/privacy | FR-AIT-06, DA-04 | Partial | Therapist transcripts are not obviously persisted by default. | Add explicit local mood tracking and consented transcript storage controls. |
| Post-drive report generation | FR-PDF-01 to FR-PDF-03 | Partial | `mobile/src/screens/PostDriveScreen.js`, backend `/feedback/generate`, and `llmService.js` support report generation and caching. | Need hard latency measurement and stronger structured top-3 moment extraction. |
| Synthetic scenarios | FR-PDF-04 | Done | `backend/src/services/llmService.js` generates 10-15 scenario variants for high-stress events. | Persist and operationalize the dataset pipeline beyond response payload storage. |
| Confidence trajectory graph | FR-PDF-05 | Partial | Backend stores `confidence_trajectory`; dashboard now shows summary confidence cards. | No real graph visualization in mobile yet. |
| Deferred cloud sync | FR-PDF-06 | Partial | `mobile/src/services/SyncService.js` and `LocalStorage.js` support queued sync. | Wi-Fi-only policy and consent gating need enforcement. |
| Security: keys server-side only | NFR-S-01, FR-SW-LLM-04 | Partial | LLM keys are server-side. | Google Maps and Sarvam TTS are still directly called from mobile codepaths and must be proxied. |
| At-rest encryption | NFR-022, DA-05 | Partial | Local SQLite is wired for a key. | Current mobile storage still relies on a non-production key path and needs keystore-backed SQLCipher handling. |
| Consent / DPDP / deletion | DA-01 to DA-06, NFR-C-01 | Missing | No full consent UX or deletion workflow. | Add consent surfaces, policy enforcement, deletion job, and India residency controls. |
| Crash / reliability instrumentation | NFR-R-03, NFR-R-04 | Partial | Repo includes an `ErrorTracker` service and reconnection banners. | Full Sentry or Crashlytics wiring and hardware disconnect telemetry still need production setup. |
| Localisation / accessibility | NFR-A-01 to NFR-A-04 | Partial | Language selection exists for several Indian languages. | UI copy, in-drive high-contrast mode, and font/accessibility validation remain incomplete. |
| New narrow-lane visual truth story | Product addition | Partial | Route preview, live confidence corridor, memory reinforcement, and post-drive narrative hooks are now implemented. | Replace route-model simulation with real side-clearance CV and sensor fusion from the edge stack. |

## Highest-Priority OEM Blockers

1. Replace direct mobile calls to Google Maps and Sarvam TTS with backend-proxied, authenticated APIs.
2. Replace route-model corridor simulation with real sensor-derived left/right clearance estimates from the edge or phone CV path.
3. Validate latency, camera throughput, and OBD robustness on target RV1126 hardware with repeatable benchmarks.
4. Implement consent, data residency, deletion, and secure at-rest key management before any external pilot.
5. Add production telemetry, crash reporting, and hardware compatibility checks for actual vehicles and dongles.
