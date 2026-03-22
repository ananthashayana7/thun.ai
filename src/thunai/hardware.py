"""
Hardware readiness and plug-and-play diagnostics.

This module keeps a lightweight heartbeat for the three critical inputs:
  - OBD-2 telemetry (vehicle kinematics)
  - Biometrics (HR / HRV from smartwatch)
  - Camera feed (GMSL2 dash / pillar cameras)

It enforces:
  - NFR-R-03: Detect hardware disconnection within 2 seconds.
  - HW-NFR-01: Keep IVIS latency within the configured budget (50 ms default).
  - NFR-R-02: Degrade gracefully when a feed drops by producing a fallback
              stress-input stack.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from thunai.config import HardwareConfig


_SENSOR_NAMES = {
    "obd": "OBD-2",
    "biometrics": "Biometrics",
    "camera": "Camera",
}


@dataclass
class ReadinessReport:
    """Immutable view of current hardware readiness."""

    status: str  # ready | degraded | offline
    plug_and_play: bool
    available_inputs: list[str] = field(default_factory=list)
    effective_stress_inputs: list[str] = field(default_factory=list)
    fallback_path: list[str] = field(default_factory=list)
    faults: list[str] = field(default_factory=list)
    latency_budget_ms: float = 50.0
    latency_guard_passed: bool = True

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "plug_and_play": self.plug_and_play,
            "available_inputs": list(self.available_inputs),
            "effective_stress_inputs": list(self.effective_stress_inputs),
            "fallback_path": list(self.fallback_path),
            "faults": list(self.faults),
            "latency_budget_ms": self.latency_budget_ms,
            "latency_guard_passed": self.latency_guard_passed,
        }


class HardwareMonitor:
    """
    Tracks last-seen timestamps for hardware feeds and produces readiness reports.

    Designed to be updated from the main engine loop:
      - tick_obd() whenever an OBD snapshot is processed
      - tick_biometrics() when HR/HRV arrives from the watch
      - tick_camera() when a camera frame is ingested
    """

    def __init__(self, config: HardwareConfig) -> None:
        self._config = config
        self._last_seen: Dict[str, Optional[float]] = {"obd": None, "biometrics": None, "camera": None}
        self._latency_ms: Dict[str, float] = {"obd": 0.0, "biometrics": 0.0, "camera": 0.0}

    # ── Feed updates ──────────────────────────────────────────────────────────
    def tick_obd(self, latency_ms: float = 0.0, now: Optional[float] = None) -> None:
        self._mark("obd", latency_ms, now)

    def tick_biometrics(self, latency_ms: float = 0.0, now: Optional[float] = None) -> None:
        self._mark("biometrics", latency_ms, now)

    def tick_camera(self, latency_ms: float = 0.0, now: Optional[float] = None) -> None:
        self._mark("camera", latency_ms, now)

    # ── Reporting ─────────────────────────────────────────────────────────────
    def assess(self, now: Optional[float] = None) -> ReadinessReport:
        now = now if now is not None else time.monotonic()
        faults: List[str] = []
        available: List[str] = []

        for key, last_seen in self._last_seen.items():
            if last_seen is None:
                faults.append(f"{_SENSOR_NAMES[key]} not yet detected")
                continue

            stale = (now - last_seen) > self._config.disconnect_timeout_seconds
            if stale:
                elapsed = now - last_seen
                faults.append(f"{_SENSOR_NAMES[key]} link lost ({elapsed:.1f}s > {self._config.disconnect_timeout_seconds:.1f}s)")
            else:
                available.append(key)

        effective_inputs, fallback_path = self._compute_effective_stack(available)
        plug_and_play = "obd" in available and "biometrics" in available
        if not available:
            status = "offline"
        elif plug_and_play and not faults:
            status = "ready"
        else:
            status = "degraded"

        max_latency = max((self._latency_ms[k] for k in available), default=0.0)
        latency_guard = max_latency <= self._config.latency_budget_ms if available else False

        return ReadinessReport(
            status=status,
            plug_and_play=plug_and_play,
            available_inputs=available,
            effective_stress_inputs=effective_inputs,
            fallback_path=fallback_path,
            faults=faults,
            latency_budget_ms=self._config.latency_budget_ms,
            latency_guard_passed=latency_guard,
        )

    # ── Internal helpers ──────────────────────────────────────────────────────
    def _mark(self, key: str, latency_ms: float, now: Optional[float]) -> None:
        timestamp = now if now is not None else time.monotonic()
        self._last_seen[key] = timestamp
        self._latency_ms[key] = latency_ms

    def _compute_effective_stack(self, available: List[str]) -> tuple[list[str], list[str]]:
        """
        Derive the active + fallback stack for stress estimation in priority order.

        Rules:
          - Primary (ideal): OBD + biometrics + vision
          - If OBD drops: fall back to biometrics + vision (NFR-R-02)
          - If camera drops: fall back to OBD + biometrics (NFR-R-02)
          - If only one input remains, use it but mark degraded.
        """
        # Preserve deterministic ordering for tests and logs
        primary_order = ["obd", "biometrics", "camera"]

        if all(key in available for key in primary_order):
            return ["obd", "biometrics", "vision"], ["obd+biometrics+vision"]

        if "obd" not in available and all(key in available for key in ("biometrics", "camera")):
            return ["biometrics", "vision"], ["biometrics+vision"]

        if "camera" not in available and all(key in available for key in ("obd", "biometrics")):
            return ["obd", "biometrics"], ["obd+biometrics"]

        if available:
            # Partial survival — keep the order stable
            ordered = [key for key in primary_order if key in available]
            label_map = {"obd": "obd", "biometrics": "biometrics", "camera": "vision"}
            effective = [label_map[key] for key in ordered]
            return effective, ["+".join(effective)]

        return [], []
