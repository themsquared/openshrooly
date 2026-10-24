import ipaddress

import pytest
from fastapi import HTTPException

from hub.app import device_client
from hub.targets import UnsafeDeviceHost, device_host_error, resolve_connect_ip


def test_lan_hosts_are_allowed():
    assert device_host_error("192.168.1.50") is None
    assert device_host_error("10.0.0.8") is None
    assert device_host_error("172.16.4.20") is None
    assert device_host_error("chamber.local") is None


def test_unresolvable_hostname_can_be_stored():
    assert device_host_error("offline-chamber.local") is None


def test_loopback_link_local_and_metadata_are_blocked():
    blocked = [
        "127.0.0.1",
        "localhost",
        "::1",
        "[::1]",
        "0.0.0.0",
        "169.254.1.1",
        "169.254.169.254",
        "fe80::1",
        "metadata.google.internal",
        "metadata",
        "http://192.168.1.50",
        "192.168.1.50/admin",
    ]
    for host in blocked:
        assert device_host_error(host), host


def test_unresolvable_name_is_blocked_at_connect(monkeypatch):
    monkeypatch.setattr("hub.targets.resolved_ips", lambda host: None)
    with pytest.raises(UnsafeDeviceHost, match="resolved"):
        resolve_connect_ip("offline-chamber.local")


def test_connect_rejects_rebinding_to_loopback(monkeypatch):
    monkeypatch.setattr("hub.targets.resolved_ips", lambda host: [ipaddress.ip_address("192.168.1.50")])
    assert device_host_error("chamber.example") is None

    monkeypatch.setattr("hub.targets.resolved_ips", lambda host: [ipaddress.ip_address("127.0.0.1")])
    with pytest.raises(UnsafeDeviceHost, match="not allowed"):
        resolve_connect_ip("chamber.example")
    with pytest.raises(HTTPException) as caught:
        device_client({"host": "chamber.example", "port": 80})
    assert caught.value.status_code == 400


def test_device_client_connects_to_resolved_ip(monkeypatch):
    monkeypatch.setattr("hub.targets.resolved_ips", lambda host: [ipaddress.ip_address("192.168.1.50")])
    client = device_client({"host": "chamber.local", "port": 80})
    assert client.base_url == "http://192.168.1.50:80"
    assert client.extra_headers.get("Host") == "chamber.local"
