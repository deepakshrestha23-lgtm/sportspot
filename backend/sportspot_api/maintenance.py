from io import StringIO

from django.core.management import call_command
from django.utils import timezone

from matchmaking.services import expire_matchmaking_deadlines
from venues.services import complete_finished_bookings, expire_expired_reservations


def run_platform_maintenance(*, limit=100, notify=True, run_reminders=True, now=None):
    """Run all time-based SportSpot lifecycle work once.

    Each underlying operation is idempotent and locks the records it changes, so
    this function is safe to run from a scheduler even if two runs overlap.
    """
    now = now or timezone.now()
    expiry_result = expire_expired_reservations(now=now, limit=limit, notify=notify)
    completion_result = complete_finished_bookings(now=now, limit=limit, notify=notify)
    matchmaking_result = expire_matchmaking_deadlines(now=now, limit=limit, notify=notify)

    reminder_output = ""
    reminders_enabled = bool(run_reminders and notify)
    if reminders_enabled:
        output = StringIO()
        call_command("send_booking_reminders", stdout=output)
        reminder_output = output.getvalue().strip()

    return {
        "ran_at": now,
        "booking_expiry": expiry_result,
        "booking_completion": completion_result,
        "matchmaking": matchmaking_result,
        "reminders_enabled": reminders_enabled,
        "reminder_output": reminder_output,
    }


def format_maintenance_summary(result):
    expiry = result["booking_expiry"]
    completion = result["booking_completion"]
    matchmaking = result["matchmaking"]
    reminder_summary = result["reminder_output"] or "Booking reminders skipped."
    return (
        "Platform maintenance complete. "
        f"Expired {expiry['expired_count']} of {expiry['checked_count']} reservation candidate(s). "
        f"Completed {completion['completed_count']} of {completion['checked_count']} confirmed booking candidate(s). "
        f"Matchmaking: closed {matchmaking['games_closed']}, cancelled {matchmaking['games_cancelled']}, "
        f"in progress {matchmaking['games_in_progress']}, completed {matchmaking['games_completed']}, "
        f"expired {matchmaking['requests_expired']} request(s). "
        f"{reminder_summary}"
    )
