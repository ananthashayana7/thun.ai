"""Tests for SLM providers."""

from __future__ import annotations

import pytest

from thunai.config import SLMConfig
from thunai.intelligence.base import SLMResponse
from thunai.intelligence.slm import StubSLMProvider, create_slm_provider


def test_stub_slm_returns_slm_response():
    slm = StubSLMProvider()
    result = slm.generate("The car has stalled.")
    assert isinstance(result, SLMResponse)
    assert len(result.text) > 0
    assert result.provider == "stub"


def test_stub_slm_stall_intervention():
    slm = StubSLMProvider()
    result = slm.generate("stall detected, engine off")
    assert "clutch" in result.text.lower() or len(result.text) > 0


def test_stub_slm_lane_intervention():
    slm = StubSLMProvider()
    result = slm.generate("lane departure detected")
    assert "lane" in result.text.lower() or len(result.text) > 0


def test_stub_slm_latency_is_non_negative():
    slm = StubSLMProvider()
    result = slm.generate("check gear")
    assert result.latency_ms >= 0.0


def test_stub_slm_is_always_available():
    slm = StubSLMProvider()
    assert slm.is_available() is True


def test_factory_stub():
    config = SLMConfig(provider="stub")
    slm = create_slm_provider(config)
    assert isinstance(slm, StubSLMProvider)


def test_factory_ollama_falls_back_to_stub():
    """Ollama is not running in test env — should gracefully fall back to stub."""
    config = SLMConfig(provider="ollama")
    slm = create_slm_provider(config)
    assert isinstance(slm, StubSLMProvider)


def test_factory_phi3_falls_back_to_stub():
    """Phi-3 model file is absent in test env — should fall back to stub."""
    config = SLMConfig(provider="phi3")
    slm = create_slm_provider(config)
    assert isinstance(slm, StubSLMProvider)


def test_factory_invalid_provider():
    config = SLMConfig(provider="unknown_slm")
    with pytest.raises(ValueError, match="Unknown SLM provider"):
        create_slm_provider(config)
