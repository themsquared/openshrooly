"""ESPHome REST client for stock OpenShrooly firmware (no firmware changes)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .mapping import DeviceCommand, stage_to_commands
from .models import ProfileStage

DEFAULT_TIMEOUT_S = 5.0

# Read paths used for the hub status dashboard. Each logical sensor lists
# name-slug and yaml-id fallbacks because ESPHome matches both.
STATUS_ENTITIES: dict[str, tuple[str, str, ...]] = {
    "temperature": ("sensor", "current_temperature", "temperature"),
    "humidity": ("sensor", "current_humidity", "humidity"),
    "water_level": ("sensor", "water_level", "water_level_percent"),
    "fan_rpm": ("sensor", "current_air_exchange_fan_speed", "air_exchange_fan_speed"),
    "alerts": ("text_sensor", "active_alerts",),
    "ip_address": ("text_sensor", "ip_address",),
    "wifi_ssid": ("text_sensor", "wifi_ssid",),
    "humidifier_status": ("text_sensor", "humidifier_status",),
    "air_status": ("text_sensor", "air_exchange_status",),
    "light_status": ("text_sensor", "light_status",),
    "target_humidity": ("number", "target_humidity",),
    "temperature_target": ("number", "temperature_target", "temperature__target"),
    "grow_lights": ("binary_sensor", "grow_lights", "grow_lights_on"),
}


@dataclass
class ApplyResult:
    ok: bool
    applied: list[dict[str, Any]] = field(default_factory=list)
    failed: list[dict[str, Any]] = field(default_factory=list)

    @property
    def partial(self) -> bool:
        return bool(self.applied) and bool(self.failed)


class ESPHomeDeviceClient:
    """Talk to the device's existing web_server v3 REST API."""

    def __init__(
        self,
        base_url: str,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        opener=None,
        extra_headers: dict[str, str] | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._opener = opener
        self.extra_headers = dict(extra_headers or {})

    def _request(self, method: str, path: str, query: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urlencode(query)}"
        headers = {"Accept": "application/json", **self.extra_headers}
        request = Request(url, method=method, headers=headers)
        if self._opener:
            return self._opener(request, timeout=self.timeout_s)
        with urlopen(request, timeout=self.timeout_s) as response:
            body = response.read()
            if not body:
                return {"ok": True, "status": response.status}
            try:
                import json

                return json.loads(body.decode("utf-8"))
            except ValueError:
                return {"raw": body.decode("utf-8", errors="replace")}

    def get_entity(self, domain: str, entity_id: str) -> dict[str, Any] | None:
        try:
            payload = self._request("GET", f"/{domain}/{entity_id}")
        except (HTTPError, URLError, TimeoutError, OSError):
            return None
        if not isinstance(payload, dict):
            return None
        return payload

    def get_first(self, domain: str, *entity_ids: str) -> dict[str, Any] | None:
        for entity_id in entity_ids:
            payload = self.get_entity(domain, entity_id)
            if payload:
                payload["_resolved_id"] = entity_id
                return payload
        return None

    def set_number(self, entity_id: str, value: float) -> bool:
        try:
            self._request("POST", f"/number/{entity_id}/set", {"value": value})
            return True
        except (HTTPError, URLError, TimeoutError, OSError):
            return False

    def set_switch(self, entity_id: str, on: bool) -> bool:
        action = "turn_on" if on else "turn_off"
        try:
            self._request("POST", f"/switch/{entity_id}/{action}")
            return True
        except (HTTPError, URLError, TimeoutError, OSError):
            return False

    def ping(self) -> bool:
        return self.get_first("text_sensor", "ip_address", "wifi_mode") is not None or self.get_first(
            "sensor", "current_temperature", "temperature"
        ) is not None

    def fetch_status(self) -> dict[str, Any]:
        status: dict[str, Any] = {"online": False, "entities": {}}
        any_ok = False
        for key, spec in STATUS_ENTITIES.items():
            domain, *ids = spec
            payload = self.get_first(domain, *ids)
            if payload:
                any_ok = True
                status["entities"][key] = payload
        status["online"] = any_ok
        return status

    def apply_command(self, command: DeviceCommand) -> tuple[bool, str | None]:
        for entity_id in command.entity_ids:
            if command.kind == "number":
                ok = self.set_number(entity_id, float(command.value))
            else:
                ok = self.set_switch(entity_id, bool(command.value))
            if ok:
                return True, entity_id
        return False, None

    def apply_stage(self, stage: ProfileStage) -> ApplyResult:
        result = ApplyResult(ok=True)
        for command in stage_to_commands(stage):
            ok, entity_id = self.apply_command(command)
            row = {
                "field": command.field,
                "value": command.value,
                "entity_id": entity_id,
            }
            if ok:
                result.applied.append(row)
            else:
                result.failed.append(row)
                result.ok = False
        return result
