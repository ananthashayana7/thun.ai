"""
OpenAI-compatible LLM provider.

Works with OpenAI API and any OpenAI-compatible endpoint
(e.g., local LM Studio, vLLM, Together AI).

Install the optional dependency:  pip install "thunai[llm-openai]"
"""

from __future__ import annotations

import logging
import os

from thunai.config import OpenAIConfig
from thunai.intelligence.base import BaseLLMProvider, LLMResponse, Message

logger = logging.getLogger(__name__)


class OpenAIProvider(BaseLLMProvider):
    """OpenAI-compatible LLM (GPT-4o-mini by default)."""

    def __init__(self, config: OpenAIConfig) -> None:
        self._config = config
        self._client: object | None = None

    @property
    def provider_name(self) -> str:
        return "openai"

    @property
    def model_name(self) -> str:
        return self._config.model

    def _get_client(self) -> object:
        if self._client is None:
            try:
                from openai import OpenAI  # type: ignore[import]
            except ImportError as exc:
                raise ImportError(
                    "openai is not installed. "
                    'Run: pip install "thunai[llm-openai]"'
                ) from exc

            api_key = os.environ.get(self._config.api_key_env, "")
            if not api_key:
                raise EnvironmentError(
                    f"OpenAI API key not found. Set the {self._config.api_key_env!r} "
                    "environment variable."
                )
            self._client = OpenAI(api_key=api_key)
        return self._client

    def is_available(self) -> bool:
        api_key = os.environ.get(self._config.api_key_env, "")
        if not api_key:
            return False
        try:
            from openai import OpenAI  # noqa: F401  # type: ignore[import]

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

        openai_messages = [
            {"role": msg.role, "content": msg.content} for msg in messages
        ]

        response = client.chat.completions.create(  # type: ignore[union-attr]
            model=self.model_name,
            messages=openai_messages,
            max_tokens=max_tokens or self._config.max_output_tokens,
            temperature=temperature if temperature is not None else self._config.temperature,
        )

        text = response.choices[0].message.content or ""
        return LLMResponse(
            text=text,
            provider=self.provider_name,
            model=self.model_name,
            input_tokens=response.usage.prompt_tokens if response.usage else 0,
            output_tokens=response.usage.completion_tokens if response.usage else 0,
        )
