"""Tests for the Pre-Drive route selection feature."""

from __future__ import annotations

import pytest

from thunai.config import PreDriveConfig
from thunai.features.pre_drive import PreDriveAdvisor, Route, RouteSegment, UserAnxietyProfile


def _advisor() -> PreDriveAdvisor:
    return PreDriveAdvisor(PreDriveConfig())


def test_select_route_returns_route():
    advisor = _advisor()
    profile = UserAnxietyProfile(overall_score=0.5)
    route = advisor.select_route("Home", "Office", profile)
    assert isinstance(route, Route)
    assert route.route_id


def test_selects_lowest_stress_route():
    advisor = _advisor()
    profile = UserAnxietyProfile(
        highway_sensitivity=1.0,
        heavy_vehicle_sensitivity=1.0,
        narrow_lane_sensitivity=0.0,
    )
    calm_route = Route(
        route_id="calm",
        segments=[RouteSegment("Residential", 5.0, stress_score=0.1)],
        total_distance_km=5.0,
    )
    stressful_route = Route(
        route_id="stressful",
        segments=[RouteSegment("Highway", 5.0, stress_score=0.9, is_highway=True)],
        total_distance_km=5.0,
    )
    result = advisor.select_route("A", "B", profile, [calm_route, stressful_route])
    assert result.route_id == "calm"


def test_peace_of_mind_label_for_low_stress():
    advisor = _advisor()
    profile = UserAnxietyProfile()
    route = Route(
        route_id="easy",
        segments=[RouteSegment("Quiet Road", 3.0, stress_score=0.1)],
        total_distance_km=3.0,
    )
    result = advisor.select_route("A", "B", profile, [route])
    assert result.comfort_label == "peace_of_mind"


def test_pep_talk_peace_of_mind():
    advisor = _advisor()
    profile = UserAnxietyProfile(gamified_progress_level=1)
    route = Route(route_id="r", comfort_label="peace_of_mind")
    pep = advisor.generate_pep_talk(route, profile)
    assert isinstance(pep, str)
    assert len(pep) > 10


def test_pep_talk_includes_level_for_challenge_route():
    advisor = _advisor()
    profile = UserAnxietyProfile(gamified_progress_level=3)
    route = Route(route_id="r", comfort_label="standard")
    pep = advisor.generate_pep_talk(route, profile)
    assert "3" in pep or "level" in pep.lower()


def test_route_stress_score_reflects_profile():
    profile_anxious = UserAnxietyProfile(highway_sensitivity=1.0)
    profile_calm = UserAnxietyProfile(highway_sensitivity=0.0)

    route = Route(
        route_id="highway",
        segments=[RouteSegment("Highway", 10.0, stress_score=0.5, is_highway=True)],
        total_distance_km=10.0,
    )

    score_anxious = route.calculate_stress_score(profile_anxious)
    route2 = Route(
        route_id="highway",
        segments=[RouteSegment("Highway", 10.0, stress_score=0.5, is_highway=True)],
        total_distance_km=10.0,
    )
    score_calm = route2.calculate_stress_score(profile_calm)
    assert score_anxious > score_calm
