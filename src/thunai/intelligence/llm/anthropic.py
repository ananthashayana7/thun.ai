from __future__ import annotations

from types import SimpleNamespace

try:
    import anthropic  # type: ignore[import]
except ImportError:  # pragma: no cover - optional dependency
    class _MissingAnthropic:
        def __init__(self, *_, **__):
            raise ImportError("anthropic package is required for AnthropicLLM")

    anthropic = SimpleNamespace(Anthropic=_MissingAnthropic)  # type: ignore

from thunai.intelligence.base import LLMProvider


class AnthropicLLM(LLMProvider):
    provider_name = "anthropic"

    def __init__(self, cfg: dict):
        self.client = anthropic.Anthropic(api_key=cfg["api_key"])
        self.model = cfg["model"]
        self.max_tok = cfg.get("max_tokens", 1024)
        self.temp = cfg.get("temperature", 0.7)
        self.timeout = cfg.get("timeout_s", 30)

    def complete(
        self,
        system: str,
        user: str,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        msg = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens or self.max_tok,
            temperature=temperature or self.temp,
            system=system,
            messages=[{"role": "user", "content": user}],
            timeout=self.timeout,
        )
        return msg.content[0].text

    async def complete_stream(
        self, system: str, user: str, max_tokens: int = 1024
    ):
        with self.client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        ) as stream:
            for chunk in stream.text_stream:
                yield chunk

    def is_healthy(self) -> bool:
        try:
            self.client.messages.create(
                model=self.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "ping"}],
            )
            return True
        except Exception:
            return False
