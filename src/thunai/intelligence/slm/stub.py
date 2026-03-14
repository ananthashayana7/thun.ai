"""
Stub SLM provider for local development and testing.

Returns deterministic short responses simulating on-device SLM behaviour
without requiring a running Ollama server or GGUF model files.
"""

from __future__ import annotations

import time

from thunai.intelligence.base import BaseSLMProvider, SLMResponse

_INTERVENTIONS: dict[str, str] = {
    "stall": "It's alright. Gently press clutch and brake, turn the key, release clutch and brake gradually.",
    "lane": "You are drifting left. Gently steer right.",
    "ambulance": "Emergency vehicle approaching. Move safely to the left.",
    "gear": "You are in 4th gear at low speed. Consider shifting to 3rd.",
    "indicator": "Remember to signal before changing lanes.",
    "speed": "You are approaching a speed bump. Ease off the accelerator.",
    "default": "Stay calm. You are doing well.",
}


class StubSLMProvider(BaseSLMProvider):
    """Deterministic SLM for offline testing — no model files required."""

    @property
    def provider_name(self) -> str:
        return "stub"

    @property
    def model_name(self) -> str:
        return "stub-slm"

    def generate(
        self,
        prompt: str,
        *,
        max_tokens: int = 128,
        temperature: float = 0.3,
    ) -> SLMResponse:
        start = time.monotonic()
        prompt_lower = prompt.lower()
        for key, text in _INTERVENTIONS.items():
            if key in prompt_lower:
                result = text
                break
        else:
            result = _INTERVENTIONS["default"]

        latency_ms = (time.monotonic() - start) * 1000
        return SLMResponse(
            text=result,
            provider=self.provider_name,
            model=self.model_name,
            latency_ms=latency_ms,
        )
