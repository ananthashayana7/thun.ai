"""VLM provider package."""

from thunai.intelligence.vlm.factory import create_vlm_provider
from thunai.intelligence.vlm.gemini import GeminiVLM, GeminiVLMProvider
from thunai.intelligence.vlm.ollama import LLaVAOllamaVLM, OllamaVLMProvider
from thunai.intelligence.vlm.stub import StubVLM, StubVLMProvider


def build_vlm_provider(cfg: dict):
    vlm_cfg = cfg.get("intelligence", {}).get("vlm") if "intelligence" in cfg else cfg
    provider = vlm_cfg["provider"]
    if provider == "gemini":
        return GeminiVLM(vlm_cfg["gemini"])
    if provider in ("llava_ollama", "ollama"):
        return LLaVAOllamaVLM(vlm_cfg["llava_ollama"] if "llava_ollama" in vlm_cfg else vlm_cfg["ollama"])
    if provider == "stub":
        return StubVLM()
    raise ValueError(f"Unknown VLM provider: {provider}")


__all__ = [
    "create_vlm_provider",
    "GeminiVLMProvider",
    "OllamaVLMProvider",
    "StubVLMProvider",
    "GeminiVLM",
    "LLaVAOllamaVLM",
    "StubVLM",
    "build_vlm_provider",
]
