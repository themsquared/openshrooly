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


def test_stage_at_day_walks_sequence():
    profile = next(p for p in load_seed_profiles(ROOT / "data") if p.id == "shiitake")
    assert profile.stage_at_day(0).id == "colonization"
    assert profile.stage_at_day(profile.total_days() + 10).id == profile.stages[-1].id
