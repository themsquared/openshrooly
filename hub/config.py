from __future__ import annotations

import os
import secrets
from pathlib import Path

from openshrooly_lib.webutil import env

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DATA_DIR = Path(env("HUB_DATA_DIR", str(ROOT / "data")))
SEED_DIR = Path(env("OPENSHROOLY_DATA_DIR", str(REPO_ROOT / "data")))
DB_PATH = DATA_DIR / "hub.sqlite"
FORBIDDEN_DEFAULT_SECRET = "openshrooly-hub-dev-secret"
SECRET_FILENAME = "hub.secret"
COMMUNITY_URL = env("COMMUNITY_URL", "http://127.0.0.1:8787")
COMMUNITY_TOKEN = env("COMMUNITY_TOKEN", "")
ENABLE_PSILOCYBIN = env("HUB_ENABLE_PSILOCYBIN", "0") in {"1", "true", "yes"}
POLL_SECONDS = int(env("HUB_POLL_SECONDS", "60"))
HOST = env("HUB_HOST", "0.0.0.0")
PORT = int(env("HUB_PORT", "8090"))
BRIDGE_STATUS_URL = env("BRIDGE_STATUS_URL", "http://127.0.0.1:8091")
BRIDGE_STATUS_FILE = env("BRIDGE_STATUS_FILE", "")
NEEDS_WATER_THRESHOLD_PCT = float(env("HUB_NEEDS_WATER_PCT", "15"))
ADMIN_PASSWORD = env("HUB_ADMIN_PASSWORD", "")
_BUILTIN_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]", "testserver"})


class InsecureHubSecret(RuntimeError):
    """The published default session secret must never be used."""


def secret_path(data_dir: Path | None = None) -> Path:
    return (data_dir or DATA_DIR) / SECRET_FILENAME


def _reject_default_secret(value: str, source: str) -> str:
    if value == FORBIDDEN_DEFAULT_SECRET:
        raise InsecureHubSecret(
            f"{source} is the published default hub secret. Unset HUB_SECRET so the hub "
            "can write a random one, or set HUB_SECRET to a new random value."
        )
    return value


def resolve_secret(data_dir: Path | None = None) -> str:
    """Use HUB_SECRET, or a 0600 file in the data dir. Never the old published default."""
    directory = data_dir or DATA_DIR
    raw = os.environ.get("HUB_SECRET")
    if raw:
        return _reject_default_secret(raw, "HUB_SECRET")
    path = secret_path(directory)
    if path.is_file():
        stored = path.read_text(encoding="utf-8").strip()
        if not stored:
            raise InsecureHubSecret(f"{path} is empty. Delete it and restart the hub.")
        return _reject_default_secret(stored, str(path))
    directory.mkdir(parents=True, exist_ok=True)
    generated = secrets.token_urlsafe(32)
    path.write_text(generated + "\n", encoding="utf-8")
    path.chmod(0o600)
    return generated


def parse_allowed_hosts(raw: str | None = None) -> frozenset[str]:
    extra = {
        part.strip().lower()
        for part in (raw if raw is not None else env("HUB_ALLOWED_HOSTS", "")).split(",")
        if part.strip()
    }
    return frozenset(_BUILTIN_ALLOWED_HOSTS | extra)


SECRET = resolve_secret()
ALLOWED_HOSTS = parse_allowed_hosts()
