"""Tests for the configuration loader."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from thunai.config import ThunaiConfig, load_config


def test_load_config_returns_thunai_config():
    config = load_config()
    assert isinstance(config, ThunaiConfig)


def test_default_slm_vlm_voice_are_stub():
    """SLM defaults to stub (on-device, needs local model); VLM uses Gemini; voice uses system TTS."""
    config = load_config()
    assert config.slm.provider == "stub"
    assert config.vlm.provider == "gemini"
    assert config.voice.provider == "system"


def test_default_llm_provider():
    """LLM defaults to gemini for cloud feedback generation."""
    config = load_config()
    assert config.llm.provider == "gemini"


def test_default_app_config():
    config = load_config()
    assert config.app.name == "thun.ai"
    assert config.app.speed_silence_threshold_kmh == 80.0


def test_env_override_llm_provider(monkeypatch):
    monkeypatch.setenv("THUNAI_LLM_PROVIDER", "gemini")
    config = load_config()
    assert config.llm.provider == "gemini"


def test_env_override_slm_provider(monkeypatch):
    monkeypatch.setenv("THUNAI_SLM_PROVIDER", "ollama")
    config = load_config()
    assert config.slm.provider == "ollama"


def test_ivis_defaults():
    config = load_config()
    assert 0 < config.ivis.stress_threshold <= 1.0
    assert config.ivis.max_interventions_per_minute > 0


def test_stack_defaults_cover_deployment_and_synthetic_data():
    config = load_config()
    assert config.deployment.edge_unit == "rv1126"
    assert config.deployment.local_retention_days == 90
    assert config.synthetic_data.enabled is True
    assert config.synthetic_data.target == "slm_finetune"


def test_local_yaml_override(tmp_path, monkeypatch):
    """A local.yaml file should override default.yaml values."""
    local_yaml = tmp_path / "local.yaml"
    local_yaml.write_text("app:\n  log_level: DEBUG\n")
    # Also provide the default so the loader finds the config_dir
    (tmp_path / "default.yaml").write_text("app:\n  log_level: INFO\n")

    config = load_config(config_dir=tmp_path)
    assert config.app.log_level == "DEBUG"


def test_load_config_with_explicit_path(tmp_path):
    config_file = tmp_path / "custom.yaml"
    config_file.write_text("app:\n  log_level: WARNING\n")

    config = load_config(config_path=config_file)

    assert config.app.log_level == "WARNING"


def test_hardware_defaults():
    config = load_config()
    assert config.hardware.disconnect_timeout_seconds == 2.0
    assert config.hardware.latency_budget_ms == 50.0
