from datetime import datetime, timedelta

from django.core.signing import BadSignature, Signer
from django.db import transaction
from django.utils import timezone

from notifications.services import notify_booking_completed, notify_booking_payment_failed

from .models import Booking, BookingCheckIn, CourtSlot
from .policies import get_booking_start_at


BOOKING_CHECK_IN_TOKEN_SALT = "sportspot.booking-check-in.v1"
CHECK_IN_WINDOW_BEFORE = timedelta(hours=2)
CHECK_IN_WINDOW_AFTER = timedelta(hours=2)


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


def generate_booking_check_in_token(booking):
    """Return an opaque, tamper-evident token without embedding private data."""
    payload = f"v1|{booking.id}|{booking.booking_code}"
    return Signer(salt=BOOKING_CHECK_IN_TOKEN_SALT).sign(payload)


def parse_booking_check_in_token(token):
    try:
        payload = Signer(salt=BOOKING_CHECK_IN_TOKEN_SALT).unsign(str(token or "").strip())
        version, booking_id, booking_code = payload.split("|", 2)
        if version != "v1":
            return None
        return int(booking_id), booking_code
    except (BadSignature, TypeError, ValueError):
        return None


def get_booking_check_in_window(booking):
    start_at = get_booking_start_at(booking)
    end_at = get_booking_end_at(booking)
    if not start_at or not end_at:
        return None, None
    return start_at - CHECK_IN_WINDOW_BEFORE, end_at + CHECK_IN_WINDOW_AFTER


def get_booking_check_in_state(booking, *, now=None):
    now = now or timezone.now()
    window_start, window_end = get_booking_check_in_window(booking)
    check_in = getattr(booking, "check_in", None)

    if booking.status not in [Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED] or booking.payment_status != Booking.PaymentStatus.PAID:
        return {
            "status": "NOT_AVAILABLE",
            "message": "Check-in is available only for a paid confirmed booking.",
            "window_start": window_start,
            "window_end": window_end,
            "check_in": check_in,
        }
    if check_in:
        return {
            "status": "CHECKED_IN",
            "message": "This booking has already been checked in.",
            "window_start": window_start,
            "window_end": window_end,
            "check_in": check_in,
        }
    if not window_start or not window_end:
        return {
            "status": "NOT_AVAILABLE",
            "message": "The booking schedule is not available for check-in.",
            "window_start": window_start,
            "window_end": window_end,
            "check_in": None,
        }
    if now < window_start:
        return {
            "status": "NOT_YET_OPEN",
            "message": "Check-in opens two hours before the booking starts.",
            "window_start": window_start,
            "window_end": window_end,
            "check_in": None,
        }
    if now > window_end:
        return {
            "status": "CLOSED",
            "message": "The check-in window for this booking has closed.",
            "window_start": window_start,
            "window_end": window_end,
            "check_in": None,
        }
    return {
        "status": "READY",
        "message": "This booking is ready for venue check-in.",
        "window_start": window_start,
        "window_end": window_end,
        "check_in": None,
    }


def record_booking_check_in(booking, owner, *, now=None):
    now = now or timezone.now()
    check_in, created = BookingCheckIn.objects.select_for_update().get_or_create(
        booking=booking,
        defaults={
            "status": BookingCheckIn.Status.CHECKED_IN,
            "checked_in_at": now,
            "checked_in_by": owner,
            "scan_count": 1,
            "last_scanned_at": now,
        },
    )
    if not created:
        check_in.scan_count += 1
        check_in.last_scanned_at = now
        check_in.save(update_fields=["scan_count", "last_scanned_at", "updated_at"])
    return check_in, created


def expire_reserved_booking(booking_id, *, now=None, notify=True):
    now = now or timezone.now()
    expired_booking = None

    with transaction.atomic():
        # Linked Plan First payments use the game as the coordination lock.
        # Acquire it before the booking so expiry, payment verification and
        # cancellation all use the same game -> booking -> slots order.
        booking_hint = (
            Booking.objects.filter(pk=booking_id)
            .values("matchmaking_game_id")
            .first()
        )
        if booking_hint and booking_hint["matchmaking_game_id"]:
            from matchmaking.models import Game

            Game.objects.select_for_update(of=("self",)).filter(
                pk=booking_hint["matchmaking_game_id"]
            ).first()
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
        if booking.matchmaking_game_id:
            booking.matchmaking_sync_status = Booking.MatchmakingSyncStatus.RELEASED
        booking.save(
            update_fields=[
                "status",
                "payment_status",
                "refund_status",
                "refund_reason",
                "matchmaking_sync_status",
                "updated_at",
            ]
        )
        slots.filter(status=CourtSlot.Status.RESERVED).update(
            status=CourtSlot.Status.AVAILABLE,
            reserved_until=None,
            updated_at=now,
        )
        if booking.matchmaking_game_id:
            # Keep a Plan First game coherent with the short Khalti hold. The
            # game is restored as a private closed plan or cancelled when its
            # own booking deadline has elapsed; it is never left claiming a
            # court is being paid for after the hold disappeared.
            from matchmaking.services import restore_game_after_booking_handoff_expiry

            restore_game_after_booking_handoff_expiry(booking, now=now)
        expired_booking = booking

    if expired_booking and notify:
        notify_booking_payment_failed(expired_booking, expired_booking.player)

    return bool(expired_booking)


def release_reserved_booking_for_game(game_id, *, now=None):
    """Release an unpaid Plan First reservation when its game is cancelled."""
    now = now or timezone.now()
    with transaction.atomic():
        from matchmaking.models import Game

        Game.objects.select_for_update(of=("self",)).filter(pk=game_id).first()
        booking = (
            Booking.objects.select_for_update()
            .prefetch_related("slot_items__slot")
            .filter(
                matchmaking_game_id=game_id,
                status=Booking.BookingStatus.RESERVED,
                payment_status=Booking.PaymentStatus.PENDING,
            )
            .first()
        )
        if not booking:
            return False

        slot_ids = get_booking_slot_ids(booking)
        slots = CourtSlot.objects.select_for_update().filter(id__in=slot_ids)
        booking.status = Booking.BookingStatus.CANCELLED
        booking.payment_status = Booking.PaymentStatus.CANCELLED
        booking.refund_status = Booking.RefundStatus.NOT_REQUIRED
        booking.cancellation_tier = Booking.CancellationTier.UNPAID_RELEASE
        booking.refund_reason = "The unpaid court reservation was released because the game was cancelled."
        booking.cancelled_at = now
        booking.matchmaking_sync_status = Booking.MatchmakingSyncStatus.RELEASED
        booking.save(update_fields=[
            "status", "payment_status", "refund_status", "cancellation_tier",
            "refund_reason", "cancelled_at", "matchmaking_sync_status", "updated_at",
        ])
        slots.filter(status=CourtSlot.Status.RESERVED).update(
            status=CourtSlot.Status.AVAILABLE,
            reserved_until=None,
            updated_at=now,
        )
        return True


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
        booking.completed_at = end_at
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
    local_today = timezone.localdate(now)
    candidate_ids = list(
        Booking.objects.filter(
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            slot__date__lte=local_today,
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


def reconcile_matchmaking_booking_handoffs(*, limit=100):
    """Repair a confirmed plan-first payment whose game attachment was delayed.

    A court booking remains confirmed once Khalti verification succeeds. This
    worker retries only the secondary game-link operation and records a clear
    review state if it cannot be repaired automatically.
    """
    booking_ids = list(
        Booking.objects.filter(
            matchmaking_game__isnull=False,
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            matchmaking_sync_status__in=[
                Booking.MatchmakingSyncStatus.PENDING_PAYMENT,
                Booking.MatchmakingSyncStatus.RECONCILIATION_REQUIRED,
            ],
        )
        .order_by("confirmed_at", "id")
        .values_list("id", flat=True)[:limit]
    )
    attached_count = 0
    review_count = 0
    for booking_id in booking_ids:
        with transaction.atomic():
            booking_hint = (
                Booking.objects.filter(pk=booking_id)
                .values("matchmaking_game_id")
                .first()
            )
            if booking_hint and booking_hint["matchmaking_game_id"]:
                from matchmaking.models import Game

                Game.objects.select_for_update(of=("self",)).filter(
                    pk=booking_hint["matchmaking_game_id"]
                ).first()
            booking = (
                Booking.objects.select_for_update()
                .select_related("player", "matchmaking_game")
                .filter(id=booking_id)
                .first()
            )
            if not booking or not booking.matchmaking_game_id:
                continue
            try:
                from matchmaking.services import attach_booking_to_game

                attach_booking_to_game(
                    booking.matchmaking_game,
                    booking,
                    booking.player,
                    from_payment_handoff=True,
                )
                booking.matchmaking_sync_status = Booking.MatchmakingSyncStatus.ATTACHED
                booking.matchmaking_sync_error = ""
                booking.save(update_fields=["matchmaking_sync_status", "matchmaking_sync_error", "updated_at"])
                attached_count += 1
            except Exception as exc:
                if exc.__class__.__name__ != "ValidationError":
                    raise
                booking.matchmaking_sync_status = Booking.MatchmakingSyncStatus.RECONCILIATION_REQUIRED
                booking.matchmaking_sync_error = str(exc)[:300]
                booking.save(update_fields=["matchmaking_sync_status", "matchmaking_sync_error", "updated_at"])
                review_count += 1
    return {
        "checked_count": len(booking_ids),
        "attached_count": attached_count,
        "review_count": review_count,
    }
