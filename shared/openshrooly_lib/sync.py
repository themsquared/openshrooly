"""Hub <-> community sync payload helpers. Offline-first: hub is the home copy."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .models import GrowReport, MushroomProfile
from .schema import validate_profile


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class SyncEnvelope:
    direction: str
    hub_id: str
    generated_at: str
    profiles: list[MushroomProfile] = field(default_factory=list)
    grow_reports: list[GrowReport] = field(default_factory=list)
    since: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "direction": self.direction,
            "hub_id": self.hub_id,
            "generated_at": self.generated_at,
            "since": self.since,
            "profiles": [profile.to_dict() for profile in self.profiles],
            "grow_reports": [report.to_dict() for report in self.grow_reports],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SyncEnvelope":
        return cls(
            direction=data["direction"],
            hub_id=data["hub_id"],
            generated_at=data.get("generated_at", utc_now()),
            since=data.get("since"),
            profiles=[validate_profile(item) for item in data.get("profiles", [])],
            grow_reports=[GrowReport(**item) for item in data.get("grow_reports", [])],
        )


def build_push(
    hub_id: str,
    profiles: list[MushroomProfile],
    reports: list[GrowReport] | None = None,
) -> SyncEnvelope:
    return SyncEnvelope(
        direction="push",
        hub_id=hub_id,
        generated_at=utc_now(),
        profiles=profiles,
        grow_reports=reports or [],
    )


def merge_profiles(
    local: list[MushroomProfile], incoming: list[MushroomProfile]
) -> list[MushroomProfile]:
    """Last-writer-wins by id. Incoming community/hub copies replace local ones."""
    by_id = {profile.id: profile for profile in local}
    by_id.update({profile.id: profile for profile in incoming})
    return list(by_id.values())
