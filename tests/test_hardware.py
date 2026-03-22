from __future__ import annotations

from thunai.config import HardwareConfig
from thunai.hardware import HardwareMonitor


def test_hardware_ready_with_all_inputs():
    monitor = HardwareMonitor(HardwareConfig(disconnect_timeout_seconds=2.0, latency_budget_ms=50.0))
    monitor.tick_obd(latency_ms=10.0, now=1.0)
    monitor.tick_biometrics(latency_ms=12.0, now=1.0)
    monitor.tick_camera(latency_ms=15.0, now=1.0)

    report = monitor.assess(now=2.0)
    assert report.status == "ready"
    assert report.plug_and_play is True
    assert report.latency_guard_passed is True
    assert report.effective_stress_inputs == ["obd", "biometrics", "vision"]


def test_fallback_when_obd_drops():
    monitor = HardwareMonitor(HardwareConfig(disconnect_timeout_seconds=2.0))
    monitor.tick_obd(now=0.0)  # stale
    monitor.tick_biometrics(now=2.9)
    monitor.tick_camera(now=2.9)

    # Past the disconnect threshold for OBD only
    report = monitor.assess(now=3.1)
    assert report.status == "degraded"
    assert not report.plug_and_play
    assert "obd" not in report.available_inputs
    assert report.effective_stress_inputs == ["biometrics", "vision"]
    assert any("OBD-2" in fault for fault in report.faults)


def test_fallback_when_camera_drops():
    monitor = HardwareMonitor(HardwareConfig(disconnect_timeout_seconds=2.0))
    monitor.tick_obd(now=0.0)
    monitor.tick_biometrics(now=0.0)

    # Camera never seen -> degraded but still operational with OBD + biometrics
    report = monitor.assess(now=0.5)
    assert report.status == "degraded"
    assert report.effective_stress_inputs == ["obd", "biometrics"]
    assert any("Camera" in fault for fault in report.faults)
