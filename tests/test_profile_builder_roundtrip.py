"""Built-in profiles stay valid after a builder-style export/import."""

from __future__ import annotations

import json
from pathlib import Path

from openshrooly_lib.catalog import load_seed_profiles
from openshrooly_lib.schema import validate_profile

ROOT = Path(__file__).resolve().parents[1]


def test_every_seed_round_trips_through_json_and_validates():
    profiles = load_seed_profiles(ROOT / "data", include_psilocybin=True)
    assert len(profiles) >= 26
    for profile in profiles:
        raw = json.loads(json.dumps(profile.to_dict()))
        again = validate_profile(raw)
        assert again.id == profile.id
        assert again.light_recipe is not None
        assert "colonization" in again.light_recipe.phases
        assert "fruiting" in again.light_recipe.phases
