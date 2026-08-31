from datetime import timedelta

from django.utils import timezone


CHAT_EDIT_WINDOW = timedelta(minutes=5)


def chat_edit_deadline(message):
    return message.created_at + CHAT_EDIT_WINDOW


def can_edit_chat_message(message, actor, *, now=None):
    if not actor or not getattr(actor, "is_authenticated", False):
        return False
    if message.sender_id != actor.id or message.deleted_at is not None:
        return False
    return (now or timezone.now()) < chat_edit_deadline(message)
