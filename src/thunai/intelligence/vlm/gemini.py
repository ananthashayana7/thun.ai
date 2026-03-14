"""
Google Gemini VLM provider.

Uses Gemini's native vision capabilities to analyse camera frames.
"""

from __future__ import annotations

import base64
import logging
import os

from thunai.config import VLMGeminiConfig
from thunai.intelligence.base import BaseVLMProvider, VLMResponse

logger = logging.getLogger(__name__)


class GeminiVLMProvider(BaseVLMProvider):
    """Gemini multimodal model for scene analysis."""

    def __init__(self, config: VLMGeminiConfig) -> None:
        self._config = config
        self._client: object | None = None

    @property
    def provider_name(self) -> str:
        return "gemini"

    @property
    def model_name(self) -> str:
        return self._config.model

    def _get_client(self) -> object:
        if self._client is None:
            try:
                import google.generativeai as genai  # type: ignore[import]
            except ImportError as exc:
                raise ImportError(
                    "google-generativeai is not installed. "
                    'Run: pip install "thunai[llm-gemini]"'
                ) from exc

            api_key = os.environ.get(self._config.api_key_env, "")
            if not api_key:
                raise EnvironmentError(
                    f"Gemini API key not set. Check {self._config.api_key_env!r}."
                )
            genai.configure(api_key=api_key)
            self._client = genai.GenerativeModel(self.model_name)
        return self._client

    def is_available(self) -> bool:
        api_key = os.environ.get(self._config.api_key_env, "")
        if not api_key:
            return False
        try:
            import google.generativeai  # noqa: F401  # type: ignore[import]

            return True
        except ImportError:
            return False

    def describe_scene(
        self,
        image_bytes: bytes,
        prompt: str = "Describe what is happening on the road in this image.",
    ) -> VLMResponse:
        try:
            import google.generativeai as genai  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "google-generativeai is not installed."
            ) from exc

        client = self._get_client()
        image_part = {"mime_type": "image/jpeg", "data": base64.b64encode(image_bytes).decode()}

        response = client.generate_content([prompt, image_part])  # type: ignore[union-attr]
        text = response.text or ""

        return VLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
        )
