"""Tests for the perception module."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from thunai.config import PerceptionConfig
from thunai.perception import (
    Detection,
    ObjectDetector,
    PerceptionResult,
    StubPerception,
    build_perception_provider,
)


class TestStubDetect:
    """Test the stub backend returns valid PerceptionResult."""

    def test_stub_backend_returns_perception_result(self):
        config = PerceptionConfig(backend="stub")
        detector = ObjectDetector(config)
        result = detector.detect(b"fake-frame-data", timestamp_ms=1000.0)

        assert isinstance(result, PerceptionResult)
        assert result.frame_timestamp_ms == 1000.0
        assert len(result.detections) > 0
        assert result.emergency_vehicle_detected is False
        assert result.lane_departure_detected is False

    def test_stub_returns_expected_labels(self):
        config = PerceptionConfig(backend="stub")
        detector = ObjectDetector(config)
        result = detector.detect(b"data")
        labels = result.labels
        assert "car" in labels
        assert "road" in labels

    def test_stub_detection_has_valid_confidence(self):
        config = PerceptionConfig(backend="stub")
        detector = ObjectDetector(config)
        result = detector.detect(b"data")

        for det in result.detections:
            assert 0.0 <= det.confidence <= 1.0

    def test_stub_detection_has_valid_bbox(self):
        config = PerceptionConfig(backend="stub")
        detector = ObjectDetector(config)
        result = detector.detect(b"data")

        for det in result.detections:
            x1, y1, x2, y2 = det.bbox
            assert x1 <= x2
            assert y1 <= y2


class TestInvalidBackend:
    """Test that invalid backends raise ValueError."""

    def test_invalid_backend_raises_value_error(self):
        config = PerceptionConfig(backend="invalid_backend")
        detector = ObjectDetector(config)
        with pytest.raises(ValueError, match="Unknown perception backend"):
            detector._load_backend()


class TestYOLOBackend:
    """Test YOLO backend attempts model load (mocked onnxruntime)."""

    @patch.dict("sys.modules", {"onnxruntime": MagicMock()})
    def test_yolo_load_attempts_inference_session(self):
        import sys

        mock_ort = sys.modules["onnxruntime"]
        mock_session = MagicMock()
        mock_ort.InferenceSession.return_value = mock_session

        config = PerceptionConfig(backend="yolo")
        detector = ObjectDetector(config)
        detector._load_yolo()

        mock_ort.InferenceSession.assert_called_once_with(config.yolo.model_path)
        assert detector._backend is mock_session

    def test_yolo_raises_import_error_without_onnxruntime(self):
        config = PerceptionConfig(backend="yolo")
        detector = ObjectDetector(config)
        # onnxruntime is not installed in test env, so this should raise
        with pytest.raises(ImportError, match="onnxruntime"):
            detector._load_yolo()


class TestMobileNetBackend:
    """Test MobileNet backend attempts model load (mocked onnxruntime)."""

    @patch.dict("sys.modules", {"onnxruntime": MagicMock()})
    def test_mobilenet_load_attempts_inference_session(self):
        import sys

        mock_ort = sys.modules["onnxruntime"]
        mock_session = MagicMock()
        mock_ort.InferenceSession.return_value = mock_session

        config = PerceptionConfig(backend="mobilenet")
        detector = ObjectDetector(config)
        detector._load_mobilenet()

        mock_ort.InferenceSession.assert_called_once_with(config.mobilenet.model_path)
        assert detector._backend is mock_session

    def test_mobilenet_raises_import_error_without_onnxruntime(self):
        config = PerceptionConfig(backend="mobilenet")
        detector = ObjectDetector(config)
        with pytest.raises(ImportError, match="onnxruntime"):
            detector._load_mobilenet()


class TestEmergencyVehicleDetection:
    """Test emergency vehicle label detection."""

    def test_emergency_labels_are_defined(self):
        expected = {"ambulance", "fire_truck", "police_car", "emergency_vehicle"}
        assert ObjectDetector._EMERGENCY_LABELS == expected

    def test_emergency_detection_from_detections(self):
        detections = [
            Detection(label="ambulance", confidence=0.9, bbox=(0.1, 0.1, 0.5, 0.5)),
            Detection(label="car", confidence=0.85, bbox=(0.2, 0.2, 0.6, 0.6)),
        ]
        emergency = any(
            d.label in ObjectDetector._EMERGENCY_LABELS for d in detections
        )
        assert emergency is True

    def test_no_emergency_without_emergency_labels(self):
        detections = [
            Detection(label="car", confidence=0.9, bbox=(0.1, 0.1, 0.5, 0.5)),
            Detection(label="truck", confidence=0.8, bbox=(0.2, 0.2, 0.6, 0.6)),
        ]
        emergency = any(
            d.label in ObjectDetector._EMERGENCY_LABELS for d in detections
        )
        assert emergency is False


class TestProximityAlertDetection:
    """Test proximity alert label detection."""

    def test_proximity_labels_are_defined(self):
        expected = {"car", "truck", "bus", "motorcycle", "bicycle", "pedestrian"}
        assert ObjectDetector._PROXIMITY_LABELS == expected

    def test_proximity_alert_triggered_by_vehicle(self):
        detections = [
            Detection(label="car", confidence=0.9, bbox=(0.1, 0.1, 0.5, 0.5)),
        ]
        proximity = any(
            d.label in ObjectDetector._PROXIMITY_LABELS for d in detections
        )
        assert proximity is True

    def test_no_proximity_for_non_vehicle_labels(self):
        detections = [
            Detection(label="traffic_light", confidence=0.9, bbox=(0.1, 0.1, 0.2, 0.2)),
        ]
        proximity = any(
            d.label in ObjectDetector._PROXIMITY_LABELS for d in detections
        )
        assert proximity is False


class TestPerceptionResult:
    """Test PerceptionResult properties."""

    def test_labels_property(self):
        result = PerceptionResult(
            detections=[
                Detection(label="car", confidence=0.9),
                Detection(label="bus", confidence=0.8),
            ]
        )
        assert result.labels == ["car", "bus"]

    def test_empty_result_defaults(self):
        result = PerceptionResult()
        assert result.detections == []
        assert result.emergency_vehicle_detected is False
        assert result.lane_departure_detected is False
        assert result.proximity_alert is False
        assert result.frame_timestamp_ms == 0.0


class TestStubPerception:
    """Test StubPerception process_frame returns PerceptionFrame."""

    def test_process_frame_returns_perception_frame(self):
        from thunai.models import PerceptionFrame

        cfg = {"perception": {"provider": "stub", "stub": {"frame_rate_hz": 5}}}
        stub = StubPerception(cfg)
        frame = stub.process_frame()

        assert isinstance(frame, PerceptionFrame)
        assert frame.timestamp_ms > 0
        assert len(frame.detections) > 0

    def test_provider_name_is_stub(self):
        cfg = {"perception": {"provider": "stub", "stub": {"frame_rate_hz": 5}}}
        stub = StubPerception(cfg)
        assert stub.provider_name == "stub"

    def test_is_healthy_returns_true(self):
        cfg = {"perception": {"provider": "stub", "stub": {}}}
        stub = StubPerception(cfg)
        assert stub.is_healthy() is True

    def test_emergency_vehicle_periodic(self):
        cfg = {"perception": {"provider": "stub", "stub": {"frame_rate_hz": 3}}}
        stub = StubPerception(cfg)
        # Frame rate is 3, so emergency triggers every 3rd frame
        results = [stub.process_frame().emergency_vehicle for _ in range(6)]
        assert any(results), "At least one frame should have emergency_vehicle=True"

    def test_detections_have_car_label(self):
        cfg = {"perception": {"provider": "stub", "stub": {}}}
        stub = StubPerception(cfg)
        frame = stub.process_frame()
        labels = [d.label for d in frame.detections]
        assert "car" in labels


class TestBuildPerceptionProvider:
    """Test factory function."""

    def test_build_stub_provider(self):
        cfg = {"perception": {"provider": "stub", "stub": {}}}
        provider = build_perception_provider(cfg)
        assert isinstance(provider, StubPerception)

    def test_build_unknown_provider_raises(self):
        cfg = {"perception": {"provider": "unknown_backend"}}
        with pytest.raises(ValueError, match="Unknown perception provider"):
            build_perception_provider(cfg)

    def test_build_with_backend_key(self):
        cfg = {"perception": {"backend": "stub", "stub": {}}}
        provider = build_perception_provider(cfg)
        assert isinstance(provider, StubPerception)


class TestLaneDeparture:
    """Test the lane departure heuristic."""

    def test_no_lane_markings_returns_false(self):
        detections = [Detection(label="car", confidence=0.9)]
        assert ObjectDetector._check_lane_departure(detections) is False

    def test_lane_marking_in_centre_returns_true(self):
        detections = [
            Detection(label="lane_marking", confidence=0.9, bbox=(0.4, 0.5, 0.6, 0.8)),
        ]
        assert ObjectDetector._check_lane_departure(detections) is True

    def test_lane_marking_on_edge_returns_false(self):
        detections = [
            Detection(label="lane_marking", confidence=0.9, bbox=(0.0, 0.5, 0.1, 0.8)),
        ]
        assert ObjectDetector._check_lane_departure(detections) is False
