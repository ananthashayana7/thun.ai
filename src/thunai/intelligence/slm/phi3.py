"""
Microsoft Phi-3 Mini on-device SLM provider.

Runs GGUF model files directly on the device via llama-cpp-python.
This is the primary real-time inference path when running on the phone
NPU or a Rockchip SoC.

Install optional dependency:
    pip install llama-cpp-python

Download model (example):
    huggingface-cli download microsoft/Phi-3-mini-4k-instruct-gguf \
        Phi-3-mini-4k-instruct-q4.gguf \
        --local-dir models/local/
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from thunai.config import Phi3Config
from thunai.intelligence.base import BaseSLMProvider, SLMResponse

logger = logging.getLogger(__name__)

_CHAT_TEMPLATE = "<|user|>\n{prompt}<|end|>\n<|assistant|>\n"


class Phi3Provider(BaseSLMProvider):
    """
    Microsoft Phi-3 Mini — on-device inference via llama-cpp-python.

    Falls back gracefully with an informative error if the GGUF file is
    missing or llama-cpp-python is not installed.
    """

    def __init__(self, config: Phi3Config) -> None:
        self._config = config
        self._llm: object | None = None

    @property
    def provider_name(self) -> str:
        return "phi3"

    @property
    def model_name(self) -> str:
        return "phi-3-mini"

    def is_available(self) -> bool:
        if not Path(self._config.model_path).exists():
            return False
        try:
            from llama_cpp import Llama  # noqa: F401  # type: ignore[import]

            return True
        except ImportError:
            return False

    def _load(self) -> object:
        if self._llm is None:
            try:
                from llama_cpp import Llama  # type: ignore[import]
            except ImportError as exc:
                raise ImportError(
                    "llama-cpp-python is not installed. "
                    "Run: pip install llama-cpp-python"
                ) from exc

            model_path = self._config.model_path
            if not Path(model_path).exists():
                raise FileNotFoundError(
                    f"Phi-3 model not found at {model_path!r}. "
                    "Download it from Hugging Face and place it in models/local/."
                )

            logger.info("Loading Phi-3 model from %s …", model_path)
            self._llm = Llama(
                model_path=model_path,
                n_ctx=self._config.n_ctx,
                n_threads=self._config.n_threads,
                verbose=False,
            )
            logger.info("Phi-3 model loaded.")
        return self._llm

    def generate(
        self,
        prompt: str,
        *,
        max_tokens: int = 128,
        temperature: float = 0.3,
    ) -> SLMResponse:
        llm = self._load()
        formatted = _CHAT_TEMPLATE.format(prompt=prompt)

        start = time.monotonic()
        output = llm(  # type: ignore[operator]
            formatted,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=["<|end|>", "<|user|>"],
        )
        latency_ms = (time.monotonic() - start) * 1000

        text = output["choices"][0]["text"].strip()
        return SLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
            latency_ms=latency_ms,
            metadata={"tokens_evaluated": output.get("usage", {}).get("completion_tokens", 0)},
        )
