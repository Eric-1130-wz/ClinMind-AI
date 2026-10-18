"""Case catalogue and loader shared by the API and simulation engines.

The original project shipped a small catalogue of additional teaching cases,
but the runtime only knew about the chest-pain case.  This module keeps the
catalogue data-driven while leaving the existing high-risk chest-pain engine
unchanged.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import config


class CaseRepository:
    """Read-only repository for the bundled fictional teaching cases."""

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = data_dir or config.DATA_DIR
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._index: Dict[str, Dict[str, Any]] = {}
        self._load_all()

    def _read_json(self, path: Path) -> Dict[str, Any]:
        with path.open("r", encoding="utf-8-sig") as handle:
            value = json.load(handle)
        if not isinstance(value, dict) or not value.get("case_id"):
            raise ValueError(f"病例文件格式无效：{path.name}")
        return value

    def _load_all(self) -> None:
        index_path = self.data_dir / "cases" / "index.json"
        if index_path.exists():
            try:
                with index_path.open("r", encoding="utf-8-sig") as handle:
                    index_data = json.load(handle)
                self._index = {str(item["case_id"]): item for item in index_data.get("patients", []) if item.get("case_id")}
            except (OSError, ValueError, json.JSONDecodeError):
                self._index = {}
        paths = [self.data_dir / "case_chest_pain.json"]
        paths.extend(sorted((self.data_dir / "cases").glob("*.json")))
        for path in paths:
            if not path.exists() or path.name == "index.json":
                continue
            try:
                data = self._read_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                # A malformed optional case must not prevent the core case
                # from starting.  The API simply omits that case.
                continue
            self._cache[str(data["case_id"])] = data

    def ids(self) -> List[str]:
        return list(self._cache)

    def get(self, case_id: str) -> Optional[Dict[str, Any]]:
        aliases = {
            "CASE_2025_AORTIC_DISSECTION": "case_chest_pain_001",
            "case_aortic_dissection": "case_chest_pain_001",
        }
        return self._cache.get(aliases.get(case_id, case_id))

    def require(self, case_id: str) -> Dict[str, Any]:
        value = self.get(case_id)
        if value is None:
            raise KeyError(case_id)
        return value

    def summary(self, data: Dict[str, Any]) -> Dict[str, str]:
        catalogue = self._index.get(str(data["case_id"]), {})
        profile = data.get("patient_profile") or {}
        title = data.get("title") or catalogue.get("disease") or data.get("disease") or data["case_id"]
        complaint = data.get("chief_complaint") or catalogue.get("one_liner") or data.get("one_liner") or ""
        category = data.get("category") or catalogue.get("disease") or data.get("disease") or "临床综合训练"
        teaching = catalogue.get("core_teaching") or (data.get("game_extensions") or {}).get("core_teaching") or data.get("core_teaching") or category
        return {
            "case_id": str(data["case_id"]),
            "title": str(title),
            "difficulty": str(data.get("difficulty") or catalogue.get("difficulty") or "教学病例"),
            "chief_complaint": str(complaint),
            "target_competency": str(teaching),
            "description": str(catalogue.get("one_liner") or f"{profile.get('name', '虚拟患者')} · {category}"),
        }

    def summaries(self) -> List[Dict[str, str]]:
        return [self.summary(self._cache[key]) for key in self.ids()]


def get_case_repository() -> CaseRepository:
    """Return a fresh repository so development can add cases without restart."""
    return CaseRepository()
