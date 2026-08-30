import asyncio
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.authentication import VerifiedJWTAuthentication
from sportspot_api.chat import can_edit_chat_message

from .models import TeamFixtureChatMessage
from .realtime import fixture_chat_group_name, fixture_chat_message_payload
from .services import team_fixture_chat_access_level


class TeamFixtureChatConsumer(AsyncJsonWebsocketConsumer):
    """Authenticated, durable chat for one team fixture room."""

    authentication_timeout_seconds = 10
    max_message_length = 1000
    max_messages_per_minute = 30

    async def connect(self):
        try:
            self.fixture_id = int(self.scope["url_route"]["kwargs"]["fixture_id"])
        except (KeyError, TypeError, ValueError):
            await self.close(code=4404)
            return

        self.user = None
        self.group_name = None
        self.message_timestamps = []
        self.authentication_timeout_task = asyncio.create_task(
            self._close_if_not_authenticated()
        )
        await self.accept()
        await self.send_json({"type": "authenticate"})

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            await self.send_json({"type": "chat.error", "code": "INVALID_MESSAGE", "message": "Send a valid chat message."})
            return

        if self.user is None:
            if content.get("type") != "authenticate":
                await self.close(code=4401)
                return

            raw_token = content.get("access_token")
            if not isinstance(raw_token, str) or not raw_token.strip():
                await self.close(code=4401)
                return

            authenticated = await self._authenticate(raw_token.strip())
            if not authenticated:
                await self.close(code=4401)
                return

            self.user, token_expiry = authenticated
            room_access = await self._get_room_access()
            if room_access == "NOT_FOUND":
                await self.close(code=4404)
                return
            if room_access == "NONE":
                await self.close(code=4403)
                return

            self.room_access = room_access
            self.group_name = fixture_chat_group_name(self.fixture_id)
            await self.channel_layer.group_add(self.group_name, self.channel_name)
            self.authentication_timeout_task.cancel()
            self.token_expiry_task = asyncio.create_task(
                self._close_at_token_expiry(token_expiry)
            )
            await self.send_json({"type": "ready", "room_access": room_access})
            return

        message_type = content.get("type")
        if message_type == "ping":
            await self.send_json({"type": "pong", "server_time": timezone.now().isoformat()})
            return
        if message_type not in {"message.send", "message.edit", "message.delete"}:
            await self.send_json({"type": "chat.error", "code": "UNSUPPORTED_MESSAGE", "message": "This chat action is not supported."})
            return
        if self._is_rate_limited():
            await self.send_json({"type": "chat.error", "code": "RATE_LIMITED", "message": "You are sending messages too quickly. Please wait a moment."})
            return

        if message_type == "message.edit":
            body = content.get("body")
            message_id = content.get("message_id")
            if not isinstance(body, str) or not isinstance(message_id, int):
                await self.send_json({"type": "chat.error", "code": "INVALID_MESSAGE", "message": "Send a valid message edit."})
                return
            result = await self._edit_message(message_id, body)
        elif message_type == "message.delete":
            message_id = content.get("message_id")
            if not isinstance(message_id, int):
                await self.send_json({"type": "chat.error", "code": "INVALID_MESSAGE", "message": "Send a valid message deletion."})
                return
            result = await self._delete_message(message_id)
        else:
            body = content.get("body")
            client_message_id = content.get("client_message_id", "")
            if not isinstance(body, str) or not isinstance(client_message_id, str):
                await self.send_json({"type": "chat.error", "code": "INVALID_MESSAGE", "message": "Send a valid chat message."})
                return
            result = await self._create_message(body, client_message_id)

        if result["kind"] == "error":
            await self.send_json({
                "type": "chat.error",
                "code": result["code"],
                "message": result["message"],
            })
            return

        if result["changed"]:
            await self.channel_layer.group_send(
                self.group_name,
                {"type": "chat.message", "message": result["message"]},
            )
        else:
            await self.send_json({
                "type": "chat.message",
                "message": {**result["message"], "is_mine": True},
            })

    async def disconnect(self, close_code):
        for task_name in ("authentication_timeout_task", "token_expiry_task"):
            task = getattr(self, task_name, None)
            if task:
                task.cancel()
        if self.group_name:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def chat_message(self, event):
        message = dict(event["message"])
        message["is_mine"] = message.get("sender_id") == self.user.id
        await self.send_json({"type": "chat.message", "message": message})

    def _is_rate_limited(self):
        now = time.monotonic()
        self.message_timestamps = [stamp for stamp in self.message_timestamps if now - stamp < 60]
        if len(self.message_timestamps) >= self.max_messages_per_minute:
            return True
        self.message_timestamps.append(now)
        return False

    async def _close_if_not_authenticated(self):
        await asyncio.sleep(self.authentication_timeout_seconds)
        if self.user is None:
            await self.close(code=4401)

    async def _close_at_token_expiry(self, token_expiry):
        delay = max(token_expiry - timezone.now().timestamp(), 1)
        await asyncio.sleep(delay)
        await self.close(code=4401)

    @database_sync_to_async
    def _authenticate(self, raw_token):
        try:
            authentication = VerifiedJWTAuthentication()
            validated_token = authentication.get_validated_token(raw_token)
            user = authentication.get_user(validated_token)
            return user, int(validated_token["exp"])
        except Exception:
            return None

    @database_sync_to_async
    def _get_room_access(self):
        return team_fixture_chat_access_level(self.fixture_id, self.user)

    @database_sync_to_async
    def _create_message(self, body, client_message_id):
        body = body.strip()
        client_message_id = client_message_id.strip()
        if not body:
            return {"kind": "error", "code": "EMPTY_MESSAGE", "message": "Message cannot be empty."}
        if len(body) > self.max_message_length:
            return {"kind": "error", "code": "MESSAGE_TOO_LONG", "message": "Messages must be 1,000 characters or fewer."}
        if len(client_message_id) > 64:
            return {"kind": "error", "code": "INVALID_MESSAGE", "message": "The message could not be sent. Please try again."}

        room_access = team_fixture_chat_access_level(self.fixture_id, self.user)
        if room_access == "NOT_FOUND":
            return {"kind": "error", "code": "FIXTURE_NOT_FOUND", "message": "This team match room is no longer available."}
        if room_access == "NONE":
            return {"kind": "error", "code": "ROOM_ACCESS_REVOKED", "message": "You no longer have access to this team match room."}
        if room_access == "READ_ONLY":
            return {"kind": "error", "code": "ROOM_READ_ONLY", "message": "This team match room is read-only."}

        if client_message_id:
            existing = TeamFixtureChatMessage.objects.filter(
                fixture_id=self.fixture_id,
                sender=self.user,
                client_message_id=client_message_id,
            ).first()
            if existing:
                if existing.body != body:
                    return {"kind": "error", "code": "INVALID_MESSAGE", "message": "This message retry does not match the original message."}
                return {"kind": "message", "changed": False, "message": fixture_chat_message_payload(existing)}

        sender_name = (self.user.full_name or self.user.email).strip()
        try:
            with transaction.atomic():
                message = TeamFixtureChatMessage.objects.create(
                    fixture_id=self.fixture_id,
                    sender=self.user,
                    sender_name=sender_name[:120],
                    body=body,
                    client_message_id=client_message_id,
                )
        except IntegrityError:
            existing = TeamFixtureChatMessage.objects.filter(
                fixture_id=self.fixture_id,
                sender=self.user,
                client_message_id=client_message_id,
            ).first()
            if not existing:
                return {"kind": "error", "code": "MESSAGE_NOT_SAVED", "message": "We could not save that message. Please try again."}
            return {"kind": "message", "changed": False, "message": fixture_chat_message_payload(existing)}

        return {"kind": "message", "changed": True, "message": fixture_chat_message_payload(message)}

    @database_sync_to_async
    def _edit_message(self, message_id, body):
        body = body.strip()
        if not body:
            return {"kind": "error", "code": "EMPTY_MESSAGE", "message": "Message cannot be empty."}
        if len(body) > self.max_message_length:
            return {"kind": "error", "code": "MESSAGE_TOO_LONG", "message": "Messages must be 1,000 characters or fewer."}

        room_access = team_fixture_chat_access_level(self.fixture_id, self.user)
        if room_access == "NOT_FOUND":
            return {"kind": "error", "code": "FIXTURE_NOT_FOUND", "message": "This team match room is no longer available."}
        if room_access == "NONE":
            return {"kind": "error", "code": "ROOM_ACCESS_REVOKED", "message": "You no longer have access to this team match room."}
        if room_access == "READ_ONLY":
            return {"kind": "error", "code": "ROOM_READ_ONLY", "message": "This team match room is read-only."}

        with transaction.atomic():
            message = TeamFixtureChatMessage.objects.select_for_update().filter(fixture_id=self.fixture_id, pk=message_id).first()
            if not message:
                return {"kind": "error", "code": "MESSAGE_NOT_FOUND", "message": "Message not found."}
            if message.sender_id != self.user.id:
                return {"kind": "error", "code": "MESSAGE_NOT_OWNED", "message": "You can only edit your own messages."}
            if message.deleted_at:
                return {"kind": "error", "code": "MESSAGE_DELETED", "message": "Deleted messages cannot be edited."}
            if not can_edit_chat_message(message, self.user):
                return {"kind": "error", "code": "EDIT_WINDOW_EXPIRED", "message": "Messages can only be edited within 15 minutes of sending."}
            message.body = body
            message.edited_at = timezone.now()
            message.save(update_fields=["body", "edited_at", "updated_at"])
            return {"kind": "message", "changed": True, "message": fixture_chat_message_payload(message)}

    @database_sync_to_async
    def _delete_message(self, message_id):
        room_access = team_fixture_chat_access_level(self.fixture_id, self.user)
        if room_access == "NOT_FOUND":
            return {"kind": "error", "code": "FIXTURE_NOT_FOUND", "message": "This team match room is no longer available."}
        if room_access == "NONE":
            return {"kind": "error", "code": "ROOM_ACCESS_REVOKED", "message": "You no longer have access to this team match room."}

        with transaction.atomic():
            message = TeamFixtureChatMessage.objects.select_for_update().filter(fixture_id=self.fixture_id, pk=message_id).first()
            if not message:
                return {"kind": "error", "code": "MESSAGE_NOT_FOUND", "message": "Message not found."}
            if message.sender_id != self.user.id:
                return {"kind": "error", "code": "MESSAGE_NOT_OWNED", "message": "You can only delete your own messages."}
            if message.deleted_at:
                return {"kind": "message", "changed": False, "message": fixture_chat_message_payload(message)}
            message.deleted_at = timezone.now()
            message.save(update_fields=["deleted_at", "updated_at"])
            return {"kind": "message", "changed": True, "message": fixture_chat_message_payload(message)}
