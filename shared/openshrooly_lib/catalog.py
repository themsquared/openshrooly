"""Load seed profiles and supply lists from shared data files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .models import AffiliateLink, MushroomProfile, SupplyItem
from .schema import validate_profile

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _iter_json_files(directory: Path) -> Iterable[Path]:
    if not directory.is_dir():
        return []
    return sorted(path for path in directory.glob("*.json") if path.is_file())


def load_seed_profiles(
    data_dir: Path | None = None,
    *,
    include_psilocybin: bool = False,
) -> list[MushroomProfile]:
    root = Path(data_dir) if data_dir else DEFAULT_DATA_DIR
    profiles: list[MushroomProfile] = []
    packs = ["culinary"]
    if include_psilocybin:
        packs.append("psilocybin")
    for pack in packs:
        for path in _iter_json_files(root / "profiles" / pack):
            payload = json.loads(path.read_text(encoding="utf-8"))
            items = payload if isinstance(payload, list) else [payload]
            for item in items:
                profiles.append(validate_profile(item))
    return profiles


def load_profile_by_id(
    profile_id: str,
    data_dir: Path | None = None,
    *,
    include_psilocybin: bool = True,
) -> MushroomProfile | None:
    for profile in load_seed_profiles(data_dir, include_psilocybin=include_psilocybin):
        if profile.id == profile_id:
            return profile
    return None


def load_supply_catalog(data_dir: Path | None = None) -> list[SupplyItem]:
    root = Path(data_dir) if data_dir else DEFAULT_DATA_DIR
    path = root / "supplies" / "catalog.json"
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    items: list[SupplyItem] = []
    for row in payload.get("items", []):
        affiliate = None
        if row.get("affiliate"):
            affiliate = AffiliateLink.from_dict(row["affiliate"])
        items.append(
            SupplyItem(
                id=row["id"],
                name=row["name"],
                category=row["category"],
                notes=row.get("notes", ""),
                affiliate=affiliate,
            )
        )
    return items
