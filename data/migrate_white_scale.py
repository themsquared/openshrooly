#!/usr/bin/env python3
"""One-time migration of the seed profiles to the output scale for white percent.

Before: a recipe's white percent was the input to the Shrooly firmware curve (20% = 92 lux,
capped near 78%). After: 0 to 100 where 100 is the most the chamber's white channel puts out,
linear in output. On the Shrooly that is 4000 lux, so lux = 40 x percent.

Every phase keeps the lux it made before: new percent = old curve lux / 40. The stage lux
already stored in each profile is not touched. A migrated recipe carries white_scale: "output".
Running this twice changes nothing.

    python3 data/migrate_white_scale.py          # rewrite data/profiles/*/*.json
    python3 data/migrate_white_scale.py --check  # exit 1 if any file is not migrated
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))

from openshrooly_lib.light_scale import (  # noqa: E402
    LIGHT_SCALE,
    legacy_white_percent_to_percent as new_percent,
    upgrade_recipe_scale,
)


def fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


# Percents that appear next to white in prose, old value to new text.
_PROSE_OLD = (1, 10, 11, 20, 26, 37, 51, 65)
_TO_NEW = {str(old): fmt(new_percent(old)) for old in _PROSE_OLD}
_N = "|".join(str(n) for n in _PROSE_OLD)
_RULES = (
    (re.compile(rf"\b({_N})% white"), lambda m: f"{_TO_NEW[m.group(1)]}% white"),
    (re.compile(rf"\bWhite ({_N})% is"), lambda m: f"White {_TO_NEW[m.group(1)]}% is"),
    (re.compile(rf"\b({_N})% / (\d+) lux"), lambda m: f"{_TO_NEW[m.group(1)]}% / {m.group(2)} lux"),
    (re.compile(rf"\band ({_N})% is about"), lambda m: f"and {_TO_NEW[m.group(1)]}% is about"),
)


def fix_prose(text: str) -> str:
    for rule, repl in _RULES:
        text = rule.sub(repl, text)
    return text


def _walk(node):
    if isinstance(node, dict):
        return {k: _walk(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_walk(v) for v in node]
    if isinstance(node, str):
        return fix_prose(node)
    return node


def migrate_profile(data: dict) -> dict:
    recipe = data.get("light_recipe")
    if not recipe or recipe.get("white_scale") == LIGHT_SCALE:
        return data
    out = _walk(data)
    upgraded = upgrade_recipe_scale(recipe)
    out["light_recipe"] = {"white_scale": LIGHT_SCALE, **{**out["light_recipe"], "phases": upgraded["phases"]}}
    return out


def _dump(data: dict, like: str) -> str:
    for ascii_ in (False, True):
        for newline in (True, False):
            if json.dumps(json.loads(like), indent=2, ensure_ascii=ascii_) + ("\n" if newline else "") == like:
                return json.dumps(data, indent=2, ensure_ascii=ascii_) + ("\n" if newline else "")
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    todo = 0
    for path in sorted((ROOT / "data" / "profiles").glob("*/*.json")):
        text = path.read_text()
        data = json.loads(text)
        migrated = migrate_profile(data)
        if migrated is data:
            continue
        todo += 1
        if not check:
            path.write_text(_dump(migrated, text))
    print(f"{'would change' if check else 'migrated'} {todo} profiles")
    return 1 if check and todo else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
