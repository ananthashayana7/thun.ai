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
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

from thunai.config import IVISConfig
from thunai.intelligence.base import BaseSLMProvider
from thunai.interaction import VoiceEngine
from thunai.perception import PerceptionResult

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


class IVISEngine:
    """
    Real-time IVIS intervention engine.

    Call :meth:`process_frame` once per perception cycle with the latest
    OBD snapshot and camera detection results.
    """

    def __init__(
        self,
        config: IVISConfig,
        slm: BaseSLMProvider,
        voice: VoiceEngine,
    ) -> None:
        self._config = config
        self._slm = slm
        self._voice = voice

        self._stress_level: float = 0.0  # running 0–1 estimate
        self._recent_interventions: deque[float] = deque()  # timestamps of recent speaks

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
