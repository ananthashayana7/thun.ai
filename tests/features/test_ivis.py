"""Tests for the IVIS engine."""

from __future__ import annotations

import pytest

from thunai.config import IVISConfig
from thunai.features.ivis import DriveEvent, IVISEngine, OBDSnapshot
from thunai.intelligence.slm import StubSLMProvider
from thunai.interaction import VoiceEngine
from thunai.config import VoiceConfig
from thunai.perception import PerceptionResult


def _make_engine(stress_threshold: float = 0.65) -> IVISEngine:
    config = IVISConfig(stress_threshold=stress_threshold, max_interventions_per_minute=3)
    slm = StubSLMProvider()
    voice = VoiceEngine(VoiceConfig(provider="stub"))
    return IVISEngine(config, slm, voice)


def test_stall_detected():
    engine = _make_engine()
    obd = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    events = engine.process_frame(obd)
    assert any(e.event_type == "stall" for e in events)


def test_no_events_at_normal_driving():
    engine = _make_engine()
    obd = OBDSnapshot(speed_kmh=40, rpm=2500, gear=3)
    events = engine.process_frame(obd)
    stalls = [e for e in events if e.event_type == "stall"]
    assert len(stalls) == 0


def test_gear_mismatch_detected():
    engine = _make_engine()
    # Speed 60 km/h but gear 1 — very high mismatch
    obd = OBDSnapshot(speed_kmh=60, rpm=3000, gear=1)
    events = engine.process_frame(obd)
    gear_events = [e for e in events if e.event_type == "gear_mismatch"]
    assert len(gear_events) > 0


def test_stress_increases_on_stall():
    engine = _make_engine()
    initial_stress = engine.stress_level
    obd = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    engine.process_frame(obd)
    assert engine.stress_level > initial_stress


def test_stress_decays_on_normal_driving():
    engine = _make_engine(stress_threshold=0.1)  # low threshold to trigger stress
    # First raise stress
    obd_stall = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    engine.process_frame(obd_stall)
    high_stress = engine.stress_level

    # Then drive normally many times
    obd_normal = OBDSnapshot(speed_kmh=40, rpm=2200, gear=3)
    for _ in range(20):
        engine.process_frame(obd_normal)

    assert engine.stress_level < high_stress


def test_stress_capped_at_one():
    engine = _make_engine()
    obd = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    for _ in range(20):
        engine.process_frame(obd)
    assert engine.stress_level <= 1.0


def test_rate_limiting_interventions():
    """Should not exceed max_interventions_per_minute."""
    engine = _make_engine(stress_threshold=0.0)  # Always trigger
    engine._config.max_interventions_per_minute = 2
    obd = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    for _ in range(10):
        engine.process_frame(obd)
    assert len(engine._recent_interventions) <= 2


# ── New tests for stress history tracking ────────────────────────────────────

def test_stress_average_and_peak_tracked():
    """stress_average and stress_peak should reflect session history."""
    engine = _make_engine()
    engine.reset_session()

    obd_stall = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    obd_normal = OBDSnapshot(speed_kmh=40, rpm=2200, gear=3)

    # Build up stress then let it decay
    for _ in range(5):
        engine.process_frame(obd_stall)
    peak_after_stalls = engine.stress_peak

    for _ in range(20):
        engine.process_frame(obd_normal)

    # Average should be below peak (stress decayed over normal driving)
    assert engine.stress_peak >= engine.stress_average
    assert engine.stress_peak == peak_after_stalls  # peak captured at stall


def test_stress_peak_zero_before_any_frame():
    engine = _make_engine()
    engine.reset_session()
    assert engine.stress_peak == 0.0
    assert engine.stress_average == 0.0


def test_reset_session_clears_history():
    """reset_session() must wipe history so subsequent drives start fresh."""
    engine = _make_engine()
    obd_stall = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
    for _ in range(5):
        engine.process_frame(obd_stall)
    assert engine.stress_peak > 0.0

    engine.reset_session()
    assert engine.stress_peak == 0.0
    assert engine.stress_level == 0.0


# ── OBD input validation ─────────────────────────────────────────────────────

def test_obd_snapshot_clamps_negative_speed():
    obd = OBDSnapshot(speed_kmh=-10, rpm=2000, gear=2)
    assert obd.speed_kmh == 0.0


def test_obd_snapshot_clamps_negative_rpm():
    obd = OBDSnapshot(speed_kmh=30, rpm=-500, gear=2)
    assert obd.rpm == 0


def test_obd_snapshot_clamps_throttle_over_100():
    obd = OBDSnapshot(throttle_pct=150.0)
    assert obd.throttle_pct == 100.0


def test_obd_snapshot_clamps_speed_over_limit():
    obd = OBDSnapshot(speed_kmh=999.0)
    assert obd.speed_kmh == 300.0


# ── Emergency vehicle bypasses rate limiter ──────────────────────────────────

def test_emergency_bypasses_rate_limit():
    """Emergency vehicle intervention must always fire, even when rate-limited."""
    engine = _make_engine(stress_threshold=0.99)  # normal interventions suppressed
    engine._config.max_interventions_per_minute = 0  # completely block normal interventions

    perception = PerceptionResult(emergency_vehicle_detected=True)
    obd = OBDSnapshot(speed_kmh=40, rpm=2000, gear=3)

    events = engine.process_frame(obd, perception)
    emergency_events = [e for e in events if e.event_type == "emergency"]
    assert len(emergency_events) == 1
    # Rate-limit counter should NOT be incremented for emergency interventions
    assert len(engine._recent_interventions) == 0


def test_emergency_detected_in_events():
    engine = _make_engine()
    perception = PerceptionResult(emergency_vehicle_detected=True)
    obd = OBDSnapshot(speed_kmh=40, rpm=2000, gear=3)
    events = engine.process_frame(obd, perception)
    assert any(e.event_type == "emergency" for e in events)

