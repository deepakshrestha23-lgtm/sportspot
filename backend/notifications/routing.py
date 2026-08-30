from django.urls import path

from matchmaking.consumers import GameChatConsumer

from .consumers import NotificationConsumer


websocket_urlpatterns = [
    path("ws/notifications/", NotificationConsumer.as_asgi()),
    path("ws/games/<int:game_id>/chat/", GameChatConsumer.as_asgi()),
]
