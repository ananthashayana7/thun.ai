"""Factory function for creating SLM providers from configuration."""

from __future__ import annotations

import logging

from thunai.config import SLMConfig
from thunai.intelligence.base import BaseSLMProvider

logger = logging.getLogger(__name__)


def create_slm_provider(config: SLMConfig) -> BaseSLMProvider:
    """
    Instantiate the configured SLM provider.

    Resolution order when the configured provider is unavailable:
      1. Configured provider (ollama / phi3 / mistral)
      2. Stub (always available — used in dev/testing)

    Parameters
    ----------
    config:
        The SLM section of :class:`ThunaiConfig`.
    """
    provider = config.provider.lower()

    if provider == "ollama":
        from thunai.intelligence.slm.ollama import OllamaSLMProvider

        slm = OllamaSLMProvider(config.ollama)
        if slm.is_available():
            logger.info("SLM provider: Ollama (%s)", config.ollama.model)
            return slm
        logger.warning(
            "Ollama server not reachable at %s. Falling back to stub.",
            config.ollama.base_url,
        )

    elif provider == "phi3":
        from thunai.intelligence.slm.phi3 import Phi3Provider

        slm = Phi3Provider(config.phi3)
        if slm.is_available():
            logger.info("SLM provider: Phi-3 (on-device)")
            return slm
        logger.warning(
            "Phi-3 model not available at %s. Falling back to stub.",
            config.phi3.model_path,
        )

    elif provider == "mistral":
        from thunai.intelligence.slm.ollama import OllamaSLMProvider
        from thunai.config import OllamaConfig

        mistral_config = OllamaConfig(
            base_url=config.ollama.base_url,
            model="mistral:7b-instruct",
            timeout_seconds=config.ollama.timeout_seconds,
        )
        slm = OllamaSLMProvider(mistral_config)
        if slm.is_available():
            logger.info("SLM provider: Mistral (via Ollama)")
            return slm
        logger.warning("Mistral not available via Ollama. Falling back to stub.")

    elif provider != "stub":
        raise ValueError(
            f"Unknown SLM provider {provider!r}. "
            "Valid options: ollama | phi3 | mistral | stub"
        )

    from thunai.intelligence.slm.stub import StubSLMProvider

    logger.info("SLM provider: Stub (offline / testing)")
    return StubSLMProvider()
