"""SLM provider package."""

from thunai.intelligence.slm.factory import create_slm_provider
from thunai.intelligence.slm.ollama import OllamaSLM, OllamaSLMProvider
from thunai.intelligence.slm.phi3 import Phi3Provider
from thunai.intelligence.slm.stub import StubSLM, StubSLMProvider


def build_slm_provider(cfg: dict):
    slm_cfg = cfg.get("intelligence", {}).get("slm") if "intelligence" in cfg else cfg
    provider = slm_cfg["provider"]
    if provider == "ollama":
        return OllamaSLM(slm_cfg["ollama"])
    if provider in ("phi3_onnx", "phi3"):
        # Minimal stub implementation until ONNX runtime is required
        return StubSLM()
    if provider == "stub":
        return StubSLM(slm_cfg.get("stub", {}))
    raise ValueError(f"Unknown SLM provider: {provider}")


__all__ = [
    "create_slm_provider",
    "OllamaSLMProvider",
    "Phi3Provider",
    "StubSLMProvider",
    "OllamaSLM",
    "StubSLM",
    "build_slm_provider",
]
