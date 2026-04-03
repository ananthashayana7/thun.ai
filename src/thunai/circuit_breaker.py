"""
Circuit Breaker pattern for external API calls.

Prevents cascading failures when external services (Ollama, Sarvam,
ElevenLabs, Gemini) are unavailable. Implements the standard
closed → open → half-open → closed state machine.

Usage:
    breaker = CircuitBreaker("sarvam", failure_threshold=5, timeout=300)
    result = breaker.call(my_api_function, arg1, arg2)
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half-open"


class CircuitBreakerOpenError(Exception):
    """Raised when the circuit breaker is open and calls are rejected."""

    def __init__(self, provider: str, retry_after: float = 0.0) -> None:
        self.provider = provider
        self.retry_after = retry_after
        super().__init__(
            f"Circuit breaker OPEN for {provider}. "
            f"Retry after {retry_after:.0f}s."
        )


@dataclass
class CircuitBreakerStats:
    """Snapshot of circuit breaker state for health endpoints."""

    provider: str
    state: CircuitState
    failures: int
    threshold: int
    last_failure_time: float | None
    last_success_time: float | None
    timeout_seconds: float


class CircuitBreaker:
    """
    Thread-safe circuit breaker for external API calls.

    Parameters
    ----------
    provider :
        Human-readable name of the external service (e.g. "sarvam", "ollama").
    failure_threshold :
        Number of consecutive failures before opening the circuit.
    timeout :
        Seconds to wait before attempting recovery (half-open state).
    """

    def __init__(
        self,
        provider: str,
        failure_threshold: int = 5,
        timeout: float = 300.0,
    ) -> None:
        self.provider = provider
        self.failure_threshold = failure_threshold
        self.timeout = timeout

        self._state = CircuitState.CLOSED
        self._failures = 0
        self._last_failure_time: float | None = None
        self._last_success_time: float | None = None
        self._lock = threading.Lock()

    @property
    def state(self) -> CircuitState:
        with self._lock:
            return self._state

    @property
    def failures(self) -> int:
        with self._lock:
            return self._failures

    def get_stats(self) -> CircuitBreakerStats:
        """Return a snapshot of the breaker state for health checks."""
        with self._lock:
            return CircuitBreakerStats(
                provider=self.provider,
                state=self._state,
                failures=self._failures,
                threshold=self.failure_threshold,
                last_failure_time=self._last_failure_time,
                last_success_time=self._last_success_time,
                timeout_seconds=self.timeout,
            )

    def call(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """
        Execute ``func`` through the circuit breaker.

        Raises
        ------
        CircuitBreakerOpenError
            If the circuit is open and the timeout has not elapsed.
        """
        with self._lock:
            if self._state == CircuitState.OPEN:
                elapsed = time.time() - (self._last_failure_time or 0)
                if elapsed > self.timeout:
                    logger.info(
                        "[CircuitBreaker] %s: attempting recovery (half-open)",
                        self.provider,
                    )
                    self._state = CircuitState.HALF_OPEN
                else:
                    retry_after = self.timeout - elapsed
                    logger.warning(
                        "[CircuitBreaker] %s: OPEN, skipping call (retry in %.0fs)",
                        self.provider,
                        retry_after,
                    )
                    raise CircuitBreakerOpenError(self.provider, retry_after)

        # Execute the function outside the lock
        try:
            result = func(*args, **kwargs)
        except Exception as exc:
            self._record_failure(exc)
            raise

        self._record_success()
        return result

    async def call_async(
        self, func: Callable[..., Any], *args: Any, **kwargs: Any
    ) -> Any:
        """
        Execute an async ``func`` through the circuit breaker.

        Same semantics as ``call()`` but for coroutines.
        """
        with self._lock:
            if self._state == CircuitState.OPEN:
                elapsed = time.time() - (self._last_failure_time or 0)
                if elapsed > self.timeout:
                    logger.info(
                        "[CircuitBreaker] %s: attempting recovery (half-open)",
                        self.provider,
                    )
                    self._state = CircuitState.HALF_OPEN
                else:
                    retry_after = self.timeout - elapsed
                    raise CircuitBreakerOpenError(self.provider, retry_after)

        try:
            result = await func(*args, **kwargs)
        except Exception as exc:
            self._record_failure(exc)
            raise

        self._record_success()
        return result

    def _record_failure(self, error: Exception) -> None:
        with self._lock:
            self._failures += 1
            self._last_failure_time = time.time()

            if self._failures >= self.failure_threshold:
                old_state = self._state
                self._state = CircuitState.OPEN
                if old_state != CircuitState.OPEN:
                    logger.error(
                        "[CircuitBreaker] %s: OPEN after %d failures: %s",
                        self.provider,
                        self._failures,
                        str(error),
                    )
            else:
                logger.warning(
                    "[CircuitBreaker] %s: failure %d/%d: %s",
                    self.provider,
                    self._failures,
                    self.failure_threshold,
                    str(error),
                )

    def _record_success(self) -> None:
        with self._lock:
            if self._failures > 0 or self._state != CircuitState.CLOSED:
                logger.info(
                    "[CircuitBreaker] %s: recovered (state=%s → closed, "
                    "failures reset from %d)",
                    self.provider,
                    self._state.value,
                    self._failures,
                )
            self._failures = 0
            self._state = CircuitState.CLOSED
            self._last_success_time = time.time()

    def reset(self) -> None:
        """Manually reset the circuit breaker (e.g. from admin endpoint)."""
        with self._lock:
            self._failures = 0
            self._state = CircuitState.CLOSED
            logger.info("[CircuitBreaker] %s: manually reset", self.provider)


# ── Global registry for all circuit breakers ──────────────────────────────────

_registry: dict[str, CircuitBreaker] = {}
_registry_lock = threading.Lock()


def get_breaker(
    provider: str,
    failure_threshold: int = 5,
    timeout: float = 300.0,
) -> CircuitBreaker:
    """Get or create a circuit breaker for the given provider."""
    with _registry_lock:
        if provider not in _registry:
            _registry[provider] = CircuitBreaker(
                provider, failure_threshold, timeout
            )
        return _registry[provider]


def get_all_breaker_stats() -> list[CircuitBreakerStats]:
    """Return stats for all registered breakers (for /health/providers)."""
    with _registry_lock:
        return [breaker.get_stats() for breaker in _registry.values()]


def reset_all_breakers() -> None:
    """Reset all circuit breakers (for testing or admin)."""
    with _registry_lock:
        for breaker in _registry.values():
            breaker.reset()
