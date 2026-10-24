from __future__ import annotations

from pathlib import Path

from openshrooly_lib.webutil import env

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DATA_DIR = Path(env("HUB_DATA_DIR", str(ROOT / "data")))
SEED_DIR = Path(env("OPENSHROOLY_DATA_DIR", str(REPO_ROOT / "data")))
DB_PATH = DATA_DIR / "hub.sqlite"
SECRET = env("HUB_SECRET", "openshrooly-hub-dev-secret")
COMMUNITY_URL = env("COMMUNITY_URL", "http://127.0.0.1:8787")
COMMUNITY_TOKEN = env("COMMUNITY_TOKEN", "")
ENABLE_PSILOCYBIN = env("HUB_ENABLE_PSILOCYBIN", "0") in {"1", "true", "yes"}
POLL_SECONDS = int(env("HUB_POLL_SECONDS", "60"))
HOST = env("HUB_HOST", "0.0.0.0")
PORT = int(env("HUB_PORT", "8090"))
BRIDGE_STATUS_URL = env("BRIDGE_STATUS_URL", "http://127.0.0.1:8091")
NEEDS_WATER_THRESHOLD_PCT = float(env("HUB_NEEDS_WATER_PCT", "15"))
