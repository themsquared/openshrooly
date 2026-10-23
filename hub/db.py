from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from openshrooly_lib.webutil import connect, json_dumps

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 80,
    added_at TEXT NOT NULL,
    last_seen TEXT,
    last_status TEXT,
    current_profile_id TEXT,
    current_stage_id TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grows (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    current_stage_id TEXT,
    notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    grow_id INTEGER REFERENCES grows(id) ON DELETE SET NULL,
    recorded_at TEXT NOT NULL,
    temperature REAL,
    humidity REAL,
    water_level REAL,
    extra TEXT
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    device_id INTEGER,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def init_db(path) -> sqlite3.Connection:
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def log_event(conn: sqlite3.Connection, kind: str, detail: str, device_id: int | None = None) -> None:
    conn.execute(
        "INSERT INTO events (recorded_at, device_id, kind, detail) VALUES (?, ?, ?, ?)",
        (now(), device_id, kind, detail),
    )
    conn.commit()


def upsert_profile(conn: sqlite3.Connection, profile_id: str, document: dict, source: str) -> None:
    conn.execute(
        """
        INSERT INTO profiles (id, document, source, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET document=excluded.document, source=excluded.source, updated_at=excluded.updated_at
        """,
        (profile_id, json_dumps(document), source, now()),
    )
    conn.commit()
