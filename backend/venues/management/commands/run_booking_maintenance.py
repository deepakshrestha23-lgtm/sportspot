from io import StringIO
import time

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
        parser.add_argument(
            "--watch",
            action="store_true",
            help="Keep running booking maintenance continuously. Use this for near real-time lifecycle processing during development or in a managed worker.",
        )
        parser.add_argument(
            "--interval",
            type=int,
            default=10,
            help="Seconds between maintenance checks when --watch is enabled.",
        )
        parser.add_argument(
            "--reminder-every",
            type=int,
            default=300,
            help="Seconds between booking-reminder checks when --watch is enabled.",
        )

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        notify = not options["no_notify"]
        interval = max(5, options["interval"])
        reminder_every = max(interval, options["reminder_every"])

        if not options["watch"]:
            self.stdout.write(self.style.SUCCESS(self.run_once(limit=limit, notify=notify, run_reminders=notify)))
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"SportSpot booking maintenance worker started. Checking lifecycle every {interval}s. "
                "Press Ctrl+C to stop."
            )
        )
        next_reminder_at = 0.0
        try:
            while True:
                now_monotonic = time.monotonic()
                run_reminders = notify and now_monotonic >= next_reminder_at
                if run_reminders:
                    next_reminder_at = now_monotonic + reminder_every
                self.stdout.write(self.run_once(limit=limit, notify=notify, run_reminders=run_reminders))
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("SportSpot booking maintenance worker stopped."))

    def run_once(self, *, limit, notify, run_reminders):
        now = timezone.now()
        expiry_result = expire_expired_reservations(now=now, limit=limit, notify=notify)
        completion_result = complete_finished_bookings(now=now, limit=limit, notify=notify)

        reminder_summary = "Booking reminders skipped."
        if run_reminders:
            reminder_output = StringIO()
            call_command("send_booking_reminders", stdout=reminder_output)
            reminder_summary = reminder_output.getvalue().strip()

        return (
            "Booking maintenance complete. "
            f"Expired {expiry_result['expired_count']} of {expiry_result['checked_count']} reservation candidate(s). "
            f"Completed {completion_result['completed_count']} of {completion_result['checked_count']} confirmed booking candidate(s). "
            f"{reminder_summary}"
        )
