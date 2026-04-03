# ADR-002: Intervention Cooldown (30 seconds)

## Status: Accepted

## Context

The IVIS engine triggers real-time interventions (calm audio, breathing cues, HUD icons, lane guidance) when the Composite Stress Index (CSI) exceeds a threshold. Without any rate-limiting, the system would fire interventions continuously during sustained high-stress periods — potentially every 200 ms (at the 5 Hz polling rate). This creates several problems:

1. **Cognitive overload:** Constant interruptions are counterproductive and can increase anxiety
2. **Habituation:** Frequent alerts lead the driver to tune them out entirely
3. **Safety hazard:** Too many audio/visual prompts while driving can themselves become distracting

A cooldown mechanism is essential to balance responsiveness with restraint.

## Decision

We enforce a **30-second cooldown** per intervention type. After an intervention fires, the same type will not fire again until 30 seconds have elapsed. Different intervention types can fire independently.

**Exception:** Emergency vehicle detection (`emergency_vehicle`) bypasses all cooldowns — it is a safety-critical priority override.

Additionally, the total intervention rate is capped at **4 per minute** to prevent cognitive overload.

```
Cooldown rules:
  calm_audio:      30s between occurrences
  breathing_cue:   30s between occurrences
  hud_icon:        30s between occurrences
  lane_guidance:   30s between occurrences
  stall_protocol:  30s between occurrences
  emergency:       NO cooldown (priority override)
```

## Rationale

1. **30 seconds** aligns with clinical CBT intervention timing. Research on brief mindfulness insertions suggests that 30-second intervals allow the driver to absorb and act on feedback before the next prompt.

2. **Per-type cooldowns** allow complementary interventions to co-occur. A breathing cue and an HUD icon can both fire within the same 30-second window, providing multi-modal support without repeating the same type.

3. **Emergency exemption** is non-negotiable. An approaching ambulance requires immediate action regardless of other cooldowns.

4. **The 4/minute cap** provides a hard ceiling. Even if all 5 intervention types have independent 30s cooldowns, the combined rate is bounded.

## Consequences

- **Pro:** Drivers receive timely but measured interventions
- **Pro:** Multiplechannel support (audio + visual) without redundancy
- **Pro:** Emergency vehicle response is never suppressed
- **Con:** During extreme stress events (CSI > 90), a 30-second gap may feel too long — consider reducing to 15s for CRITICAL severity
- **Con:** The cooldown is currently hardcoded (30,000 ms in `IVISEngine.js`); this should move to `config/default.yaml` for OEM customisation

## References

- IVISEngine.js, line 39: `const INTERVENTION_COOLDOWN_MS = 30_000`
- TRS, FR-014: "Minimum 30 seconds between identical intervention types"
- config/default.yaml, `intervention.cooldown_ms: 30000`
