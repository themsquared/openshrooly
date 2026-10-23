"""Provider-agnostic checkout. Stripe is stubbed; BTCPay is documented only."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from .models import MushroomProfile
from .schema import ValidationError


@dataclass
class CheckoutRequest:
    item_id: str
    item_type: str
    amount_cents: int
    currency: str
    buyer_account_id: str
    allowed_providers: list[str]
    description: str = ""


@dataclass
class CheckoutSession:
    id: str
    provider: str
    status: str
    checkout_url: str | None = None
    entitlement_granted: bool = False
    details: dict[str, Any] = field(default_factory=dict)


class PaymentProvider(Protocol):
    name: str

    def create_checkout(self, request: CheckoutRequest) -> CheckoutSession: ...

    def complete_checkout(self, session_id: str, payload: dict[str, Any] | None = None) -> CheckoutSession: ...


class StripeStubProvider:
    """Local stand-in for Stripe Checkout. No live keys, no network charges."""

    name = "stripe"

    def __init__(self) -> None:
        self.sessions: dict[str, CheckoutSession] = {}

    def create_checkout(self, request: CheckoutRequest) -> CheckoutSession:
        session = CheckoutSession(
            id=f"cs_test_{uuid4().hex[:16]}",
            provider=self.name,
            status="requires_payment",
            checkout_url=f"/pay/stub/{request.item_id}",
            details={
                "item_id": request.item_id,
                "item_type": request.item_type,
                "amount_cents": request.amount_cents,
                "currency": request.currency,
                "buyer_account_id": request.buyer_account_id,
                "note": "Stub only. Wire a real Stripe secret in production.",
            },
        )
        self.sessions[session.id] = session
        return session

    def complete_checkout(self, session_id: str, payload: dict[str, Any] | None = None) -> CheckoutSession:
        session = self.sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        session.status = "paid"
        session.entitlement_granted = True
        if payload:
            session.details.update(payload)
        return session


class PaymentRouter:
    """Pick a configured provider from the item's allowed list."""

    def __init__(self, providers: dict[str, PaymentProvider] | None = None):
        self.providers = providers or {"stripe": StripeStubProvider()}

    def assert_item_billable(self, profile: MushroomProfile) -> None:
        if profile.is_psilocybin:
            raise ValidationError(
                "Psilocybin pack is free-only. Card processors and affiliate "
                "programs prohibit these items. A future self-hosted crypto "
                "provider (e.g. BTCPay) is documented in the ROADMAP and is "
                "not implemented in this pass."
            )
        if profile.is_free:
            raise ValidationError("free items do not go through checkout")
        if not profile.allowed_payment_providers:
            raise ValidationError("paid item has no allowed_payment_providers")

    def choose_provider(self, allowed: list[str]) -> PaymentProvider:
        for name in allowed:
            provider = self.providers.get(name)
            if provider is not None:
                return provider
        raise ValidationError(f"no configured payment provider in {allowed}")

    def checkout_profile(self, profile: MushroomProfile, buyer_account_id: str) -> CheckoutSession:
        self.assert_item_billable(profile)
        provider = self.choose_provider(profile.allowed_payment_providers)
        request = CheckoutRequest(
            item_id=profile.id,
            item_type="profile",
            amount_cents=profile.pricing.amount_cents,
            currency=profile.pricing.currency,
            buyer_account_id=buyer_account_id,
            allowed_providers=profile.allowed_payment_providers,
            description=profile.name,
        )
        return provider.create_checkout(request)
