"""Hub admin login. Same shape as the chamber: user admin, CSRF on writes."""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import secrets
import threading
import time
from typing import Any
from urllib.parse import quote

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from . import config

ADMIN_USER = "admin"
SESSION_COOKIE = "hub_session"
CSRF_COOKIE = "hub_csrf"
SESSION_TTL_S = 7 * 24 * 60 * 60
_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
LOGIN_IP_MAX_FAILURES = 5
LOGIN_WINDOW_S = 10 * 60
LOGIN_LOCKOUT_S = 60
LOGIN_GLOBAL_SOFT_MAX = 40
LOGIN_GLOBAL_BACKOFF_S = 2
SESSIONS_FILENAME = "sessions.json"


def random_password(length: int = 12) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


def password_path():
    return config.DATA_DIR / "admin.json"


def admin_password() -> str:
    if config.ADMIN_PASSWORD:
        return config.ADMIN_PASSWORD
    path = password_path()
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            password = payload.get("password")
            if isinstance(password, str) and password:
                return password
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    password = random_password()
    config.write_private_file(path, json.dumps({"username": ADMIN_USER, "password": password}) + "\n")
    return password


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(value: str) -> str:
    digest = hmac.new(config.SECRET.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
    return f"{value}.{_b64(digest)}"


def sign_with_secret(value: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
    return f"{value}.{_b64(digest)}"


def _verify(token: str) -> str | None:
    if not token or "." not in token:
        return None
    value, _, signature = token.rpartition(".")
    expected = _sign(value).rsplit(".", 1)[1]
    if not hmac.compare_digest(signature, expected):
        return None
    return value


def new_csrf() -> str:
    return secrets.token_urlsafe(24)


def sessions_path():
    return config.DATA_DIR / SESSIONS_FILENAME


_session_lock = threading.Lock()


def _load_sessions() -> dict[str, int]:
    path = sessions_path()
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return {}
    raw = payload.get("active") if isinstance(payload, dict) else None
    if not isinstance(raw, dict):
        return {}
    now = int(time.time())
    active: dict[str, int] = {}
    for jti, expiry in raw.items():
        if not isinstance(jti, str) or not isinstance(expiry, int):
            continue
        if expiry >= now:
            active[jti] = expiry
    return active


def _save_sessions(active: dict[str, int]) -> None:
    config.write_private_file(sessions_path(), json.dumps({"active": active}) + "\n")


def remember_session(jti: str, expiry: int) -> None:
    with _session_lock:
        active = _load_sessions()
        active[jti] = expiry
        _save_sessions(active)


def session_is_active(jti: str) -> bool:
    with _session_lock:
        return jti in _load_sessions()


def revoke_session(token: str | None) -> None:
    value = _verify(token or "")
    if not value:
        return
    parts = value.split(":")
    if len(parts) < 3:
        return
    jti = parts[2]
    with _session_lock:
        active = _load_sessions()
        if jti in active:
            del active[jti]
            _save_sessions(active)


def reset_sessions() -> None:
    with _session_lock:
        path = sessions_path()
        try:
            path.unlink()
        except OSError:
            pass


def session_token(username: str = ADMIN_USER, now: int | None = None) -> str:
    expiry = int(now if now is not None else time.time()) + SESSION_TTL_S
    jti = secrets.token_urlsafe(16)
    remember_session(jti, expiry)
    return _sign(f"{username}:{expiry}:{jti}")


def session_user(token: str | None, now: int | None = None) -> str | None:
    value = _verify(token or "")
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    username, expiry_text, jti = parts
    try:
        expiry = int(expiry_text)
    except ValueError:
        return None
    if expiry < int(now if now is not None else time.time()):
        return None
    if not session_is_active(jti):
        return None
    return username


def passwords_match(given: str, expected: str) -> bool:
    if not given or not expected:
        return False
    given_digest = hashlib.sha256(given.encode("utf-8")).digest()
    expected_digest = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(given_digest, expected_digest) and given == expected


def parse_basic(header: str | None) -> tuple[str, str] | None:
    if not header or not header.lower().startswith("basic "):
        return None
    try:
        decoded = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if ":" not in decoded:
        return None
    user, _, password = decoded.partition(":")
    return user, password


def hostname_from_host_header(host: str | None) -> str | None:
    if not host:
        return None
    text = host.strip()
    if not text:
        return None
    if text.startswith("["):
        end = text.find("]")
        if end == -1:
            return None
        return text[1:end].lower()
    if text.count(":") == 1:
        name, _, port = text.rpartition(":")
        if port.isdigit():
            text = name
    return text.lower().rstrip(".") or None


def host_allowed(host_header: str | None, allowed: frozenset[str] | None = None) -> bool:
    hostname = hostname_from_host_header(host_header)
    if not hostname:
        return False
    names = allowed if allowed is not None else config.ALLOWED_HOSTS
    if hostname in names or f"[{hostname}]" in names:
        return True
    if hostname.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    if ip.is_private and not ip.is_link_local:
        return True
    return False


def origin_self(host: str | None) -> str | None:
    if not host:
        return None
    return f"http://{host}"


def same_origin(request: Request, require_header: bool = False) -> bool:
    """Ship 9 rule: Origin wins, then Referer. POST without a header is a script."""
    host = request.headers.get("host")
    if not host_allowed(host):
        return False
    self = origin_self(host)
    if not self:
        return False
    origin = request.headers.get("origin")
    if origin:
        return origin == self
    referer = request.headers.get("referer")
    if referer:
        return referer == self or referer.startswith(self + "/")
    return not require_header


def basic_ok(request: Request) -> bool:
    """True when Basic is valid and this IP is not locked. Does not record."""
    parsed = parse_basic(request.headers.get("authorization"))
    if not parsed:
        return False
    if login_retry_after(client_ip(request)) or login_global_backoff(client_ip(request)):
        return False
    user, password = parsed
    return user == ADMIN_USER and passwords_match(password, admin_password())


def evaluate_basic(request: Request) -> tuple[str, int]:
    """Check Basic against LOGIN_GUARD. Returns ok/fail/none/locked and retry-after."""
    parsed = parse_basic(request.headers.get("authorization"))
    if not parsed:
        return "none", 0
    ip = client_ip(request)
    wait = login_retry_after(ip) or login_global_backoff(ip)
    if wait:
        return "locked", wait
    user, password = parsed
    if user == ADMIN_USER and passwords_match(password, admin_password()):
        record_login_success(ip)
        return "ok", 0
    record_login_failure(ip)
    wait = login_retry_after(ip) or login_global_backoff(ip)
    if wait:
        return "locked", wait
    return "fail", 0


def session_ok(request: Request) -> bool:
    return session_user(request.cookies.get(SESSION_COOKIE)) == ADMIN_USER


def is_authenticated(request: Request) -> bool:
    return session_ok(request) or basic_ok(request)


def csrf_ok(request: Request, form_token: str | None) -> bool:
    cookie = request.cookies.get(CSRF_COOKIE) or ""
    token = form_token or request.headers.get("x-csrf-token") or ""
    if not cookie or not token:
        return False
    return hmac.compare_digest(cookie, token)


def write_rejected(message: str, status_code: int = 403) -> Response:
    return JSONResponse({"ok": False, "error": message}, status_code=status_code)


def require_write_guard(request: Request, form_token: str | None = None) -> Response | None:
    """CSRF on every write, including HTTP Basic. Foreign Origin is refused."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    if not same_origin(request, require_header=False):
        return write_rejected("This change must be made from the hub's own page.")
    if not csrf_ok(request, form_token):
        return write_rejected("CSRF token missing or wrong.")
    return None


def wants_html(request: Request) -> bool:
    if request.url.path.startswith("/api/"):
        return False
    accept = request.headers.get("accept") or ""
    return "text/html" in accept or request.url.path == "/smart-home"


def require_admin(request: Request) -> Response | None:
    if session_ok(request):
        return None
    status, retry_after = evaluate_basic(request)
    if status == "locked":
        return login_locked_response(retry_after)
    if status == "ok":
        return None
    if wants_html(request):
        nxt = quote(str(request.url.path), safe="/")
        return RedirectResponse(f"/login?next={nxt}", status_code=303)
    return JSONResponse(
        {"ok": False, "error": "sign_in_required"},
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="OpenShrooly Hub"'},
    )


def require_admin_write(request: Request, form_token: str | None = None) -> Response | None:
    denied = require_admin(request)
    if denied:
        return denied
    return require_write_guard(request, form_token)


def safe_next_path(value: str | None, default: str = "/smart-home") -> str:
    """Same-origin relative path only. One leading slash, no host, no scheme."""
    if not isinstance(value, str):
        return default
    path = value.strip()
    if not path or path[0] != "/":
        return default
    if len(path) > 1 and path[1] in "/\\":
        return default
    if "\\" in path or "://" in path:
        return default
    if any(ord(ch) < 32 for ch in path):
        return default
    return path


def client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class LoginGuard:
    def __init__(self) -> None:
        self._ip: dict[str, list[float]] = {}
        self._global: list[float] = []
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._ip.clear()
            self._global.clear()

    def _prune(self, times: list[float], now: float) -> list[float]:
        return [stamp for stamp in times if now - stamp < LOGIN_WINDOW_S]

    def _locked(self, times: list[float], now: float, limit: int) -> int:
        recent = self._prune(times, now)
        if len(recent) < limit:
            return 0
        wait = int(LOGIN_LOCKOUT_S - (now - recent[-1]))
        return wait if wait > 0 else 0

    def retry_after(self, ip: str, now: float | None = None) -> int:
        """Hard lock for this IP only. A burst from other IPs cannot lock the admin."""
        stamp = time.time() if now is None else now
        with self._lock:
            return self._locked(self._ip.get(ip, []), stamp, LOGIN_IP_MAX_FAILURES)

    def global_backoff(self, ip: str, now: float | None = None) -> int:
        """Slow an IP that already failed. A clean IP can still sign in."""
        stamp = time.time() if now is None else now
        with self._lock:
            if not self._prune(self._ip.get(ip, []), stamp):
                return 0
            recent = self._prune(self._global, stamp)
            if len(recent) < LOGIN_GLOBAL_SOFT_MAX:
                return 0
            wait = int(LOGIN_GLOBAL_BACKOFF_S - (stamp - recent[-1]))
            return wait if wait > 0 else 0

    def record_failure(self, ip: str, now: float | None = None) -> None:
        stamp = time.time() if now is None else now
        with self._lock:
            self._ip[ip] = self._prune(self._ip.get(ip, []), stamp) + [stamp]
            self._global = self._prune(self._global, stamp) + [stamp]

    def record_success(self, ip: str) -> None:
        with self._lock:
            self._ip.pop(ip, None)


LOGIN_GUARD = LoginGuard()


def reset_login_guard() -> None:
    LOGIN_GUARD.reset()


def login_retry_after(ip: str) -> int:
    return LOGIN_GUARD.retry_after(ip)


def login_global_backoff(ip: str) -> int:
    return LOGIN_GUARD.global_backoff(ip)


def record_login_failure(ip: str) -> None:
    LOGIN_GUARD.record_failure(ip)


def record_login_success(ip: str) -> None:
    LOGIN_GUARD.record_success(ip)


def login_locked_response(retry_after: int) -> Response:
    return JSONResponse(
        {"ok": False, "error": "too_many_login_attempts", "retry_after": retry_after},
        status_code=429,
        headers={"Retry-After": str(max(1, retry_after))},
    )


def public_pairing(status: dict[str, Any]) -> dict[str, Any]:
    commissioned = bool(status.get("commissioned"))
    return {
        "ok": bool(status.get("ok", True)),
        "reachable": bool(status.get("reachable")),
        "commissioned": commissioned,
        "fabrics": status.get("fabrics", 0),
        "qr": None if commissioned else status.get("qr"),
        "manual_code": None if commissioned else status.get("manual_code"),
        "vendor_id": status.get("vendor_id"),
        "product_id": status.get("product_id"),
        "chambers": status.get("chambers"),
    }
