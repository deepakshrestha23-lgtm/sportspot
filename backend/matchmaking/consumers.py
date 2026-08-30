import asyncio
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.authentication import VerifiedJWTAuthentication

from .models import Game, GameChatMessage
from .realtime import chat_message_payload, game_chat_group_name
from .services import game_room_access_level


class GameChatConsumer(AsyncJsonWebsocketConsumer):
    """Authenticated, durable chat for one game room."""

    authentication_timeout_seconds = 10
    max_message_length = 1000
    max_messages_per_minute = 30

    async def connect(self):
        try:
            self.game_id = int(self.scope["url_route"]["kwargs"]["game_id"])
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
            self.group_name = game_chat_group_name(self.game_id)
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
        if message_type != "message.send":
            await self.send_json({"type": "chat.error", "code": "UNSUPPORTED_MESSAGE", "message": "This chat action is not supported."})
            return
        if self._is_rate_limited():
            await self.send_json({"type": "chat.error", "code": "RATE_LIMITED", "message": "You are sending messages too quickly. Please wait a moment."})
            return

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

        if result["created"]:
            await self.channel_layer.group_send(
                self.group_name,
                {"type": "chat.message", "message": result["message"]},
            )
        else:
            # A retry may have reached the database before the first response.
            # Echoing the existing row lets this connection recover without a
            # duplicate, while the UI deduplicates by server message ID.
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
        try:
            game = Game.objects.select_related("team").get(pk=self.game_id)
        except Game.DoesNotExist:
            return "NOT_FOUND"
        return game_room_access_level(game, self.user)

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

        try:
            game = Game.objects.select_related("team").get(pk=self.game_id)
        except Game.DoesNotExist:
            return {"kind": "error", "code": "GAME_NOT_FOUND", "message": "This game room is no longer available."}
        room_access = game_room_access_level(game, self.user)
        if room_access == "NONE":
            return {"kind": "error", "code": "ROOM_ACCESS_REVOKED", "message": "You no longer have access to this game room."}
        if room_access == "READ_ONLY":
            return {"kind": "error", "code": "ROOM_READ_ONLY", "message": "This game room is read-only."}

        if client_message_id:
            existing = GameChatMessage.objects.filter(
                game=game,
                sender=self.user,
                client_message_id=client_message_id,
            ).first()
            if existing:
                if existing.body != body:
                    return {"kind": "error", "code": "INVALID_MESSAGE", "message": "This message retry does not match the original message."}
                return {"kind": "message", "created": False, "message": chat_message_payload(existing)}

        sender_name = (self.user.full_name or self.user.email).strip()
        try:
            with transaction.atomic():
                message = GameChatMessage.objects.create(
                    game=game,
                    sender=self.user,
                    sender_name=sender_name[:120],
                    body=body,
                    client_message_id=client_message_id,
                )
        except IntegrityError:
            existing = GameChatMessage.objects.filter(
                game=game,
                sender=self.user,
                client_message_id=client_message_id,
            ).first()
            if not existing:
                return {"kind": "error", "code": "MESSAGE_NOT_SAVED", "message": "We could not save that message. Please try again."}
            return {"kind": "message", "created": False, "message": chat_message_payload(existing)}

        return {"kind": "message", "created": True, "message": chat_message_payload(message)}
