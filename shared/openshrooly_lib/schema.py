"""Validation for mushroom profiles, including psilocybin commerce rules."""

from __future__ import annotations

import copy
import math
from typing import Any
from urllib.parse import urlparse

from .mapping import lux_to_brightness_percent
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
    "Psilocybin mushrooms are illegal to grow, possess, or sell in most countries "
    "and under US federal law. This information is published for "
    "educational, research and harm-reduction purposes only. Check the laws where "
    "you live. Shroom Labs does not sell spores, cultures or psilocybin products."
)

# Card networks and mainstream affiliate programs prohibit these items.
PSILOCYBIN_BLOCKED_PROVIDERS = {"stripe", "paypal", "square"}


class ValidationError(ValueError):
    """Raised when a profile document is not usable."""


def is_https_source_url(url: str | None) -> bool:
    """True when a source link is absent or is an https URL with a host."""
    if url is None:
        return True
    text = str(url).strip()
    if not text:
        return True
    parsed = urlparse(text)
    return parsed.scheme == "https" and bool(parsed.netloc)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


# Firmware 1.0.3-sl.6 uses 12 h when lux or RGB is on and duration is 0 or unset.
FIRMWARE_FALLBACK_LIGHT_HOURS = 12
DEFAULT_SUNRISE_HOUR = 8
_STAGE_CHANNELS = ("white_led_lux", "red_percent", "green_percent", "blue_percent")
_PHASE_CHANNELS = ("white_brightness_percent", "red_percent", "green_percent", "blue_percent")


def _finite_or(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return int(number) if number.is_integer() else number


def _normalize_stage_light(light: Any) -> dict[str, Any]:
    if not isinstance(light, dict) or not light:
        return {
            "sunrise_hour": DEFAULT_SUNRISE_HOUR,
            "duration_hours": 0,
            "white_led_lux": 0,
            "red_percent": 0,
            "green_percent": 0,
            "blue_percent": 0,
        }
    out = dict(light)
    out["sunrise_hour"] = _finite_or(light.get("sunrise_hour"), DEFAULT_SUNRISE_HOUR)
    for channel in _STAGE_CHANNELS:
        out[channel] = _finite_or(light.get(channel), 0)
    hours = _finite_or(light.get("duration_hours"), None)
    on = any(float(out[channel]) > 0 for channel in _STAGE_CHANNELS)
    if on and not (hours is not None and hours > 0):
        out["duration_hours"] = FIRMWARE_FALLBACK_LIGHT_HOURS
    else:
        out["duration_hours"] = 0 if hours is None else hours
    return out


def _normalize_phase(phase: dict[str, Any]) -> dict[str, Any]:
    out = dict(phase)
    for channel in _PHASE_CHANNELS:
        out[channel] = _finite_or(phase.get(channel), 0)
    hours = _finite_or(phase.get("photoperiod_hours"), None)
    on = any(float(out[channel]) > 0 for channel in _PHASE_CHANNELS)
    if on and not (hours is not None and hours > 0):
        out["photoperiod_hours"] = FIRMWARE_FALLBACK_LIGHT_HOURS
    else:
        out["photoperiod_hours"] = 0 if hours is None else hours
    return out


def normalize_stored_light(data: dict[str, Any]) -> dict[str, Any]:
    """Read path only, same rules as normalizeStoredProfileLight in profile-schema.js.

    Profiles saved before every stage needed a full light mix can have a stage with
    no light, or light on with 0 or missing hours. No light reads as dark. Light on
    without hours reads as 12 h, which is what the firmware does.
    """
    if not isinstance(data, dict):
        return data
    out = copy.deepcopy(data)
    stages = out.get("stages")
    if not isinstance(stages, list):
        return out
    for stage in stages:
        if isinstance(stage, dict):
            stage["light"] = _normalize_stage_light(stage.get("light"))
    recipe = out.get("light_recipe")
    phases = recipe.get("phases") if isinstance(recipe, dict) else None
    if isinstance(phases, dict):
        for name, phase in list(phases.items()):
            if isinstance(phase, dict):
                phases[name] = _normalize_phase(phase)
        for stage in stages:
            if isinstance(stage, dict) and stage.get("id") and stage["id"] not in phases:
                light = stage["light"]
                phases[stage["id"]] = {
                    "photoperiod_hours": light["duration_hours"],
                    "white_brightness_percent": int(
                        math.floor(lux_to_brightness_percent(light["white_led_lux"]) + 0.5)
                    ),
                    "red_percent": light["red_percent"],
                    "green_percent": light["green_percent"],
                    "blue_percent": light["blue_percent"],
                }
    return out


def validate_stored_profile(data: dict[str, Any]) -> MushroomProfile:
    """Validate a profile read back from storage after filling in legacy light."""
    return validate_profile(normalize_stored_light(data))


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
        light_on = (
            stage.light.white_led_lux > 0
            or stage.light.red_percent > 0
            or stage.light.green_percent > 0
            or stage.light.blue_percent > 0
        )
        if light_on:
            _require(
                stage.light.duration_hours > 0,
                f"stage {stage.id} needs duration_hours > 0 when lux or RGB is on; "
                "duration 0 is only valid for a dark stage with lux 0 and RGB 0",
            )
        if profile.light_recipe is not None:
            _require(
                stage.id in profile.light_recipe.phases,
                f"light_recipe needs a {stage.id} phase so this stage has a complete light mix",
            )
        _require(15 <= stage.fan.speed_percent <= 100, f"stage {stage.id} fan speed invalid")
        _require(1 <= stage.fan.period_min <= 240, f"stage {stage.id} fan period invalid")
        _require(5 <= stage.fan.run_duration_s <= 900, f"stage {stage.id} fan run duration invalid")
        downtime = stage.fan.period_min * 60 - stage.fan.run_duration_s
        _require(downtime >= 60, f"stage {stage.id} fan cycle needs >= 60s downtime")
        for channel, value in (
            ("red", stage.light.red_percent),
            ("green", stage.light.green_percent),
            ("blue", stage.light.blue_percent),
        ):
            _require(0 <= value <= 100, f"stage {stage.id} {channel} percent invalid")

    if profile.light_recipe:
        _validate_light_recipe(profile)

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


def _validate_light_recipe(profile: MushroomProfile) -> None:
    recipe = profile.light_recipe
    assert recipe is not None
    _require(bool(recipe.why.strip()), "light_recipe.why is required")
    _require(bool(recipe.wavelength_note.strip()), "light_recipe.wavelength_note is required")
    _require(len(recipe.sources) >= 1, "light_recipe needs at least one source")
    for note in recipe.sources:
        _require(bool(note.title.strip()), "light_recipe source title is required")
        _require(bool(note.detail.strip()), "light_recipe source detail is required")
        _require(is_https_source_url(note.url), "light_recipe source url must be https")
    _require("colonization" in recipe.phases, "light_recipe needs a colonization phase")
    _require("fruiting" in recipe.phases, "light_recipe needs a fruiting phase")
    for name, phase in recipe.phases.items():
        _require(name in KNOWN_STAGE_IDS, f"light_recipe phase {name} is not a known stage")
        _require(0 <= phase.photoperiod_hours <= 24, f"light_recipe {name} photoperiod invalid")
        _require(
            0 <= phase.white_brightness_percent <= 100,
            f"light_recipe {name} white brightness invalid",
        )
        for channel, value in (
            ("red", phase.red_percent),
            ("green", phase.green_percent),
            ("blue", phase.blue_percent),
        ):
            _require(0 <= value <= 100, f"light_recipe {name} {channel} percent invalid")
        phase_on = (
            phase.white_brightness_percent > 0
            or phase.red_percent > 0
            or phase.green_percent > 0
            or phase.blue_percent > 0
        )
        if phase_on:
            _require(
                phase.photoperiod_hours > 0,
                f"light_recipe {name} needs photoperiod_hours > 0 when the mix is on; "
                "0 h is only valid for a dark mix with 0% white and RGB 0",
            )


def export_json_dict(profile: MushroomProfile) -> dict[str, Any]:
    validate_profile(profile)
    return profile.to_dict()
