"""Tests for founder-authored IVIS dictionary integration."""

from __future__ import annotations

from unittest.mock import MagicMock

from thunai.config import IVISConfig
from thunai.features.ivis import IVISEngine, OBDSnapshot
from thunai.intelligence.base import SLMResponse
from thunai.ivis_dictionary import IVISRuleCatalog
from thunai.perception import PerceptionResult


def _mock_slm(text: str = "Stay calm.") -> MagicMock:
    slm = MagicMock()
    slm.generate.return_value = SLMResponse(
        text=text,
        provider="stub",
        model="test",
    )
    return slm


def _mock_voice() -> MagicMock:
    voice = MagicMock()
    voice.speak = MagicMock()
    return voice


def test_founder_dictionary_catalog_loads_generated_rules():
    catalog = IVISRuleCatalog.load()

    assert len(catalog) == 59
    assert catalog.mapped_event_types == ("emergency", "stall")
    assert catalog.resolve_runtime_event("stall", "mode_2").text == "Hazards on, breathe, restart."
    assert catalog.resolve_runtime_event("emergency", "mode_2").text == "Indicate left, move at gap."


def test_ivis_engine_uses_founder_dictionary_for_stall_copy():
    engine = IVISEngine(
        IVISConfig(stress_threshold=0.0, max_interventions_per_minute=3),
        _mock_slm("Fallback stall copy."),
        _mock_voice(),
    )

    engine.process_frame(OBDSnapshot(speed_kmh=0, rpm=0, gear=0))

    engine._voice.speak.assert_called_once_with("Hazards on, breathe, restart.")
    engine._slm.generate.assert_not_called()


def test_ivis_engine_uses_founder_dictionary_for_emergency_copy():
    engine = IVISEngine(
        IVISConfig(stress_threshold=1.0, max_interventions_per_minute=3),
        _mock_slm("Fallback emergency copy."),
        _mock_voice(),
    )

    engine.process_frame(
        OBDSnapshot(speed_kmh=40, rpm=2000, gear=3),
        PerceptionResult(emergency_vehicle_detected=True),
    )

    engine._voice.speak.assert_called_once_with("Indicate left, move at gap.")
    engine._slm.generate.assert_not_called()


def test_ivis_engine_falls_back_to_slm_for_unmapped_event_types():
    engine = IVISEngine(
        IVISConfig(stress_threshold=0.0, max_interventions_per_minute=3),
        _mock_slm("Fallback gear copy."),
        _mock_voice(),
    )

    engine.process_frame(OBDSnapshot(speed_kmh=60, rpm=3000, gear=1))

    engine._slm.generate.assert_called_once()
    engine._voice.speak.assert_called_once_with("Fallback gear copy.")
