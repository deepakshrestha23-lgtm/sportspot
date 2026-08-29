import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


logger = logging.getLogger(__name__)


def notification_group_name(user_id):
    return f"notifications.user.{user_id}"


def publish_notification_created(notification):
    """Push a minimal, user-scoped event without affecting the main action.

    The notification is already persisted when this is called. Delivery is a
    convenience channel; the notification API remains the source of truth.
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return False

    try:
        async_to_sync(channel_layer.group_send)(
            notification_group_name(notification.recipient_id),
            {
                "type": "notification.created",
                "notification_id": notification.id,
            },
        )
    except Exception:
        # Redis availability must never turn a successful booking, team or
        # challenge action into a failed request.
        logger.warning(
            "Real-time notification delivery was unavailable for notification %s.",
            notification.id,
            exc_info=True,
        )
        return False
    return True
