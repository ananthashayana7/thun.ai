"""
Stub LLM provider for local development and testing.

Returns deterministic responses without requiring any API keys.
"""

from __future__ import annotations

from thunai.intelligence.base import BaseLLMProvider, LLMResponse, Message

_STUB_RESPONSES: dict[str, str] = {
    "feedback": (
        "Great drive! You maintained a steady speed and handled the merge onto "
        "the main road calmly. One suggestion: try using your indicator a moment "
        "earlier before lane changes. Overall stress score: 0.42 — well within "
        "your comfort zone."
    ),
    "synthetic": (
        "Scenario: You are approaching a busy intersection at 30 km/h. A cyclist "
        "cuts in from the left. Recommended action: Ease off the accelerator, "
        "check mirrors, and let the cyclist pass."
    ),
    "therapist": (
        "You're doing wonderfully. Take a slow breath — in through your nose for "
        "four counts, hold for four, and out through your mouth for four. "
        "The road is clear. You are safe. Whenever you are ready, we continue."
    ),
    "default": (
        "I am thun.ai, your calm driving companion. How can I help you today?"
    ),
}

_STRUCTURED_SYNTHETIC_RESPONSE = (
    '[{"scenario":"A two-wheeler suddenly cuts across your lane near a market road.",'
    '"trigger":"lane_merge","suggested_response":"Ease off the accelerator, keep a steady lane, and wait for a safe gap."},'
    '{"scenario":"Traffic compresses quickly near a signal while a bus blocks your right mirror.",'
    '"trigger":"traffic_compression","suggested_response":"Increase following distance, scan left and right, and brake progressively."},'
    '{"scenario":"A pedestrian steps off the divider during light rain at dusk.",'
    '"trigger":"pedestrian","suggested_response":"Reduce speed early, cover the brake, and let the pedestrian clear the road."}]'
)


class StubLLMProvider(BaseLLMProvider):
    """Deterministic LLM for offline testing — no API calls."""

    @property
    def provider_name(self) -> str:
        return "stub"

    @property
    def model_name(self) -> str:
        return "stub-llm"

    def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResponse:
        last_user = next(
            (m.content.lower() for m in reversed(messages) if m.role == "user"),
            "",
        )
        for key, response in _STUB_RESPONSES.items():
            if key in last_user:
                text = response
                break
        else:
            text = _STUB_RESPONSES["default"]

        if "json array" in last_user and "suggested_response" in last_user:
            text = _STRUCTURED_SYNTHETIC_RESPONSE

        return LLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
            input_tokens=sum(len(m.content) for m in messages),
            output_tokens=len(text),
        )
