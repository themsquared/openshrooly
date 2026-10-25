import json
from pathlib import Path

import pytest

from openshrooly_lib.catalog import load_seed_profiles
from openshrooly_lib.models import MushroomProfile
from openshrooly_lib.schema import ValidationError, validate_profile

ROOT = Path(__file__).resolve().parents[1]


def test_all_seed_profiles_validate():
    culinary = load_seed_profiles(ROOT / "data", include_psilocybin=False)
    assert len(culinary) >= 20
    assert all(not p.is_psilocybin for p in culinary)
    all_profiles = load_seed_profiles(ROOT / "data", include_psilocybin=True)
    assert len(all_profiles) > len(culinary)
    for profile in all_profiles:
        validate_profile(profile)
        assert profile.stages
        assert profile.source_notes
        assert profile.light_recipe
        assert profile.light_recipe.why
        assert profile.light_recipe.wavelength_note
        assert profile.light_recipe.sources
        assert "colonization" in profile.light_recipe.phases
        assert "fruiting" in profile.light_recipe.phases
        for stage in profile.stages:
            light = stage.light
            assert light.sunrise_hour is not None, f"{profile.id} {stage.id} sunrise"
            assert 0 <= light.duration_hours <= 24, f"{profile.id} {stage.id} duration"
            assert 0 <= light.white_led_lux <= 4000, f"{profile.id} {stage.id} lux"
            assert stage.id in profile.light_recipe.phases, f"{profile.id} missing {stage.id} recipe"
            on = (
                light.white_led_lux > 0
                or light.red_percent > 0
                or light.green_percent > 0
                or light.blue_percent > 0
            )
            if on:
                assert light.duration_hours > 0, f"{profile.id} {stage.id} lit without duration"


def test_every_built_in_stage_has_complete_light():
    for profile in load_seed_profiles(ROOT / "data", include_psilocybin=True):
        validate_profile(profile)
        for stage in profile.stages:
            light = stage.light
            assert 0 <= light.sunrise_hour <= 23
            assert light.duration_hours is not None
            phase = profile.light_recipe.phases[stage.id]
            assert 0 <= phase.photoperiod_hours <= 24
            assert 0 <= phase.white_brightness_percent <= 100
            assert stage.light.duration_hours == phase.photoperiod_hours


def test_light_recipe_ranges_and_sources():
    raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
    validate_profile(raw)
    raw["light_recipe"]["phases"]["fruiting"]["photoperiod_hours"] = 30
    with pytest.raises(ValidationError, match="photoperiod"):
        validate_profile(raw)
    raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
    raw["light_recipe"]["phases"]["fruiting"]["white_brightness_percent"] = 140
    with pytest.raises(ValidationError, match="white brightness"):
        validate_profile(raw)
    raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
    raw["light_recipe"]["sources"] = []
    with pytest.raises(ValidationError, match="source"):
        validate_profile(raw)
    raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
    del raw["light_recipe"]["phases"]["colonization"]
    with pytest.raises(ValidationError, match="colonization"):
        validate_profile(raw)
    for bad_url in ("javascript:alert(1)", "data:text/html,hi", "http://example.com/paper"):
        raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
        raw["light_recipe"]["sources"][0]["url"] = bad_url
        with pytest.raises(ValidationError, match="https"):
            validate_profile(raw)


def test_psilocybin_cannot_be_paid_or_affiliated():
    raw = json.loads((ROOT / "data/profiles/psilocybin/golden-teacher.json").read_text())
    validate_profile(raw)
    raw["pricing"] = {"kind": "paid", "amount_cents": 199, "currency": "USD", "creator_share_percent": 70}
    raw["allowed_payment_providers"] = ["stripe"]
    with pytest.raises(ValidationError):
        validate_profile(raw)


def test_round_trip_json():
    profile = load_seed_profiles(ROOT / "data", include_psilocybin=False)[0]
    again = MushroomProfile.from_dict(profile.to_dict())
    assert again.id == profile.id
    assert again.total_days() == profile.total_days()


def test_lit_stage_cannot_have_zero_duration():
    raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
    raw["stages"][1]["light"]["duration_hours"] = 0
    with pytest.raises(ValidationError, match="duration"):
        validate_profile(raw)
    raw = json.loads((ROOT / "data/profiles/culinary/pearl-oyster.json").read_text())
    del raw["light_recipe"]["phases"]["pinning"]
    with pytest.raises(ValidationError, match="pinning"):
        validate_profile(raw)


def test_stage_at_day_walks_sequence():
    profile = next(p for p in load_seed_profiles(ROOT / "data") if p.id == "shiitake")
    assert profile.stage_at_day(0).id == "colonization"
    assert profile.stage_at_day(profile.total_days() + 10).id == profile.stages[-1].id
