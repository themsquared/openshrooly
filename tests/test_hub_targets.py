from hub.targets import device_host_error


def test_lan_hosts_are_allowed():
    assert device_host_error("192.168.1.50") is None
    assert device_host_error("10.0.0.8") is None
    assert device_host_error("172.16.4.20") is None
    assert device_host_error("chamber.local") is None


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
