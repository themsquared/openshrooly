"""White light percent means the same thing on every chamber: 100 is that channel's maximum.

Shrooly white is 4000 lux at 100%, linear (lux = 40 x percent). Existing recipes were written on
the old firmware-curve scale, so they were migrated without changing the lux they make.
The community API and web tests read the same fixture (tests/fixtures/light-scale-before.json).
"""

import json
from pathlib import Path

from openshrooly_lib.catalog import load_seed_profiles
from openshrooly_lib.light_scale import (
    LIGHT_SCALE,
    legacy_white_percent_to_lux,
    lux_to_white_percent,
    upgrade_recipe_scale,
    white_percent_to_lux,
)
from openshrooly_lib.models import LightRecipe
from openshrooly_lib.schema import normalize_stored_light

ROOT = Path(__file__).resolve().parents[1]
BEFORE = json.loads((ROOT / "tests/fixtures/light-scale-before.json").read_text())["profiles"]


def test_percent_is_linear_with_no_cap_below_100():
    assert [white_percent_to_lux(p) for p in (0, 1, 2.3, 10, 50, 78, 79, 100)] == [0, 40, 92, 400, 2000, 3120, 3160, 4000]
    assert white_percent_to_lux(150) == 4000
    assert white_percent_to_lux(-5) == 0


def test_round_trip_is_exact():
    for pct in range(0, 101):
        assert lux_to_white_percent(white_percent_to_lux(pct)) == pct
    for tenth in range(0, 1001):
        pct = tenth / 10
        assert lux_to_white_percent(white_percent_to_lux(pct)) == pct
    for lux in range(0, 4001):
        assert white_percent_to_lux(lux_to_white_percent(lux)) == lux
    assert lux_to_white_percent(10000) == 100


def test_old_curve_points_are_kept_for_the_upgrade():
    points = {0: 0, 10: 46, 20: 92, 26: 190, 37: 506, 51: 1229, 78: 3984, 79: 4000, 100: 4000}
    for pct, lux in points.items():
        assert legacy_white_percent_to_lux(pct) == lux


def test_every_seed_profile_makes_the_same_light_as_before():
    profiles = {p.id: p for p in load_seed_profiles(ROOT / "data", include_psilocybin=True)}
    assert set(profiles) == set(BEFORE)
    checked = 0
    for pid, before in BEFORE.items():
        profile = profiles[pid]
        assert profile.light_recipe is not None
        for name, old in before["phases"].items():
            phase = profile.light_recipe.phases[name]
            assert white_percent_to_lux(phase.white_brightness_percent) == legacy_white_percent_to_lux(old["old_percent"]), (pid, name)
            if old["lux"] is not None:
                assert profile.stage_by_id(name).light.white_led_lux == old["lux"], (pid, name)
            checked += 1
    assert checked > 100


def test_seed_data_is_marked_and_the_migration_is_a_no_op_now():
    for path in sorted((ROOT / "data/profiles").glob("*/*.json")):
        recipe = json.loads(path.read_text()).get("light_recipe")
        assert recipe is None or recipe["white_scale"] == LIGHT_SCALE, path.name


def test_an_unmarked_recipe_is_upgraded_once_and_keeps_its_lux():
    old = {
        "why": "x",
        "sources": [{"title": "t", "detail": "d"}],
        "phases": {
            "colonization": {"photoperiod_hours": 0, "white_brightness_percent": 0},
            "fruiting": {"photoperiod_hours": 12, "white_brightness_percent": 37, "blue_percent": 80},
        },
    }
    up = upgrade_recipe_scale(old)
    assert up["white_scale"] == LIGHT_SCALE
    assert up["phases"]["fruiting"]["white_brightness_percent"] == 12.65
    assert white_percent_to_lux(12.65) == legacy_white_percent_to_lux(37) == 506
    assert upgrade_recipe_scale(up) is up
    assert old["phases"]["fruiting"]["white_brightness_percent"] == 37, "input is not mutated"
    recipe = LightRecipe.from_dict(old)
    assert recipe.phases["fruiting"].white_brightness_percent == 12.65
    assert recipe.to_dict()["white_scale"] == LIGHT_SCALE
    assert LightRecipe.from_dict(recipe.to_dict()).phases["fruiting"].white_brightness_percent == 12.65


def test_stored_unmarked_profiles_are_upgraded_on_read():
    raw = json.loads((ROOT / "data/profiles/culinary/lions-mane.json").read_text())
    raw["light_recipe"].pop("white_scale")
    raw["light_recipe"]["phases"]["fruiting"]["white_brightness_percent"] = 26
    read = normalize_stored_light(raw)
    assert read["light_recipe"]["white_scale"] == LIGHT_SCALE
    assert read["light_recipe"]["phases"]["fruiting"]["white_brightness_percent"] == 4.75
