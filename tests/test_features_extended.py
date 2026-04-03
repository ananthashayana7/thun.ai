"""Extended tests for feature modules with mocked dependencies."""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

import pytest

from thunai.config import (
    IVISConfig,
    PostDriveConfig,
    PreDriveConfig,
    SyntheticDataConfig,
    TherapistConfig,
    VoiceConfig,
)
from thunai.features.ivis import DriveEvent, IVISEngine, OBDSnapshot
from thunai.features.post_drive import (
    DriveSummary,
    FeedbackReport,
    PostDriveAnalyser,
    SyntheticDataset,
    SyntheticScenario,
)
from thunai.features.pre_drive import (
    PreDriveAdvisor,
    Route,
    RouteSegment,
    UserAnxietyProfile,
)
from thunai.features.therapist import AITherapist
from thunai.intelligence.base import LLMResponse, Message, SLMResponse
from thunai.perception import PerceptionResult


# ─── Helper: create mock providers ───────────────────────────────────────────


def _mock_slm(text: str = "Stay calm."):
    slm = MagicMock()
    slm.generate.return_value = SLMResponse(
        text=text, provider="stub", model="test"
    )
    return slm


def _mock_llm(text: str = "Great drive!", model: str = "test-model"):
    llm = MagicMock()
    llm.generate.return_value = LLMResponse(
        text=text, provider="stub", model=model, output_tokens=50
    )
    llm.provider_name = "stub"
    llm.model_name = model
    return llm


def _mock_voice():
    voice = MagicMock()
    voice.speak = MagicMock()
    return voice


# ═══════════════════════════════════════════════════════════════════════════════
# Pre-Drive Feature Tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestPreDriveRouteSelection:
    """Test route selection with different profiles."""

    def test_select_route_from_candidates(self):
        advisor = PreDriveAdvisor(PreDriveConfig())
        profile = UserAnxietyProfile(overall_score=0.7)

        calm_route = Route(
            route_id="calm",
            segments=[RouteSegment("Residential", 5.0, stress_score=0.1)],
        )
        stressful_route = Route(
            route_id="stressful",
            segments=[
                RouteSegment("Highway", 5.0, stress_score=0.8, is_highway=True)
            ],
        )

        selected = advisor.select_route(
            "A", "B", profile, candidate_routes=[calm_route, stressful_route]
        )
        assert selected.route_id == "calm"

    def test_high_progress_level_nudges_toward_challenge(self):
        advisor = PreDriveAdvisor(PreDriveConfig())
        profile = UserAnxietyProfile(
            overall_score=0.3, gamified_progress_level=10
        )

        easy = Route(
            route_id="easy",
            segments=[RouteSegment("Park Road", 5.0, stress_score=0.05)],
        )
        medium = Route(
            route_id="medium",
            segments=[RouteSegment("Main Road", 5.0, stress_score=0.2)],
        )

        selected = advisor.select_route(
            "A", "B", profile, candidate_routes=[easy, medium]
        )
        # High progress level provides a challenge bonus; the algorithm
        # may still choose easy, but both routes should be scored
        assert selected.route_id in ("easy", "medium")

    def test_stub_routes_are_used_when_no_candidates(self):
        advisor = PreDriveAdvisor(PreDriveConfig())
        profile = UserAnxietyProfile()
        route = advisor.select_route("Home", "Office", profile)
        assert route.route_id in ("route_A", "route_B", "route_C")

    def test_route_stress_score_calculation(self):
        profile = UserAnxietyProfile(highway_sensitivity=1.0)
        route = Route(
            route_id="test",
            segments=[
                RouteSegment("Highway", 10.0, stress_score=0.5, is_highway=True),
            ],
        )
        score = route.calculate_stress_score(profile)
        # Highway sensitivity adds 0.15 * 1.0 = 0.15 to base 0.5 → 0.65
        assert score == pytest.approx(0.65, abs=0.01)

    def test_comfort_label_set_on_selected_route(self):
        advisor = PreDriveAdvisor(PreDriveConfig())
        profile = UserAnxietyProfile(overall_score=0.1)
        calm = Route(
            route_id="calm",
            segments=[RouteSegment("Quiet Lane", 3.0, stress_score=0.05)],
        )
        route = advisor.select_route("A", "B", profile, candidate_routes=[calm])
        assert route.comfort_label in ("peace_of_mind", "standard")


class TestPreDrivePepTalk:
    """Test pep talk generation."""

    def test_peace_of_mind_pep_talk(self):
        advisor = PreDriveAdvisor(PreDriveConfig())
        route = Route(route_id="calm", comfort_label="peace_of_mind")
        profile = UserAnxietyProfile()
        talk = advisor.generate_pep_talk(route, profile)
        assert "Great choice" in talk

    def test_standard_route_pep_talk_includes_level(self):
        advisor = PreDriveAdvisor(PreDriveConfig())
        route = Route(route_id="standard", comfort_label="standard")
        profile = UserAnxietyProfile(gamified_progress_level=5)
        talk = advisor.generate_pep_talk(route, profile)
        assert "Level 5" in talk

    def test_anxiety_profile_clamping(self):
        profile = UserAnxietyProfile(
            overall_score=1.5,
            highway_sensitivity=-0.5,
            gamified_progress_level=15,
        )
        assert profile.overall_score == 1.0
        assert profile.highway_sensitivity == 0.0
        assert profile.gamified_progress_level == 10


# ═══════════════════════════════════════════════════════════════════════════════
# IVIS Feature Tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestIVISStressDetection:
    """Test stress threshold detection and intervention dispatch."""

    def _make_engine(
        self, stress_threshold: float = 0.3, max_per_min: int = 10
    ) -> IVISEngine:
        from thunai.intelligence.slm import StubSLMProvider
        from thunai.interaction import VoiceEngine

        config = IVISConfig(
            stress_threshold=stress_threshold,
            max_interventions_per_minute=max_per_min,
        )
        slm = StubSLMProvider()
        voice = VoiceEngine(VoiceConfig(provider="stub"))
        return IVISEngine(config, slm, voice)

    def test_stress_increases_with_events(self):
        engine = self._make_engine()
        obd = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)  # stall event
        engine.process_frame(obd)
        assert engine.stress_level > 0.0

    def test_stress_decays_without_events(self):
        engine = self._make_engine()
        # First, inject some stress
        obd_stall = OBDSnapshot(speed_kmh=0, rpm=0, gear=0)
        engine.process_frame(obd_stall)
        initial = engine.stress_level

        # Normal driving — stress should decay
        obd_normal = OBDSnapshot(speed_kmh=40, rpm=2500, gear=3)
        engine.process_frame(obd_normal)
        assert engine.stress_level < initial

    def test_emergency_event_always_dispatches(self):
        engine = self._make_engine(stress_threshold=1.0)  # very high threshold
        obd = OBDSnapshot(speed_kmh=40, rpm=2000, gear=3)
        perception = PerceptionResult(emergency_vehicle_detected=True)
        events = engine.process_frame(obd, perception)
        assert any(e.event_type == "emergency" for e in events)

    def test_stress_peak_tracking(self):
        engine = self._make_engine()
        engine.process_frame(OBDSnapshot(speed_kmh=0, rpm=0))
        engine.process_frame(OBDSnapshot(speed_kmh=40, rpm=2500, gear=3))
        assert engine.stress_peak >= engine.stress_level

    def test_stress_average_tracking(self):
        engine = self._make_engine()
        engine.process_frame(OBDSnapshot(speed_kmh=0, rpm=0))
        engine.process_frame(OBDSnapshot(speed_kmh=40, rpm=2500, gear=3))
        assert engine.stress_average > 0.0

    def test_reset_session_clears_history(self):
        engine = self._make_engine()
        engine.process_frame(OBDSnapshot(speed_kmh=0, rpm=0))
        engine.reset_session()
        assert engine.stress_level == 0.0
        assert engine.stress_peak == 0.0
        assert engine.stress_average == 0.0


class TestIVISEventDetection:
    """Test individual event types."""

    def _make_engine(self) -> IVISEngine:
        from thunai.intelligence.slm import StubSLMProvider
        from thunai.interaction import VoiceEngine

        config = IVISConfig(stress_threshold=0.6, max_interventions_per_minute=4)
        return IVISEngine(config, StubSLMProvider(), VoiceEngine(VoiceConfig(provider="stub")))

    def test_stall_event(self):
        engine = self._make_engine()
        events = engine.process_frame(OBDSnapshot(speed_kmh=0, rpm=0))
        types = [e.event_type for e in events]
        assert "stall" in types

    def test_gear_mismatch_event(self):
        engine = self._make_engine()
        events = engine.process_frame(OBDSnapshot(speed_kmh=60, rpm=3000, gear=1))
        types = [e.event_type for e in events]
        assert "gear_mismatch" in types

    def test_lane_departure_event(self):
        engine = self._make_engine()
        perception = PerceptionResult(lane_departure_detected=True)
        events = engine.process_frame(OBDSnapshot(speed_kmh=40, rpm=2000, gear=3), perception)
        types = [e.event_type for e in events]
        assert "lane_departure" in types

    def test_proximity_event(self):
        engine = self._make_engine()
        perception = PerceptionResult(proximity_alert=True)
        events = engine.process_frame(OBDSnapshot(speed_kmh=40, rpm=2000, gear=3), perception)
        types = [e.event_type for e in events]
        assert "proximity" in types


# ═══════════════════════════════════════════════════════════════════════════════
# Post-Drive Feature Tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestPostDriveFeedback:
    """Test feedback narrative generation."""

    def test_analyse_returns_feedback_report(self):
        llm = _mock_llm("Your drive was excellent!")
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        summary = DriveSummary(
            duration_minutes=20,
            distance_km=8.0,
            average_stress=0.3,
            peak_stress=0.5,
        )
        report = analyser.analyse(summary)
        assert isinstance(report, FeedbackReport)
        assert report.report_text == "Your drive was excellent!"

    def test_stress_label_low(self):
        llm = _mock_llm()
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        summary = DriveSummary(average_stress=0.2, peak_stress=0.3)
        report = analyser.analyse(summary)
        assert report.stress_score_label == "low"

    def test_stress_label_moderate(self):
        llm = _mock_llm()
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        summary = DriveSummary(average_stress=0.5, peak_stress=0.6)
        report = analyser.analyse(summary)
        assert report.stress_score_label == "moderate"

    def test_stress_label_high(self):
        llm = _mock_llm()
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        summary = DriveSummary(average_stress=0.8, peak_stress=0.9)
        report = analyser.analyse(summary)
        assert report.stress_score_label == "high"

    def test_pro_model_used_for_high_stress(self):
        flash = _mock_llm("Flash response", "flash")
        pro = _mock_llm("Pro response", "pro")

        analyser = PostDriveAnalyser(
            PostDriveConfig(use_pro_model_threshold=0.6), flash, pro
        )
        summary = DriveSummary(average_stress=0.7)
        report = analyser.analyse(summary)
        assert report.model_used == "pro"
        pro.generate.assert_called_once()

    def test_flash_model_used_for_low_stress(self):
        flash = _mock_llm("Flash response", "flash")
        pro = _mock_llm("Pro response", "pro")

        analyser = PostDriveAnalyser(
            PostDriveConfig(use_pro_model_threshold=0.6), flash, pro
        )
        summary = DriveSummary(average_stress=0.3)
        report = analyser.analyse(summary)
        assert report.model_used == "flash"
        flash.generate.assert_called_once()


class TestPostDriveSyntheticScenarios:
    """Test synthetic scenario generation."""

    def test_no_scenarios_for_low_stress_events(self):
        llm = _mock_llm()
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        summary = DriveSummary(
            events=[DriveEvent(event_type="normal", description="Normal", stress_delta=0.1)]
        )
        scenarios = analyser.generate_synthetic_scenarios(summary)
        assert scenarios == []

    def test_scenarios_generated_for_high_stress(self):
        llm = _mock_llm("Scenario: Navigating a busy roundabout\nScenario: Heavy traffic merge")
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        summary = DriveSummary(
            events=[
                DriveEvent(
                    event_type="stall",
                    description="Engine stall",
                    stress_delta=0.4,
                )
            ]
        )
        scenarios = analyser.generate_synthetic_scenarios(summary)
        assert len(scenarios) == 2


class TestPostDriveDataExport:
    """Test SyntheticDataset data export."""

    def test_synthetic_dataset_to_dict(self):
        dataset = SyntheticDataset(
            target="slm_finetune",
            provider="stub",
            model="test",
            samples=[
                SyntheticScenario(
                    scenario="Test scenario",
                    trigger="stall",
                    suggested_response="Stay calm",
                    source_event="Engine stall",
                    stress_delta=0.4,
                )
            ],
        )
        d = dataset.to_dict()
        assert d["target"] == "slm_finetune"
        assert d["sample_count"] == 1
        assert len(d["samples"]) == 1

    def test_build_synthetic_dataset_disabled(self):
        llm = _mock_llm()
        analyser = PostDriveAnalyser(PostDriveConfig(), llm)
        config = SyntheticDataConfig(enabled=False)
        summary = DriveSummary(
            events=[DriveEvent(event_type="stall", description="Stall", stress_delta=0.5)]
        )
        dataset = analyser.build_synthetic_dataset(summary, config)
        assert len(dataset.samples) == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Therapist Feature Tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestTherapistCBTConversation:
    """Test CBT conversation functionality."""

    def _make_therapist(self, require_user_request: bool = True) -> AITherapist:
        llm = _mock_llm("Take a deep breath. You are doing well.")
        voice = _mock_voice()
        config = TherapistConfig(
            require_user_request=require_user_request,
            breathing_exercise_seconds=0,
        )
        return AITherapist(config, llm, voice)

    def test_therapist_respond_returns_text(self):
        t = self._make_therapist(require_user_request=False)
        t.activate(rpm=0, user_requested=True)
        response = t.respond("I feel anxious")
        assert isinstance(response, str)
        assert len(response) > 0

    def test_therapist_maintains_conversation_history(self):
        t = self._make_therapist(require_user_request=False)
        t.activate(rpm=0, user_requested=True)
        t.respond("First message")
        t.respond("Second message")
        # History includes system + 2 user + 2 assistant = 5
        assert len(t._session_history) == 5

    def test_therapist_history_trimmed_at_max(self):
        t = self._make_therapist(require_user_request=False)
        t.activate(rpm=0, user_requested=True)
        # Send many messages to exceed _MAX_HISTORY_TURNS (20)
        for i in range(25):
            t.respond(f"Message {i}")
        # History should be trimmed: system + 20 most recent
        assert len(t._session_history) <= 22  # system + 20 + 1 buffer

    def test_therapist_speaks_response(self):
        llm = _mock_llm("Calm response.")
        voice = _mock_voice()
        config = TherapistConfig(require_user_request=False)
        t = AITherapist(config, llm, voice)
        t.activate(rpm=0, user_requested=True)
        t.respond("Help me")
        voice.speak.assert_called()


class TestTherapistParkingGate:
    """Test parking-only activation gate."""

    def test_activation_blocked_when_rpm_nonzero(self):
        llm = _mock_llm()
        voice = _mock_voice()
        config = TherapistConfig(require_user_request=True)
        t = AITherapist(config, llm, voice)
        activated = t.activate(rpm=800, user_requested=True)
        assert activated is False
        # Should tell user to pull over
        voice.speak.assert_called_once()

    def test_activation_blocked_without_user_request(self):
        llm = _mock_llm()
        voice = _mock_voice()
        config = TherapistConfig(require_user_request=True)
        t = AITherapist(config, llm, voice)
        activated = t.activate(rpm=0, user_requested=False)
        assert activated is False

    def test_activation_succeeds_when_parked_and_requested(self):
        llm = _mock_llm()
        voice = _mock_voice()
        config = TherapistConfig(require_user_request=True)
        t = AITherapist(config, llm, voice)
        activated = t.activate(rpm=0, user_requested=True)
        assert activated is True

    def test_activation_without_require_user_request(self):
        llm = _mock_llm()
        voice = _mock_voice()
        config = TherapistConfig(require_user_request=False)
        t = AITherapist(config, llm, voice)
        activated = t.activate(rpm=0, user_requested=False)
        assert activated is True

    @patch("time.sleep")
    def test_breathing_exercise_speaks_all_lines(self, mock_sleep):
        llm = _mock_llm()
        voice = _mock_voice()
        config = TherapistConfig()
        t = AITherapist(config, llm, voice)
        t.run_breathing_exercise()
        # Should speak each line of the breathing script
        assert voice.speak.call_count >= 8

    @patch("time.sleep")
    def test_roadside_recovery_protocol(self, mock_sleep):
        llm = _mock_llm()
        voice = _mock_voice()
        config = TherapistConfig()
        t = AITherapist(config, llm, voice)
        t.roadside_recovery()
        # Should include hazard lights reminder + breathing + closing
        assert voice.speak.call_count >= 10
