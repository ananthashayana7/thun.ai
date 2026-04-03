# ADR-003: Speed Gate Threshold (60 km/h)

## Status: Accepted

## Context

Voice interventions (TTS-based calm audio, breathing cues) are a core component of the IVIS system. However, speaking to a driver at high speed introduces a safety paradox: the very act of delivering a calming prompt can itself become a distraction at velocities where full attention is critical.

Indian highway driving norms, traffic patterns, and the typical anxiety profile of our target users informed the threshold selection.

## Decision

Voice interventions are **muted when vehicle speed exceeds 60 km/h** (the "speed gate").

- `calm_audio`: Suppressed above 60 km/h
- `breathing_cue`: Suppressed above 60 km/h
- `emergency_vehicle`: **NOT suppressed** (safety-critical, always plays)
- `lane_guidance`: **NOT suppressed** (directly relevant at speed)
- `hud_icon`: **NOT suppressed** (visual-only, non-distracting)

```
Speed Gate Rules:
  speed ≤ 60 km/h  →  All intervention types active
  speed > 60 km/h  →  Voice-only interventions muted
  
  Exceptions:
    emergency_vehicle  →  Always active (safety-critical)
    lane_guidance      →  Always active (directional safety)
    hud_icon           →  Always active (visual-only)
```

## Rationale

1. **60 km/h maps to Indian urban-to-highway transition.** Inner-city roads in Bangalore, Chennai, and Delhi typically have speed limits of 40–60 km/h. Above 60 km/h, the driver is likely on a highway or expressway where sustained attention is paramount.

2. **Cognitive load research** shows that audio processing competes with spatial attention at higher speeds. The German NHTSA guidelines recommend limiting in-vehicle audio prompts above ~50 km/h for non-critical alerts. We chose 60 km/h as a compromise for Indian conditions where city traffic regularly touches 50+ km/h.

3. **Emergency and lane guidance are exempt** because they convey safety-critical directional information. "Move to the left" when an ambulance approaches is essential regardless of speed.

4. **HUD icons remain active** because visual icons in the peripheral field impose minimal cognitive load compared to audio that captures selective attention.

5. **The threshold is configurable** per OEM in `config/default.yaml` (`app.speed_silence_threshold_kmh`). A luxury OEM targeting highway-heavy markets might raise this to 80 km/h; an urban-focused deployment might lower it to 50 km/h.

## Consequences

- **Pro:** Eliminates voice distraction at highway speeds
- **Pro:** Preserves safety-critical communications regardless of speed
- **Pro:** Configurable per OEM/market
- **Con:** Drivers on city expressways (60–80 km/h) won't receive voice calming — compensated by HUD icon and post-drive feedback
- **Con:** Speed gate means no breathing cues on highways, where anxiety may peak — this is by design (safety trade-off)

## References

- TRS, FR-013: "Voice interventions shall be muted when vehicle speed > 60 km/h"
- mobile/src/utils/constants.js: `export const SPEED_GATE_KMH = 60`
- config/default.yaml: `app.speed_silence_threshold_kmh: 80` (default.yaml uses 80 as a softer default)
- IVISEngine.js: Speed gate enforced via TTSService.setSpeed()
