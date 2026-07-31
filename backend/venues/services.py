from datetime import datetime

from django.db import transaction
from django.utils import timezone

from notifications.services import notify_booking_completed, notify_booking_payment_failed

from .models import Booking, CourtSlot


def get_booking_slot_ids(booking):
    slot_ids = list(booking.slot_items.values_list("slot_id", flat=True))
    return slot_ids or [booking.slot_id]


def get_booking_end_at(booking):
    slots = booking.booked_slots
    if not slots:
        return None
    last_slot = slots[-1]
    return timezone.make_aware(
        datetime.combine(last_slot.date, last_slot.end_time),
        timezone.get_current_timezone(),
    )


def expire_reserved_booking(booking_id, *, now=None, notify=True):
    now = now or timezone.now()
    expired_booking = None

    with transaction.atomic():
        booking = (
            Booking.objects.select_for_update()
            .select_related("player", "venue", "venue__owner", "court", "slot")
            .prefetch_related("slot_items__slot")
            .filter(pk=booking_id)
            .first()
        )
        if (
            not booking
            or booking.status != Booking.BookingStatus.RESERVED
            or booking.reserved_until > now
        ):
            return False

        slot_ids = get_booking_slot_ids(booking)
        slots = CourtSlot.objects.select_for_update().filter(id__in=slot_ids)

        booking.status = Booking.BookingStatus.EXPIRED
        booking.payment_status = Booking.PaymentStatus.FAILED
        booking.refund_status = Booking.RefundStatus.NOT_REQUIRED
        booking.refund_reason = "Unpaid reservation expired before payment."
        booking.save(
            update_fields=[
                "status",
                "payment_status",
                "refund_status",
                "refund_reason",
                "updated_at",
            ]
        )
        slots.filter(status=CourtSlot.Status.RESERVED).update(
            status=CourtSlot.Status.AVAILABLE,
            reserved_until=None,
            updated_at=now,
        )
        expired_booking = booking

    if expired_booking and notify:
        notify_booking_payment_failed(expired_booking, expired_booking.player)

    return bool(expired_booking)


def complete_confirmed_booking(booking_id, *, now=None, notify=True):
    now = now or timezone.now()
    completed_booking = None

    with transaction.atomic():
        booking = (
            Booking.objects.select_for_update()
            .select_related("player", "venue", "venue__owner", "court", "slot")
            .prefetch_related("slot_items__slot")
            .filter(pk=booking_id)
            .first()
        )
        if (
            not booking
            or booking.status != Booking.BookingStatus.CONFIRMED
            or booking.payment_status != Booking.PaymentStatus.PAID
        ):
            return False

        end_at = get_booking_end_at(booking)
        if not end_at or end_at > now:
            return False

        booking.status = Booking.BookingStatus.COMPLETED
        booking.completed_at = now
        booking.save(update_fields=["status", "completed_at", "updated_at"])
        completed_booking = booking

    if completed_booking and notify:
        notify_booking_completed(completed_booking)

    return bool(completed_booking)


def expire_expired_reservations(*, now=None, limit=100, notify=True):
    now = now or timezone.now()
    booking_ids = list(
        Booking.objects.filter(
            status=Booking.BookingStatus.RESERVED,
            reserved_until__lte=now,
        )
        .order_by("reserved_until", "id")
        .values_list("id", flat=True)[:limit]
    )

    expired_count = 0
    for booking_id in booking_ids:
        if expire_reserved_booking(booking_id, now=now, notify=notify):
            expired_count += 1

    return {
        "checked_count": len(booking_ids),
        "expired_count": expired_count,
    }


def complete_finished_bookings(*, now=None, limit=100, notify=True):
    now = now or timezone.now()
    candidate_ids = list(
        Booking.objects.filter(
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
        )
        .order_by("slot__date", "slot__end_time", "id")
        .values_list("id", flat=True)[:limit]
    )

    completed_count = 0
    for booking_id in candidate_ids:
        if complete_confirmed_booking(booking_id, now=now, notify=notify):
            completed_count += 1

    return {
        "checked_count": len(candidate_ids),
        "completed_count": completed_count,
    }
