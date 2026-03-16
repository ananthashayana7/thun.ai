from __future__ import annotations

import base64
import hashlib
import logging
from pathlib import Path

import requests

from thunai.interaction.base import TTSProvider

log = logging.getLogger(__name__)

# Common IVIS cues to pre-cache on startup
CACHE_CUES = [
    "Take a slow breath in. Hold. Now breathe out slowly.",
    "Emergency vehicle approaching. Please move to the left safely.",
    "Stay calm. Apply the handbrake, then restart gently.",
    "You are doing well. Keep steady.",
    "Ease off the accelerator. Give yourself more space.",
]


class SarvamTTS(TTSProvider):
    provider_name = "sarvam"

    def __init__(self, cfg: dict):
        self.api_key = cfg["api_key"]
        self.base_url = cfg["base_url"]
        self.voice_id = cfg.get("voice_id", "meera")
        self.model = cfg.get("model", "bulbul:v1")
        self.timeout = cfg.get("timeout_s", 3)
        self.cache_dir = Path(cfg.get("cache_dir", "~/.thunai/audio_cache")).expanduser()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def synthesise(self, text: str, language: str = "en-IN") -> bytes:
        cache_path = self._cache_path(text, language)
        if cache_path.exists():
            return cache_path.read_bytes()
        audio = self._api_call(text, language)
        cache_path.write_bytes(audio)
        return audio

    def _api_call(self, text: str, language: str) -> bytes:
        resp = requests.post(
            self.base_url,
            headers={"api-subscription-key": self.api_key},
            json={
                "inputs": [text],
                "target_language_code": language,
                "speaker": self.voice_id,
                "model": self.model,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        audio_b64 = resp.json()["audios"][0]
        return base64.b64decode(audio_b64)

    def _cache_path(self, text: str, language: str) -> Path:
        key = hashlib.md5(f"{text}|{language}|{self.voice_id}".encode()).hexdigest()
        return self.cache_dir / f"{key}.wav"

    def warm_cache(self, language: str = "en-IN") -> None:
        for cue in CACHE_CUES:
            try:
                self.synthesise(cue, language)
                log.debug("Cached: %s", cue[:40])
            except Exception as e:
                log.warning("Cache warm failed for cue: %s", e)

    def is_healthy(self) -> bool:
        try:
            self._api_call("test", "en-IN")
            return True
        except Exception:
            return False
