from __future__ import annotations

from datetime import datetime
from enum import IntEnum
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field, field_validator


class AnxietySensitivityScore(BaseModel):
    """Computed from onboarding interview. Range 0.0 – 1.0."""

    overall: float = Field(ge=0.0, le=1.0)
    night_driving: float = Field(ge=0.0, le=1.0, default=0.0)
    highway_merges: float = Field(ge=0.0, le=1.0, default=0.0)
    narrow_lanes: float = Field(ge=0.0, le=1.0, default=0.0)
    heavy_vehicles: float = Field(ge=0.0, le=1.0, default=0.0)
    social_judgment: float = Field(ge=0.0, le=1.0, default=0.0)
    post_accident: bool = False


class UserProfile(BaseModel):
    user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    anxiety_score: AnxietySensitivityScore
    baseline_hr_bpm: float = 72.0
    baseline_hrv_ms: float = 45.0
    experience_months: int = 0
    confidence_score: float = Field(ge=0.0, le=1.0, default=0.5)
    total_drives: int = 0
    preferred_language: str = "en-IN"


class OBDReading(BaseModel):
    """Single OBD-2 sample from the CAN bus."""

    timestamp_ms: int
    speed_kmh: float
    rpm: float
    throttle_pct: float
    engine_load_pct: float
    coolant_temp_c: float


class BiometricReading(BaseModel):
    """Smartwatch sample (HR + HRV)."""

    timestamp_ms: int
    hr_bpm: float
    hrv_rmssd_ms: float


class StressReading(BaseModel):
    """Composite stress index computed by StressIndexEngine."""

    timestamp_ms: int
    score: float = Field(ge=0.0, le=1.0)
    obd_component: float = Field(ge=0.0, le=1.0, default=0.0)
    hr_component: float = Field(ge=0.0, le=1.0, default=0.0)
    hrv_component: float = Field(ge=0.0, le=1.0, default=0.0)
    severity: Literal[0, 1, 2, 3, 4] = 0


class DetectedObject(BaseModel):
    """Single detection from the perception layer."""

    label: str
    confidence: float
    bbox: Tuple[float, float, float, float]
    camera: Literal["irvm", "b_pillar_left", "b_pillar_right"]

    @field_validator("confidence")
    def _check_confidence(cls, value: float) -> float:
        if not 0.0 <= value <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        return value


class PerceptionFrame(BaseModel):
    timestamp_ms: int
    detections: List[DetectedObject] = []
    emergency_vehicle: bool = False
    lane_departure: bool = False
    proximity_alert: bool = False


class InterventionLevel(IntEnum):
    NONE = 0
    MILD = 1
    MODERATE = 2
    SEVERE = 3
    EMERGENCY = 4


class Intervention(BaseModel):
    timestamp_ms: int
    level: InterventionLevel
    trigger: str
    text: str
    audio_path: Optional[str] = None
    source: Literal["dictionary", "slm", "rule"] = "rule"


class RouteOption(BaseModel):
    route_id: str
    label: str
    eta_minutes: int
    distance_km: float
    anxiety_score: float = Field(ge=0.0, le=100.0)
    triggers: List[str] = []
    polyline: str


class StressEvent(BaseModel):
    timestamp_ms: int
    severity: int
    trigger_type: str
    stress_score: float
    intervention_fired: bool


class DriveSession(BaseModel):
    drive_id: str
    user_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    route_option: Optional[RouteOption] = None
    obd_readings: List[OBDReading] = []
    biometric_readings: List[BiometricReading] = []
    stress_events: List[StressEvent] = []
    interventions_fired: List[Intervention] = []
    confidence_score_start: float = 0.5
    confidence_score_end: Optional[float] = None


class DriveReport(BaseModel):
    drive_id: str
    user_id: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    overall_confidence_score: float
    narrative: str
    top_triggers: List[str]
    improvement_vs_prev: Optional[float] = None
    synthetic_scenarios: List[dict] = []
