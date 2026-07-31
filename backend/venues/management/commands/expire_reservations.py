from django.core.management.base import BaseCommand
from django.utils import timezone

from venues.services import expire_expired_reservations


class Command(BaseCommand):
    help = "Expire unpaid court booking reservations whose payment window has passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum number of expired reservations to process in one run.",
        )
        parser.add_argument(
            "--no-notify",
            action="store_true",
            help="Expire reservations without creating payment-failed notifications or emails.",
        )

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        result = expire_expired_reservations(
            now=timezone.now(),
            limit=limit,
            notify=not options["no_notify"],
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Checked {result['checked_count']} expired reservation candidate(s); "
                f"expired {result['expired_count']} booking(s)."
            )
        )
