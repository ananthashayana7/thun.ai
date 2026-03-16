"""
Abstract base classes for all AI model providers.

All providers share a common interface so they are hot-swappable:
  - swap Gemini → Phi-3 on-device with a single config change
  - swap cloud TTS → local TTS the same way
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Optional


@dataclass
class Message:
    """A single turn in a conversation."""

    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SLMResponse:
    text: str
    provider: str
    model: str
    latency_ms: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class VLMResponse:
    text: str
    provider: str
    model: str
    detected_objects: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseLLMProvider(ABC):
    """
    Cloud Large Language Model provider.

    Used for post-drive feedback generation, synthetic data augmentation,
    and the AI Therapist feature.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @abstractmethod
    def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResponse:
        """Generate a response from a list of messages."""

    def is_available(self) -> bool:
        """Return True if the provider is reachable / configured."""
        return True


class BaseSLMProvider(ABC):
    """
    On-Device Small Language Model provider.

    Used for real-time IVIS intervention with zero-latency requirements.
    The SLM runs locally on the device (phone NPU or Rockchip SoC).
    """

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        max_tokens: int = 128,
        temperature: float = 0.3,
    ) -> SLMResponse:
        """Generate a short, low-latency response from a plain prompt."""

    def is_available(self) -> bool:
        """Return True if the local model is loaded and ready."""
        return True


class BaseVLMProvider(ABC):
    """
    Vision Language Model provider.

    Combines camera frame analysis with language understanding to provide
    scene semantics that back the SLM decision-making.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @abstractmethod
    def describe_scene(
        self,
        image_bytes: bytes,
        prompt: str = "Describe what is happening on the road in this image.",
    ) -> VLMResponse:
        """Analyse a camera frame and return a scene description."""

    def is_available(self) -> bool:
        """Return True if the provider is reachable / configured."""
        return True


# ───────────────────────────────────────────────────────────────────────────────
# Developer reference interfaces (v1)
# ───────────────────────────────────────────────────────────────────────────────


class LLMProvider(ABC):
    """Cloud LLM — used for post-drive reports and AI Therapist sessions."""

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @abstractmethod
    def complete(
        self,
        system: str,
        user: str,
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> str:
        """Synchronous completion. Returns full response string."""

    @abstractmethod
    async def complete_stream(
        self, system: str, user: str, max_tokens: int = 1024
    ) -> AsyncGenerator[str, None]:
        """Async streaming generator yielding text chunks."""

    @abstractmethod
    def is_healthy(self) -> bool:
        """Returns True if the provider API is reachable."""


class SLMProvider(ABC):
    """On-device SLM — must return within the IVIS latency budget."""

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @abstractmethod
    def infer(
        self, prompt: str, max_tokens: int = 128, temperature: float = 0.3
    ) -> str:
        """Synchronous local inference. MUST complete < 500ms."""

    @abstractmethod
    def is_healthy(self) -> bool:
        """Returns True if the provider is reachable."""


class VLMProvider(ABC):
    """Vision LLM — processes image frames for scene understanding."""

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @abstractmethod
    def describe_scene(self, image_bytes: bytes, prompt: str) -> str:
        """Describe a camera frame given a text prompt."""

    @abstractmethod
    def is_healthy(self) -> bool:
        """Returns True if the provider is reachable."""
