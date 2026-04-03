"""
Google Gemini VLM provider.

Uses Gemini's native vision capabilities to analyse camera frames.
"""

from __future__ import annotations

import base64
import logging
import os

from thunai.circuit_breaker import get_breaker
from thunai.config import VLMGeminiConfig
from thunai.intelligence.base import BaseVLMProvider, VLMResponse

logger = logging.getLogger(__name__)


class GeminiVLMProvider(BaseVLMProvider):
    """Gemini multimodal model for scene analysis."""

    def __init__(self, config: VLMGeminiConfig) -> None:
        self._config = config
        self._client: object | None = None
        self.breaker = get_breaker("gemini", failure_threshold=5, timeout=300)

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
        return self.breaker.call(
            self._do_describe_scene,
            image_bytes,
            prompt=prompt,
        )

    def _do_describe_scene(
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


class GeminiVLM:
    """Developer reference VLM that calls Gemini multimodal API."""

    provider_name = "gemini"

    def __init__(self, cfg: dict):
        self.model = cfg["model"]
        self.api_key = cfg.get("api_key")
        self.max_tokens = cfg.get("max_tokens", 256)
        self.breaker = get_breaker("gemini", failure_threshold=5, timeout=300)

    def describe_scene(self, image_bytes: bytes, prompt: str) -> str:
        return self.breaker.call(
            self._do_describe_scene,
            image_bytes,
            prompt,
        )

    def _do_describe_scene(self, image_bytes: bytes, prompt: str) -> str:
        import base64
        import requests

        image_b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "model": self.model,
            "prompt": prompt,
            "image": image_b64,
            "max_tokens": self.max_tokens,
        }
        resp = requests.post(
            "https://generativeai.googleapis.com/v1beta/models",
            json=payload,
            headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("description", "") or data.get("response", "") or ""

    def is_healthy(self) -> bool:
        return True
