"""OpenShrooly local hub — one process, SQLite, Pi-friendly."""

from __future__ import annotations

import json
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
sys.path.insert(0, str(REPO / "shared"))

from openshrooly_lib.catalog import load_seed_profiles  # noqa: E402
from openshrooly_lib.device import ESPHomeDeviceClient  # noqa: E402
from openshrooly_lib.mapping import commands_as_preview  # noqa: E402
from openshrooly_lib.models import GrowReport, MushroomProfile  # noqa: E402
from openshrooly_lib.schema import ValidationError, validate_profile  # noqa: E402
from openshrooly_lib.sync import build_push  # noqa: E402
from openshrooly_lib.webutil import json_dumps  # noqa: E402

from . import auth  # noqa: E402
from . import config  # noqa: E402
from . import db  # noqa: E402
from . import targets  # noqa: E402
from .discover import discover_esphome  # noqa: E402
from .smart_home import pairing_qr_svg, smart_home_state  # noqa: E402
from .species_art import species_photo  # noqa: E402

templates = Jinja2Templates(directory=str(ROOT / "templates"))
templates.env.globals["species_photo"] = species_photo
_poll_stop = threading.Event()


def _entity_value(status: dict, key: str) -> float | str | None:
    payload = status.get("entities", {}).get(key) or {}
    if "value" in payload:
        return payload["value"]
    state = payload.get("state")
    if state in (None, "unknown", "unavailable"):
        return None
    try:
        return float(state)
    except (TypeError, ValueError):
        return state


def seed_library(conn) -> None:
    for profile in load_seed_profiles(config.SEED_DIR, include_psilocybin=config.ENABLE_PSILOCYBIN):
        db.upsert_profile(conn, profile.id, profile.to_dict(), "seed")


def all_profiles(conn) -> list[MushroomProfile]:
    rows = conn.execute("SELECT document FROM profiles ORDER BY id").fetchall()
    return [validate_profile(json.loads(row["document"])) for row in rows]


def authored_profiles(conn) -> list[MushroomProfile]:
    rows = conn.execute(
        "SELECT document FROM profiles WHERE source NOT IN ('seed', 'community') ORDER BY id"
    ).fetchall()
    return [validate_profile(json.loads(row["document"])) for row in rows]


def get_profile(conn, profile_id: str) -> MushroomProfile:
    row = conn.execute("SELECT document FROM profiles WHERE id=?", (profile_id,)).fetchone()
    if not row:
        raise HTTPException(404, "profile not found")
    return validate_profile(json.loads(row["document"]))


PUBLIC_DEVICE_FIELDS = (
    "id",
    "name",
    "host",
    "port",
    "added_at",
    "last_seen",
    "current_profile_id",
    "current_stage_id",
)


def device_client(row) -> ESPHomeDeviceClient:
    host = row["host"]
    port = int(row["port"])
    try:
        ip = targets.resolve_connect_ip(host)
    except targets.UnsafeDeviceHost as exc:
        raise HTTPException(400, str(exc)) from exc
    if ":" in ip:
        base = f"http://[{ip}]:{port}"
    else:
        base = f"http://{ip}:{port}"
    headers = {}
    if targets.parse_ip(host) is None:
        headers["Host"] = f"{host}:{port}" if port not in (80, 443) else host
    return ESPHomeDeviceClient(base, extra_headers=headers)


def unavailable_status(reason: str, *, blocked: bool) -> dict:
    return {"online": False, "blocked": blocked, "reason": reason, "entities": {}}


def fetch_device_status(row) -> dict:
    """Poll one chamber. Blocked or offline hosts never abort the rest of the fleet."""
    try:
        return device_client(row).fetch_status()
    except HTTPException as exc:
        blocked = getattr(exc.__cause__, "blocked", True)
        return unavailable_status(str(exc.detail), blocked=blocked)
    except (OSError, TimeoutError) as exc:
        return unavailable_status(str(exc) or "unreachable", blocked=False)


def public_device(row) -> dict:
    data = dict(row)
    return {key: data.get(key) for key in PUBLIC_DEVICE_FIELDS}


def record_sample(conn, device_row, status: dict) -> None:
    grow = conn.execute(
        "SELECT id FROM grows WHERE device_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
        (device_row["id"],),
    ).fetchone()
    conn.execute(
        """
        INSERT INTO samples (device_id, grow_id, recorded_at, temperature, humidity, water_level, extra)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            device_row["id"],
            grow["id"] if grow else None,
            db.now(),
            _entity_value(status, "temperature"),
            _entity_value(status, "humidity"),
            _entity_value(status, "water_level"),
            json_dumps(status),
        ),
    )
    conn.execute(
        "UPDATE devices SET last_seen=?, last_status=? WHERE id=?",
        (db.now(), json_dumps(status), device_row["id"]),
    )
    conn.commit()


def poll_once(conn) -> None:
    for row in conn.execute("SELECT * FROM devices").fetchall():
        try:
            record_sample(conn, row, fetch_device_status(row))
        except Exception:
            continue


def poll_loop(conn) -> None:
    while not _poll_stop.is_set():
        try:
            poll_once(conn)
        except Exception:
            pass
        _poll_stop.wait(config.POLL_SECONDS)


def maybe_advance_grow(conn, device_id: int) -> None:
    grow = conn.execute(
        "SELECT * FROM grows WHERE device_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
        (device_id,),
    ).fetchone()
    if not grow:
        return
    try:
        profile = get_profile(conn, grow["profile_id"])
    except HTTPException:
        return
    started = grow["started_at"]
    try:
        from datetime import datetime

        elapsed = (datetime.fromisoformat(db.now()) - datetime.fromisoformat(started)).total_seconds() / 86400
    except ValueError:
        return
    stage = profile.stage_at_day(elapsed)
    if stage.id != grow["current_stage_id"]:
        device = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
        try:
            result = device_client(device).apply_stage(stage, recipe=profile.light_recipe)
        except HTTPException:
            return
        conn.execute("UPDATE grows SET current_stage_id=? WHERE id=?", (stage.id, grow["id"]))
        conn.execute(
            "UPDATE devices SET current_profile_id=?, current_stage_id=? WHERE id=?",
            (profile.id, stage.id, device_id),
        )
        db.log_event(
            conn,
            "stage_advance",
            f"{profile.id} -> {stage.id} applied={result.ok}",
            device_id,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.SECRET == config.FORBIDDEN_DEFAULT_SECRET:
        raise config.InsecureHubSecret(
            "HUB_SECRET is the published default. Unset it or set a new random value."
        )
    conn = db.init_db(config.DB_PATH)
    seed_library(conn)
    app.state.conn = conn
    thread = threading.Thread(target=poll_loop, args=(conn,), daemon=True)
    thread.start()
    yield
    _poll_stop.set()
    conn.close()


app = FastAPI(title="OpenShrooly Hub", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
design_dir = REPO / "design"
if design_dir.is_dir():
    app.mount("/design", StaticFiles(directory=str(design_dir)), name="design")


def entity_reading(status: dict) -> dict:
    entities = status.get("entities") or {}

    def val(key: str):
        payload = entities.get(key) or {}
        value = payload.get("value", payload.get("state"))
        if value in (None, "unknown", "unavailable"):
            return None
        try:
            return round(float(value), 1)
        except (TypeError, ValueError):
            return value

    return {"temperature": val("temperature"), "humidity": val("humidity"), "water": val("water_level")}


@app.middleware("http")
async def allowlisted_host(request: Request, call_next):
    if not auth.host_allowed(request.headers.get("host")):
        return JSONResponse({"ok": False, "error": "unknown_host"}, status_code=400)
    return await call_next(request)


def page(request: Request, name: str, **context):
    token = context.get("csrf") or request.cookies.get(auth.CSRF_COOKIE) or auth.new_csrf()
    context.update(
        {
            "enable_psilocybin": config.ENABLE_PSILOCYBIN,
            "community_url": config.COMMUNITY_URL,
            "admin_signed_in": auth.is_authenticated(request),
            "csrf": token,
        }
    )
    response = templates.TemplateResponse(request, name, context)
    if request.cookies.get(auth.CSRF_COOKIE) != token:
        response.set_cookie(auth.CSRF_COOKIE, token, httponly=True, samesite="lax", path="/")
    return response


def saved_devices(conn):
    return [public_device(row) for row in conn.execute("SELECT * FROM devices ORDER BY name")]


def device_host_rejected(request: Request, host: str) -> Response | None:
    message = targets.device_host_error(host)
    if not message:
        return None
    if auth.wants_html(request):
        return page(request, "devices.html", devices=saved_devices(request.app.state.conn), discovered=[], error=message)
    return JSONResponse({"ok": False, "error": message}, status_code=400)


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    conn = request.app.state.conn
    devices = []
    for row in conn.execute("SELECT * FROM devices ORDER BY name").fetchall():
        status = json.loads(row["last_status"] or "{}")
        item = public_device(row)
        item.update(
            {
                "status": {"online": status.get("online", False), "blocked": bool(status.get("blocked"))},
                "online": status.get("online", False),
                "reading": entity_reading(status),
            }
        )
        devices.append(item)
    grows = conn.execute(
        """
        SELECT grows.*, devices.name AS device_name
        FROM grows JOIN devices ON devices.id = grows.device_id
        WHERE grows.ended_at IS NULL
        ORDER BY grows.id DESC
        """
    ).fetchall()
    return page(
        request,
        "home.html",
        devices=devices,
        grows=grows,
        profile_count=conn.execute("SELECT COUNT(*) AS n FROM profiles").fetchone()["n"],
    )


@app.get("/devices", response_class=HTMLResponse)
def devices_page(request: Request):
    conn = request.app.state.conn
    devices = [dict(row) for row in conn.execute("SELECT * FROM devices ORDER BY name")]
    return page(request, "devices.html", devices=devices, discovered=[])


@app.post("/devices/add")
def add_device(
    request: Request,
    name: str = Form(...),
    host: str = Form(...),
    port: int = Form(80),
    csrf: str = Form(""),
):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    blocked = device_host_rejected(request, host)
    if blocked:
        return blocked
    cleaned = targets.normalize_device_host(host) or host.strip()
    conn = request.app.state.conn
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at) VALUES (?, ?, ?, ?)",
        (name.strip(), cleaned, port, db.now()),
    )
    conn.commit()
    db.log_event(conn, "device_added", f"{name} {cleaned}:{port}")
    return RedirectResponse("/devices", status_code=303)


@app.post("/devices/{device_id}/delete")
def delete_device(request: Request, device_id: int, csrf: str = Form("")):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    conn = request.app.state.conn
    conn.execute("DELETE FROM devices WHERE id=?", (device_id,))
    conn.commit()
    return RedirectResponse("/devices", status_code=303)


@app.post("/devices/discover")
def discover_devices(request: Request, csrf: str = Form("")):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    conn = request.app.state.conn
    discovered = discover_esphome()
    existing = {row["host"] for row in conn.execute("SELECT host FROM devices")}
    return page(
        request,
        "devices.html",
        devices=saved_devices(conn),
        discovered=[d for d in discovered if d.addresses and d.addresses[0] not in existing],
    )


@app.get("/devices/{device_id}", response_class=HTMLResponse)
def device_detail(request: Request, device_id: int):
    conn = request.app.state.conn
    row = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
    if not row:
        raise HTTPException(404)
    status = fetch_device_status(row)
    record_sample(conn, row, status)
    if not status.get("blocked"):
        maybe_advance_grow(conn, device_id)
    samples = conn.execute(
        "SELECT * FROM samples WHERE device_id=? ORDER BY id DESC LIMIT 48",
        (device_id,),
    ).fetchall()
    apply_notices = {
        "blocked": "The profile was not applied. That address is not allowed.",
        "offline": "The profile was not applied. The chamber is offline.",
    }
    return page(
        request,
        "device.html",
        device=row,
        status=status,
        profiles=all_profiles(conn),
        samples=samples,
        preview=None,
        reading=entity_reading(status),
        apply_error=apply_notices.get(request.query_params.get("apply", "")),
    )


@app.post("/devices/{device_id}/refresh")
def refresh_device(device_id: int, request: Request, csrf: str = Form("")):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    return RedirectResponse(f"/devices/{device_id}", status_code=303)


@app.post("/devices/{device_id}/apply")
def apply_profile(
    request: Request,
    device_id: int,
    profile_id: str = Form(...),
    stage_id: str = Form(""),
    start_grow: str = Form("1"),
    csrf: str = Form(""),
):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    conn = request.app.state.conn
    device = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
    if not device:
        raise HTTPException(404, "device not found")
    profile = get_profile(conn, profile_id)
    stage = profile.stage_by_id(stage_id) if stage_id else profile.stages[0]
    try:
        result = device_client(device).apply_stage(stage, recipe=profile.light_recipe)
    except HTTPException as exc:
        kind = "blocked" if getattr(exc.__cause__, "blocked", True) else "offline"
        return RedirectResponse(f"/devices/{device_id}?apply={kind}", status_code=303)
    if start_grow == "1":
        conn.execute("UPDATE grows SET ended_at=? WHERE device_id=? AND ended_at IS NULL", (db.now(), device_id))
        conn.execute(
            """
            INSERT INTO grows (device_id, profile_id, started_at, current_stage_id)
            VALUES (?, ?, ?, ?)
            """,
            (device_id, profile.id, db.now(), stage.id),
        )
    conn.execute(
        "UPDATE devices SET current_profile_id=?, current_stage_id=? WHERE id=?",
        (profile.id, stage.id, device_id),
    )
    db.log_event(
        conn,
        "profile_applied",
        json_dumps({"profile": profile.id, "stage": stage.id, "ok": result.ok, "failed": result.failed}),
        device_id,
    )
    return RedirectResponse(f"/devices/{device_id}", status_code=303)


def catalog_payload(conn):
    return json_dumps([p.to_dict() for p in all_profiles(conn)])


@app.get("/profiles", response_class=HTMLResponse)
def profiles_page(request: Request):
    profiles = all_profiles(request.app.state.conn)
    return page(request, "profiles.html", profiles=profiles, error=None, catalog_json=json_dumps([p.to_dict() for p in profiles]))


@app.get("/profiles/{profile_id}/edit", response_class=HTMLResponse)
def profile_edit(request: Request, profile_id: str):
    profile = get_profile(request.app.state.conn, profile_id)
    return page(
        request,
        "profile_edit.html",
        profile=profile,
        profile_json=json_dumps(profile.to_dict()),
        catalog_json=catalog_payload(request.app.state.conn),
        error=None,
    )


@app.get("/profiles/{profile_id}", response_class=HTMLResponse)
def profile_detail(request: Request, profile_id: str):
    profile = get_profile(request.app.state.conn, profile_id)
    return page(
        request,
        "profile.html",
        profile=profile,
        preview={stage.id: commands_as_preview(stage, profile.light_recipe) for stage in profile.stages},
    )


@app.get("/api/profiles/{profile_id}")
def api_profile(request: Request, profile_id: str):
    return JSONResponse(get_profile(request.app.state.conn, profile_id).to_dict())


@app.post("/profiles/import")
async def import_profile(request: Request, document: str = Form(...), csrf: str = Form("")):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    conn = request.app.state.conn
    try:
        payload = json.loads(document)
        profile = validate_profile(payload)
        if profile.is_psilocybin and not config.ENABLE_PSILOCYBIN:
            raise ValidationError("Psilocybin pack is disabled. Set HUB_ENABLE_PSILOCYBIN=1 to import it.")
        db.upsert_profile(conn, profile.id, profile.to_dict(), "import")
    except (json.JSONDecodeError, ValidationError, KeyError) as exc:
        profiles = all_profiles(conn)
        return page(request, "profiles.html", profiles=profiles, error=str(exc), catalog_json=json_dumps([p.to_dict() for p in profiles]))
    return RedirectResponse(f"/profiles/{profile.id}", status_code=303)


@app.get("/history", response_class=HTMLResponse)
def history_page(request: Request):
    conn = request.app.state.conn
    events = conn.execute("SELECT * FROM events ORDER BY id DESC LIMIT 100").fetchall()
    grows = conn.execute(
        """
        SELECT grows.*, devices.name AS device_name
        FROM grows JOIN devices ON devices.id = grows.device_id
        ORDER BY grows.id DESC LIMIT 50
        """
    ).fetchall()
    return page(request, "history.html", events=events, grows=grows)


@app.post("/sync/push")
def sync_push(request: Request, csrf: str = Form("")):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    conn = request.app.state.conn
    if not config.COMMUNITY_TOKEN:
        raise HTTPException(400, "COMMUNITY_TOKEN is not set")
    import urllib.request

    envelope = build_push(
        hub_id="local-hub",
        profiles=authored_profiles(conn),
        reports=[
            GrowReport(
                profile_id=row["profile_id"],
                outcome="partial" if row["ended_at"] is None else "success",
                notes=row["notes"] or "",
                device_name=row["device_name"],
            )
            for row in conn.execute(
                """
                SELECT grows.*, devices.name AS device_name
                FROM grows JOIN devices ON devices.id = grows.device_id
                """
            )
        ],
    )
    payload = json.dumps(envelope.to_dict()).encode()
    req = urllib.request.Request(
        f"{config.COMMUNITY_URL.rstrip('/')}/api/hub/push",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.COMMUNITY_TOKEN}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()
    except Exception as exc:
        raise HTTPException(502, f"community push failed: {exc}") from exc
    db.log_event(conn, "sync_push", body.decode("utf-8", errors="replace"))
    return RedirectResponse("/profiles", status_code=303)


@app.post("/sync/pull")
def sync_pull(request: Request, csrf: str = Form("")):
    denied = auth.require_admin_write(request, csrf)
    if denied:
        return denied
    conn = request.app.state.conn
    if not config.COMMUNITY_TOKEN:
        raise HTTPException(400, "COMMUNITY_TOKEN is not set")
    import urllib.request

    req = urllib.request.Request(
        f"{config.COMMUNITY_URL.rstrip('/')}/api/hub/pull",
        method="GET",
        headers={"Authorization": f"Bearer {config.COMMUNITY_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode())
    except Exception as exc:
        raise HTTPException(502, f"community pull failed: {exc}") from exc
    imported = 0
    for item in payload.get("profiles", []):
        try:
            profile = validate_profile(item)
        except ValidationError:
            continue
        if profile.is_psilocybin and not config.ENABLE_PSILOCYBIN:
            continue
        existing = conn.execute("SELECT source FROM profiles WHERE id=?", (profile.id,)).fetchone()
        hub_user = payload.get("hub_user")
        existing_source = existing["source"] if existing else None
        if existing_source and existing_source not in ("seed", "community"):
            source = existing_source
        elif hub_user and profile.author == hub_user:
            source = "import"
        else:
            source = "community"
        db.upsert_profile(conn, profile.id, profile.to_dict(), source)
        imported += 1
    db.log_event(conn, "sync_pull", f"imported {imported}")
    return RedirectResponse("/profiles", status_code=303)


@app.get("/api/devices")
def api_devices(request: Request):
    return [public_device(row) for row in request.app.state.conn.execute("SELECT * FROM devices")]


def _status_from_payload(payload) -> dict:
    if not isinstance(payload, dict):
        return {"ok": False, "reachable": False}
    payload["ok"] = True
    payload["reachable"] = True
    return payload


def read_bridge_status_file() -> dict | None:
    path = config.BRIDGE_STATUS_FILE
    if not path:
        return None
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return _status_from_payload(payload)


def fetch_bridge_status() -> dict:
    """Ask the Matter sidecar for pairing state. Never log the body."""
    from_file = read_bridge_status_file()
    if from_file and from_file.get("reachable"):
        return from_file

    import urllib.error
    import urllib.request

    url = config.BRIDGE_STATUS_URL.rstrip("/") + "/status"
    request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return {"ok": False, "reachable": False}
    return _status_from_payload(payload)


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, next: str = "/smart-home"):
    return page(request, "login.html", error=None, next_path=auth.safe_next_path(next), csrf=auth.new_csrf())


@app.post("/login")
def login_submit(
    request: Request,
    username: str = Form(""),
    password: str = Form(""),
    csrf: str = Form(""),
    next: str = Form("/smart-home"),
):
    blocked = auth.require_write_guard(request, csrf)
    if blocked:
        return blocked
    ip = auth.client_ip(request)
    retry_after = auth.login_retry_after(ip) or auth.login_global_backoff(ip)
    if retry_after:
        return auth.login_locked_response(retry_after)
    if username != auth.ADMIN_USER or not auth.passwords_match(password, auth.admin_password()):
        auth.record_login_failure(ip)
        retry_after = auth.login_retry_after(ip) or auth.login_global_backoff(ip)
        if retry_after:
            return auth.login_locked_response(retry_after)
        return page(
            request,
            "login.html",
            error="Wrong user name or password.",
            next_path=auth.safe_next_path(next),
            csrf=auth.new_csrf(),
        )
    auth.record_login_success(ip)
    target = auth.safe_next_path(next)
    response = RedirectResponse(target, status_code=303)
    response.set_cookie(
        auth.SESSION_COOKIE,
        auth.session_token(),
        httponly=True,
        samesite="lax",
        path="/",
        max_age=auth.SESSION_TTL_S,
    )
    response.set_cookie(auth.CSRF_COOKIE, auth.new_csrf(), httponly=True, samesite="lax", path="/")
    return response


@app.post("/logout")
def logout(request: Request, csrf: str = Form("")):
    blocked = auth.require_write_guard(request, csrf)
    if blocked:
        return blocked
    auth.revoke_session(request.cookies.get(auth.SESSION_COOKIE))
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


@app.get("/api/smart-home/state")
def api_smart_home_state(request: Request):
    rows = request.app.state.conn.execute("SELECT * FROM devices ORDER BY name").fetchall()
    return smart_home_state(rows, config.NEEDS_WATER_THRESHOLD_PCT)


@app.get("/api/smart-home/pairing")
def api_smart_home_pairing(request: Request):
    denied = auth.require_admin(request)
    if denied:
        return denied
    status = fetch_bridge_status()
    if not status.get("reachable"):
        return JSONResponse({"ok": False, "reachable": False}, status_code=503)
    return auth.public_pairing(status)


@app.get("/smart-home", response_class=HTMLResponse)
def smart_home_page(request: Request):
    denied = auth.require_admin(request)
    if denied:
        return denied
    status = auth.public_pairing(fetch_bridge_status())
    qr_payload = status.get("qr") if status.get("reachable") else None
    return page(
        request,
        "smart_home.html",
        bridge=status,
        qr_svg=pairing_qr_svg(qr_payload) if qr_payload else None,
        csrf=request.cookies.get(auth.CSRF_COOKIE) or "",
    )


@app.get("/api/profiles")
def api_profiles(request: Request):
    return [profile.to_dict() for profile in all_profiles(request.app.state.conn)]


@app.get("/health")
def health():
    return {"ok": True, "psilocybin_enabled": config.ENABLE_PSILOCYBIN}


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)


def create_app() -> FastAPI:
    return app
