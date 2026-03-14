"""
thun.ai Main Engine — orchestrates all subsystems.

This is the top-level coordinator:
  1. Loads configuration
  2. Initialises all providers (LLM, SLM, VLM, Voice)
  3. Exposes the four core feature modules
  4. Provides a simple ``run_drive_session()`` method for integration testing
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from thunai.config import ThunaiConfig, load_config
from thunai.features.ivis import IVISEngine, OBDSnapshot
from thunai.features.post_drive import DriveSummary, PostDriveAnalyser
from thunai.features.pre_drive import PreDriveAdvisor, Route, UserAnxietyProfile
from thunai.features.therapist import AITherapist
from thunai.intelligence.llm import create_llm_provider
from thunai.intelligence.slm import create_slm_provider
from thunai.intelligence.vlm import create_vlm_provider
from thunai.interaction import VoiceEngine
from thunai.perception import ObjectDetector

logger = logging.getLogger(__name__)


class ThunaiEngine:
    """
    Central engine for the thun.ai IVIS system.

    Instantiate once and keep alive for the duration of the driving session.

    Example
    -------
    >>> engine = ThunaiEngine.from_config()
    >>> engine.start_session(origin="Home", destination="Office", profile=my_profile)
    >>> # … feed sensor data …
    >>> engine.stop_session()
    """

    def __init__(self, config: ThunaiConfig) -> None:
        self._config = config
        self._setup_logging()

        # Providers
        self._slm = create_slm_provider(config.slm)
        self._llm = create_llm_provider(config.llm)
        self._llm_pro = create_llm_provider(config.llm, use_pro=True)
        self._vlm = create_vlm_provider(config.vlm)
        self._voice = VoiceEngine(
            config.voice,
            speed_silence_threshold_kmh=config.app.speed_silence_threshold_kmh,
        )
        self._detector = ObjectDetector(config.perception)

        # Feature modules
        self.ivis = IVISEngine(config.ivis, self._slm, self._voice)
        self.pre_drive = PreDriveAdvisor(config.pre_drive)
        self.therapist = AITherapist(config.therapist, self._llm_pro, self._voice)
        self.post_drive = PostDriveAnalyser(config.post_drive, self._llm, self._llm_pro)

        self._session_start: Optional[float] = None
        self._session_events = []

        logger.info(
            "thun.ai engine initialised. SLM=%s, LLM=%s, VLM=%s, Voice=%s",
            self._slm.provider_name,
            self._llm.provider_name,
            self._vlm.provider_name,
            config.voice.provider,
        )

    @classmethod
    def from_config(cls, config: Optional[ThunaiConfig] = None) -> "ThunaiEngine":
        """Create an engine from configuration (loads YAML + env vars if not provided)."""
        return cls(config or load_config())

    def start_session(
        self,
        origin: str,
        destination: str,
        profile: UserAnxietyProfile,
    ) -> Route:
        """
        Begin a driving session.

        Selects the best route, delivers a pep talk, and prepares all
        subsystems for real-time data ingestion.

        Returns the selected :class:`Route`.
        """
        self._session_start = time.monotonic()
        self._session_events.clear()

        route = self.pre_drive.select_route(origin, destination, profile)
        pep_talk = self.pre_drive.generate_pep_talk(route, profile)
        self._voice.speak(pep_talk)

        logger.info("Drive session started: %s → %s (route=%s).", origin, destination, route.route_id)
        return route

    def process_telemetry(
        self,
        obd: OBDSnapshot,
        frame_bytes: Optional[bytes] = None,
    ) -> None:
        """
        Process a single telemetry tick.

        Call this in a loop (e.g., every 100 ms) with fresh OBD data
        and optionally a camera frame.
        """
        self._voice.update_speed(obd.speed_kmh)

        perception_result = None
        if frame_bytes:
            perception_result = self._detector.detect(frame_bytes)

        events = self.ivis.process_frame(obd, perception_result)
        self._session_events.extend(events)

    def stop_session(self, route: Optional[Route] = None) -> DriveSummary:
        """
        End the current driving session and return a summary.

        Call :meth:`PostDriveAnalyser.analyse` on the returned summary to
        generate the full feedback report.
        """
        duration = (time.monotonic() - self._session_start) / 60.0 if self._session_start else 0.0
        stall_count = sum(1 for e in self._session_events if e.event_type == "stall")

        summary = DriveSummary(
            duration_minutes=duration,
            distance_km=route.total_distance_km if route else 0.0,
            average_stress=self.ivis.stress_level,
            peak_stress=self.ivis.stress_level,
            stall_count=stall_count,
            ivis_intervention_count=len(self._session_events),
            events=list(self._session_events),
            route_label=route.comfort_label if route else "unknown",
        )
        logger.info("Drive session ended. Duration=%.1f min, stress=%.2f.", duration, summary.average_stress)
        self._session_start = None
        return summary

    def get_provider_info(self) -> dict[str, str]:
        """Return a summary of configured providers for diagnostics."""
        return {
            "slm": f"{self._slm.provider_name}/{self._slm.model_name}",
            "llm": f"{self._llm.provider_name}/{self._llm.model_name}",
            "llm_pro": f"{self._llm_pro.provider_name}/{self._llm_pro.model_name}",
            "vlm": f"{self._vlm.provider_name}/{self._vlm.model_name}",
            "voice": self._config.voice.provider,
            "perception": self._config.perception.backend,
        }

    def _setup_logging(self) -> None:
        logging.basicConfig(
            level=getattr(logging, self._config.app.log_level, logging.INFO),
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        )
