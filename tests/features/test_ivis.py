"""Tests for the IVIS engine."""

from __future__ import annotations

import pytest

from thunai.config import IVISConfig
from thunai.features.ivis import DriveEvent, IVISEngine, OBDSnapshot
from thunai.intelligence.slm import StubSLMProvider
from thunai.interaction import VoiceEngine
from thunai.config import VoiceConfig


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
