from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationSerializer


class NotificationPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = "page_size"
    max_page_size = 30


def unseen_count_for(user):
    return Notification.objects.filter(recipient=user, is_seen=False).count()


def mark_notification_read(notification):
    now = timezone.now()
    changed_fields = []
    if not notification.is_seen:
        notification.is_seen = True
        notification.seen_at = now
        changed_fields.extend(["is_seen", "seen_at"])
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = now
        changed_fields.extend(["is_read", "read_at"])
    if changed_fields:
        notification.save(update_fields=[*changed_fields, "updated_at"])


class NotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        notifications = (
            Notification.objects.filter(recipient=request.user)
            .select_related("actor", "actor__player_profile")
            .order_by("-created_at")
        )
        category = str(request.query_params.get("category", "")).upper()
        if category and category in Notification.Category.values:
            notifications = notifications.filter(category=category)
        if str(request.query_params.get("unseen", "")).lower() in ["1", "true", "yes"]:
            notifications = notifications.filter(is_seen=False)
        if str(request.query_params.get("action_required", "")).lower() in ["1", "true", "yes"]:
            notifications = notifications.filter(action_required=True)

        paginator = NotificationPagination()
        page = paginator.paginate_queryset(notifications, request)
        serialized = NotificationSerializer(page, many=True, context={"request": request}).data
        response = paginator.get_paginated_response(serialized)
        response.data["unseen_count"] = unseen_count_for(request.user)
        return response


class UnseenNotificationCountView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        latest = Notification.objects.filter(recipient=request.user).only(
            "id",
            "title",
            "message",
            "action_url",
            "notification_type",
            "category",
            "created_at",
        ).first()
        return Response(
            {
                "unseen_count": unseen_count_for(request.user),
                "latest_notification": (
                    {
                        "id": latest.id,
                        "title": latest.title,
                        "message": latest.message,
                        "action_url": latest.action_url,
                        "notification_type": latest.notification_type,
                        "category": latest.category,
                        "created_at": latest.created_at,
                    }
                    if latest
                    else None
                ),
            }
        )


class MarkNotificationsSeenView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        notification_ids = request.data.get("notification_ids", [])
        if not isinstance(notification_ids, list):
            return Response({"detail": "notification_ids must be a list."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            notification_ids = list(dict.fromkeys(int(item) for item in notification_ids))[:100]
        except (TypeError, ValueError):
            return Response({"detail": "Every notification ID must be a number."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        updated = Notification.objects.filter(
            recipient=request.user,
            id__in=notification_ids,
            is_seen=False,
        ).update(is_seen=True, seen_at=now, updated_at=now)
        return Response({"seen_count": updated, "unseen_count": unseen_count_for(request.user)})


class MarkAllNotificationsReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        now = timezone.now()
        Notification.objects.filter(recipient=request.user).filter(
            Q(is_read=False) | Q(is_seen=False)
        ).update(is_seen=True, seen_at=now, is_read=True, read_at=now, updated_at=now)
        return Response({"detail": "All notifications marked as read.", "unseen_count": 0})


class MarkNotificationReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, notification_id):
        notification = (
            Notification.objects.filter(pk=notification_id, recipient=request.user)
            .select_related("actor", "actor__player_profile")
            .first()
        )
        if not notification:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

        mark_notification_read(notification)
        return Response(
            {
                "notification": NotificationSerializer(notification, context={"request": request}).data,
                "unseen_count": unseen_count_for(request.user),
            }
        )


class MarkRelatedNotificationsReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        target_url = str(request.data.get("target_url", "")).strip()
        if not target_url.startswith("/") or len(target_url) > 255:
            return Response({"detail": "A valid SportSpot target URL is required."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        updated = Notification.objects.filter(
            recipient=request.user,
            action_url=target_url,
            is_read=False,
        ).update(
            is_seen=True,
            seen_at=now,
            is_read=True,
            read_at=now,
            updated_at=now,
        )
        return Response({"read_count": updated, "unseen_count": unseen_count_for(request.user)})


class NotificationActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, notification_id):
        notification = Notification.objects.filter(
            pk=notification_id,
            recipient=request.user,
        ).first()
        if not notification:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)

        action = str(request.data.get("action", "")).strip().lower()
        if action == "open":
            mark_notification_read(notification)
            return Response(
                {
                    "detail": "Notification opened.",
                    "target_url": notification.action_url,
                    "notification": NotificationSerializer(notification, context={"request": request}).data,
                    "unseen_count": unseen_count_for(request.user),
                }
            )

        if notification.notification_type not in [
            Notification.NotificationType.TEAM_INVITATION_RECEIVED,
            Notification.NotificationType.TEAM_INVITATION,
        ]:
            return Response({"detail": "This notification has no supported inline action."}, status=status.HTTP_400_BAD_REQUEST)
        if action not in ["accept", "reject"]:
            return Response({"detail": "Action must be accept or reject."}, status=status.HTTP_400_BAD_REQUEST)
        if notification.related_entity_type != "team_member" or not notification.related_entity_id:
            return Response({"detail": "This invitation cannot be processed from the notification."}, status=status.HTTP_400_BAD_REQUEST)

        from teams.services import decide_team_invitation

        try:
            member, changed = decide_team_invitation(
                member_id=notification.related_entity_id,
                user=request.user,
                decision=action,
            )
        except ValidationError as error:
            return Response({"detail": error.messages[0]}, status=status.HTTP_409_CONFLICT)

        notification.refresh_from_db()
        mark_notification_read(notification)
        return Response(
            {
                "detail": (
                    f"Invitation {action}ed successfully."
                    if changed
                    else f"Invitation was already {member.get_status_display().lower()}."
                ),
                "notification": NotificationSerializer(notification, context={"request": request}).data,
                "unseen_count": unseen_count_for(request.user),
            }
        )
