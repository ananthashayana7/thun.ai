"""Tests for stack manifest and synthetic export helpers."""

from __future__ import annotations

import json

from thunai.config import load_config
from thunai.engine import ThunaiEngine
from thunai.features.ivis import DriveEvent
from thunai.features.post_drive import DriveSummary


def _summary() -> DriveSummary:
    return DriveSummary(
        duration_minutes=18,
        distance_km=7.5,
        average_speed_kmh=28,
        average_stress=0.58,
        peak_stress=0.82,
        stall_count=1,
        ivis_intervention_count=3,
        route_label="comfort",
        events=[
            DriveEvent(
                "merge",
                "A car cut in front during a lane merge.",
                stress_delta=0.35,
            )
        ],
    )


def test_stack_manifest_contains_deployment_and_providers(monkeypatch):
    monkeypatch.setenv("THUNAI_LLM_PROVIDER", "stub")
    engine = ThunaiEngine.from_config(load_config())

    manifest = engine.get_stack_manifest()

    assert manifest["deployment"]["edge_unit"] == "rv1126"
    assert manifest["deployment"]["local_retention_days"] == 90
    assert manifest["providers"]["llm"] == "stub/stub-llm"
    assert manifest["synthetic_data"]["target"] == "slm_finetune"
    assert manifest["config_validation"]["profile"] == "development"


def test_export_synthetic_dataset_writes_json(tmp_path, monkeypatch):
    monkeypatch.setenv("THUNAI_LLM_PROVIDER", "stub")
    engine = ThunaiEngine.from_config(load_config())

    output_path = tmp_path / "synthetic.json"
    dataset = engine.export_synthetic_dataset(_summary(), output_path=output_path)

    assert output_path.exists()
    assert dataset["sample_count"] > 0
    assert json.loads(output_path.read_text())["sample_count"] == dataset["sample_count"]
