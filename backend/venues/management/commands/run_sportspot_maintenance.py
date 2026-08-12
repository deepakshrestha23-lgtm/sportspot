import time

from django.core.management.base import BaseCommand

from sportspot_api.maintenance import format_maintenance_summary, run_platform_maintenance


class Command(BaseCommand):
    help = "Run SportSpot booking, matchmaking, completion, expiry, and reminder maintenance."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100, help="Maximum candidates processed per lifecycle step.")
        parser.add_argument("--no-notify", action="store_true", help="Skip in-app notifications and transactional email work.")
        parser.add_argument("--no-reminders", action="store_true", help="Skip the booking reminder pass.")
        parser.add_argument("--watch", action="store_true", help="Keep this process running between maintenance checks.")
        parser.add_argument("--interval", type=int, default=10, help="Seconds between checks when --watch is enabled.")
        parser.add_argument("--reminder-every", type=int, default=300, help="Seconds between reminder passes when --watch is enabled.")

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        notify = not options["no_notify"]
        interval = max(5, options["interval"])
        reminder_every = max(interval, options["reminder_every"])

        if not options["watch"]:
            result = run_platform_maintenance(
                limit=limit,
                notify=notify,
                run_reminders=not options["no_reminders"],
            )
            self.stdout.write(self.style.SUCCESS(format_maintenance_summary(result)))
            return

        self.stdout.write(self.style.SUCCESS(
            f"SportSpot maintenance worker started. Checking every {interval}s. Press Ctrl+C to stop."
        ))
        next_reminder_at = 0.0
        try:
            while True:
                now_monotonic = time.monotonic()
                run_reminders = not options["no_reminders"] and now_monotonic >= next_reminder_at
                if run_reminders:
                    next_reminder_at = now_monotonic + reminder_every
                result = run_platform_maintenance(
                    limit=limit,
                    notify=notify,
                    run_reminders=run_reminders,
                )
                self.stdout.write(self.style.SUCCESS(format_maintenance_summary(result)))
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("SportSpot maintenance worker stopped."))
