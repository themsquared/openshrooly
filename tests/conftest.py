import os
import sys
from pathlib import Path

os.environ.setdefault("HUB_SECRET", "hub-test-secret-ok")
os.environ.setdefault("HUB_ALLOWED_HOSTS", "testserver")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT))
