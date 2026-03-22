"""Tests for the Post-Drive analysis feature."""

from __future__ import annotations

import pytest

from thunai.config import PostDriveConfig, SyntheticDataConfig
from thunai.features.ivis import DriveEvent
from thunai.features.post_drive import (
    DriveSummary,
    FeedbackReport,
    PostDriveAnalyser,
    SyntheticDataset,
)
from thunai.intelligence.llm import StubLLMProvider


def _analyser() -> PostDriveAnalyser:
    config = PostDriveConfig(use_pro_model_threshold=0.8)
    return PostDriveAnalyser(config, StubLLMProvider(), StubLLMProvider())


def _summary(**kwargs) -> DriveSummary:
    defaults = dict(
        duration_minutes=20,
        distance_km=8.0,
        average_speed_kmh=35,
        average_stress=0.3,
        peak_stress=0.5,
        stall_count=1,
        ivis_intervention_count=2,
    )
    defaults.update(kwargs)
    return DriveSummary(**defaults)


def test_analyse_returns_feedback_report():
    analyser = _analyser()
    report = analyser.analyse(_summary())
    assert isinstance(report, FeedbackReport)
    assert len(report.report_text) > 0


def test_stress_label_low():
    analyser = _analyser()
    report = analyser.analyse(_summary(average_stress=0.2))
    assert report.stress_score_label == "low"


def test_stress_label_moderate():
    analyser = _analyser()
    report = analyser.analyse(_summary(average_stress=0.5))
    assert report.stress_score_label == "moderate"


def test_stress_label_high():
    analyser = _analyser()
    report = analyser.analyse(_summary(average_stress=0.8))
    assert report.stress_score_label == "high"


def test_model_info_in_report():
    analyser = _analyser()
    report = analyser.analyse(_summary())
    assert report.model_used == "stub-llm"


def test_synthetic_scenarios_for_stressful_drive():
    """With no high-stress events, synthetic scenario list should be empty."""
    analyser = _analyser()
    summary = _summary()
    scenarios = analyser.generate_synthetic_scenarios(summary)
    assert isinstance(scenarios, list)


def test_synthetic_scenarios_with_events():
    analyser = _analyser()
    events = [
        DriveEvent("stall", "Engine stalled at traffic light.", stress_delta=0.4),
        DriveEvent("emergency", "Ambulance nearby.", stress_delta=0.3),
    ]
    summary = _summary(events=events)
    scenarios = analyser.generate_synthetic_scenarios(summary)
    assert isinstance(scenarios, list)


def test_build_synthetic_dataset_returns_structured_samples():
    analyser = _analyser()
    events = [
        DriveEvent("stall", "Engine stalled at traffic light.", stress_delta=0.4),
        DriveEvent("merge", "A bus merged aggressively from the left.", stress_delta=0.3),
    ]
    summary = _summary(events=events)
    dataset = analyser.build_synthetic_dataset(
        summary,
        SyntheticDataConfig(
            scenarios_per_event=2,
            max_events_per_drive=1,
        ),
    )
    assert isinstance(dataset, SyntheticDataset)
    assert dataset.target == "slm_finetune"
    assert len(dataset.samples) == 2
    assert all(sample.source_event for sample in dataset.samples)
