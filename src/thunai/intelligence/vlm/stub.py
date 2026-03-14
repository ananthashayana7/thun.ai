"""
Stub VLM provider for local development and testing.
"""

from __future__ import annotations

from thunai.intelligence.base import BaseVLMProvider, VLMResponse


class StubVLMProvider(BaseVLMProvider):
    """Returns synthetic scene descriptions — no model required."""

    @property
    def provider_name(self) -> str:
        return "stub"

    @property
    def model_name(self) -> str:
        return "stub-vlm"

    def describe_scene(
        self,
        image_bytes: bytes,
        prompt: str = "Describe what is happening on the road in this image.",
    ) -> VLMResponse:
        description = (
            "The road ahead is clear. There is moderate traffic on the left lane. "
            "A two-wheeler is approximately 15 metres ahead. No emergency vehicles detected."
        )
        return VLMResponse(
            text=description,
            provider=self.provider_name,
            model=self.model_name,
            detected_objects=["road", "vehicle", "two-wheeler"],
        )
