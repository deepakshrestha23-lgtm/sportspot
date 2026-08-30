import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from sportspot_api.chat import chat_edit_deadline


logger = logging.getLogger(__name__)


def fixture_chat_group_name(fixture_id):
    return f"team_challenges.fixture.{fixture_id}.chat"


def fixture_chat_message_payload(message):
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_name": message.sender_name,
        "body": message.body if message.deleted_at is None else "This message was deleted.",
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "is_deleted": message.deleted_at is not None,
        "edit_deadline_at": None if message.deleted_at else chat_edit_deadline(message).isoformat(),
    }


def publish_fixture_chat_message(message):
    """Broadcast a persisted fixture message; REST remains the source of truth."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return False

    try:
        async_to_sync(channel_layer.group_send)(
            fixture_chat_group_name(message.fixture_id),
            {
                "type": "chat.message",
                "message": fixture_chat_message_payload(message),
            },
        )
    except Exception:
        logger.warning(
            "Real-time fixture chat delivery was unavailable for message %s.",
            message.id,
            exc_info=True,
        )
        return False
    return True
