"""Dataclasses for mushroom profiles, grow reports, and commerce metadata."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

PaymentKind = Literal["free", "paid"]
PackId = Literal["culinary", "psilocybin"]
StageId = Literal["colonization", "pinning", "fruiting", "rest", "flush", "cold_shock", "browning"]


@dataclass
class SourceNote:
    title: str
    detail: str
    url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data = {"title": self.title, "detail": self.detail}
        if self.url:
            data["url"] = self.url
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SourceNote":
        return cls(title=data["title"], detail=data["detail"], url=data.get("url"))


@dataclass
class LightSchedule:
    sunrise_hour: int = 8
    duration_hours: float = 12
    white_led_lux: int = 150
    red_percent: int = 0
    green_percent: int = 0
    blue_percent: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "LightSchedule":
        if not data:
            return cls()
        return cls(
            sunrise_hour=int(data.get("sunrise_hour", 8)),
            duration_hours=float(data.get("duration_hours", 12)),
            white_led_lux=int(data.get("white_led_lux", 150)),
            red_percent=int(data.get("red_percent", 0)),
            green_percent=int(data.get("green_percent", 0)),
            blue_percent=int(data.get("blue_percent", 0)),
        )


@dataclass
class FanSchedule:
    period_min: int = 15
    run_duration_s: int = 30
    speed_percent: int = 30

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "FanSchedule":
        if not data:
            return cls()
        return cls(
            period_min=int(data.get("period_min", 15)),
            run_duration_s=int(data.get("run_duration_s", 30)),
            speed_percent=int(data.get("speed_percent", 30)),
        )


@dataclass
class ProfileStage:
    id: str
    name: str
    duration_days: float
    humidity_percent: float
    temperature_c: float
    light: LightSchedule = field(default_factory=LightSchedule)
    fan: FanSchedule = field(default_factory=FanSchedule)
    humidity_hysteresis: float = 2.0
    temperature_hysteresis: float = 1.0
    temperature_control_enabled: bool = True
    temperature_warning_min_c: float = 16.0
    temperature_warning_max_c: float = 28.0
    humidifier_speed_percent: float = 75.0
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "duration_days": self.duration_days,
            "humidity_percent": self.humidity_percent,
            "humidity_hysteresis": self.humidity_hysteresis,
            "temperature_c": self.temperature_c,
            "temperature_hysteresis": self.temperature_hysteresis,
            "temperature_control_enabled": self.temperature_control_enabled,
            "temperature_warning_min_c": self.temperature_warning_min_c,
            "temperature_warning_max_c": self.temperature_warning_max_c,
            "humidifier_speed_percent": self.humidifier_speed_percent,
            "light": self.light.to_dict(),
            "fan": self.fan.to_dict(),
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProfileStage":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"].replace("_", " ").title()),
            duration_days=float(data["duration_days"]),
            humidity_percent=float(data["humidity_percent"]),
            temperature_c=float(data["temperature_c"]),
            light=LightSchedule.from_dict(data.get("light")),
            fan=FanSchedule.from_dict(data.get("fan")),
            humidity_hysteresis=float(data.get("humidity_hysteresis", 2.0)),
            temperature_hysteresis=float(data.get("temperature_hysteresis", 1.0)),
            temperature_control_enabled=bool(data.get("temperature_control_enabled", True)),
            temperature_warning_min_c=float(data.get("temperature_warning_min_c", 16.0)),
            temperature_warning_max_c=float(data.get("temperature_warning_max_c", 28.0)),
            humidifier_speed_percent=float(data.get("humidifier_speed_percent", 75.0)),
            notes=data.get("notes", ""),
        )


@dataclass
class Pricing:
    kind: PaymentKind = "free"
    amount_cents: int = 0
    currency: str = "USD"
    creator_share_percent: int = 70

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "Pricing":
        if not data:
            return cls()
        return cls(
            kind=data.get("kind", "free"),
            amount_cents=int(data.get("amount_cents", 0)),
            currency=data.get("currency", "USD"),
            creator_share_percent=int(data.get("creator_share_percent", 70)),
        )


@dataclass
class AffiliateLink:
    id: str
    label: str
    merchant: str
    url: str
    disclosure: str = (
        "We may earn a commission if you buy through this link, at no extra cost to you."
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AffiliateLink":
        return cls(
            id=data["id"],
            label=data["label"],
            merchant=data["merchant"],
            url=data["url"],
            disclosure=data.get("disclosure", cls.disclosure),
        )


@dataclass
class MushroomProfile:
    id: str
    name: str
    species: str
    stages: list[ProfileStage]
    strain: str = ""
    variety_group: str = ""
    pack: PackId = "culinary"
    tags: list[str] = field(default_factory=list)
    summary: str = ""
    notes: str = ""
    chamber_notes: str = ""
    source_notes: list[SourceNote] = field(default_factory=list)
    legal_notice: str | None = None
    restricted: bool = False
    pricing: Pricing = field(default_factory=Pricing)
    allowed_payment_providers: list[str] = field(default_factory=list)
    affiliates_allowed: bool = True
    affiliate_links: list[AffiliateLink] = field(default_factory=list)
    schema_version: int = 1
    fork_of: str | None = None
    author: str | None = None
    firmware_compat: dict[str, Any] = field(
        default_factory=lambda: {
            "min_version": "1.0.0",
            "uses_existing_entities_only": True,
        }
    )

    @property
    def is_psilocybin(self) -> bool:
        return self.pack == "psilocybin" or "psilocybin" in self.tags or self.restricted

    @property
    def is_free(self) -> bool:
        return self.pricing.kind == "free" or self.pricing.amount_cents <= 0

    def total_days(self) -> float:
        return sum(stage.duration_days for stage in self.stages)

    def stage_by_id(self, stage_id: str) -> ProfileStage:
        for stage in self.stages:
            if stage.id == stage_id:
                return stage
        raise KeyError(stage_id)

    def stage_at_day(self, elapsed_days: float) -> ProfileStage:
        cursor = 0.0
        for stage in self.stages:
            cursor += stage.duration_days
            if elapsed_days < cursor:
                return stage
        return self.stages[-1]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "id": self.id,
            "name": self.name,
            "species": self.species,
            "strain": self.strain,
            "variety_group": self.variety_group,
            "pack": self.pack,
            "tags": list(self.tags),
            "restricted": self.restricted,
            "summary": self.summary,
            "notes": self.notes,
            "chamber_notes": self.chamber_notes,
            "legal_notice": self.legal_notice,
            "source_notes": [note.to_dict() for note in self.source_notes],
            "stages": [stage.to_dict() for stage in self.stages],
            "pricing": self.pricing.to_dict(),
            "allowed_payment_providers": list(self.allowed_payment_providers),
            "affiliates_allowed": self.affiliates_allowed,
            "affiliate_links": [link.to_dict() for link in self.affiliate_links],
            "fork_of": self.fork_of,
            "author": self.author,
            "firmware_compat": dict(self.firmware_compat),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MushroomProfile":
        return cls(
            id=data["id"],
            name=data["name"],
            species=data["species"],
            stages=[ProfileStage.from_dict(stage) for stage in data.get("stages", [])],
            strain=data.get("strain", ""),
            variety_group=data.get("variety_group", ""),
            pack=data.get("pack", "culinary"),
            tags=list(data.get("tags", [])),
            summary=data.get("summary", ""),
            notes=data.get("notes", ""),
            chamber_notes=data.get("chamber_notes", ""),
            source_notes=[SourceNote.from_dict(note) for note in data.get("source_notes", [])],
            legal_notice=data.get("legal_notice"),
            restricted=bool(data.get("restricted", False)),
            pricing=Pricing.from_dict(data.get("pricing")),
            allowed_payment_providers=list(data.get("allowed_payment_providers", [])),
            affiliates_allowed=bool(data.get("affiliates_allowed", True)),
            affiliate_links=[
                AffiliateLink.from_dict(link) for link in data.get("affiliate_links", [])
            ],
            schema_version=int(data.get("schema_version", 1)),
            fork_of=data.get("fork_of"),
            author=data.get("author"),
            firmware_compat=dict(
                data.get(
                    "firmware_compat",
                    {"min_version": "1.0.0", "uses_existing_entities_only": True},
                )
            ),
        )


@dataclass
class GrowReport:
    profile_id: str
    outcome: Literal["success", "partial", "fail"]
    notes: str = ""
    days: float | None = None
    flushes: int | None = None
    device_name: str | None = None
    author: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SupplyItem:
    id: str
    name: str
    category: str
    affiliate: AffiliateLink | None = None
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "notes": self.notes,
            "affiliate": self.affiliate.to_dict() if self.affiliate else None,
        }
