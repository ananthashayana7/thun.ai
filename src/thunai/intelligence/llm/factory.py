"""Factory function for creating LLM providers from configuration."""

from __future__ import annotations

import logging

from thunai.config import LLMConfig
from thunai.intelligence.base import BaseLLMProvider

logger = logging.getLogger(__name__)


def create_llm_provider(config: LLMConfig, *, use_pro: bool = False) -> BaseLLMProvider:
    """
    Instantiate the configured LLM provider.

    Parameters
    ----------
    config:
        The LLM section of :class:`ThunaiConfig`.
    use_pro:
        When ``True`` and the provider is Gemini, select the Pro model
        (used for the AI Therapist feature).
    """
    provider = config.provider.lower()

    if provider == "gemini":
        from thunai.intelligence.llm.gemini import GeminiProvider

        logger.info("LLM provider: Gemini (%s)", "pro" if use_pro else "flash")
        return GeminiProvider(config.gemini, use_pro=use_pro)

    if provider == "openai":
        from thunai.intelligence.llm.openai_provider import OpenAIProvider

        logger.info("LLM provider: OpenAI (%s)", config.openai.model)
        return OpenAIProvider(config.openai)

    if provider == "stub":
        from thunai.intelligence.llm.stub import StubLLMProvider

        logger.info("LLM provider: Stub (offline / testing)")
        return StubLLMProvider()

    raise ValueError(
        f"Unknown LLM provider {provider!r}. "
        "Valid options: gemini | openai | stub"
    )
