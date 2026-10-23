"""Map a profile stage onto the existing OpenShrooly ESPHome REST entities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .models import ProfileStage

# Firmware 1.0.x exposes one live setpoint set. The hub applies the active
# stage; automatic multi-day stage changes stay on the hub (see ROADMAP).
CommandKind = Literal["number", "switch"]


@dataclass(frozen=True)
class DeviceCommand:
    kind: CommandKind
    # First id is preferred; fallbacks handle ESPHome name-slug vs yaml id.
    entity_ids: tuple[str, ...]
    value: float | bool
    field: str


# Maps logical fields to ESPHome REST object IDs used by the stock firmware.
# The web dashboard already uses name-derived slugs (humidifier__speed).
# yaml `id:` values are also tried because ESPHome matches both.
ENTITY_CANDIDATES: dict[str, tuple[str, ...]] = {
    "target_humidity": ("target_humidity",),
    "humidity_hysteresis": ("humidity_hysteresis", "humidity__hysteresis"),
    "humidifier_speed": ("humidifier_speed", "humidifier__speed"),
    "temperature_target": ("temperature_target", "temperature__target"),
    "temperature_hysteresis": ("temperature_hysteresis", "temperature__hysteresis"),
    "temperature_warning_minimum": (
        "temperature_warning_minimum",
        "temperature__warning_minimum",
    ),
    "temperature_warning_maximum": (
        "temperature_warning_maximum",
        "temperature__warning_maximum",
    ),
    "air_exchange_period_min": (
        "air_exchange_period_min",
        "air_exchange__period__min_",
    ),
    "air_exchange_run_sec": (
        "air_exchange_run_sec",
        "air_exchange__run_duration__s_",
    ),
    "air_exchange_speed": ("air_exchange_speed", "air_exchange__speed"),
    "sunrise_hour": ("sunrise_hour", "lights__sunrise_hour"),
    "light_hours": ("light_hours", "lights__duration__hours_"),
    "white_intensity": ("white_intensity", "white_led_intensity"),
    "color_r": ("color_r", "red_led_intensity"),
    "color_g": ("color_g", "green_led_intensity"),
    "color_b": ("color_b", "blue_led_intensity"),
    "temperature_control_enabled": ("temperature_control_enabled",),
}


def stage_to_commands(stage: ProfileStage) -> list[DeviceCommand]:
    """Translate one grow stage into REST writes the 1.0.x firmware already accepts."""
    return [
        DeviceCommand("number", ENTITY_CANDIDATES["target_humidity"], stage.humidity_percent, "humidity"),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["humidity_hysteresis"],
            stage.humidity_hysteresis,
            "humidity_hysteresis",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["humidifier_speed"],
            stage.humidifier_speed_percent,
            "humidifier_speed",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["temperature_target"],
            stage.temperature_c,
            "temperature",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["temperature_hysteresis"],
            stage.temperature_hysteresis,
            "temperature_hysteresis",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["temperature_warning_minimum"],
            stage.temperature_warning_min_c,
            "temperature_warning_min",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["temperature_warning_maximum"],
            stage.temperature_warning_max_c,
            "temperature_warning_max",
        ),
        DeviceCommand(
            "switch",
            ENTITY_CANDIDATES["temperature_control_enabled"],
            stage.temperature_control_enabled,
            "temperature_control",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["air_exchange_period_min"],
            stage.fan.period_min,
            "fan_period",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["air_exchange_run_sec"],
            stage.fan.run_duration_s,
            "fan_run",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["air_exchange_speed"],
            stage.fan.speed_percent,
            "fan_speed",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["sunrise_hour"],
            stage.light.sunrise_hour,
            "sunrise_hour",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["light_hours"],
            stage.light.duration_hours,
            "light_hours",
        ),
        DeviceCommand(
            "number",
            ENTITY_CANDIDATES["white_intensity"],
            stage.light.white_led_lux,
            "white_led_lux",
        ),
        DeviceCommand("number", ENTITY_CANDIDATES["color_r"], stage.light.red_percent, "red"),
        DeviceCommand("number", ENTITY_CANDIDATES["color_g"], stage.light.green_percent, "green"),
        DeviceCommand("number", ENTITY_CANDIDATES["color_b"], stage.light.blue_percent, "blue"),
    ]


def commands_as_preview(stage: ProfileStage) -> list[dict[str, Any]]:
    return [
        {
            "field": cmd.field,
            "kind": cmd.kind,
            "entity_ids": list(cmd.entity_ids),
            "value": cmd.value,
        }
        for cmd in stage_to_commands(stage)
    ]
