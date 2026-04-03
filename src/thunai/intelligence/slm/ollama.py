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

from thunai.circuit_breaker import get_breaker
from thunai.config import OllamaConfig
from thunai.intelligence.base import BaseSLMProvider, SLMProvider, SLMResponse

logger = logging.getLogger(__name__)


class OllamaSLMProvider(BaseSLMProvider):
    """On-device SLM via local Ollama server (Phi-3, Mistral, Llama, etc.)."""

    def __init__(self, config: OllamaConfig) -> None:
        self._config = config
        self.breaker = get_breaker("ollama", failure_threshold=5, timeout=300)

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
        return self.breaker.call(
            self._do_generate,
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def _do_generate(
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


# Developer reference implementation (v1)
class OllamaSLM(SLMProvider):
    provider_name = "ollama"

    def __init__(self, cfg: dict):
        self.base_url = cfg["base_url"]
        self.model = cfg["model"]
        self.timeout = cfg.get("timeout_s", cfg.get("timeout_seconds", 5))
        self.temp = cfg.get("temperature", 0.3)
        self.breaker = get_breaker("ollama", failure_threshold=5, timeout=300)

    def infer(
        self, prompt: str, max_tokens: int = 128, temperature: float | None = None
    ) -> str:
        return self.breaker.call(
            self._do_infer,
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def _do_infer(
        self, prompt: str, max_tokens: int = 128, temperature: float | None = None
    ) -> str:
        resp = requests.post(
            f"{self.base_url}/api/generate",
            json={
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": temperature or self.temp,
                    "num_predict": max_tokens,
                },
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()["response"].strip()

    def is_healthy(self) -> bool:
        try:
            r = requests.get(f"{self.base_url}/api/tags", timeout=2)
            return r.status_code == 200
        except Exception:
            return False
