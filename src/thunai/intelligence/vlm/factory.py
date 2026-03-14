"""Factory function for creating VLM providers from configuration."""

from __future__ import annotations

import logging

from thunai.config import VLMConfig
from thunai.intelligence.base import BaseVLMProvider

logger = logging.getLogger(__name__)


def create_vlm_provider(config: VLMConfig) -> BaseVLMProvider:
    """Instantiate the configured VLM provider."""
    provider = config.provider.lower()

    if provider == "gemini":
        from thunai.intelligence.vlm.gemini import GeminiVLMProvider

        vlm = GeminiVLMProvider(config.gemini)
        if vlm.is_available():
            logger.info("VLM provider: Gemini")
            return vlm
        logger.warning("Gemini VLM not available. Falling back to stub.")

    elif provider == "ollama":
        from thunai.intelligence.vlm.ollama import OllamaVLMProvider

        vlm = OllamaVLMProvider(config.ollama)
        if vlm.is_available():
            logger.info("VLM provider: Ollama (%s)", config.ollama.model)
            return vlm
        logger.warning(
            "Ollama VLM not reachable at %s. Falling back to stub.",
            config.ollama.base_url,
        )

    elif provider != "stub":
        raise ValueError(
            f"Unknown VLM provider {provider!r}. "
            "Valid options: gemini | ollama | stub"
        )

    from thunai.intelligence.vlm.stub import StubVLMProvider

    logger.info("VLM provider: Stub (offline / testing)")
    return StubVLMProvider()
