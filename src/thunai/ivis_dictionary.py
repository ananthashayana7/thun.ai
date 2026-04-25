"""Founder-approved IVIS response dictionary loader."""

from __future__ import annotations

import json
from dataclasses import dataclass
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_CATALOG_PATH = _REPO_ROOT / "config" / "ivis_dictionary.json"
_SUPPORTED_MODES = {"mode_1", "mode_2", "mode_3"}


def _normalize_mode(mode: str | None) -> str:
    if not mode:
        return "mode_2"

    normalized = mode.strip().lower().replace("-", "_")
    aliases = {
        "mode1": "mode_1",
        "mode2": "mode_2",
        "mode3": "mode_3",
        "1": "mode_1",
        "2": "mode_2",
        "3": "mode_3",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in _SUPPORTED_MODES:
        logger.warning("Unknown IVIS dictionary mode %r; defaulting to mode_2.", mode)
        return "mode_2"
    return normalized


@dataclass(frozen=True)
class IVISRuleEntry:
    """Single founder-authored IVIS rule entry."""

    rule_id: str
    category: str
    scenario: str
    what_needs_to_be_done: str
    driver_state: str
    typical_human_reaction: str
    ideal_human_response: str
    reference_response: str
    mode_1: str
    mode_2: str
    mode_3: str
    runtime_event_types: tuple[str, ...] = ()

    def response_for_mode(self, mode: str | None) -> tuple[str, str]:
        normalized_mode = _normalize_mode(mode)
        mode_map = {
            "mode_1": self.mode_1,
            "mode_2": self.mode_2,
            "mode_3": self.mode_3,
        }

        response = mode_map.get(normalized_mode, "").strip()
        if response:
            return normalized_mode, response

        for fallback_mode in ("mode_2", "mode_1", "mode_3"):
            fallback_response = mode_map[fallback_mode].strip()
            if fallback_response:
                return fallback_mode, fallback_response

        raise ValueError(f"Rule {self.rule_id} has no configured IVIS responses.")


@dataclass(frozen=True)
class ResolvedRuleResponse:
    """Concrete response text selected for runtime delivery."""

    rule_id: str
    category: str
    scenario: str
    mode: str
    text: str


class IVISRuleCatalog:
    """Load and resolve founder-authored IVIS rules."""

    def __init__(
        self,
        *,
        source_path: Path,
        rules_by_id: dict[str, IVISRuleEntry],
        runtime_event_map: dict[str, str],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.source_path = source_path
        self._rules_by_id = rules_by_id
        self._runtime_event_map = runtime_event_map
        self.metadata = metadata or {}

    def __len__(self) -> int:
        return len(self._rules_by_id)

    @property
    def mapped_event_types(self) -> tuple[str, ...]:
        return tuple(sorted(self._runtime_event_map))

    @classmethod
    def load(cls, path: str | Path | None = None) -> "IVISRuleCatalog":
        source_path = cls._resolve_path(path)
        with source_path.open(encoding="utf-8") as fh:
            payload = json.load(fh)

        rules_by_id: dict[str, IVISRuleEntry] = {}
        for raw_rule in payload.get("rules", []):
            rule = IVISRuleEntry(
                rule_id=raw_rule["rule_id"],
                category=raw_rule.get("category", ""),
                scenario=raw_rule.get("scenario", ""),
                what_needs_to_be_done=raw_rule.get("what_needs_to_be_done", ""),
                driver_state=raw_rule.get("driver_state", ""),
                typical_human_reaction=raw_rule.get("typical_human_reaction", ""),
                ideal_human_response=raw_rule.get("ideal_human_response", ""),
                reference_response=raw_rule.get("reference_response", ""),
                mode_1=raw_rule.get("mode_1", ""),
                mode_2=raw_rule.get("mode_2", ""),
                mode_3=raw_rule.get("mode_3", ""),
                runtime_event_types=tuple(raw_rule.get("runtime_event_types", [])),
            )
            rules_by_id[rule.rule_id] = rule

        runtime_event_map: dict[str, str] = {}
        for event_type, raw_mapping in payload.get("runtime_event_map", {}).items():
            if isinstance(raw_mapping, str):
                runtime_event_map[event_type] = raw_mapping
            elif isinstance(raw_mapping, dict) and raw_mapping.get("rule_id"):
                runtime_event_map[event_type] = raw_mapping["rule_id"]

        return cls(
            source_path=source_path,
            rules_by_id=rules_by_id,
            runtime_event_map=runtime_event_map,
            metadata=payload.get("metadata", {}),
        )

    @staticmethod
    def _resolve_path(path: str | Path | None) -> Path:
        if path is None:
            return _DEFAULT_CATALOG_PATH

        candidate = Path(path)
        if candidate.is_absolute():
            return candidate
        return _REPO_ROOT / candidate

    def get_rule(self, rule_id: str) -> IVISRuleEntry | None:
        return self._rules_by_id.get(rule_id)

    def resolve_rule(
        self,
        rule_id: str,
        mode: str | None = None,
    ) -> ResolvedRuleResponse | None:
        rule = self.get_rule(rule_id)
        if not rule:
            return None

        selected_mode, response_text = rule.response_for_mode(mode)
        return ResolvedRuleResponse(
            rule_id=rule.rule_id,
            category=rule.category,
            scenario=rule.scenario,
            mode=selected_mode,
            text=response_text,
        )

    def resolve_runtime_event(
        self,
        event_type: str,
        mode: str | None = None,
    ) -> ResolvedRuleResponse | None:
        mapped_rule_id = self._runtime_event_map.get(event_type)
        if not mapped_rule_id:
            return None
        return self.resolve_rule(mapped_rule_id, mode)
