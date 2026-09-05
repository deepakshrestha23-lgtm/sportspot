from django.utils import timezone
from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True, default="")
    actor_avatar = serializers.SerializerMethodField()
    time_label = serializers.SerializerMethodField()
    full_time = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            "id",
            "notification_type",
            "category",
            "priority",
            "title",
            "message",
            "action_url",
            "related_entity_type",
            "related_entity_id",
            "action_required",
            "action_status",
            "is_seen",
            "seen_at",
            "is_read",
            "read_at",
            "metadata",
            "actor_name",
            "actor_avatar",
            "actions",
            "time_label",
            "full_time",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_actor_avatar(self, notification):
        if not notification.actor_id:
            return ""
        profile = getattr(notification.actor, "player_profile", None)
        if not profile or not profile.profile_photo:
            return ""
        request = self.context.get("request")
        url = profile.profile_photo.url
        return request.build_absolute_uri(url) if request else url

    def get_time_label(self, notification):
        delta = timezone.now() - notification.created_at
        seconds = max(int(delta.total_seconds()), 0)

        if seconds < 60:
            return "Just now"
        if seconds < 3600:
            minutes = seconds // 60
            return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
        if seconds < 86400:
            hours = seconds // 3600
            return f"{hours} hour{'s' if hours != 1 else ''} ago"
        days = seconds // 86400
        if days == 1:
            return "Yesterday"
        if days < 7:
            return f"{days} days ago"
        return timezone.localtime(notification.created_at).strftime("%b %d, %Y")

    def get_full_time(self, notification):
        return timezone.localtime(notification.created_at).strftime("%b %d, %Y at %I:%M %p").replace(" at 0", " at ")

    def get_actions(self, notification):
        actions = []
        pending_team_invitation = (
            notification.notification_type
            in [
                Notification.NotificationType.TEAM_INVITATION_RECEIVED,
                Notification.NotificationType.TEAM_INVITATION,
            ]
            and notification.action_required
            and notification.action_status == Notification.ActionStatus.PENDING
        )
        if pending_team_invitation:
            actions.extend(
                [
                    {
                        "key": "open",
                        "label": "Review Team",
                        "style": "secondary",
                        "url": notification.action_url,
                    },
                    {"key": "accept", "label": "Accept", "style": "primary", "url": ""},
                    {"key": "reject", "label": "Reject", "style": "danger", "url": ""},
                ]
            )
            return actions

        if notification.action_url and (
            notification.notification_type != Notification.NotificationType.RATING_REQUIRED
            or notification.action_required
        ):
            actions.append(
                {
                    "key": "open",
                    "label": get_open_action_label(notification.notification_type),
                    "style": "primary",
                    "url": notification.action_url,
                }
            )
        return actions


def get_open_action_label(notification_type):
    labels = {
        Notification.NotificationType.TEAM_INVITATION_ACCEPTED: "View Team",
        Notification.NotificationType.TEAM_INVITATION_REJECTED: "View Team",
        Notification.NotificationType.TEAM_MEMBER_REMOVED: "View Teams",
        Notification.NotificationType.VENUE_SUBMITTED: "Review Venue",
        Notification.NotificationType.VENUE_APPROVED: "Open Dashboard",
        Notification.NotificationType.VENUE_NEEDS_CHANGES: "Fix Submission",
        Notification.NotificationType.VENUE_REJECTED: "View Feedback",
        Notification.NotificationType.VENUE_SUSPENDED: "View Status",
        Notification.NotificationType.VENUE_MESSAGE: "View Booking",
        Notification.NotificationType.BOOKING_RESERVED: "View Bookings",
        Notification.NotificationType.BOOKING_CONFIRMED: "View Booking",
        Notification.NotificationType.BOOKING_CHECKED_IN: "View Booking",
        Notification.NotificationType.BOOKING_PAYMENT_FAILED: "View Booking",
        Notification.NotificationType.BOOKING_CANCELLED_BY_PLAYER: "View Booking",
        Notification.NotificationType.BOOKING_CANCELLED_BY_OWNER: "View Reason",
        Notification.NotificationType.REFUND_PENDING: "Process Refund",
        Notification.NotificationType.REFUND_REJECTED: "View Refund Status",
        Notification.NotificationType.REFUND_COMPLETED: "View Booking",
        Notification.NotificationType.CHAT_MESSAGE_RECEIVED: "Open chat",
        Notification.NotificationType.RATING_REQUIRED: "Rate players",
    }
    return labels.get(notification_type, "Open")
