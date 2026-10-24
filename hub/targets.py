"""Refuse device hosts that would let the hub call itself or cloud metadata."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import unquote

BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "ip6-localhost",
        "ip6-loopback",
        "metadata",
        "metadata.google.internal",
        "metadata.goog",
        "metadata.gke",
    }
)
BLOCKED_IPS = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),
        ipaddress.ip_address("169.254.170.2"),
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)


class UnsafeDeviceHost(ValueError):
    """Resolved device address is missing or not a safe LAN target."""

    def __init__(self, message: str, *, blocked: bool = True):
        super().__init__(message)
        self.blocked = blocked


def parse_ip(text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(text.strip().strip("[]"))
    except ValueError:
        return None


def _canonical_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address):
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    ip = _canonical_ip(ip)
    if ip in BLOCKED_IPS:
        return True
    return bool(
        ip.is_loopback
        or ip.is_link_local
        or ip.is_unspecified
        or ip.is_multicast
        or ip.is_reserved
    )


def _hostname_blocked(host: str) -> bool:
    name = host.strip().lower().rstrip(".")
    if not name:
        return True
    if name in BLOCKED_HOSTNAMES:
        return True
    if name.endswith(".localhost") or name.endswith(".localhost.localdomain"):
        return True
    if name.endswith(".internal") and "metadata" in name:
        return True
    return False


def normalize_device_host(host: str) -> str | None:
    raw = host or ""
    if not raw or any(ch.isspace() for ch in raw) or any(ch.isspace() for ch in unquote(raw)):
        return None
    lowered = raw.lower()
    if lowered.startswith("http://") or lowered.startswith("https://") or "://" in raw:
        return None
    if "/" in raw or "\\" in raw or "@" in raw or "?" in raw or "#" in raw:
        return None
    if raw.startswith("[") and "]" in raw:
        return raw[1 : raw.index("]")].rstrip(".") or None
    if raw.count(":") == 1:
        name, _, port = raw.rpartition(":")
        if port.isdigit():
            raw = name
    return raw.strip().rstrip(".") or None


def resolved_ips(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address] | None:
    ip = parse_ip(host)
    if ip is not None:
        return [ip]
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, OSError):
        return None
    found: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in infos:
        addr = parse_ip(info[4][0])
        if addr is not None:
            found.append(addr)
    return found or None


def resolve_connect_ip(host: str) -> str:
    """Pick a safe IP for this connect. Unresolvable names are refused here, not at store."""
    normalized = normalize_device_host(host)
    if normalized is None:
        raise UnsafeDeviceHost("Device host must be a hostname or IP on your LAN, not a URL.")
    if _hostname_blocked(normalized):
        raise UnsafeDeviceHost("That address is not allowed. Use the chamber's LAN hostname or IP.")
    addrs = resolved_ips(normalized)
    if not addrs:
        raise UnsafeDeviceHost("Device host could not be resolved.", blocked=False)
    safe = [addr for addr in addrs if not ip_is_blocked(addr)]
    if not safe:
        raise UnsafeDeviceHost("That address is not allowed. Use the chamber's LAN hostname or IP.")
    chosen = next((addr for addr in safe if addr.version == 4), safe[0])
    return str(_canonical_ip(chosen))


def device_host_error(host: str) -> str | None:
    """Return an error if this host is not a safe LAN chamber address.

    Unresolvable names are allowed here so an offline .local chamber can be stored.
    Connect time uses resolve_connect_ip, which refuses those names until they resolve.
    """
    normalized = normalize_device_host(host)
    if normalized is None:
        return "Device host must be a hostname or IP on your LAN, not a URL."
    if _hostname_blocked(normalized):
        return "That address is not allowed. Use the chamber's LAN hostname or IP."
    ip = parse_ip(normalized)
    if ip is not None:
        if ip_is_blocked(ip):
            return "That address is not allowed. Use the chamber's LAN hostname or IP."
        return None
    addrs = resolved_ips(normalized)
    if addrs and any(ip_is_blocked(addr) for addr in addrs):
        return "That address is not allowed. Use the chamber's LAN hostname or IP."
    return None
