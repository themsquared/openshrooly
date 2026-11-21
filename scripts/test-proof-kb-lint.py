#!/usr/bin/env python3
"""Unit tests for scripts/lint-proof-kb.py. Does not need a Hugo build."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "lint-proof-kb.py"


def load_lint():
    spec = importlib.util.spec_from_file_location("lint_proof_kb", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


GOOD = """---
id: test-good
claim: "A verified claim with a named source."
evidence_type: test
source: tests/example.test.js (asserts the value against src/example.js)
date: 2026-11-21
pages:
  - /example/
---

# A verified claim
"""


class ProofLintTests(unittest.TestCase):
    def setUp(self):
        self.lint = load_lint()

    def _write(self, root: Path, name: str, text: str) -> Path:
        path = root / "seo" / "kb" / "proof" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_good_entry_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write(root, "good.md", GOOD)
            self.assertEqual(self.lint.lint(root), [])

    def test_missing_source_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            text = GOOD.replace("source: tests/example.test.js (asserts the value against src/example.js)\n", "")
            self._write(root, "no-source.md", text)
            errors = self.lint.lint(root)
            self.assertTrue(any("missing source" in e for e in errors), errors)

    def test_missing_date_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            text = GOOD.replace("date: 2026-11-21\n", "")
            self._write(root, "no-date.md", text)
            errors = self.lint.lint(root)
            self.assertTrue(any("missing date" in e for e in errors), errors)

    def test_empty_source_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            text = GOOD.replace(
                "source: tests/example.test.js (asserts the value against src/example.js)",
                "source: \"\"",
            )
            self._write(root, "empty-source.md", text)
            errors = self.lint.lint(root)
            self.assertTrue(any("missing source" in e or "source is empty" in e for e in errors), errors)

    def test_bad_date_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            text = GOOD.replace("date: 2026-11-21", "date: last week")
            self._write(root, "bad-date.md", text)
            errors = self.lint.lint(root)
            self.assertTrue(any("date must be YYYY-MM-DD" in e for e in errors), errors)

    def test_yaml_entry_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write(
                root,
                "good.yaml",
                "claim: A claim.\nevidence_type: test\nsource: a file\ndate: 2026-11-21\npages:\n  - /x/\n",
            )
            self.assertEqual(self.lint.lint(root), [])

    def test_missing_proof_dir_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            errors = self.lint.lint(Path(tmp))
            self.assertTrue(any("does not exist" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
