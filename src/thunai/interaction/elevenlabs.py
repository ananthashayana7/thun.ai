from __future__ import annotations

import requests

from thunai.circuit_breaker import get_breaker
from thunai.interaction.base import TTSProvider


class ElevenLabsTTS(TTSProvider):
    provider_name = "elevenlabs"

    def __init__(self, cfg: dict):
        self.api_key = cfg["api_key"]
        self.voice_id = cfg["voice_id"]
        self.model_id = cfg.get("model_id", cfg.get("model", "eleven_turbo_v2_5"))
        self.timeout = cfg.get("timeout_s", 3)
        self.breaker = get_breaker("elevenlabs", failure_threshold=5, timeout=300)

    def synthesise(self, text: str, language: str = "en-US") -> bytes:
        return self.breaker.call(self._api_call, text, language)

    def _api_call(self, text: str, language: str = "en-US") -> bytes:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}"
        resp = requests.post(
            url,
            headers={
                "xi-api-key": self.api_key,
                "accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
            json={"text": text, "model_id": self.model_id},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.content

    def is_healthy(self) -> bool:
        return True
