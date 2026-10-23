"""Validation for mushroom profiles, including psilocybin commerce rules."""

from __future__ import annotations

from typing import Any

from .models import MushroomProfile

PROFILE_SCHEMA_VERSION = 1
KNOWN_STAGE_IDS = {
    "colonization",
    "pinning",
    "fruiting",
    "rest",
    "flush",
    "cold_shock",
    "browning",
}
PSILOCYBIN_LEGAL_NOTICE = (
    "Legality of cultivating Psilocybe species varies by jurisdiction. "
    "This pack is informational environmental setpoints for a fruiting chamber "
    "and is disabled by default. You are responsible for following local law."
)

# Card networks and mainstream affiliate programs prohibit these items.
PSILOCYBIN_BLOCKED_PROVIDERS = {"stripe", "paypal", "square"}


class ValidationError(ValueError):
    """Raised when a profile document is not usable."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def validate_profile(data: dict[str, Any] | MushroomProfile) -> MushroomProfile:
    profile = data if isinstance(data, MushroomProfile) else MushroomProfile.from_dict(data)

    _require(bool(profile.id), "profile.id is required")
    _require(bool(profile.name), "profile.name is required")
    _require(bool(profile.species), "profile.species is required")
    _require(len(profile.stages) >= 1, "profile must include at least one stage")
    _require(
        profile.schema_version == PROFILE_SCHEMA_VERSION,
        f"unsupported schema_version {profile.schema_version}",
    )
    _require(profile.pack in {"culinary", "psilocybin"}, "pack must be culinary or psilocybin")

    seen_stages: set[str] = set()
    for stage in profile.stages:
        _require(stage.id not in seen_stages, f"duplicate stage id {stage.id}")
        seen_stages.add(stage.id)
        _require(stage.duration_days > 0, f"stage {stage.id} duration_days must be > 0")
        _require(30 <= stage.humidity_percent <= 100, f"stage {stage.id} humidity out of range")
        _require(10 <= stage.temperature_c <= 35, f"stage {stage.id} temperature out of range")
        _require(0 <= stage.light.sunrise_hour <= 23, f"stage {stage.id} sunrise_hour invalid")
        _require(0 <= stage.light.duration_hours <= 24, f"stage {stage.id} light duration invalid")
        _require(0 <= stage.light.white_led_lux <= 4000, f"stage {stage.id} white_led_lux invalid")
        _require(15 <= stage.fan.speed_percent <= 100, f"stage {stage.id} fan speed invalid")
        _require(1 <= stage.fan.period_min <= 240, f"stage {stage.id} fan period invalid")
        _require(5 <= stage.fan.run_duration_s <= 900, f"stage {stage.id} fan run duration invalid")
        downtime = stage.fan.period_min * 60 - stage.fan.run_duration_s
        _require(downtime >= 60, f"stage {stage.id} fan cycle needs >= 60s downtime")

    if profile.pricing.kind == "paid":
        _require(1_00 <= profile.pricing.amount_cents <= 20_00, "paid profiles must be $1-$20")
        _require(bool(profile.allowed_payment_providers), "paid profiles need allowed_payment_providers")
    else:
        _require(profile.pricing.amount_cents == 0, "free profiles must have amount_cents=0")

    if profile.is_psilocybin:
        _require(profile.pack == "psilocybin", "psilocybin profiles must use pack=psilocybin")
        _require(profile.restricted, "psilocybin profiles must set restricted=true")
        _require(profile.is_free, "psilocybin pack must remain free in this release")
        _require(not profile.allowed_payment_providers, "psilocybin pack cannot route payments")
        _require(not profile.affiliates_allowed, "psilocybin pack cannot allow affiliates")
        _require(not profile.affiliate_links, "psilocybin pack cannot carry affiliate links")
        blocked = set(p.lower() for p in profile.allowed_payment_providers) & PSILOCYBIN_BLOCKED_PROVIDERS
        _require(not blocked, "card processors cannot be attached to the psilocybin pack")
        _require(bool(profile.legal_notice), "psilocybin profiles need a legal_notice")

    if not profile.affiliates_allowed:
        _require(not profile.affiliate_links, "affiliates_allowed=false cannot include links")

    return profile


def export_json_dict(profile: MushroomProfile) -> dict[str, Any]:
    validate_profile(profile)
    return profile.to_dict()
