"""
Feature 1: Pre-Drive — Peace of Mind Route Selection.

Selects the most psychologically comfortable route for the driver based on:
  - User's anxiety profile (from onboarding)
  - Road characteristics (traffic density, road quality, accident zones)
  - Time of day and environmental factors
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional

import requests

from thunai.config import PreDriveConfig
from thunai.models import RouteOption, UserProfile

logger = logging.getLogger(__name__)


@dataclass
class UserAnxietyProfile:
    """Quantified anxiety sensitivity scores for a user."""

    overall_score: float = 0.5           # 0 (no anxiety) – 1 (severe)
    night_driving_sensitivity: float = 0.5
    highway_sensitivity: float = 0.5
    narrow_lane_sensitivity: float = 0.5
    heavy_traffic_sensitivity: float = 0.5
    heavy_vehicle_sensitivity: float = 0.5
    gamified_progress_level: int = 1     # 1 (beginner) – 10 (expert)


@dataclass
class RouteSegment:
    """A section of a navigation route with associated stress characteristics."""

    name: str
    distance_km: float
    stress_score: float = 0.0   # 0 (calm) – 1 (stressful)
    has_accident_zone: bool = False
    has_heavy_vehicles: bool = False
    is_narrow: bool = False
    is_highway: bool = False


@dataclass
class Route:
    """A candidate route from origin to destination."""

    route_id: str
    segments: list[RouteSegment] = field(default_factory=list)
    total_distance_km: float = 0.0
    estimated_duration_min: float = 0.0
    overall_stress_score: float = 0.0
    comfort_label: str = "standard"  # peace_of_mind | standard | challenging

    def calculate_stress_score(self, profile: UserAnxietyProfile) -> float:
        """Compute the aggregate stress score weighted by the user's anxiety profile."""
        if not self.segments:
            return 0.0

        total_weight = 0.0
        weighted_stress = 0.0

        for seg in self.segments:
            base = seg.stress_score
            if seg.has_heavy_vehicles:
                base += 0.1 * profile.heavy_vehicle_sensitivity
            if seg.is_narrow:
                base += 0.1 * profile.narrow_lane_sensitivity
            if seg.is_highway:
                base += 0.15 * profile.highway_sensitivity
            weight = seg.distance_km
            weighted_stress += min(1.0, base) * weight
            total_weight += weight

        self.overall_stress_score = weighted_stress / max(total_weight, 1e-9)
        return self.overall_stress_score


class PreDriveAdvisor:
    """
    Selects and ranks routes based on the driver's psychological comfort.

    In production this integrates with the Maps SDK (Mapbox / Google Maps /
    Mappls) to fetch real route alternatives.  During development it works
    with synthetic stub routes.
    """

    def __init__(self, config: PreDriveConfig) -> None:
        self._config = config

    def select_route(
        self,
        origin: str,
        destination: str,
        profile: UserAnxietyProfile,
        candidate_routes: Optional[list[Route]] = None,
    ) -> Route:
        """
        Return the most comfortable route from *origin* to *destination*.

        Parameters
        ----------
        origin, destination:
            Human-readable addresses or coordinate strings.
        profile:
            The driver's anxiety profile from onboarding.
        candidate_routes:
            Pre-fetched routes (from Maps SDK). If ``None``, stub routes are used.
        """
        routes = candidate_routes if candidate_routes is not None else self._stub_routes(origin, destination)

        # Score each route for the user's profile
        for route in routes:
            route.calculate_stress_score(profile)

        # Sort: lowest stress first, but give the user a nudge toward slightly harder routes
        # as their gamified_progress_level increases
        challenge_bonus = (profile.gamified_progress_level - 1) * 0.03
        sorted_routes = sorted(
            routes,
            key=lambda r: r.overall_stress_score - challenge_bonus * (1 - r.overall_stress_score),
        )

        best = sorted_routes[0]
        best.comfort_label = "peace_of_mind" if best.overall_stress_score < 0.35 else "standard"
        logger.info(
            "Pre-Drive selected route %s (stress=%.2f, label=%s)",
            best.route_id,
            best.overall_stress_score,
            best.comfort_label,
        )
        return best

    def generate_pep_talk(self, route: Route, profile: UserAnxietyProfile) -> str:
        """Generate a short motivational message for the start of the drive."""
        if route.comfort_label == "peace_of_mind":
            return (
                "Great choice! This route is smooth and familiar. "
                "You know this road — take it one step at a time. Let's go!"
            )
        level = profile.gamified_progress_level
        return (
            f"You've reached Level {level}! This route has a gentle challenge. "
            "I'm right here with you. Take a breath, and when you're ready, let's begin."
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Stub data
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _stub_routes(origin: str, destination: str) -> list[Route]:
        return [
            Route(
                route_id="route_A",
                total_distance_km=8.5,
                estimated_duration_min=25,
                segments=[
                    RouteSegment("Main Road", 3.0, stress_score=0.2),
                    RouteSegment("Inner Ring Road", 5.5, stress_score=0.3, has_heavy_vehicles=True),
                ],
            ),
            Route(
                route_id="route_B",
                total_distance_km=10.2,
                estimated_duration_min=30,
                segments=[
                    RouteSegment("Residential Zone", 6.0, stress_score=0.15, is_narrow=True),
                    RouteSegment("Connector Road", 4.2, stress_score=0.25),
                ],
            ),
            Route(
                route_id="route_C",
                total_distance_km=7.0,
                estimated_duration_min=20,
                segments=[
                    RouteSegment("Highway Bypass", 7.0, stress_score=0.6, is_highway=True, has_heavy_vehicles=True),
                ],
            ),
        ]


# Developer reference implementation (v1)
class PreDriveFeature:
    """Peace-of-Mind route selection using Maps API responses."""

    def __init__(self, cfg: dict):
        self.cfg = cfg["features"]["pre_drive"] if "features" in cfg else cfg
        self.api_key = self.cfg.get("google_maps_api_key")
        self.max_alt = self.cfg.get("max_route_alternatives", 3)
        self.weights = self.cfg.get("anxiety_score_weights", {})

    def get_route_options(
        self, origin: str, destination: str, profile: UserProfile
    ) -> list[RouteOption]:
        raw_routes = self._fetch_routes(origin, destination)
        scores = [self._score_route(r, profile) for r in raw_routes]
        min_score = min(scores) if scores else 0
        options = []
        for i, (route, score) in enumerate(zip(raw_routes, scores)):
            triggers = self._extract_triggers(route)
            label = "fastest" if i == 0 else (
                "peace_of_mind" if score == min_score else f"option_{i+1}"
            )
            options.append(
                RouteOption(
                    route_id=str(uuid.uuid4()),
                    label=label,
                    eta_minutes=route["legs"][0]["duration"]["value"] // 60,
                    distance_km=route["legs"][0]["distance"]["value"] / 1000,
                    anxiety_score=round(score, 1),
                    triggers=triggers,
                    polyline=route["overview_polyline"]["points"],
                )
            )
        return sorted(options, key=lambda r: r.anxiety_score)

    def _fetch_routes(self, origin: str, destination: str) -> list[dict]:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/directions/json",
            params={
                "origin": origin,
                "destination": destination,
                "alternatives": "true",
                "key": self.api_key,
                "region": "in",
                "language": "en",
            },
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("routes", [])[: self.max_alt]

    def _score_route(self, route: dict, profile: UserProfile) -> float:
        steps = route["legs"][0]["steps"]
        highway_merges = sum(
            1 for s in steps if "merge" in s.get("html_instructions", "").lower()
        )
        total_km = route["legs"][0]["distance"]["value"] / 1000
        merge_score = min(highway_merges / max(total_km, 1), 1.0)
        highway_weight = self.weights.get("highway_merges", 0) * (
            1 + profile.anxiety_score.highway_merges
        )
        return merge_score * highway_weight * 100

    def _extract_triggers(self, route: dict) -> list[str]:
        triggers = []
        for step in route["legs"][0]["steps"]:
            instr = step.get("html_instructions", "").lower()
            if "merge" in instr:
                triggers.append("highway merge")
            if "narrow" in instr:
                triggers.append("narrow road")
        return list(set(triggers))
