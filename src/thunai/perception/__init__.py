"""
Perception layer — object detection from camera frames.

Abstracts over different object detection backends:
  - stub:      Synthetic detections (for development/testing)
  - yolo:      YOLOv8-nano ONNX (optimised for Rockchip RV1126 NPU)
  - mobilenet: SSD MobileNetV2 ONNX (alternative lightweight backend)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
import time
from typing import Optional

from thunai.config import PerceptionConfig
from thunai.models import DetectedObject, PerceptionFrame

logger = logging.getLogger(__name__)


@dataclass
class Detection:
    """A single detected object in a camera frame."""

    label: str
    confidence: float
    bbox: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)  # x1,y1,x2,y2 normalised


@dataclass
class PerceptionResult:
    """Output from a single frame analysis."""

    detections: list[Detection] = field(default_factory=list)
    emergency_vehicle_detected: bool = False
    lane_departure_detected: bool = False
    proximity_alert: bool = False
    frame_timestamp_ms: float = 0.0

    @property
    def labels(self) -> list[str]:
        return [d.label for d in self.detections]


class ObjectDetector:
    """
    Wrapper around the configured object detection backend.

    This class is the single entry-point for the IVIS perception pipeline.
    When running on real hardware (Rockchip RV1126), swap ``backend`` to
    ``"yolo"`` and point ``model_path`` at the ONNX file on the SoC.
    """

    _EMERGENCY_LABELS = {"ambulance", "fire_truck", "police_car", "emergency_vehicle"}
    _PROXIMITY_LABELS = {"car", "truck", "bus", "motorcycle", "bicycle", "pedestrian"}

    def __init__(self, config: PerceptionConfig) -> None:
        self._config = config
        self._backend: Optional[object] = None

    def _load_backend(self) -> None:
        backend = self._config.backend.lower()
        if backend == "stub":
            return  # no model to load
        if backend == "yolo":
            self._load_yolo()
        elif backend == "mobilenet":
            self._load_mobilenet()
        else:
            raise ValueError(
                f"Unknown perception backend {backend!r}. "
                "Valid options: stub | yolo | mobilenet"
            )

    def _load_yolo(self) -> None:
        try:
            import onnxruntime as ort  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "onnxruntime is not installed. Run: pip install onnxruntime"
            ) from exc

        logger.info("Loading YOLO model from %s …", self._config.yolo.model_path)
        self._backend = ort.InferenceSession(self._config.yolo.model_path)

    def _load_mobilenet(self) -> None:
        try:
            import onnxruntime as ort  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "onnxruntime is not installed. Run: pip install onnxruntime"
            ) from exc

        self._backend = ort.InferenceSession(self._config.mobilenet.model_path)

    def detect(self, frame_bytes: bytes, timestamp_ms: float = 0.0) -> PerceptionResult:
        """
        Run object detection on a raw camera frame.

        Parameters
        ----------
        frame_bytes:
            JPEG or PNG bytes from the camera.
        timestamp_ms:
            Frame capture time in milliseconds (used for latency tracking).
        """
        backend = self._config.backend.lower()
        if backend == "stub":
            return self._stub_detect(timestamp_ms)

        raise NotImplementedError(
            f"Backend {backend!r} detect() not yet connected to hardware. "
            "Set perception.backend = stub for development."
        )

    def _stub_detect(self, timestamp_ms: float) -> PerceptionResult:
        """Return synthetic detection results for testing."""
        detections = [
            Detection(label="car", confidence=0.92, bbox=(0.1, 0.3, 0.4, 0.7)),
            Detection(label="road", confidence=0.98, bbox=(0.0, 0.5, 1.0, 1.0)),
        ]
        return PerceptionResult(
            detections=detections,
            emergency_vehicle_detected=False,
            lane_departure_detected=False,
            proximity_alert=False,
            frame_timestamp_ms=timestamp_ms,
        )


# Developer reference perception stub
class StubPerception:
    """Synthetic perception provider returning Pydantic PerceptionFrame."""

    def __init__(self, cfg: dict):
        self.cfg = cfg.get("perception", cfg)
        self._counter = 0
        stub_cfg = self.cfg.get("stub", {})
        self.emergency_interval = max(1, int(stub_cfg.get("frame_rate_hz", 5)))

    @property
    def provider_name(self) -> str:
        return "stub"

    def process_frame(self) -> PerceptionFrame:
        self._counter += 1
        now = int(time.time() * 1000)
        emergency = self._counter % self.emergency_interval == 0
        detections = [
            DetectedObject(
                label="car",
                confidence=0.9,
                bbox=(0.1, 0.1, 0.3, 0.3),
                camera="irvm",
            )
        ]
        return PerceptionFrame(
            timestamp_ms=now,
            detections=detections,
            emergency_vehicle=emergency,
            lane_departure=False,
            proximity_alert=False,
        )

    def is_healthy(self) -> bool:
        return True


def build_perception_provider(cfg: dict):
    perc_cfg = cfg.get("perception") if "perception" in cfg else cfg
    provider = perc_cfg.get("provider") or perc_cfg.get("backend")
    if provider == "stub":
        return StubPerception(perc_cfg)
    raise ValueError(f"Unknown perception provider: {provider}")
