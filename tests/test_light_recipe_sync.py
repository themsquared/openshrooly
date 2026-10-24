from pathlib import Path

from openshrooly_lib.catalog import load_profile_by_id, load_seed_profiles
from openshrooly_lib.light_recipes import recipe_for
from openshrooly_lib.mapping import (
    apply_recipe_to_profile,
    brightness_percent_to_lux,
    lux_to_brightness_percent,
    stage_to_commands,
)

ROOT = Path(__file__).resolve().parents[1]


def _cmd(commands, field):
    return next(cmd for cmd in commands if cmd.field == field)


def test_firmware_white_curve_round_trip():
    assert brightness_percent_to_lux(0) == 0
    assert brightness_percent_to_lux(20) == 92
    assert brightness_percent_to_lux(51) == 1230
    assert abs(lux_to_brightness_percent(92) - 20) < 0.01
    assert abs(lux_to_brightness_percent(brightness_percent_to_lux(37)) - 37) < 0.6


def test_recipe_maps_to_existing_light_entities():
    profile = load_profile_by_id("pearl-oyster", ROOT / "data")
    fruiting = profile.stage_by_id("fruiting")
    commands = stage_to_commands(fruiting, profile.light_recipe)
    assert _cmd(commands, "light_hours").value == 12
    assert _cmd(commands, "white_led_lux").value == 92
    assert _cmd(commands, "red").value == 0
    assert _cmd(commands, "green").value == 0
    assert _cmd(commands, "blue").value == 80
    assert "light_hours" in _cmd(commands, "light_hours").entity_ids
    assert "white_intensity" in _cmd(commands, "white_led_lux").entity_ids
    assert "color_b" in _cmd(commands, "blue").entity_ids

    colonize = stage_to_commands(profile.stage_by_id("colonization"), profile.light_recipe)
    assert _cmd(colonize, "light_hours").value == 0
    assert _cmd(colonize, "white_led_lux").value == 0
    assert _cmd(colonize, "blue").value == 0


def test_recipe_overrides_stale_stage_light():
    profile = load_profile_by_id("pearl-oyster", ROOT / "data")
    stage = profile.stage_by_id("fruiting")
    stage.light.duration_hours = 3
    stage.light.white_led_lux = 9
    stage.light.blue_percent = 1
    commands = stage_to_commands(stage, profile.light_recipe)
    assert _cmd(commands, "light_hours").value == 12
    assert _cmd(commands, "white_led_lux").value == 92
    assert _cmd(commands, "blue").value == 80


def test_variety_specific_and_dark_recipes_sync():
    cordyceps = load_profile_by_id("cordyceps-militaris", ROOT / "data")
    commands = stage_to_commands(cordyceps.stage_by_id("fruiting"), cordyceps.light_recipe)
    assert _cmd(commands, "light_hours").value == 12
    assert _cmd(commands, "white_led_lux").value == brightness_percent_to_lux(51)
    assert _cmd(commands, "blue").value == 80

    button = load_profile_by_id("button-cremini", ROOT / "data")
    commands = stage_to_commands(button.stage_by_id("fruiting"), button.light_recipe)
    assert _cmd(commands, "light_hours").value == 0
    assert _cmd(commands, "white_led_lux").value == 0

    enoki = load_profile_by_id("enoki", ROOT / "data")
    commands = stage_to_commands(enoki.stage_by_id("fruiting"), enoki.light_recipe)
    assert _cmd(commands, "light_hours").value == 0


def test_every_seed_recipe_has_a_source_and_matches_catalog():
    for profile in load_seed_profiles(ROOT / "data", include_psilocybin=True):
        catalog = recipe_for(profile.id)
        assert profile.light_recipe is not None
        assert profile.light_recipe.sources
        assert profile.light_recipe.why == catalog.why
        apply_recipe_to_profile(profile)
        fruiting = profile.stage_by_id("fruiting")
        phase = profile.light_recipe.phase_for("fruiting")
        assert fruiting.light.duration_hours == phase.photoperiod_hours
        assert fruiting.light.blue_percent == phase.blue_percent
        assert fruiting.light.white_led_lux == brightness_percent_to_lux(phase.white_brightness_percent)
