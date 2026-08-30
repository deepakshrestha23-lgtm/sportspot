import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


logger = logging.getLogger(__name__)


def game_chat_group_name(game_id):
    return f"matchmaking.game.{game_id}.chat"


def chat_message_payload(message):
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_name": message.sender_name,
        "body": message.body if message.deleted_at is None else "This message was deleted.",
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "is_deleted": message.deleted_at is not None,
    }


def publish_game_chat_message(message):
    """Broadcast a persisted message; REST remains the source of truth."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return False

    try:
        async_to_sync(channel_layer.group_send)(
            game_chat_group_name(message.game_id),
            {
                "type": "chat.message",
                "message": chat_message_payload(message),
            },
        )
    except Exception:
        logger.warning(
            "Real-time game chat delivery was unavailable for message %s.",
            message.id,
            exc_info=True,
        )
        return False
    return True
