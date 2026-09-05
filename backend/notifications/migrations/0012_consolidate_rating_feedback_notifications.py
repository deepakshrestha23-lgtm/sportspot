from django.db import migrations
from django.utils import timezone


def consolidate_rating_feedback_notifications(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    PlayerRatingEligibility = apps.get_model("players", "PlayerRatingEligibility")
    now = timezone.now()

    contexts = (
        PlayerRatingEligibility.objects.values_list(
            "rater_id", "related_entity_type", "related_entity_id"
        )
        .distinct()
    )
    for rater_id, related_entity_type, related_entity_id in contexts:
        notifications = Notification.objects.filter(
            recipient_id=rater_id,
            notification_type="RATING_REQUIRED",
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        ).order_by("-created_at", "-id")
        canonical = notifications.filter(
            deduplication_key=(
                f"{related_entity_type}:{related_entity_id}:rating:{rater_id}"
            )
        ).first() or notifications.first()
        if not canonical:
            continue

        pending = list(
            PlayerRatingEligibility.objects.filter(
                rater_id=rater_id,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                status="PENDING",
            ).order_by("deadline_at", "created_at", "id")
        )
        has_submitted_rating = PlayerRatingEligibility.objects.filter(
            rater_id=rater_id,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            status="SUBMITTED",
        ).exists()

        if pending:
            target = pending[0]
            pending_count = len(pending)
            player_label = "player rating" if pending_count == 1 else "player ratings"
            canonical.title = "Share feedback on your completed game"
            canonical.message = (
                f"You have {pending_count} {player_label} remaining from a completed game. "
                "Ratings and reliability are kept separate."
            )
            canonical.action_url = f"/dashboard/player/ratings?rate={target.id}"
            canonical.action_required = True
            canonical.action_status = "PENDING"
            canonical.metadata = {
                "eligibility_id": target.id,
                "rated_player_id": target.rated_player_id,
                "pending_rating_count": pending_count,
            }
            canonical.deduplication_key = (
                f"{related_entity_type}:{related_entity_id}:rating:{rater_id}"
            )
            if has_submitted_rating:
                canonical.is_seen = True
                canonical.seen_at = canonical.seen_at or now
                canonical.is_read = True
                canonical.read_at = canonical.read_at or now
        else:
            canonical.action_required = False
            canonical.action_status = "COMPLETED"
            canonical.action_url = ""
            canonical.is_seen = True
            canonical.seen_at = canonical.seen_at or now
            canonical.is_read = True
            canonical.read_at = canonical.read_at or now

        canonical.save()
        notifications.exclude(pk=canonical.pk).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0011_alter_notification_notification_type"),
        ("players", "0008_participationcommitment"),
    ]

    operations = [
        migrations.RunPython(consolidate_rating_feedback_notifications, migrations.RunPython.noop),
    ]
