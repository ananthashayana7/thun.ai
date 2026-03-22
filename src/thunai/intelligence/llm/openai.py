from __future__ import annotations

from types import SimpleNamespace

try:
    from openai import OpenAI  # type: ignore[import]
except ImportError:  # pragma: no cover - optional dependency
    class _MissingOpenAI:
        def __init__(self, *_, **__):
            raise ImportError("openai package is required for OpenAILLM")

    OpenAI = _MissingOpenAI  # type: ignore

from thunai.intelligence.base import LLMProvider


class OpenAILLM(LLMProvider):
    provider_name = "openai"

    def __init__(self, cfg: dict):
        self.client = OpenAI(api_key=cfg["api_key"])
        self.model = cfg["model"]
        self.max_tok = cfg.get("max_tokens", 1024)
        self.temp = cfg.get("temperature", 0.7)

    def complete(self, system: str, user: str, **kwargs) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=self.max_tok,
            temperature=self.temp,
        )
        return resp.choices[0].message.content

    async def complete_stream(self, system: str, user: str, **kwargs):
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        stream = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            max_tokens=self.max_tok,
            temperature=self.temp,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    def is_healthy(self) -> bool:
        try:
            self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            return True
        except Exception:
            return False
