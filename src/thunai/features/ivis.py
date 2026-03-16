"""
Feature 2: The Core IVIS — Real-Time In-Vehicle Intervention.

Monitors sensor data and triggers calm, non-distracting interventions
only when stress exceeds a defined threshold.

Key responsibilities:
  - Detect driving events (stall, lane departure, gear mismatch, etc.)
  - Consult the on-device SLM to formulate a response
  - Deliver the response via the Voice engine
  - Rate-limit interventions to prevent cognitive overload
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

from thunai.config import IVISConfig
from thunai.intelligence.base import BaseSLMProvider, SLMProvider
from thunai.interaction.base import TTSProvider
from thunai.interaction import VoiceEngine
from thunai.perception import PerceptionResult
from thunai.models import (
    DriveSession,
    StressReading,
    Intervention,
    InterventionLevel,
    OBDReading,
    BiometricReading,
)

logger = logging.getLogger(__name__)


@dataclass
class OBDSnapshot:
    """A snapshot of OBD-2 telemetry from the vehicle."""

    speed_kmh: float = 0.0
    rpm: int = 0
    gear: int = 0           # 0 = neutral / unknown
    throttle_pct: float = 0.0
    engine_load_pct: float = 0.0
    timestamp_ms: float = field(default_factory=lambda: time.monotonic() * 1000)


@dataclass
class DriveEvent:
    """A discrete driving event that may trigger an IVIS intervention."""

    event_type: str           # stall | lane_departure | gear_mismatch | emergency | proximity
    description: str
    stress_delta: float = 0.0  # how much this event raises estimated stress (0–1)
    timestamp_ms: float = field(default_factory=lambda: time.monotonic() * 1000)


# Developer reference stress computation engine
class StressIndexEngine:
    """Computes composite stress score from sensor inputs."""

    def __init__(self, cfg: dict, user_profile):
        self.w = cfg["stress"]["weights"]
        self.thr = cfg["stress"]["thresholds"]
        self.kin = cfg["stress"]["kinematic"]
        self.baseline_hr = user_profile.baseline_hr_bpm
        self.baseline_hrv = user_profile.baseline_hrv_ms
        self._speed_buffer: list[float] = []

    def compute(
        self, obd: OBDReading | None, bio: BiometricReading | None
    ) -> StressReading:
        ts = int(time.time() * 1000)
        obd_c = self._obd_score(obd) if obd else 0.0
        hr_c = self._hr_score(bio) if bio else 0.0
        hrv_c = self._hrv_score(bio) if bio else 0.0
        score = (
            self.w["obd_kinematic"] * obd_c
            + self.w["hr_delta"] * hr_c
            + self.w["hrv_suppression"] * hrv_c
        )
        return StressReading(
            timestamp_ms=ts,
            score=round(score, 4),
            obd_component=obd_c,
            hr_component=hr_c,
            hrv_component=hrv_c,
            severity=self._severity(score),
        )

    def _obd_score(self, obd: OBDReading) -> float:
        self._speed_buffer.append(obd.speed_kmh)
        win = self.kin["speed_variance_window_s"] * 10  # at 10Hz
        self._speed_buffer = self._speed_buffer[-win:]
        if len(self._speed_buffer) < 2:
            return 0.0
        import statistics

        variance = statistics.variance(self._speed_buffer)
        return min(variance / 400.0, 1.0)

    def _hr_score(self, bio: BiometricReading) -> float:
        delta = bio.hr_bpm - self.baseline_hr
        return min(max(delta / 60.0, 0.0), 1.0)

    def _hrv_score(self, bio: BiometricReading) -> float:
        drop = self.baseline_hrv - bio.hrv_rmssd_ms
        return min(max(drop / self.baseline_hrv, 0.0), 1.0)

    def _severity(self, score: float) -> int:
        t = self.thr
        if score >= t["emergency"]:
            return 4
        if score >= t["severe"]:
            return 3
        if score >= t["moderate"]:
            return 2
        if score >= t["mild"]:
            return 1
        return 0


class IVISEngine:
    """
    Real-time IVIS intervention engine.

    Call :meth:`process_frame` once per perception cycle with the latest
    OBD snapshot and camera detection results.
    """

    def __init__(
        self,
        config: IVISConfig | None = None,
        slm: BaseSLMProvider | SLMProvider | None = None,
        voice: VoiceEngine | TTSProvider | None = None,
        *,
        cfg: dict | None = None,
        tts: TTSProvider | None = None,
    ) -> None:
        self._config = config
        self._slm = slm  # legacy path
        self._voice = voice
        self.tts = tts or (voice if isinstance(voice, TTSProvider) else None)
        self.cfg = cfg["ivis"] if cfg and "ivis" in cfg else cfg
        self.slm = slm if isinstance(slm, SLMProvider) else slm  # type: ignore[assignment]

        self._stress_level: float = 0.0  # running 0–1 estimate
        self._recent_interventions: deque[float] = deque()  # timestamps of recent speaks

        # Doc reference state
        if self.cfg:
            self.cooldown_s = self.cfg.get("cooldown_s", self.cfg.get("cooldown", 0))
            self.max_per_drive = self.cfg.get("max_interventions_per_drive", 5)
            self._last_time = 0.0
            self._count = 0
            self._session: DriveSession | None = None

    @property
    def stress_level(self) -> float:
        return self._stress_level

    def process_frame(
        self,
        obd: OBDSnapshot,
        perception: Optional[PerceptionResult] = None,
    ) -> list[DriveEvent]:
        """
        Analyse a single telemetry frame and fire interventions as needed.

        Returns a list of :class:`DriveEvent` objects that were detected.
        """
        events = self._detect_events(obd, perception)
        self._update_stress(events)

        if self._stress_level >= self._config.stress_threshold:
            if self._can_intervene():
                self._intervene(events)

        return events

    # ──────────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _detect_events(
        self,
        obd: OBDSnapshot,
        perception: Optional[PerceptionResult],
    ) -> list[DriveEvent]:
        events: list[DriveEvent] = []

        # Engine stall
        if obd.rpm == 0 and obd.speed_kmh < 5:
            events.append(
                DriveEvent(
                    event_type="stall",
                    description="Engine stall detected.",
                    stress_delta=0.4,
                )
            )

        # Gear mismatch heuristic
        if obd.gear > 0 and obd.speed_kmh > 0:
            expected_gear = max(1, min(6, int(obd.speed_kmh / 15) + 1))
            if abs(obd.gear - expected_gear) > 1:
                events.append(
                    DriveEvent(
                        event_type="gear_mismatch",
                        description=f"High gear {obd.gear} at {obd.speed_kmh:.0f} km/h. Consider {expected_gear}.",
                        stress_delta=0.1,
                    )
                )

        if perception:
            # Emergency vehicle
            if perception.emergency_vehicle_detected:
                events.append(
                    DriveEvent(
                        event_type="emergency",
                        description="Emergency vehicle detected nearby.",
                        stress_delta=0.3,
                    )
                )

            # Lane departure
            if perception.lane_departure_detected:
                events.append(
                    DriveEvent(
                        event_type="lane_departure",
                        description="Lane departure detected.",
                        stress_delta=0.2,
                    )
                )

            # Proximity alert
            if perception.proximity_alert:
                events.append(
                    DriveEvent(
                        event_type="proximity",
                        description="Vehicle very close ahead.",
                        stress_delta=0.2,
                    )
                )

        return events

    def _update_stress(self, events: list[DriveEvent]) -> None:
        if events:
            delta = sum(e.stress_delta for e in events)
            self._stress_level = min(1.0, self._stress_level + delta)
        else:
            # Slow decay when no events
            self._stress_level = max(0.0, self._stress_level - 0.02)

    def _can_intervene(self) -> bool:
        now = time.monotonic()
        window = 60.0  # 1 minute
        # Remove timestamps outside the window
        while self._recent_interventions and now - self._recent_interventions[0] > window:
            self._recent_interventions.popleft()
        return len(self._recent_interventions) < self._config.max_interventions_per_minute

    def _intervene(self, events: list[DriveEvent]) -> None:
        if not events:
            return

        # Build a concise prompt for the SLM
        top_event = max(events, key=lambda e: e.stress_delta)
        prompt = (
            f"You are a calm driving coach. The driver's car has detected: {top_event.description}. "
            f"Provide a brief, calm, actionable instruction in one sentence."
        )

        response = self._slm.generate(prompt, max_tokens=64, temperature=0.2)
        self._voice.speak(response.text)
        self._recent_interventions.append(time.monotonic())
        logger.info("IVIS intervention [%s]: %s", top_event.event_type, response.text)

    # ── Developer reference methods (v1) ──────────────────────────────────
    def start_session(self, session: DriveSession) -> None:
        if self.cfg:
            self._session = session
            self._last_time = 0.0
            self._count = 0

    def end_session(self, session: DriveSession) -> None:
        if self.cfg:
            pass

    def _can_intervene_doc(self) -> bool:
        if not self.cfg:
            return False
        if self._count >= self.max_per_drive:
            return False
        return (time.time() - self._last_time) >= self.cooldown_s

    def _resolve_text(
        self, stress: StressReading, level: InterventionLevel, rpm: float
    ) -> str:
        if not self.cfg or not self.slm:
            return ""
        if rpm < self.cfg.get("stall_rpm_threshold", 100) and level.value >= 2:
            return "Stay calm. Apply the handbrake, then restart gently."
        if level == InterventionLevel.SEVERE and self.cfg.get("levels", {}).get(3, {}).get(
            "invoke_slm"
        ):
            prompt = (
                f"The driver stress score is {stress.score:.2f}. "
                f"OBD component: {stress.obd_component:.2f}. "
                f"Provide a single calm sentence to help them."
            )
            if hasattr(self.slm, "infer"):
                return self.slm.infer(prompt, max_tokens=64)  # type: ignore[arg-type]
        return "Take a slow breath in. Hold. Now breathe out slowly."

    def _deliver(self, intervention: Intervention, speed_kmh: float) -> None:
        if not self.cfg or not self.tts:
            return
        speed_gate = self.cfg.get("speed_gate_kmh", 60)
        if (
            speed_kmh > speed_gate
            and intervention.level != InterventionLevel.EMERGENCY
        ):
            logger.debug(
                "IVIS: voice suppressed above speed gate (%s km/h)", speed_kmh
            )
            return
        try:
            self.tts.synthesise(intervention.text)
        except Exception as e:
            logger.warning("IVIS: TTS delivery failed: %s", e)

    def evaluate(
        self,
        stress: StressReading,
        current_speed_kmh: float = 0.0,
        rpm: float = 0.0,
    ) -> Intervention | None:
        if not self.cfg:
            return None
        if stress.severity == 0:
            return None
        if not self._can_intervene_doc():
            return None
        level = InterventionLevel(min(stress.severity, 3))
        text = self._resolve_text(stress, level, rpm)
        intervention = Intervention(
            timestamp_ms=stress.timestamp_ms,
            level=level,
            trigger="stress_threshold",
            text=text,
            source="rule",
        )
        self._deliver(intervention, current_speed_kmh)
        self._last_time = time.time()
        self._count += 1
        if self._session:
            self._session.interventions_fired.append(intervention)
        return intervention
