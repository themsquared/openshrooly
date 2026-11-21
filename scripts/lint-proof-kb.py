#!/usr/bin/env python3
"""Flag proof knowledge base entries that are missing a source or a date.

Proof lives in seo/kb/proof/ as Markdown with YAML front matter, or as
.yaml / .yml files. Every entry must have:

  claim:          a non-empty string
  evidence_type:  a non-empty string
  source:         a non-empty string, or a list of non-empty strings
  date:           YYYY-MM-DD (optional time after the date is allowed)
  pages:          a list of page paths that may cite this entry

Never invent ratings, tests, prices, or other numbers. An entry without a
source or date cannot be cited. Run from the repo root:

  python3 scripts/lint-proof-kb.py
"""
from __future__ import annotations

import datetime as dt
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROOF_DIR = ROOT / "seo" / "kb" / "proof"
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[T ]\S+)?$")
ALLOWED_SUFFIXES = {".md", ".yaml", ".yml"}
REQUIRED = ("claim", "evidence_type", "source", "date", "pages")


def _parse_front_matter(text: str) -> tuple[dict | None, str | None]:
    if not text.startswith("---"):
        return None, "missing YAML front matter"
    rest = text[3:]
    if rest.startswith("\r\n"):
        rest = rest[2:]
    elif rest.startswith("\n"):
        rest = rest[1:]
    else:
        return None, "missing YAML front matter"
    closer = "\n---"
    end = rest.find(closer)
    if end == -1:
        return None, "unclosed YAML front matter"
    fm = rest[:end]
    return _load_yaml(fm)


def _load_yaml(text: str) -> tuple[dict | None, str | None]:
    try:
        import yaml  # type: ignore
    except ImportError:
        yaml = None
    if yaml is not None:
        try:
            data = yaml.safe_load(text)
        except Exception as exc:  # noqa: BLE001
            return None, f"invalid YAML: {exc}"
        if data is None:
            return {}, None
        if not isinstance(data, dict):
            return None, "front matter must be a mapping"
        return data, None
    return _load_yaml_subset(text)


def _load_yaml_subset(text: str) -> tuple[dict | None, str | None]:
    """Minimal parser for the scalar and string-list fields this lint requires."""
    data: dict = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        if not raw.strip() or raw.strip().startswith("#"):
            i += 1
            continue
        if raw.startswith(" ") or raw.startswith("\t"):
            return None, f"unexpected indent on line {i + 1} (install PyYAML for rich front matter)"
        if ":" not in raw:
            return None, f"cannot parse line {i + 1}"
        key, val = raw.split(":", 1)
        key = key.strip()
        val = val.strip()
        if val in ("|", ">"):
            block = []
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t") or not lines[i].strip()):
                block.append(lines[i][2:] if lines[i].startswith("  ") else lines[i].lstrip("\t"))
                i += 1
            data[key] = "\n".join(block).strip("\n")
            continue
        if val == "":
            items = []
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t") or (not lines[i].strip())):
                item = lines[i].strip()
                if not item or item.startswith("#"):
                    i += 1
                    continue
                if item.startswith("- "):
                    items.append(item[2:].strip().strip('"').strip("'"))
                    i += 1
                    continue
                return None, f"cannot parse list item on line {i + 1} (install PyYAML for rich front matter)"
            data[key] = items
            continue
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        data[key] = val
        i += 1
    return data, None


def _source_ok(value) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str) and item.strip():
                parts.append(item.strip())
            elif isinstance(item, dict):
                for field in ("path", "url", "file", "commit", "test", "note"):
                    got = item.get(field)
                    if isinstance(got, str) and got.strip():
                        parts.append(got.strip())
                        break
        return bool(parts)
    return False


def _date_ok(value) -> bool:
    if value is None:
        return False
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return True
    if isinstance(value, dt.datetime):
        return True
    text = str(value).strip()
    m = DATE_RE.match(text)
    if not m:
        return False
    try:
        dt.date.fromisoformat(m.group(1))
    except ValueError:
        return False
    return True


def _claim_ok(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _pages_ok(value) -> bool:
    return isinstance(value, list)


def check_entry(data: dict, rel: str) -> list[str]:
    errors = []
    if not isinstance(data, dict):
        return [f"{rel}: entry is not a mapping"]
    for key in REQUIRED:
        if key not in data or data[key] in (None, ""):
            errors.append(f"{rel}: missing {key}")
    if "claim" in data and data["claim"] not in (None, "") and not _claim_ok(data["claim"]):
        errors.append(f"{rel}: claim must be a non-empty string")
    if "evidence_type" in data and data["evidence_type"] not in (None, "") and not _claim_ok(data["evidence_type"]):
        errors.append(f"{rel}: evidence_type must be a non-empty string")
    if "source" in data and data["source"] not in (None, "") and not _source_ok(data["source"]):
        errors.append(f"{rel}: source is empty or unusable")
    if "date" in data and data["date"] not in (None, "") and not _date_ok(data["date"]):
        errors.append(f"{rel}: date must be YYYY-MM-DD (got {data['date']!r})")
    if "pages" in data and data["pages"] is not None and not _pages_ok(data["pages"]):
        errors.append(f"{rel}: pages must be a list of page paths")
    return errors


def iter_proof_files(proof_dir: pathlib.Path):
    if not proof_dir.is_dir():
        return
    for path in sorted(proof_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        yield path


def lint(root: pathlib.Path | None = None) -> list[str]:
    root = root or ROOT
    proof_dir = root / "seo" / "kb" / "proof"
    errors: list[str] = []
    if not proof_dir.is_dir():
        return [f"lint-proof-kb: {proof_dir.relative_to(root)} does not exist"]
    seen = 0
    for path in iter_proof_files(proof_dir):
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        if path.suffix.lower() == ".md":
            data, err = _parse_front_matter(text)
        else:
            data, err = _load_yaml(text)
        if err:
            errors.append(f"{rel}: {err}")
            continue
        seen += 1
        errors.extend(check_entry(data or {}, rel))
    if seen == 0:
        errors.append(f"lint-proof-kb: no proof entries under {proof_dir.relative_to(root)}")
    return errors


def main(argv: list[str] | None = None) -> int:
    errors = lint()
    if errors:
        for line in errors:
            print(line, file=sys.stderr)
        print(f"lint-proof-kb: {len(errors)} problem(s)", file=sys.stderr)
        return 1
    n = sum(1 for _ in iter_proof_files(PROOF_DIR))
    print(f"lint-proof-kb: {n} entries ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
