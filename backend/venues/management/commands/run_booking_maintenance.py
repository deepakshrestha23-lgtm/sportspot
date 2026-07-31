from io import StringIO

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from venues.services import complete_finished_bookings, expire_expired_reservations


class Command(BaseCommand):
    help = "Run SportSpot booking maintenance: expire unpaid reservations, complete finished bookings, and send reminders."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum expired/finished booking candidates to process for each lifecycle step.",
        )
        parser.add_argument(
            "--no-notify",
            action="store_true",
            help="Run lifecycle updates without notifications, emails, or booking reminders.",
        )

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        notify = not options["no_notify"]
        now = timezone.now()

        expiry_result = expire_expired_reservations(now=now, limit=limit, notify=notify)
        completion_result = complete_finished_bookings(now=now, limit=limit, notify=notify)

        reminder_summary = "Booking reminders skipped."
        if notify:
            reminder_output = StringIO()
            call_command("send_booking_reminders", stdout=reminder_output)
            reminder_summary = reminder_output.getvalue().strip()

        self.stdout.write(
            self.style.SUCCESS(
                "Booking maintenance complete. "
                f"Expired {expiry_result['expired_count']} of {expiry_result['checked_count']} reservation candidate(s). "
                f"Completed {completion_result['completed_count']} of {completion_result['checked_count']} confirmed booking candidate(s). "
                f"{reminder_summary}"
            )
        )
