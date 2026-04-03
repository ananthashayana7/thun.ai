"""
Perception layer — object detection from camera frames.

Abstracts over different object detection backends:
  - stub:      Synthetic detections (for development/testing)
  - yolo:      YOLOv8-nano ONNX (optimised for Rockchip RV1126 NPU)
  - mobilenet: SSD MobileNetV2 ONNX (alternative lightweight backend)
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
import time
from typing import Optional

from thunai.config import PerceptionConfig
from thunai.models import DetectedObject, PerceptionFrame

logger = logging.getLogger(__name__)

try:
    import numpy as np
    from PIL import Image

    _HAS_IMAGING = True
except ImportError:  # pragma: no cover
    _HAS_IMAGING = False


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


# Default NMS IoU threshold
_DEFAULT_IOU_THRESHOLD = 0.45

# Standard MobileNet SSD input size
_MOBILENET_INPUT_SIZE = (300, 300)


class ObjectDetector:
    """
    Wrapper around the configured object detection backend.

    This class is the single entry-point for the IVIS perception pipeline.
    When running on real hardware (Rockchip RV1126), swap ``backend`` to
    ``"yolo"`` and point ``model_path`` at the ONNX file on the SoC.
    """

    _EMERGENCY_LABELS = {"ambulance", "fire_truck", "police_car", "emergency_vehicle"}
    _PROXIMITY_LABELS = {"car", "truck", "bus", "motorcycle", "bicycle", "pedestrian"}

    # COCO label mapping (subset relevant to driving scenarios)
    _COCO_LABELS: dict[int, str] = {
        0: "person",
        1: "bicycle",
        2: "car",
        3: "motorcycle",
        5: "bus",
        7: "truck",
        9: "traffic_light",
        10: "fire_hydrant",
        11: "stop_sign",
        13: "bench",
        14: "bird",
        15: "cat",
        16: "dog",
        24: "backpack",
        56: "chair",
    }

    # COCO class IDs that may correspond to emergency vehicles.
    # Actual emergency classification requires additional model refinement,
    # but these vehicle classes are flagged for downstream logic.
    _EMERGENCY_LABEL_IDS: set[int] = {2, 3, 5, 7}

    # Labels that indicate lane-related detections
    _LANE_LABELS: set[str] = {"lane_marking", "lane_line", "lane"}

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

        logger.info(
            "Loading MobileNet SSD model from %s …", self._config.mobilenet.model_path
        )
        self._backend = ort.InferenceSession(self._config.mobilenet.model_path)

    # ── public API ──────────────────────────────────────────────────────

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

        if not self._backend:
            try:
                self._load_backend()
            except Exception:
                logger.exception(
                    "Failed to load %s backend; returning empty result", backend
                )
                return PerceptionResult(frame_timestamp_ms=timestamp_ms)

        try:
            detections = self._run_inference(frame_bytes, backend)
        except Exception:
            logger.exception(
                "Inference failed on %s backend; returning empty result", backend
            )
            return PerceptionResult(frame_timestamp_ms=timestamp_ms)

        emergency = any(d.label in self._EMERGENCY_LABELS for d in detections)
        proximity = any(d.label in self._PROXIMITY_LABELS for d in detections)
        lane_departure = self._check_lane_departure(detections)

        return PerceptionResult(
            detections=detections,
            emergency_vehicle_detected=emergency,
            lane_departure_detected=lane_departure,
            proximity_alert=proximity,
            frame_timestamp_ms=timestamp_ms,
        )

    # ── inference dispatch ──────────────────────────────────────────────

    def _run_inference(self, frame_bytes: bytes, backend: str) -> list[Detection]:
        """Preprocess, run model, and postprocess based on backend type."""
        if not _HAS_IMAGING:
            raise RuntimeError(
                "numpy and Pillow are required for inference. "
                "Install with: pip install thunai[perception]"
            )

        confidence_threshold = self._config.confidence_threshold

        if backend == "yolo":
            target_size = tuple(self._config.yolo.input_size)
            input_tensor = self._preprocess_frame(frame_bytes, target_size)
            # YOLOv8 expects NCHW float32 input
            input_tensor = np.transpose(input_tensor, (0, 3, 1, 2)).astype(np.float32)
            input_name = self._backend.get_inputs()[0].name  # type: ignore[union-attr]
            outputs = self._backend.run(None, {input_name: input_tensor})  # type: ignore[union-attr]
            return self._parse_yolo_output(outputs, confidence_threshold, target_size)

        if backend == "mobilenet":
            target_size = _MOBILENET_INPUT_SIZE
            input_tensor = self._preprocess_frame(frame_bytes, target_size)
            input_tensor = input_tensor.astype(np.float32)
            input_name = self._backend.get_inputs()[0].name  # type: ignore[union-attr]
            outputs = self._backend.run(None, {input_name: input_tensor})  # type: ignore[union-attr]
            return self._parse_mobilenet_output(outputs, confidence_threshold)

        raise ValueError(f"Unsupported backend for inference: {backend!r}")

    # ── image preprocessing ─────────────────────────────────────────────

    @staticmethod
    def _preprocess_frame(
        frame_bytes: bytes, target_size: tuple[int, int]
    ) -> "np.ndarray":
        """
        Decode image bytes, resize to *target_size*, and normalise to [0, 1].

        Returns a numpy array with shape ``(1, H, W, 3)`` (batch dimension included).
        """
        image = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
        image = image.resize(target_size, Image.BILINEAR)
        arr = np.asarray(image, dtype=np.float32) / 255.0
        return np.expand_dims(arr, axis=0)

    # ── NMS ──────────────────────────────────────────────────────────────

    @staticmethod
    def _apply_nms(
        boxes: "np.ndarray",
        scores: "np.ndarray",
        iou_threshold: float = _DEFAULT_IOU_THRESHOLD,
    ) -> list[int]:
        """
        Greedy Non-Max Suppression.

        Parameters
        ----------
        boxes : ndarray, shape (N, 4)
            Bounding boxes in ``(x1, y1, x2, y2)`` format.
        scores : ndarray, shape (N,)
            Confidence scores for each box.
        iou_threshold : float
            Boxes with IoU above this value are suppressed.

        Returns
        -------
        list[int]
            Indices of boxes that survive suppression, ordered by descending score.
        """

        if len(boxes) == 0:
            return []

        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)

        order = scores.argsort()[::-1]
        keep: list[int] = []

        while order.size > 0:
            i = int(order[0])
            keep.append(i)

            if order.size == 1:
                break

            rest = order[1:]
            xx1 = np.maximum(x1[i], x1[rest])
            yy1 = np.maximum(y1[i], y1[rest])
            xx2 = np.minimum(x2[i], x2[rest])
            yy2 = np.minimum(y2[i], y2[rest])

            inter_w = np.maximum(0.0, xx2 - xx1)
            inter_h = np.maximum(0.0, yy2 - yy1)
            intersection = inter_w * inter_h

            union = areas[i] + areas[rest] - intersection
            iou = np.where(union > 0, intersection / union, 0.0)

            remaining = np.where(iou <= iou_threshold)[0]
            order = rest[remaining]

        return keep

    # ── YOLO postprocessing ─────────────────────────────────────────────

    @classmethod
    def _parse_yolo_output(
        cls,
        outputs: list["np.ndarray"],
        confidence_threshold: float,
        input_size: tuple[int, int] = (640, 640),
    ) -> list[Detection]:
        """
        Parse YOLOv8 ONNX output into a list of detections.

        YOLOv8 raw output shape: ``(1, 4 + num_classes, num_predictions)``
        where the first 4 rows are ``cx, cy, w, h`` (in pixel coordinates)
        and remaining rows are per-class scores.

        Parameters
        ----------
        input_size:
            The (width, height) the image was resized to before inference.
            Used to normalise pixel-space coordinates to [0, 1].
        """
        raw = outputs[0]  # (1, 4+C, N)

        if raw.ndim == 3:
            raw = raw[0]  # drop batch → (4+C, N)

        # Transpose to (N, 4+C) for easier row-wise access
        preds = raw.T  # (N, 4+C)

        if preds.shape[1] <= 4:
            return []

        # Extract box coordinates (centre format) and class scores
        cx = preds[:, 0]
        cy = preds[:, 1]
        w = preds[:, 2]
        h = preds[:, 3]
        class_scores = preds[:, 4:]

        # Best class per prediction
        class_ids = np.argmax(class_scores, axis=1)
        max_scores = class_scores[np.arange(len(class_ids)), class_ids]

        # Confidence filter
        mask = max_scores >= confidence_threshold
        if not np.any(mask):
            return []

        cx, cy, w, h = cx[mask], cy[mask], w[mask], h[mask]
        class_ids = class_ids[mask]
        max_scores = max_scores[mask]

        # Convert centre-format to corner-format (x1, y1, x2, y2)
        x1 = cx - w / 2
        y1 = cy - h / 2
        x2 = cx + w / 2
        y2 = cy + h / 2

        boxes = np.stack([x1, y1, x2, y2], axis=1)

        # Apply NMS in pixel space (before normalisation)
        keep = cls._apply_nms(boxes, max_scores)

        # Normalise pixel coordinates to [0, 1] using input dimensions
        img_w, img_h = float(input_size[0]), float(input_size[1])

        detections: list[Detection] = []
        for idx in keep:
            cid = int(class_ids[idx])
            label = cls._COCO_LABELS.get(cid, f"class_{cid}")
            conf = float(max_scores[idx])
            bx = boxes[idx]
            bbox = (
                float(np.clip(bx[0] / img_w, 0.0, 1.0)),
                float(np.clip(bx[1] / img_h, 0.0, 1.0)),
                float(np.clip(bx[2] / img_w, 0.0, 1.0)),
                float(np.clip(bx[3] / img_h, 0.0, 1.0)),
            )
            detections.append(Detection(label=label, confidence=conf, bbox=bbox))

        return detections

    # ── MobileNet SSD postprocessing ────────────────────────────────────

    @classmethod
    def _parse_mobilenet_output(
        cls,
        outputs: list["np.ndarray"],
        confidence_threshold: float,
    ) -> list[Detection]:
        """
        Parse SSD MobileNetV2 ONNX output.

        Standard TF-exported SSD outputs (order may vary by export):
          - detection_boxes:   (1, N, 4)  in [y1, x1, y2, x2] normalised
          - detection_classes: (1, N)     class IDs (float, 1-indexed)
          - detection_scores:  (1, N)     confidence scores
          - num_detections:    (1,)       valid detection count

        We also handle the 2-output variant where boxes and scores are
        concatenated differently.
        """
        detections: list[Detection] = []

        if len(outputs) >= 4:
            # Standard 4-output SSD format
            det_boxes = np.squeeze(outputs[0])    # (N, 4)
            det_classes = np.squeeze(outputs[1])   # (N,)
            det_scores = np.squeeze(outputs[2])    # (N,)
            num_det = int(np.squeeze(outputs[3]))

            for i in range(min(num_det, len(det_scores))):
                score = float(det_scores[i])
                if score < confidence_threshold:
                    continue
                cid = int(det_classes[i])
                label = cls._COCO_LABELS.get(cid, f"class_{cid}")
                # SSD boxes are [y1, x1, y2, x2] normalised
                y1, x1, y2, x2 = (float(v) for v in det_boxes[i])
                bbox = (
                    max(0.0, min(1.0, x1)),
                    max(0.0, min(1.0, y1)),
                    max(0.0, min(1.0, x2)),
                    max(0.0, min(1.0, y2)),
                )
                detections.append(Detection(label=label, confidence=score, bbox=bbox))
        elif len(outputs) >= 1:
            # Fallback: single concatenated output (N, 7) format
            # [batch_id, class_id, score, x1, y1, x2, y2]
            raw = np.squeeze(outputs[0])
            if raw.ndim == 2 and raw.shape[1] >= 7:
                for row in raw:
                    score = float(row[2])
                    if score < confidence_threshold:
                        continue
                    cid = int(row[1])
                    label = cls._COCO_LABELS.get(cid, f"class_{cid}")
                    bbox = (
                        max(0.0, min(1.0, float(row[3]))),
                        max(0.0, min(1.0, float(row[4]))),
                        max(0.0, min(1.0, float(row[5]))),
                        max(0.0, min(1.0, float(row[6]))),
                    )
                    detections.append(Detection(label=label, confidence=score, bbox=bbox))

        return detections

    # ── lane departure detection ────────────────────────────────────────

    @classmethod
    def _check_lane_departure(cls, detections: list[Detection]) -> bool:
        """
        Heuristic lane-departure check based on detected lane markings.

        If lane markings are detected and any marking has its horizontal
        centre in the middle 40 percentage points of the frame (30%–70%),
        the marking is probably being crossed → potential departure.

        If no lane markings are detected at all, we conservatively return False.
        """
        lane_marks = [d for d in detections if d.label in cls._LANE_LABELS]
        if not lane_marks:
            return False

        # Check if any lane marking's horizontal centre is within the
        # vehicle's expected lane corridor (30 %–70 % of frame width).
        for det in lane_marks:
            x1, _y1, x2, _y2 = det.bbox
            cx = (x1 + x2) / 2.0
            if 0.3 <= cx <= 0.7:
                return True

        return False

    # ── stub backend ────────────────────────────────────────────────────

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
