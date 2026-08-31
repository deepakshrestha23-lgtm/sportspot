from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import AccountSettings
from notifications.models import Notification
from players.models import PlayerProfile
from sportspot_api.asgi import application

from .models import Game, GameChatMessage, GameParticipant


def create_player(email, name):
    user = get_user_model().objects.create_user(
        email=email,
        password="test-password",
        full_name=name,
        phone="9800000000",
        role="PLAYER",
        email_verified=True,
    )
    PlayerProfile.objects.create(
        user=user,
        preferred_sport=PlayerProfile.PreferredSport.CRICKSAL,
        skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
        location="Kathmandu",
    )
    return user


def create_game(host, participant):
    now = timezone.now()
    game = Game.objects.create(
        host=host,
        creation_mode=Game.CreationMode.PLAN_FIRST,
        title="Saturday chat game",
        proposed_date=timezone.localdate() + timedelta(days=3),
        proposed_start_time=timezone.datetime.min.time().replace(hour=18),
        proposed_end_time=timezone.datetime.min.time().replace(hour=20),
        preferred_district="Kathmandu",
        preferred_area="Baneshwor",
        recruitment_deadline=now + timedelta(days=1),
        booking_deadline=now + timedelta(days=2),
        total_capacity=4,
        minimum_players_to_proceed=2,
    )
    GameParticipant.objects.create(
        game=game,
        user=host,
        participant_type=GameParticipant.ParticipantType.HOST,
    )
    GameParticipant.objects.create(
        game=game,
        user=participant,
        participant_type=GameParticipant.ParticipantType.TEMPORARY,
    )
    return game


class GameChatApiTests(APITestCase):
    def setUp(self):
        self.host = create_player("chat-host@example.com", "Chat Host")
        self.participant = create_player("chat-player@example.com", "Chat Player")
        self.outsider = create_player("chat-outsider@example.com", "Chat Outsider")
        self.game = create_game(self.host, self.participant)
        self.url = reverse("matchmaking-game-chat", args=[self.game.id])

    def test_active_registered_players_can_read_send_and_retry_without_duplicates(self):
        self.client.force_authenticate(self.host)
        first = self.client.post(self.url, {"body": "Meet at 5:45", "client_message_id": "client-1"}, format="json")
        retry = self.client.post(self.url, {"body": "Meet at 5:45", "client_message_id": "client-1"}, format="json")

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertFalse(retry.data["created"])
        self.assertEqual(GameChatMessage.objects.filter(game=self.game).count(), 1)
        chat_notifications = Notification.objects.filter(
            notification_type=Notification.NotificationType.CHAT_MESSAGE_RECEIVED,
            related_entity_type="game_chat_message",
        )
        self.assertEqual(chat_notifications.count(), 1)
        self.assertEqual(chat_notifications.get().recipient, self.participant)
        self.assertEqual(chat_notifications.get().actor, self.host)
        self.assertEqual(chat_notifications.get().action_url, f"/dashboard/player/games/{self.game.id}/room")

        self.client.force_authenticate(self.participant)
        history = self.client.get(self.url)
        self.assertEqual(history.status_code, 200, history.data)
        self.assertEqual(history.data["messages"][0]["body"], "Meet at 5:45")
        self.assertFalse(history.data["messages"][0]["is_mine"])

    def test_chat_notification_respects_recipient_preference(self):
        AccountSettings.objects.create(user=self.participant, notify_chat_messages=False)
        self.client.force_authenticate(self.host)

        response = self.client.post(self.url, {"body": "Muted chat alert", "client_message_id": "client-muted"}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(Notification.objects.filter(
            notification_type=Notification.NotificationType.CHAT_MESSAGE_RECEIVED,
            related_entity_id=response.data["message"]["id"],
        ).exists())

    def test_outsider_cannot_read_or_send_game_chat(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.post(self.url, {"body": "Not allowed"}, format="json").status_code, 403)

    def test_completed_game_keeps_history_but_cannot_accept_new_messages(self):
        GameChatMessage.objects.create(game=self.game, sender=self.host, sender_name=self.host.full_name, body="History")
        self.game.status = Game.Status.CANCELLED
        self.game.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.participant)

        history = self.client.get(self.url)
        blocked = self.client.post(self.url, {"body": "Too late"}, format="json")
        self.assertEqual(history.status_code, 200, history.data)
        self.assertEqual(blocked.status_code, 400, blocked.data)
        self.assertEqual(len(history.data["messages"]), 1)

    def test_author_can_edit_then_soft_delete_a_message(self):
        self.client.force_authenticate(self.host)
        created = self.client.post(self.url, {"body": "Meet at 5:45", "client_message_id": "edit-1"}, format="json")
        message_id = created.data["message"]["id"]
        detail_url = reverse("matchmaking-game-chat-message", args=[self.game.id, message_id])

        edited = self.client.patch(detail_url, {"body": "Meet at 5:30"}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["message"]["body"], "Meet at 5:30")
        self.assertTrue(edited.data["message"]["edited_at"])
        self.assertTrue(edited.data["message"]["can_edit"])

        deleted = self.client.delete(detail_url)
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertTrue(deleted.data["message"]["is_deleted"])
        self.assertEqual(deleted.data["message"]["body"], "This message was deleted.")
        self.assertIsNotNone(GameChatMessage.objects.get(pk=message_id).deleted_at)

    def test_edit_window_and_message_ownership_are_enforced(self):
        self.client.force_authenticate(self.host)
        created = self.client.post(self.url, {"body": "Old message", "client_message_id": "edit-2"}, format="json")
        message_id = created.data["message"]["id"]
        GameChatMessage.objects.filter(pk=message_id).update(created_at=timezone.now() - timedelta(minutes=6))
        detail_url = reverse("matchmaking-game-chat-message", args=[self.game.id, message_id])

        expired = self.client.patch(detail_url, {"body": "Too late"}, format="json")
        self.assertEqual(expired.status_code, 400, expired.data)
        self.assertIn("no longer", expired.data["detail"])

        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.patch(detail_url, {"body": "Not mine"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(detail_url).status_code, 403)


class GameChatRealtimeTests(TransactionTestCase):
    def setUp(self):
        self.host = create_player("realtime-chat-host@example.com", "Realtime Host")
        self.participant = create_player("realtime-chat-player@example.com", "Realtime Player")
        self.game = create_game(self.host, self.participant)

    def test_registered_players_receive_the_same_persisted_message(self):
        async_to_sync(self._assert_message_delivery)()

    async def _assert_message_delivery(self):
        host_communicator = WebsocketCommunicator(
            application,
            f"/ws/games/{self.game.id}/chat/",
            headers=[(b"origin", b"http://localhost:3000")],
        )
        player_communicator = WebsocketCommunicator(
            application,
            f"/ws/games/{self.game.id}/chat/",
            headers=[(b"origin", b"http://localhost:3000")],
        )
        notification_communicator = WebsocketCommunicator(
            application,
            "/ws/notifications/",
            headers=[(b"origin", b"http://localhost:3000")],
        )
        for communicator, user in ((host_communicator, self.host), (player_communicator, self.participant)):
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            self.assertEqual((await communicator.receive_json_from())["type"], "authenticate")
            refresh = RefreshToken.for_user(user)
            refresh["auth_version"] = user.auth_version
            await communicator.send_json_to({"type": "authenticate", "access_token": str(refresh.access_token)})
            self.assertEqual((await communicator.receive_json_from())["type"], "ready")

        connected, _ = await notification_communicator.connect()
        self.assertTrue(connected)
        self.assertEqual((await notification_communicator.receive_json_from())["type"], "authenticate")
        refresh = RefreshToken.for_user(self.participant)
        refresh["auth_version"] = self.participant.auth_version
        await notification_communicator.send_json_to({"type": "authenticate", "access_token": str(refresh.access_token)})
        self.assertEqual((await notification_communicator.receive_json_from())["type"], "ready")

        await host_communicator.send_json_to({"type": "message.send", "body": "We are live", "client_message_id": "realtime-1"})
        host_event = await host_communicator.receive_json_from()
        player_event = await player_communicator.receive_json_from()
        self.assertEqual(host_event["type"], "chat.message")
        self.assertEqual(host_event["message"]["body"], "We are live")
        self.assertEqual(player_event, host_event | {"message": {**host_event["message"], "is_mine": False}})
        @database_sync_to_async
        def notification_id_for_message():
            return Notification.objects.get(
                recipient=self.participant,
                related_entity_type="game_chat_message",
                related_entity_id=host_event["message"]["id"],
            ).id

        notification_event = await notification_communicator.receive_json_from()
        self.assertEqual(
            notification_event,
            {"type": "notification.created", "notification_id": await notification_id_for_message()},
        )
        message_id = host_event["message"]["id"]

        await host_communicator.send_json_to({"type": "message.edit", "message_id": message_id, "body": "We are live and edited"})
        host_edit = await host_communicator.receive_json_from()
        player_edit = await player_communicator.receive_json_from()
        self.assertEqual(host_edit["message"]["body"], "We are live and edited")
        self.assertTrue(host_edit["message"]["edited_at"])
        self.assertEqual(player_edit, host_edit | {"message": {**host_edit["message"], "is_mine": False}})

        await host_communicator.send_json_to({"type": "message.delete", "message_id": message_id})
        host_delete = await host_communicator.receive_json_from()
        player_delete = await player_communicator.receive_json_from()
        self.assertTrue(host_delete["message"]["is_deleted"])
        self.assertEqual(host_delete["message"]["body"], "This message was deleted.")
        self.assertEqual(player_delete, host_delete | {"message": {**host_delete["message"], "is_mine": False}})
        @database_sync_to_async
        def message_was_persisted():
            return GameChatMessage.objects.filter(
                game=self.game,
                body="We are live and edited",
                deleted_at__isnull=False,
            ).exists()

        self.assertTrue(await message_was_persisted())

        await host_communicator.disconnect()
        await player_communicator.disconnect()
        await notification_communicator.disconnect()
