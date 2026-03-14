"""SLM provider package."""

from thunai.intelligence.slm.factory import create_slm_provider
from thunai.intelligence.slm.ollama import OllamaSLMProvider
from thunai.intelligence.slm.phi3 import Phi3Provider
from thunai.intelligence.slm.stub import StubSLMProvider

__all__ = [
    "create_slm_provider",
    "OllamaSLMProvider",
    "Phi3Provider",
    "StubSLMProvider",
]
