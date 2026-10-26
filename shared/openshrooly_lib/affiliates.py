"""Affiliate links are culinary-only, with a required FTC-style disclosure."""

from __future__ import annotations

from dataclasses import dataclass

from .models import AffiliateLink, MushroomProfile, SupplyItem


class AffiliatePolicyError(ValueError):
    """Raised when a restricted profile would be monetized via affiliates."""


DEFAULT_DISCLOSURE = (
    "Some links are affiliate links. We may earn a commission if you buy "
    "through them, at no extra cost to you."
)


@dataclass
class AffiliateClick:
    link_id: str
    profile_id: str | None
    destination: str
    disclosure_shown: bool


def record_click_allowed(profile: MushroomProfile | None, link: AffiliateLink) -> None:
    if profile is not None and (profile.is_psilocybin or not profile.affiliates_allowed):
        raise AffiliatePolicyError(
            "Affiliate links cannot be attached to the psilocybin pack "
            "(payment processors and affiliate programs prohibit it)."
        )
    if not link.url.startswith(("http://", "https://")):
        raise AffiliatePolicyError("affiliate url must be http(s)")


def affiliate_links_for(profile: MushroomProfile) -> list[AffiliateLink]:
    if profile.is_psilocybin or not profile.affiliates_allowed:
        return []
    return list(profile.affiliate_links)


def supply_links_for_profile(profile: MushroomProfile, supplies: list[SupplyItem]) -> list[AffiliateLink]:
    if profile.is_psilocybin or not profile.affiliates_allowed:
        return []
    return [item.affiliate for item in supplies if item.affiliate is not None]
