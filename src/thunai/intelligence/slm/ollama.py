"""
Ollama SLM provider.

Sends requests to a locally-running Ollama server, which hosts
on-device models such as Phi-3 Mini or Mistral 7B.

Start Ollama:  ollama serve
Pull model:    ollama pull phi3:mini

No external API keys required — all inference is local.
"""

from __future__ import annotations

import logging
import time

import requests

from thunai.config import OllamaConfig
from thunai.intelligence.base import BaseSLMProvider, SLMResponse

logger = logging.getLogger(__name__)


class OllamaSLMProvider(BaseSLMProvider):
    """On-device SLM via local Ollama server (Phi-3, Mistral, Llama, etc.)."""

    def __init__(self, config: OllamaConfig) -> None:
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

    def generate(
        self,
        prompt: str,
        *,
        max_tokens: int = 128,
        temperature: float = 0.3,
    ) -> SLMResponse:
        payload = {
            "model": self._config.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature,
            },
        }

        start = time.monotonic()
        response = requests.post(
            f"{self._config.base_url}/api/generate",
            json=payload,
            timeout=self._config.timeout_seconds,
        )
        response.raise_for_status()
        latency_ms = (time.monotonic() - start) * 1000

        data = response.json()
        text = data.get("response", "").strip()

        return SLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
            latency_ms=latency_ms,
            metadata={"eval_count": data.get("eval_count", 0)},
        )
