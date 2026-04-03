"""Tests for the circuit breaker module."""

from __future__ import annotations

import threading
import time
from unittest.mock import patch

import pytest

from thunai.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerOpenError,
    CircuitBreakerStats,
    CircuitState,
    get_all_breaker_stats,
    get_breaker,
    reset_all_breakers,
    _registry,
    _registry_lock,
)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Reset the global registry before each test."""
    with _registry_lock:
        _registry.clear()
    yield
    with _registry_lock:
        _registry.clear()


class TestCircuitBreakerStates:
    """Test the state machine: closed → open → half-open → closed."""

    def test_initial_state_is_closed(self):
        cb = CircuitBreaker("test-svc", failure_threshold=3, timeout=10)
        assert cb.state == CircuitState.CLOSED
        assert cb.failures == 0

    def test_closed_to_open_after_threshold_failures(self):
        cb = CircuitBreaker("test-svc", failure_threshold=3, timeout=10)

        for i in range(3):
            with pytest.raises(ValueError):
                cb.call(self._failing_func)

        assert cb.state == CircuitState.OPEN
        assert cb.failures == 3

    def test_open_rejects_calls_immediately(self):
        cb = CircuitBreaker("test-svc", failure_threshold=2, timeout=60)

        # Trip the breaker
        for _ in range(2):
            with pytest.raises(ValueError):
                cb.call(self._failing_func)

        assert cb.state == CircuitState.OPEN

        # Subsequent calls should raise CircuitBreakerOpenError
        with pytest.raises(CircuitBreakerOpenError) as exc_info:
            cb.call(lambda: "should not run")

        assert exc_info.value.provider == "test-svc"
        assert exc_info.value.retry_after > 0

    def test_open_to_half_open_after_timeout(self):
        cb = CircuitBreaker("test-svc", failure_threshold=2, timeout=0.1)

        # Trip the breaker
        for _ in range(2):
            with pytest.raises(ValueError):
                cb.call(self._failing_func)

        assert cb.state == CircuitState.OPEN

        # Wait for timeout to elapse
        time.sleep(0.15)

        # Next call should transition to half-open and attempt the function
        result = cb.call(lambda: "recovered")
        assert result == "recovered"
        assert cb.state == CircuitState.CLOSED

    def test_half_open_to_closed_on_success(self):
        cb = CircuitBreaker("test-svc", failure_threshold=2, timeout=0.1)

        # Trip the breaker
        for _ in range(2):
            with pytest.raises(ValueError):
                cb.call(self._failing_func)

        time.sleep(0.15)

        # Success in half-open state → closed
        result = cb.call(lambda: "ok")
        assert result == "ok"
        assert cb.state == CircuitState.CLOSED
        assert cb.failures == 0

    def test_half_open_to_open_on_failure(self):
        cb = CircuitBreaker("test-svc", failure_threshold=2, timeout=0.1)

        # Trip the breaker
        for _ in range(2):
            with pytest.raises(ValueError):
                cb.call(self._failing_func)

        time.sleep(0.15)

        # Failure in half-open state → open again
        with pytest.raises(ValueError):
            cb.call(self._failing_func)

        assert cb.state == CircuitState.OPEN

    def test_successful_calls_reset_failure_count(self):
        cb = CircuitBreaker("test-svc", failure_threshold=5, timeout=10)

        # Record some failures but not enough to open
        for _ in range(3):
            with pytest.raises(ValueError):
                cb.call(self._failing_func)

        assert cb.failures == 3

        # A success resets everything
        cb.call(lambda: "ok")
        assert cb.failures == 0
        assert cb.state == CircuitState.CLOSED

    @staticmethod
    def _failing_func():
        raise ValueError("simulated failure")


class TestCircuitBreakerStats:
    """Test the get_stats method."""

    def test_get_stats_returns_correct_snapshot(self):
        cb = CircuitBreaker("my-provider", failure_threshold=5, timeout=300)
        stats = cb.get_stats()

        assert isinstance(stats, CircuitBreakerStats)
        assert stats.provider == "my-provider"
        assert stats.state == CircuitState.CLOSED
        assert stats.failures == 0
        assert stats.threshold == 5
        assert stats.timeout_seconds == 300
        assert stats.last_failure_time is None
        assert stats.last_success_time is None

    def test_stats_reflect_failures(self):
        cb = CircuitBreaker("svc", failure_threshold=3, timeout=10)

        with pytest.raises(RuntimeError):
            cb.call(lambda: (_ for _ in ()).throw(RuntimeError("fail")))

        stats = cb.get_stats()
        assert stats.failures == 1
        assert stats.last_failure_time is not None

    def test_stats_reflect_success(self):
        cb = CircuitBreaker("svc", failure_threshold=3, timeout=10)
        cb.call(lambda: "ok")
        stats = cb.get_stats()
        assert stats.last_success_time is not None
        assert stats.failures == 0


class TestManualReset:
    """Test manual reset functionality."""

    def test_reset_clears_failures_and_closes_circuit(self):
        cb = CircuitBreaker("svc", failure_threshold=2, timeout=60)

        for _ in range(2):
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("err")))

        assert cb.state == CircuitState.OPEN

        cb.reset()
        assert cb.state == CircuitState.CLOSED
        assert cb.failures == 0

    def test_reset_allows_calls_again(self):
        cb = CircuitBreaker("svc", failure_threshold=2, timeout=60)

        for _ in range(2):
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("err")))

        cb.reset()

        result = cb.call(lambda: "after reset")
        assert result == "after reset"


class TestThreadSafety:
    """Test concurrent access to the circuit breaker."""

    def test_concurrent_calls_dont_corrupt_state(self):
        cb = CircuitBreaker("thread-svc", failure_threshold=50, timeout=10)
        errors = []

        def worker(success: bool):
            try:
                if success:
                    cb.call(lambda: "ok")
                else:
                    try:
                        cb.call(lambda: (_ for _ in ()).throw(RuntimeError("fail")))
                    except (RuntimeError, CircuitBreakerOpenError):
                        pass
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(20):
            t = threading.Thread(target=worker, args=(i % 2 == 0,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        assert len(errors) == 0
        # State should be valid
        assert cb.state in (CircuitState.CLOSED, CircuitState.OPEN, CircuitState.HALF_OPEN)


class TestGlobalRegistry:
    """Test get_breaker, get_all_breaker_stats, reset_all_breakers."""

    def test_get_breaker_creates_new_breaker(self):
        breaker = get_breaker("new-svc")
        assert isinstance(breaker, CircuitBreaker)
        assert breaker.provider == "new-svc"

    def test_get_breaker_returns_same_instance(self):
        b1 = get_breaker("shared-svc")
        b2 = get_breaker("shared-svc")
        assert b1 is b2

    def test_get_breaker_respects_custom_params(self):
        breaker = get_breaker("custom-svc", failure_threshold=10, timeout=600)
        assert breaker.failure_threshold == 10
        assert breaker.timeout == 600

    def test_get_all_breaker_stats(self):
        get_breaker("svc-a")
        get_breaker("svc-b")
        stats = get_all_breaker_stats()
        assert len(stats) == 2
        providers = {s.provider for s in stats}
        assert providers == {"svc-a", "svc-b"}

    def test_reset_all_breakers(self):
        b1 = get_breaker("svc-x", failure_threshold=2)
        b2 = get_breaker("svc-y", failure_threshold=2)

        # Trip both breakers
        for _ in range(2):
            try:
                b1.call(lambda: (_ for _ in ()).throw(ValueError("err")))
            except (ValueError, CircuitBreakerOpenError):
                pass
            try:
                b2.call(lambda: (_ for _ in ()).throw(ValueError("err")))
            except (ValueError, CircuitBreakerOpenError):
                pass

        assert b1.state == CircuitState.OPEN
        assert b2.state == CircuitState.OPEN

        reset_all_breakers()

        assert b1.state == CircuitState.CLOSED
        assert b2.state == CircuitState.CLOSED


class TestCallAsync:
    """Test async call method."""

    @pytest.mark.asyncio
    async def test_async_call_success(self):
        cb = CircuitBreaker("async-svc", failure_threshold=3, timeout=10)

        async def async_func():
            return "async result"

        result = await cb.call_async(async_func)
        assert result == "async result"
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_async_call_failure_records(self):
        cb = CircuitBreaker("async-svc", failure_threshold=3, timeout=10)

        async def failing_async():
            raise RuntimeError("async fail")

        with pytest.raises(RuntimeError):
            await cb.call_async(failing_async)

        assert cb.failures == 1

    @pytest.mark.asyncio
    async def test_async_call_rejects_when_open(self):
        cb = CircuitBreaker("async-svc", failure_threshold=2, timeout=60)

        async def failing():
            raise ValueError("err")

        for _ in range(2):
            with pytest.raises(ValueError):
                await cb.call_async(failing)

        with pytest.raises(CircuitBreakerOpenError):
            await cb.call_async(failing)
