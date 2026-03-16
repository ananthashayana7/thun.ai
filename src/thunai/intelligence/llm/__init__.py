"""LLM provider package."""

from thunai.intelligence.llm.anthropic import AnthropicLLM
from thunai.intelligence.llm.factory import create_llm_provider
from thunai.intelligence.llm.gemini import GeminiLLM, GeminiProvider
from thunai.intelligence.llm.openai import OpenAILLM
from thunai.intelligence.llm.openai_provider import OpenAIProvider
from thunai.intelligence.llm.stub import StubLLMProvider


def build_llm_provider(cfg: dict):
    """
    Factory used by the developer reference tests/spec.
    Accepts the full config dict (with ``intelligence.llm``) or the llm section.
    """
    llm_cfg = cfg.get("intelligence", {}).get("llm") if "intelligence" in cfg else cfg
    provider = llm_cfg["provider"]
    if provider == "anthropic":
        return AnthropicLLM(llm_cfg["anthropic"])
    if provider == "gemini":
        return GeminiLLM(llm_cfg["gemini"])
    if provider == "openai":
        return OpenAILLM(llm_cfg["openai"])
    raise ValueError(f"Unknown LLM provider: {provider}")


__all__ = [
    "create_llm_provider",
    "GeminiProvider",
    "OpenAIProvider",
    "StubLLMProvider",
    "AnthropicLLM",
    "GeminiLLM",
    "OpenAILLM",
    "build_llm_provider",
]
