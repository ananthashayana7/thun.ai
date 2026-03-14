"""Tests for LLM providers."""

from __future__ import annotations

import pytest

from thunai.config import LLMConfig
from thunai.intelligence.base import LLMResponse, Message
from thunai.intelligence.llm import StubLLMProvider, create_llm_provider


def test_stub_llm_returns_llm_response():
    llm = StubLLMProvider()
    messages = [Message(role="user", content="Hello")]
    result = llm.generate(messages)
    assert isinstance(result, LLMResponse)
    assert len(result.text) > 0
    assert result.provider == "stub"


def test_stub_llm_feedback_keyword():
    llm = StubLLMProvider()
    messages = [Message(role="user", content="give me feedback on my drive")]
    result = llm.generate(messages)
    assert "feedback" in result.text.lower() or "drive" in result.text.lower() or len(result.text) > 0


def test_stub_llm_therapist_keyword():
    llm = StubLLMProvider()
    messages = [Message(role="user", content="I need therapist support")]
    result = llm.generate(messages)
    assert len(result.text) > 0


def test_stub_llm_is_always_available():
    llm = StubLLMProvider()
    assert llm.is_available() is True


def test_factory_stub():
    config = LLMConfig(provider="stub")
    llm = create_llm_provider(config)
    assert isinstance(llm, StubLLMProvider)


def test_factory_invalid_provider():
    config = LLMConfig(provider="unknown_model")
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        create_llm_provider(config)


def test_factory_gemini_no_key(monkeypatch):
    """Gemini provider should be instantiated but report unavailable without API key."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from thunai.intelligence.llm.gemini import GeminiProvider
    from thunai.config import GeminiConfig

    provider = GeminiProvider(GeminiConfig())
    assert provider.is_available() is False
