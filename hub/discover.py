"""mDNS discovery for ESPHome devices. Manual IP add always works without this."""

from __future__ import annotations

from dataclasses import dataclass
import socket
import time


@dataclass
class DiscoveredDevice:
    name: str
    host: str
    port: int
    addresses: list[str]


def discover_esphome(timeout_s: float = 3.0) -> list[DiscoveredDevice]:
    try:
        from zeroconf import ServiceBrowser, ServiceStateChange, Zeroconf
    except ImportError:
        return []

    found: dict[str, DiscoveredDevice] = {}

    def on_change(zeroconf, service_type, name, state_change):
        if state_change is not ServiceStateChange.Added:
            return
        info = zeroconf.get_service_info(service_type, name)
        if info is None:
            return
        addresses = []
        for raw in info.parsed_addresses():
            addresses.append(raw)
        if not addresses:
            return
        found[name] = DiscoveredDevice(
            name=name.replace("._esphomelib._tcp.local.", ""),
            host=info.server.rstrip(".") if info.server else addresses[0],
            port=info.port or 80,
            addresses=addresses,
        )

    zeroconf = Zeroconf()
    try:
        ServiceBrowser(zeroconf, "_esphomelib._tcp.local.", handlers=[on_change])
        time.sleep(timeout_s)
    finally:
        zeroconf.close()
    return list(found.values())


def reachable(host: str, port: int = 80, timeout_s: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False
