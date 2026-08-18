from django.core.management.base import BaseCommand

from matchmaking.services import expire_matchmaking_deadlines


class Command(BaseCommand):
    help = "Close expired matchmaking games and expire stale join requests."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report the lifecycle changes without writing to the database.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum due games to process in this pass.",
        )
        parser.add_argument(
            "--no-notify",
            action="store_true",
            help="Expire records without creating in-app notifications.",
        )

    def handle(self, *args, **options):
        stats = expire_matchmaking_deadlines(
            dry_run=options["dry_run"],
            notify=not options["no_notify"],
            limit=max(1, options["limit"]),
        )
        prefix = "Dry run: " if options["dry_run"] else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}closed={stats['games_closed']} cancelled={stats['games_cancelled']} "
                f"in_progress={stats['games_in_progress']} completed={stats['games_completed']} "
                f"requests_expired={stats['requests_expired']}"
            )
        )
