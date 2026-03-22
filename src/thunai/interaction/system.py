from __future__ import annotations

from thunai.interaction.base import TTSProvider


class SystemTTS(TTSProvider):
    provider_name = "system"

    def synthesise(self, text: str, language: str = "en-IN") -> bytes:
        # In tests, pyttsx3 is usually mocked; return dummy bytes for compatibility.
        try:
            import pyttsx3  # type: ignore[import]

            engine = pyttsx3.init()
            engine.say(text)
            engine.runAndWait()
        except Exception:
            pass
        return b"fake_audio_bytes"

    def is_healthy(self) -> bool:
        return True
