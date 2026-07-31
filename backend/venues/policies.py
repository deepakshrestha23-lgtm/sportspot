from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from .models import Booking


DEFAULT_FULL_REFUND_HOURS = 24
DEFAULT_PARTIAL_REFUND_HOURS = 12
DEFAULT_PARTIAL_REFUND_PERCENT = 50


def build_cancellation_policy_snapshot(venue, captured_at=None):
    captured_at = captured_at or timezone.now()
    return {
        "version": venue.cancellation_policy_version,
        "full_refund_hours": venue.cancellation_full_refund_hours,
        "partial_refund_enabled": venue.cancellation_partial_refund_enabled,
        "partial_refund_hours": venue.cancellation_partial_refund_hours,
        "partial_refund_percent": venue.cancellation_partial_refund_percent,
        "additional_notes": venue.cancellation_policy,
        "captured_at": captured_at.isoformat(),
    }


def normalize_cancellation_policy_snapshot(booking):
    snapshot = booking.cancellation_policy_snapshot or {}
    return {
        "version": int(snapshot.get("version") or 1),
        "full_refund_hours": int(snapshot.get("full_refund_hours") or DEFAULT_FULL_REFUND_HOURS),
        "partial_refund_enabled": bool(snapshot.get("partial_refund_enabled", True)),
        "partial_refund_hours": int(snapshot.get("partial_refund_hours") or DEFAULT_PARTIAL_REFUND_HOURS),
        "partial_refund_percent": int(snapshot.get("partial_refund_percent") or DEFAULT_PARTIAL_REFUND_PERCENT),
        "additional_notes": str(snapshot.get("additional_notes") or booking.venue.cancellation_policy or ""),
        "captured_at": snapshot.get("captured_at") or booking.created_at.isoformat(),
    }


def get_booking_start_at(booking):
    slots = booking.booked_slots
    if not slots:
        return None
    return timezone.make_aware(
        datetime.combine(slots[0].date, slots[0].start_time),
        timezone.get_current_timezone(),
    )


def get_policy_summary(snapshot):
    full_hours = snapshot["full_refund_hours"]
    summary = [f"100% refund when cancelled at least {full_hours} hours before start."]
    if snapshot["partial_refund_enabled"]:
        partial_hours = snapshot["partial_refund_hours"]
        partial_percent = snapshot["partial_refund_percent"]
        summary.append(
            f"{partial_percent}% refund when cancelled between {partial_hours} and {full_hours} hours before start."
        )
        summary.append(f"No refund when cancelled less than {partial_hours} hours before start.")
    else:
        summary.append(f"No refund when cancelled less than {full_hours} hours before start.")
    summary.append("Venue-caused cancellations receive a 100% refund.")
    return summary


def calculate_refund_amount(amount, percentage):
    return (
        Decimal(amount) * Decimal(percentage) / Decimal("100")
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_cancellation_quote(booking, role, start_at=None, now=None):
    now = now or timezone.now()
    start_at = start_at or get_booking_start_at(booking)
    policy = normalize_cancellation_policy_snapshot(booking)
    base = {
        "can_cancel": False,
        "tier": Booking.CancellationTier.NOT_APPLICABLE,
        "refund_percentage": 0,
        "refund_amount": Decimal("0.00"),
        "refund_required": False,
        "late_cancellation": False,
        "hours_until_start": None,
        "message": "This booking cannot be cancelled.",
        "policy": policy,
        "policy_summary": get_policy_summary(policy),
    }

    if booking.status == Booking.BookingStatus.RESERVED:
        return {
            **base,
            "can_cancel": role in ["PLAYER", "COURT_OWNER", "ADMIN"],
            "tier": Booking.CancellationTier.UNPAID_RELEASE,
            "message": "Payment is still pending. Cancelling releases all selected slots and no refund is required.",
        }

    if booking.status != Booking.BookingStatus.CONFIRMED or not start_at:
        return base

    hours_until_start = (start_at - now).total_seconds() / 3600
    if role != "ADMIN" and hours_until_start <= 0:
        return {
            **base,
            "hours_until_start": round(hours_until_start, 2),
            "message": "The booking has already started and can no longer be cancelled.",
        }

    if role == "COURT_OWNER":
        return {
            **base,
            "can_cancel": hours_until_start > 0,
            "tier": Booking.CancellationTier.OWNER_FULL_REFUND,
            "refund_percentage": 100,
            "refund_amount": calculate_refund_amount(booking.amount, 100),
            "refund_required": True,
            "hours_until_start": round(hours_until_start, 2),
            "message": "Venue cancellation requires a 100% refund to the player.",
        }

    if role == "ADMIN":
        return {
            **base,
            "can_cancel": True,
            "tier": Booking.CancellationTier.ADMIN_DECISION,
            "hours_until_start": round(hours_until_start, 2),
            "message": "Admin cancellation refund handling follows the selected administrative outcome.",
        }

    full_hours = policy["full_refund_hours"]
    partial_hours = policy["partial_refund_hours"]
    if hours_until_start >= full_hours:
        percentage = 100
        tier = Booking.CancellationTier.FULL_REFUND
        message = f"Eligible for a 100% refund because cancellation is at least {full_hours} hours before start."
        late_cancellation = False
    elif policy["partial_refund_enabled"] and hours_until_start >= partial_hours:
        percentage = policy["partial_refund_percent"]
        tier = Booking.CancellationTier.PARTIAL_REFUND
        message = (
            f"Eligible for a {percentage}% refund because cancellation is between "
            f"{partial_hours} and {full_hours} hours before start."
        )
        late_cancellation = False
    else:
        percentage = 0
        tier = Booking.CancellationTier.NO_REFUND
        cutoff = partial_hours if policy["partial_refund_enabled"] else full_hours
        message = f"No refund applies because cancellation is less than {cutoff} hours before start."
        late_cancellation = True

    return {
        **base,
        "can_cancel": hours_until_start > 0,
        "tier": tier,
        "refund_percentage": percentage,
        "refund_amount": calculate_refund_amount(booking.amount, percentage),
        "refund_required": percentage > 0,
        "late_cancellation": late_cancellation,
        "hours_until_start": round(hours_until_start, 2),
        "message": message,
    }
