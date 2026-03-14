"""
Ollama VLM provider.

Uses local multimodal models (e.g., LLaVA) via Ollama.
"""

from __future__ import annotations

import base64
import logging

import requests

from thunai.config import VLMOllamaConfig
from thunai.intelligence.base import BaseVLMProvider, VLMResponse

logger = logging.getLogger(__name__)


class OllamaVLMProvider(BaseVLMProvider):
    """Local VLM via Ollama (LLaVA, BakLLaVA, etc.)."""

    def __init__(self, config: VLMOllamaConfig) -> None:
        self._config = config

    @property
    def provider_name(self) -> str:
        return "ollama"

    @property
    def model_name(self) -> str:
        return self._config.model

    def is_available(self) -> bool:
        try:
            resp = requests.get(
                f"{self._config.base_url}/api/tags",
                timeout=2,
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def describe_scene(
        self,
        image_bytes: bytes,
        prompt: str = "Describe what is happening on the road in this image.",
    ) -> VLMResponse:
        image_b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "model": self._config.model,
            "prompt": prompt,
            "images": [image_b64],
            "stream": False,
        }

        response = requests.post(
            f"{self._config.base_url}/api/generate",
            json=payload,
            timeout=self._config.timeout_seconds,
        )
        response.raise_for_status()

        data = response.json()
        text = data.get("response", "").strip()

        return VLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
        )
