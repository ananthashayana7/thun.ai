"""
Google Gemini LLM provider.

Wraps the ``google-generativeai`` SDK with the BaseLLMProvider interface.
Install the optional dependency:  pip install "thunai[llm-gemini]"
"""

from __future__ import annotations

import logging
import os
from types import SimpleNamespace

from thunai.config import GeminiConfig
from thunai.intelligence.base import BaseLLMProvider, LLMProvider, LLMResponse, Message

try:
    import google.generativeai as _genai  # type: ignore[import]
except ImportError:  # pragma: no cover - optional dependency
    _genai = SimpleNamespace(
        GenerativeModel=lambda *_, **__: (_ for _ in ()).throw(
            ImportError("google-generativeai is required for GeminiLLM")
        ),
        GenerationConfig=lambda *_, **__: {},
        configure=lambda *_, **__: None,
    )

logger = logging.getLogger(__name__)


class GeminiProvider(BaseLLMProvider):
    """
    Google Gemini provider (Flash for feedback, Pro for Therapist).

    The model selection is automatic:
      - Use ``model`` (Flash) for high-volume, low-cost tasks
      - Use ``pro_model`` when deeper reasoning is needed (Therapist)
    """

    def __init__(self, config: GeminiConfig, *, use_pro: bool = False) -> None:
        self._config = config
        self._use_pro = use_pro
        self._client: object | None = None

    @property
    def provider_name(self) -> str:
        return "gemini"

    @property
    def model_name(self) -> str:
        return self._config.pro_model if self._use_pro else self._config.model

    def _get_client(self) -> object:
        if self._client is None:
            try:
                import google.generativeai as genai  # type: ignore[import]
            except ImportError as exc:
                raise ImportError(
                    "google-generativeai is not installed. "
                    'Run: pip install "thunai[llm-gemini]"'
                ) from exc

            api_key = os.environ.get(self._config.api_key_env, "")
            if not api_key:
                raise EnvironmentError(
                    f"Gemini API key not found. Set the {self._config.api_key_env!r} "
                    "environment variable."
                )
            genai.configure(api_key=api_key)
            self._client = genai.GenerativeModel(self.model_name)
        return self._client

    def is_available(self) -> bool:
        api_key = os.environ.get(self._config.api_key_env, "")
        if not api_key:
            return False
        try:
            import google.generativeai  # noqa: F401  # type: ignore[import]

            return True
        except ImportError:
            return False

    def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResponse:
        client = self._get_client()

        history = []
        system_prompt: str | None = None
        for msg in messages:
            if msg.role == "system":
                system_prompt = msg.content
            elif msg.role == "user":
                history.append({"role": "user", "parts": [msg.content]})
            elif msg.role == "assistant":
                history.append({"role": "model", "parts": [msg.content]})

        final_prompt = history[-1]["parts"][0] if history else ""
        if system_prompt:
            final_prompt = f"{system_prompt}\n\n{final_prompt}"

        gen_config = {
            "max_output_tokens": max_tokens or self._config.max_output_tokens,
            "temperature": temperature if temperature is not None else self._config.temperature,
        }

        response = client.generate_content(  # type: ignore[union-attr]
            final_prompt,
            generation_config=gen_config,
        )

        text = response.text or ""
        usage = getattr(response, "usage_metadata", None)
        input_tokens = getattr(usage, "prompt_token_count", 0) if usage else 0
        output_tokens = getattr(usage, "candidates_token_count", 0) if usage else 0

        return LLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )


# Developer reference implementation (v1)
class GeminiLLM(LLMProvider):
    provider_name = "gemini"

    def __init__(self, cfg: dict):
        genai = _genai
        try:
            genai.configure(api_key=cfg["api_key"])
        except Exception:
            # if configure is stubbed, ignore
            pass
        self.model_name = cfg["model"]
        self.model = genai.GenerativeModel(
            model_name=self.model_name,
            generation_config=genai.GenerationConfig(
                max_output_tokens=cfg.get("max_tokens", 1024),
                temperature=cfg.get("temperature", 0.7),
            ),
        )

    def complete(self, system: str, user: str, **kwargs) -> str:
        prompt = f"{system}\n\n{user}" if system else user
        response = self.model.generate_content(prompt)
        return response.text

    async def complete_stream(self, system: str, user: str, **kwargs):
        prompt = f"{system}\n\n{user}" if system else user
        for chunk in self.model.generate_content(prompt, stream=True):
            if chunk.text:
                yield chunk.text

    def is_healthy(self) -> bool:
        try:
            self.complete("", "ping")
            return True
        except Exception:
            return False
