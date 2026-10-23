from pathlib import Path

from openshrooly_lib.catalog import load_seed_profiles
from openshrooly_lib.models import GrowReport
from openshrooly_lib.sync import SyncEnvelope, build_push, merge_profiles

ROOT = Path(__file__).resolve().parents[1]


def test_push_envelope_round_trip():
    profiles = load_seed_profiles(ROOT / "data")[:2]
    envelope = build_push("hub-1", profiles, [GrowReport(profile_id=profiles[0].id, outcome="success")])
    again = SyncEnvelope.from_dict(envelope.to_dict())
    assert again.hub_id == "hub-1"
    assert len(again.profiles) == 2


def test_merge_last_writer_wins():
    local = load_seed_profiles(ROOT / "data")[:2]
    incoming = [local[0]]
    incoming[0].notes = "updated"
    merged = merge_profiles(local, incoming)
    assert next(p for p in merged if p.id == local[0].id).notes == "updated"
