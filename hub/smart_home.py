"""Map hub chamber rows to the local smart-home state the Matter bridge reads."""

from __future__ import annotations

import json
from typing import Any

# Same empty / S0 band as the chamber e-paper banner and docs/ALERTS.md.
NEEDS_WATER_THRESHOLD_PCT = 15.0


def parse_number(value: Any) -> float | None:
    if value in (None, "unknown", "unavailable", ""):
        return None
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_bool(value: Any) -> bool | None:
    if value in (None, "unknown", "unavailable", ""):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value in (0, 1):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"on", "true", "1", "yes"}:
        return True
    if text in {"off", "false", "0", "no"}:
        return False
    return None


def entity_payload(status: dict, *keys: str) -> dict:
    entities = status.get("entities") or {}
    for key in keys:
        payload = entities.get(key)
        if payload:
            return payload
    return {}


def entity_number(status: dict, *keys: str) -> float | None:
    payload = entity_payload(status, *keys)
    return parse_number(payload.get("value", payload.get("state")))


def needs_water(
    water_pct: float | None, threshold_pct: float = NEEDS_WATER_THRESHOLD_PCT
) -> bool | None:
    if water_pct is None:
        return None
    return water_pct < threshold_pct


def light_on(status: dict) -> bool | None:
    payload = entity_payload(status, "grow_lights", "light_status")
    return parse_bool(payload.get("value", payload.get("state")))


def load_status(row: Any) -> dict:
    raw = row["last_status"] if not isinstance(row, dict) else row.get("last_status")
    if not raw:
        return {"online": False, "entities": {}}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {"online": False, "entities": {}}
    if not isinstance(parsed, dict):
        return {"online": False, "entities": {}}
    return parsed


def _round_or_none(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 1)


def chamber_from_device(row: Any, threshold_pct: float = NEEDS_WATER_THRESHOLD_PCT) -> dict:
    data = dict(row)
    status = load_status(data)
    online = bool(status.get("online"))
    temperature_c = entity_number(status, "temperature")
    humidity_pct = entity_number(status, "humidity")
    water_pct = entity_number(status, "water_level")
    return {
        "id": data["id"],
        "name": data.get("name") or f"Chamber {data['id']}",
        "mac": data.get("mac"),
        "online": online,
        "temperature_c": _round_or_none(temperature_c),
        "humidity_pct": _round_or_none(humidity_pct),
        "water_pct": _round_or_none(water_pct),
        "needs_water": needs_water(water_pct, threshold_pct) if online else None,
        "light_on": light_on(status) if online else None,
    }


def smart_home_state(rows, threshold_pct: float = NEEDS_WATER_THRESHOLD_PCT) -> dict:
    return {
        "chambers": [chamber_from_device(row, threshold_pct) for row in rows],
        "needs_water_threshold_pct": threshold_pct,
    }


def pairing_qr_svg(payload: str) -> str | None:
    """Render a Matter MT: payload as an inline SVG. None if the library is missing."""
    if not payload:
        return None
    try:
        import io

        import segno
    except ImportError:
        return None
    buffer = io.BytesIO()
    segno.make(payload, error="M").save(buffer, kind="svg", xmldecl=False, scale=6)
    return buffer.getvalue().decode("utf-8")
