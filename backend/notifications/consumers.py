import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

from accounts.authentication import VerifiedJWTAuthentication

from .realtime import notification_group_name


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """Authenticated per-user notification stream.

    The browser sends the access token as the first WebSocket message instead
    of putting it in the URL, where it could be copied into access logs.
    """

    authentication_timeout_seconds = 10

    async def connect(self):
        self.user = None
        self.group_name = None
        self.authentication_timeout_task = asyncio.create_task(
            self._close_if_not_authenticated()
        )
        await self.accept()
        await self.send_json({"type": "authenticate"})

    async def receive_json(self, content, **kwargs):
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
            self.group_name = notification_group_name(self.user.id)
            await self.channel_layer.group_add(self.group_name, self.channel_name)
            self.authentication_timeout_task.cancel()
            self.token_expiry_task = asyncio.create_task(
                self._close_at_token_expiry(token_expiry)
            )
            await self.send_json({"type": "ready"})
            return

        if content.get("type") == "ping":
            await self.send_json(
                {"type": "pong", "server_time": timezone.now().isoformat()}
            )

    async def disconnect(self, close_code):
        for task_name in ("authentication_timeout_task", "token_expiry_task"):
            task = getattr(self, task_name, None)
            if task:
                task.cancel()
        if self.group_name:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_created(self, event):
        await self.send_json(
            {
                "type": "notification.created",
                "notification_id": event["notification_id"],
            }
        )

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
