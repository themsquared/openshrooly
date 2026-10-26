from dataclasses import replace
from pathlib import Path

import pytest

from openshrooly_lib.affiliates import AffiliatePolicyError, affiliate_links_for, record_click_allowed
from openshrooly_lib.catalog import load_profile_by_id
from openshrooly_lib.mapping import stage_to_commands
from openshrooly_lib.models import AffiliateLink
from openshrooly_lib.payments import PaymentRouter
from openshrooly_lib.schema import ValidationError

ROOT = Path(__file__).resolve().parents[1]


def test_stage_maps_to_existing_esphome_entities():
    profile = load_profile_by_id("lions-mane", ROOT / "data", include_psilocybin=False)
    commands = stage_to_commands(profile.stages[-1])
    fields = {cmd.field for cmd in commands}
    assert "humidity" in fields
    assert "fan_speed" in fields
    assert "white_led_lux" in fields
    humidity = next(cmd for cmd in commands if cmd.field == "humidity")
    assert "target_humidity" in humidity.entity_ids


def test_stripe_stub_and_psi_block():
    router = PaymentRouter()
    paid = load_profile_by_id("king-oyster-thick-stem", ROOT / "data")
    session = router.checkout_profile(paid, "user-1")
    assert session.provider == "stripe"
    assert session.status == "requires_payment"
    psi = load_profile_by_id("golden-teacher", ROOT / "data", include_psilocybin=True)
    with pytest.raises(ValidationError):
        router.checkout_profile(psi, "user-1")


def test_affiliate_policy():
    seeded = load_profile_by_id("pearl-oyster", ROOT / "data")
    # Seeds ship with no placeholder partner links.
    assert affiliate_links_for(seeded) == []
    real = AffiliateLink(id="real-spawn", label="Culinary spawn", merchant="partner", url="https://partner.invalid/spawn")
    culinary = replace(seeded, affiliate_links=[real])
    assert affiliate_links_for(culinary) == [real]
    record_click_allowed(culinary, culinary.affiliate_links[0])
    psi = load_profile_by_id("b-plus", ROOT / "data", include_psilocybin=True)
    assert affiliate_links_for(psi) == []
    with pytest.raises(AffiliatePolicyError):
        record_click_allowed(psi, culinary.affiliate_links[0])
