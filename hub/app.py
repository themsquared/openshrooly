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

from . import config  # noqa: E402
from . import db  # noqa: E402
from .discover import discover_esphome  # noqa: E402

templates = Jinja2Templates(directory=str(ROOT / "templates"))
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


def get_profile(conn, profile_id: str) -> MushroomProfile:
    row = conn.execute("SELECT document FROM profiles WHERE id=?", (profile_id,)).fetchone()
    if not row:
        raise HTTPException(404, "profile not found")
    return validate_profile(json.loads(row["document"]))


def device_client(row) -> ESPHomeDeviceClient:
    return ESPHomeDeviceClient(f"http://{row['host']}:{row['port']}")


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
        client = device_client(row)
        status = client.fetch_status()
        record_sample(conn, row, status)


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
        result = device_client(device).apply_stage(stage)
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


def page(request: Request, name: str, **context):
    context.update(
        {
            "enable_psilocybin": config.ENABLE_PSILOCYBIN,
            "community_url": config.COMMUNITY_URL,
        }
    )
    return templates.TemplateResponse(request, name, context)


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    conn = request.app.state.conn
    devices = []
    for row in conn.execute("SELECT * FROM devices ORDER BY name").fetchall():
        status = json.loads(row["last_status"] or "{}")
        devices.append(
            {
                **dict(row),
                "status": status,
                "online": status.get("online", False),
                "reading": entity_reading(status),
            }
        )
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
):
    conn = request.app.state.conn
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at) VALUES (?, ?, ?, ?)",
        (name.strip(), host.strip(), port, db.now()),
    )
    conn.commit()
    db.log_event(conn, "device_added", f"{name} {host}:{port}")
    return RedirectResponse("/devices", status_code=303)


@app.post("/devices/{device_id}/delete")
def delete_device(request: Request, device_id: int):
    conn = request.app.state.conn
    conn.execute("DELETE FROM devices WHERE id=?", (device_id,))
    conn.commit()
    return RedirectResponse("/devices", status_code=303)


@app.post("/devices/discover")
def discover_devices(request: Request):
    conn = request.app.state.conn
    discovered = discover_esphome()
    existing = {row["host"] for row in conn.execute("SELECT host FROM devices")}
    return page(
        request,
        "devices.html",
        devices=[dict(row) for row in conn.execute("SELECT * FROM devices ORDER BY name")],
        discovered=[d for d in discovered if d.addresses and d.addresses[0] not in existing],
    )


@app.get("/devices/{device_id}", response_class=HTMLResponse)
def device_detail(request: Request, device_id: int):
    conn = request.app.state.conn
    row = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
    if not row:
        raise HTTPException(404)
    client = device_client(row)
    status = client.fetch_status()
    record_sample(conn, row, status)
    maybe_advance_grow(conn, device_id)
    samples = conn.execute(
        "SELECT * FROM samples WHERE device_id=? ORDER BY id DESC LIMIT 48",
        (device_id,),
    ).fetchall()
    return page(
        request,
        "device.html",
        device=row,
        status=status,
        profiles=all_profiles(conn),
        samples=samples,
        preview=None,
        reading=entity_reading(status),
    )


@app.post("/devices/{device_id}/refresh")
def refresh_device(device_id: int, request: Request):
    return RedirectResponse(f"/devices/{device_id}", status_code=303)


@app.post("/devices/{device_id}/apply")
def apply_profile(
    request: Request,
    device_id: int,
    profile_id: str = Form(...),
    stage_id: str = Form(""),
    start_grow: str = Form("1"),
):
    conn = request.app.state.conn
    device = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
    if not device:
        raise HTTPException(404, "device not found")
    profile = get_profile(conn, profile_id)
    stage = profile.stage_by_id(stage_id) if stage_id else profile.stages[0]
    result = device_client(device).apply_stage(stage)
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


@app.get("/profiles", response_class=HTMLResponse)
def profiles_page(request: Request):
    return page(request, "profiles.html", profiles=all_profiles(request.app.state.conn), error=None)


@app.get("/profiles/{profile_id}", response_class=HTMLResponse)
def profile_detail(request: Request, profile_id: str):
    profile = get_profile(request.app.state.conn, profile_id)
    return page(
        request,
        "profile.html",
        profile=profile,
        preview={stage.id: commands_as_preview(stage) for stage in profile.stages},
    )


@app.get("/api/profiles/{profile_id}")
def api_profile(request: Request, profile_id: str):
    return JSONResponse(get_profile(request.app.state.conn, profile_id).to_dict())


@app.post("/profiles/import")
async def import_profile(request: Request, document: str = Form(...)):
    conn = request.app.state.conn
    try:
        payload = json.loads(document)
        profile = validate_profile(payload)
        if profile.is_psilocybin and not config.ENABLE_PSILOCYBIN:
            raise ValidationError("Psilocybin pack is disabled. Set HUB_ENABLE_PSILOCYBIN=1 to import it.")
        db.upsert_profile(conn, profile.id, profile.to_dict(), "import")
    except (json.JSONDecodeError, ValidationError, KeyError) as exc:
        return page(request, "profiles.html", profiles=all_profiles(conn), error=str(exc))
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
def sync_push(request: Request):
    conn = request.app.state.conn
    if not config.COMMUNITY_TOKEN:
        raise HTTPException(400, "COMMUNITY_TOKEN is not set")
    import urllib.request

    envelope = build_push(
        hub_id="local-hub",
        profiles=all_profiles(conn),
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
def sync_pull(request: Request):
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
        db.upsert_profile(conn, profile.id, profile.to_dict(), "community")
        imported += 1
    db.log_event(conn, "sync_pull", f"imported {imported}")
    return RedirectResponse("/profiles", status_code=303)


@app.get("/api/devices")
def api_devices(request: Request):
    return [dict(row) for row in request.app.state.conn.execute("SELECT * FROM devices")]


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
