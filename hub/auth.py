"""Hub admin login. Same shape as the chamber: user admin, CSRF on writes."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
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
    path.parent.mkdir(parents=True, exist_ok=True)
    password = random_password()
    path.write_text(json.dumps({"username": ADMIN_USER, "password": password}) + "\n", encoding="utf-8")
    path.chmod(0o600)
    return password


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(value: str) -> str:
    digest = hmac.new(config.SECRET.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
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


def session_token(username: str = ADMIN_USER, now: int | None = None) -> str:
    expiry = int(now if now is not None else time.time()) + SESSION_TTL_S
    return _sign(f"{username}:{expiry}")


def session_user(token: str | None, now: int | None = None) -> str | None:
    value = _verify(token or "")
    if not value or ":" not in value:
        return None
    username, _, expiry_text = value.partition(":")
    try:
        expiry = int(expiry_text)
    except ValueError:
        return None
    if expiry < int(now if now is not None else time.time()):
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


def origin_self(host: str | None) -> str | None:
    if not host:
        return None
    return f"http://{host}"


def same_origin(request: Request, require_header: bool = False) -> bool:
    """Ship 9 rule: Origin wins, then Referer. POST without a header is a script."""
    host = request.headers.get("host")
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
    parsed = parse_basic(request.headers.get("authorization"))
    if not parsed:
        return False
    user, password = parsed
    return user == ADMIN_USER and passwords_match(password, admin_password())


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
    """CSRF on writes: foreign Origin is refused. Browser posts also need the token."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    if not same_origin(request, require_header=False):
        return write_rejected("This change must be made from the hub's own page.")
    if basic_ok(request) and not request.headers.get("origin"):
        return None
    if not csrf_ok(request, form_token):
        return write_rejected("CSRF token missing or wrong.")
    return None


def wants_html(request: Request) -> bool:
    if request.url.path.startswith("/api/"):
        return False
    accept = request.headers.get("accept") or ""
    return "text/html" in accept or request.url.path == "/smart-home"


def require_admin(request: Request) -> Response | None:
    if is_authenticated(request):
        return None
    if wants_html(request):
        nxt = quote(str(request.url.path), safe="/")
        return RedirectResponse(f"/login?next={nxt}", status_code=303)
    return JSONResponse(
        {"ok": False, "error": "sign_in_required"},
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="OpenShrooly Hub"'},
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
