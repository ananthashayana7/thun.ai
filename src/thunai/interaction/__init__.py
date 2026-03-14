"""
Voice / TTS interaction layer.

Abstracts over different TTS backends:
  - stub:        Prints to console (development/testing)
  - sarvam:      Sarvam AI — Indian-language optimised TTS
  - elevenlabs:  ElevenLabs — high-quality multilingual TTS
  - system:      OS system TTS via pyttsx3 (no API key needed)
"""

from __future__ import annotations

import logging
import os

from thunai.config import VoiceConfig

logger = logging.getLogger(__name__)


class VoiceEngine:
    """
    Speaks intervention messages to the driver.

    The engine respects a speed-based silence threshold — above a configured
    speed limit the engine will not interrupt the driver.
    """

    def __init__(self, config: VoiceConfig, speed_silence_threshold_kmh: float = 80.0) -> None:
        self._config = config
        self._threshold = speed_silence_threshold_kmh
        self._current_speed_kmh: float = 0.0
        self._backend = self._config.provider.lower()

    def update_speed(self, speed_kmh: float) -> None:
        """Update the current vehicle speed (called from OBD-2 data stream)."""
        self._current_speed_kmh = speed_kmh

    @property
    def is_silenced(self) -> bool:
        """Voice is suppressed above the safety speed threshold."""
        return self._current_speed_kmh >= self._threshold

    def speak(self, text: str) -> None:
        """
        Deliver *text* to the driver via the configured TTS engine.

        No-ops silently if above the speed threshold.
        """
        if self.is_silenced:
            logger.debug("Voice silenced (%.0f km/h ≥ %.0f km/h threshold).", self._current_speed_kmh, self._threshold)
            return

        backend = self._backend
        if backend == "stub":
            self._speak_stub(text)
        elif backend == "sarvam":
            self._speak_sarvam(text)
        elif backend == "elevenlabs":
            self._speak_elevenlabs(text)
        elif backend == "system":
            self._speak_system(text)
        else:
            logger.warning("Unknown voice backend %r — falling back to stub.", backend)
            self._speak_stub(text)

    def _speak_stub(self, text: str) -> None:
        """Console output for development/testing."""
        print(f"[thun.ai] {text}")

    def _speak_sarvam(self, text: str) -> None:
        """Sarvam AI TTS — optimised for Indian languages."""
        import requests

        api_key = os.environ.get(self._config.sarvam.api_key_env, "")
        if not api_key:
            logger.warning("Sarvam API key not set (%s). Falling back to stub.", self._config.sarvam.api_key_env)
            self._speak_stub(text)
            return

        payload = {
            "text": text,
            "target_language_code": self._config.sarvam.language,
            "speaker": self._config.sarvam.voice_id,
            "model": "bulbul:v1",
        }
        response = requests.post(
            f"{self._config.sarvam.base_url}/text-to-speech",
            json=payload,
            headers={"API-Subscription-Key": api_key},
            timeout=10,
        )
        response.raise_for_status()
        self._play_audio(response.content)

    def _speak_elevenlabs(self, text: str) -> None:
        """ElevenLabs TTS — high-quality voice synthesis."""
        try:
            from elevenlabs import ElevenLabs, play  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "elevenlabs package is not installed. "
                'Run: pip install "thunai[tts-elevenlabs]"'
            ) from exc

        api_key = os.environ.get(self._config.elevenlabs.api_key_env, "")
        if not api_key:
            logger.warning("ElevenLabs API key not set. Falling back to stub.")
            self._speak_stub(text)
            return

        client = ElevenLabs(api_key=api_key)
        audio = client.generate(
            text=text,
            voice=self._config.elevenlabs.voice_id,
            model=self._config.elevenlabs.model,
        )
        play(audio)

    def _speak_system(self, text: str) -> None:
        """OS system TTS via pyttsx3 — no API key required."""
        try:
            import pyttsx3  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "pyttsx3 is not installed. Run: pip install pyttsx3"
            ) from exc

        engine = pyttsx3.init()
        engine.say(text)
        engine.runAndWait()

    @staticmethod
    def _play_audio(audio_bytes: bytes) -> None:
        """Play raw audio bytes using available system audio library."""
        try:
            import io
            import sounddevice as sd  # type: ignore[import]
            import soundfile as sf  # type: ignore[import]

            data, samplerate = sf.read(io.BytesIO(audio_bytes))
            sd.play(data, samplerate)
            sd.wait()
        except ImportError:
            logger.debug("sounddevice/soundfile not installed — audio playback skipped in this environment.")
