"""
thun.ai command-line interface.

Usage
-----
    thunai status          — print provider diagnostics
    thunai demo            — run a simulated drive session
"""

from __future__ import annotations

import argparse
import sys


def _cmd_status(args: argparse.Namespace) -> None:
    from thunai.engine import ThunaiEngine

    engine = ThunaiEngine.from_config()
    info = engine.get_provider_info()
    readiness = engine.get_readiness_report()
    print("thun.ai provider status")
    print("─" * 40)
    for key, value in info.items():
        print(f"  {key:<12} {value}")
    print("\nHardware readiness")
    print("─" * 40)
    print(f"  status         {readiness.status}")
    print(f"  plug_and_play  {readiness.plug_and_play}")
    print(f"  inputs         {', '.join(readiness.available_inputs) or 'none'}")
    print(f"  effective      {', '.join(readiness.effective_stress_inputs) or 'none'}")
    print(f"  latency_guard  {readiness.latency_guard_passed} (budget={readiness.latency_budget_ms}ms)")
    if readiness.faults:
        print("  faults         " + "; ".join(readiness.faults))


def _cmd_demo(args: argparse.Namespace) -> None:
    import os
    import time
    from thunai.config import load_config
    from thunai.engine import ThunaiEngine
    from thunai.features.ivis import OBDSnapshot
    from thunai.features.pre_drive import UserAnxietyProfile

    # Override LLM to stub for the demo so no API key is required
    os.environ.setdefault("THUNAI_LLM_PROVIDER", "stub")
    engine = ThunaiEngine.from_config(load_config())

    profile = UserAnxietyProfile(
        overall_score=0.6,
        heavy_traffic_sensitivity=0.7,
        night_driving_sensitivity=0.5,
        gamified_progress_level=2,
    )

    route = engine.start_session(
        origin="Koramangala, Bengaluru",
        destination="MG Road, Bengaluru",
        profile=profile,
    )
    print(f"\nSelected route: {route.route_id} (stress={route.overall_stress_score:.2f})\n")

    # Simulate a short drive (5 ticks)
    scenarios = [
        OBDSnapshot(speed_kmh=30, rpm=2000, gear=2),
        OBDSnapshot(speed_kmh=45, rpm=2500, gear=3),
        OBDSnapshot(speed_kmh=0, rpm=0, gear=0),   # stall!
        OBDSnapshot(speed_kmh=20, rpm=1800, gear=2),
        OBDSnapshot(speed_kmh=35, rpm=2200, gear=3),
    ]
    for i, obd in enumerate(scenarios, 1):
        print(f"Tick {i}: speed={obd.speed_kmh:.0f} km/h, rpm={obd.rpm}, gear={obd.gear}")
        engine.process_telemetry(obd)
        time.sleep(0.1)

    summary = engine.stop_session(route)
    report = engine.post_drive.analyse(summary)

    print("\n--- Post-Drive Feedback ---")
    print(report.report_text)
    print(f"\nStress level: {report.stress_score_label}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="thunai",
        description="thun.ai — Edge-First AI Driving Companion",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("status", help="Show active provider configuration")
    subparsers.add_parser("demo", help="Run a simulated drive session")

    args = parser.parse_args()

    if args.command == "status":
        _cmd_status(args)
    elif args.command == "demo":
        _cmd_demo(args)
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
