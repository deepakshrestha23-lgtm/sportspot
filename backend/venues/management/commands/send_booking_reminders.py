from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from notifications.email_service import schedule_booking_reminder
from notifications.models import Notification
from notifications.services import create_notification
from venues.models import Booking
from venues.policies import get_booking_start_at


class Command(BaseCommand):
    help = "Send one in-app and email reminder for confirmed bookings starting within 24 hours."

    def handle(self, *args, **options):
        now = timezone.now()
        window_end = now + timedelta(hours=24)
        checked = 0
        scheduled = 0
        bookings = (
            Booking.objects.filter(
                status=Booking.BookingStatus.CONFIRMED,
                payment_status=Booking.PaymentStatus.PAID,
            )
            .select_related("player", "venue", "court", "slot")
            .prefetch_related("slot_items__slot")
        )

        for booking in bookings:
            checked += 1
            starts_at = get_booking_start_at(booking)
            if not starts_at or starts_at <= now or starts_at > window_end:
                continue

            deduplication_key = f"booking:{booking.id}:reminder:24h"
            was_existing = Notification.objects.filter(
                deduplication_key=deduplication_key
            ).exists()
            create_notification(
                recipient=booking.player,
                notification_type=Notification.NotificationType.BOOKING_REMINDER,
                title="Your Cricksal booking is coming up",
                message=(
                    f"{booking.booking_code} at {booking.venue.name} starts "
                    f"{timezone.localtime(starts_at).strftime('%d %b at %I:%M %p')}."
                ),
                priority=Notification.Priority.IMPORTANT,
                action_url=f"/dashboard/player/bookings/{booking.id}",
                related_entity_type="booking",
                related_entity_id=booking.id,
                metadata={
                    "booking_id": booking.id,
                    "booking_code": booking.booking_code,
                    "venue_id": booking.venue_id,
                    "court_id": booking.court_id,
                },
                deduplication_key=deduplication_key,
            )
            schedule_booking_reminder(booking)
            if not was_existing:
                scheduled += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Checked {checked} confirmed bookings; queued reminders for {scheduled} eligible bookings."
            )
        )
