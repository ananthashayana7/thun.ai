"""Tests for the AI Therapist feature."""

from __future__ import annotations

import pytest

from thunai.config import TherapistConfig
from thunai.features.therapist import AITherapist
from thunai.intelligence.llm import StubLLMProvider
from thunai.interaction import VoiceEngine
from thunai.config import VoiceConfig


def _therapist(require_user_request: bool = True) -> AITherapist:
    config = TherapistConfig(
        require_user_request=require_user_request,
        breathing_exercise_seconds=0,  # Skip sleep in tests
    )
    llm = StubLLMProvider()
    voice = VoiceEngine(VoiceConfig(provider="stub"))
    return AITherapist(config, llm, voice)


def test_therapist_activates_when_rpm_zero_and_requested():
    t = _therapist()
    activated = t.activate(rpm=0, user_requested=True)
    assert activated is True


def test_therapist_does_not_activate_when_rpm_nonzero():
    t = _therapist()
    activated = t.activate(rpm=800, user_requested=True)
    assert activated is False


def test_therapist_does_not_activate_without_user_request():
    t = _therapist(require_user_request=True)
    activated = t.activate(rpm=0, user_requested=False)
    assert activated is False


def test_therapist_activates_if_user_request_not_required():
    t = _therapist(require_user_request=False)
    activated = t.activate(rpm=0, user_requested=False)
    assert activated is True


def test_therapist_respond_returns_text():
    t = _therapist()
    t.activate(rpm=0, user_requested=True)
    response = t.respond("I feel very anxious.")
    assert isinstance(response, str)
    assert len(response) > 0


def test_therapist_maintains_history():
    t = _therapist()
    t.activate(rpm=0, user_requested=True)
    t.respond("I am scared.")
    t.respond("I want to continue driving.")
    # System prompt + 2 user + 2 assistant = 5 messages
    assert len(t._session_history) == 5
