"""Shared OpenShrooly profile, device, sync, and monetization library."""

from .affiliates import AffiliatePolicyError, affiliate_links_for, record_click_allowed
from .catalog import load_seed_profiles, load_supply_catalog
from .mapping import stage_to_commands
from .models import (
    AffiliateLink,
    GrowReport,
    LightSchedule,
    MushroomProfile,
    PaymentKind,
    Pricing,
    ProfileStage,
    SourceNote,
    SupplyItem,
)
from .payments import PaymentRouter, PaymentProvider, StripeStubProvider
from .schema import PROFILE_SCHEMA_VERSION, ValidationError, validate_profile

__all__ = [
    "AffiliateLink",
    "AffiliatePolicyError",
    "GrowReport",
    "LightSchedule",
    "MushroomProfile",
    "PROFILE_SCHEMA_VERSION",
    "PaymentKind",
    "PaymentProvider",
    "PaymentRouter",
    "Pricing",
    "ProfileStage",
    "SourceNote",
    "StripeStubProvider",
    "SupplyItem",
    "ValidationError",
    "affiliate_links_for",
    "load_seed_profiles",
    "load_supply_catalog",
    "record_click_allowed",
    "stage_to_commands",
    "validate_profile",
]
