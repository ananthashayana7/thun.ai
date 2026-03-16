from __future__ import annotations

from abc import ABC, abstractmethod


class TTSProvider(ABC):
    """Abstract TTS provider used in developer reference tests."""

    provider_name: str

    @abstractmethod
    def synthesise(self, text: str, language: str = "en-IN") -> bytes:
        ...

    def warm_cache(self, language: str = "en-IN") -> None:
        """Optional cache warmer."""
        return None

    @abstractmethod
    def is_healthy(self) -> bool:
        ...
