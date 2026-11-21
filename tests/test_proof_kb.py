"""Run the proof knowledge base lint in the existing Python CI job."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_proof_kb_unit_tests():
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "test-proof-kb-lint.py")],
        cwd=ROOT,
        check=False,
    )
    assert result.returncode == 0


def test_proof_kb_entries():
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "lint-proof-kb.py")],
        cwd=ROOT,
        check=False,
    )
    assert result.returncode == 0
