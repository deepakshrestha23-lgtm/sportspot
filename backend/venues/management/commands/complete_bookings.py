from django.core.management.base import BaseCommand
from django.utils import timezone

from venues.services import complete_finished_bookings


class Command(BaseCommand):
    help = "Mark paid confirmed bookings as completed after their final slot end time passes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum number of confirmed booking candidates to process in one run.",
        )
        parser.add_argument(
            "--no-notify",
            action="store_true",
            help="Complete bookings without creating booking-completed notifications.",
        )

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        result = complete_finished_bookings(
            now=timezone.now(),
            limit=limit,
            notify=not options["no_notify"],
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Checked {result['checked_count']} confirmed booking candidate(s); "
                f"completed {result['completed_count']} booking(s)."
            )
        )
