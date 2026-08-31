from datetime import time, timedelta
from unittest.mock import patch

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from notifications.models import Notification
from players.models import PlayerProfile
from sportspot_api.asgi import application
from teams.models import Team, TeamMember

from .models import TeamChallenge, TeamFixture, TeamFixtureChatMessage
from .services import create_challenge, decide_challenge


class TeamFixtureChatRealtimeTests(TransactionTestCase):
    def setUp(self):
        self.host = self.create_player("fixture-chat-host@example.com", "Fixture Chat Host")
        self.opponent = self.create_player("fixture-chat-opponent@example.com", "Fixture Chat Opponent")
        self.host_team = self.create_team("Fixture Chat Hosts", self.host)
        self.opponent_team = self.create_team("Fixture Chat Opponents", self.opponent)
        now = timezone.now()
        with patch("team_challenges.services.notify_challenge_received"), patch("team_challenges.services.notify_challenge_decision"), patch("team_challenges.services.notify_challenge_status"):
            self.challenge = create_challenge({
                "challenge_type": TeamChallenge.ChallengeType.DIRECT,
                "challenger_team": self.host_team,
                "challenged_team": self.opponent_team,
                "court_mode": TeamChallenge.CourtMode.PLAN_FIRST,
                "proposed_date": timezone.localdate() + timedelta(days=3),
                "proposed_start_time": time(18, 0),
                "proposed_end_time": time(20, 0),
                "preferred_district": "Kathmandu",
                "preferred_area": "Baneshwor",
                "players_per_side": 6,
                "intensity": "CASUAL",
                "response_deadline": now + timedelta(hours=4),
                "booking_deadline": now + timedelta(hours=5),
                "client_request_id": "fixture-chat-realtime",
            }, self.host)
            decide_challenge(self.challenge.pk, self.opponent, "ACCEPT")
        self.fixture_id = TeamFixture.objects.get(challenge_id=self.challenge.id).id

    def create_player(self, email, name):
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
            preferred_cricksal_role=PlayerProfile.CricksalRole.BATSMAN,
        )
        return user

    def create_team(self, name, captain):
        team = Team.objects.create(
            name=name,
            description="A test Cricksal team",
            location="Kathmandu",
            preferred_playing_area="Baneshwor",
            preferred_playing_time="Evening",
            skill_level=Team.SkillLevel.INTERMEDIATE,
            captain=captain,
        )
        TeamMember.objects.create(
            team=team,
            user=captain,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.CAPTAIN,
            cricksal_role=TeamMember.CricksalRole.BATSMAN,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        return team

    def test_authorised_captains_receive_the_same_persisted_fixture_message(self):
        async_to_sync(self._assert_message_delivery)()

    async def _assert_message_delivery(self):
        fixture_id = self.fixture_id
        host_communicator = WebsocketCommunicator(
            application,
            f"/ws/team-fixtures/{fixture_id}/chat/",
            headers=[(b"origin", b"http://localhost:3000")],
        )
        opponent_communicator = WebsocketCommunicator(
            application,
            f"/ws/team-fixtures/{fixture_id}/chat/",
            headers=[(b"origin", b"http://localhost:3000")],
        )
        notification_communicator = WebsocketCommunicator(
            application,
            "/ws/notifications/",
            headers=[(b"origin", b"http://localhost:3000")],
        )
        for communicator, user in ((host_communicator, self.host), (opponent_communicator, self.opponent)):
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            self.assertEqual((await communicator.receive_json_from())["type"], "authenticate")
            refresh = RefreshToken.for_user(user)
            refresh["auth_version"] = user.auth_version
            await communicator.send_json_to({"type": "authenticate", "access_token": str(refresh.access_token)})
            ready = await communicator.receive_json_from()
            self.assertEqual(ready["type"], "ready")
            self.assertEqual(ready["room_access"], "PLANNING")

        connected, _ = await notification_communicator.connect()
        self.assertTrue(connected)
        self.assertEqual((await notification_communicator.receive_json_from())["type"], "authenticate")
        refresh = RefreshToken.for_user(self.opponent)
        refresh["auth_version"] = self.opponent.auth_version
        await notification_communicator.send_json_to({"type": "authenticate", "access_token": str(refresh.access_token)})
        self.assertEqual((await notification_communicator.receive_json_from())["type"], "ready")

        await host_communicator.send_json_to({
            "type": "message.send",
            "body": "Both captains are connected",
            "client_message_id": "fixture-realtime-1",
        })
        host_event = await host_communicator.receive_json_from()
        opponent_event = await opponent_communicator.receive_json_from()
        self.assertEqual(host_event["type"], "chat.message")
        self.assertEqual(host_event["message"]["body"], "Both captains are connected")
        self.assertEqual(opponent_event, host_event | {"message": {**host_event["message"], "is_mine": False}})
        @database_sync_to_async
        def notification_id_for_message():
            return Notification.objects.get(
                recipient=self.opponent,
                related_entity_type="fixture_chat_message",
                related_entity_id=host_event["message"]["id"],
            ).id

        notification_event = await notification_communicator.receive_json_from()
        self.assertEqual(
            notification_event,
            {"type": "notification.created", "notification_id": await notification_id_for_message()},
        )
        message_id = host_event["message"]["id"]

        await host_communicator.send_json_to({"type": "message.edit", "message_id": message_id, "body": "Both captains are ready"})
        host_edit = await host_communicator.receive_json_from()
        opponent_edit = await opponent_communicator.receive_json_from()
        self.assertEqual(host_edit["message"]["body"], "Both captains are ready")
        self.assertTrue(host_edit["message"]["edited_at"])
        self.assertEqual(opponent_edit, host_edit | {"message": {**host_edit["message"], "is_mine": False}})

        await host_communicator.send_json_to({"type": "message.delete", "message_id": message_id})
        host_delete = await host_communicator.receive_json_from()
        opponent_delete = await opponent_communicator.receive_json_from()
        self.assertTrue(host_delete["message"]["is_deleted"])
        self.assertEqual(host_delete["message"]["body"], "This message was deleted.")
        self.assertEqual(opponent_delete, host_delete | {"message": {**host_delete["message"], "is_mine": False}})

        @database_sync_to_async
        def message_was_persisted():
            return TeamFixtureChatMessage.objects.filter(
                fixture_id=fixture_id,
                body="Both captains are ready",
                deleted_at__isnull=False,
            ).exists()

        self.assertTrue(await message_was_persisted())
        await host_communicator.disconnect()
        await opponent_communicator.disconnect()
        await notification_communicator.disconnect()


class TeamFixtureChatApiTests(APITestCase):
    def setUp(self):
        self.host = self.create_player("fixture-api-host@example.com", "Fixture API Host")
        self.opponent = self.create_player("fixture-api-opponent@example.com", "Fixture API Opponent")
        self.host_team = self.create_team("Fixture API Hosts", self.host)
        self.opponent_team = self.create_team("Fixture API Opponents", self.opponent)
        now = timezone.now()
        with patch("team_challenges.services.notify_challenge_received"), patch("team_challenges.services.notify_challenge_decision"), patch("team_challenges.services.notify_challenge_status"):
            challenge = create_challenge({
                "challenge_type": TeamChallenge.ChallengeType.DIRECT,
                "challenger_team": self.host_team,
                "challenged_team": self.opponent_team,
                "court_mode": TeamChallenge.CourtMode.PLAN_FIRST,
                "proposed_date": timezone.localdate() + timedelta(days=3),
                "proposed_start_time": time(18, 0),
                "proposed_end_time": time(20, 0),
                "preferred_district": "Kathmandu",
                "preferred_area": "Baneshwor",
                "players_per_side": 6,
                "intensity": "CASUAL",
                "response_deadline": now + timedelta(hours=4),
                "booking_deadline": now + timedelta(hours=5),
                "client_request_id": "fixture-chat-api",
            }, self.host)
            decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        self.fixture = TeamFixture.objects.get(challenge_id=challenge.id)
        self.url = reverse("team-fixture-chat", args=[self.fixture.id])

    def create_player(self, email, name):
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
            preferred_cricksal_role=PlayerProfile.CricksalRole.BATSMAN,
        )
        return user

    def create_team(self, name, captain):
        team = Team.objects.create(
            name=name,
            description="A test Cricksal team",
            location="Kathmandu",
            preferred_playing_area="Baneshwor",
            preferred_playing_time="Evening",
            skill_level=Team.SkillLevel.INTERMEDIATE,
            captain=captain,
        )
        TeamMember.objects.create(
            team=team,
            user=captain,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.CAPTAIN,
            cricksal_role=TeamMember.CricksalRole.BATSMAN,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        return team

    def test_author_can_edit_and_soft_delete_fixture_message(self):
        self.client.force_authenticate(self.host)
        created = self.client.post(self.url, {"body": "Meet at the court", "client_message_id": "fixture-edit-1"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        message_id = created.data["message"]["id"]
        detail_url = reverse("team-fixture-chat-message", args=[self.fixture.id, message_id])

        edited = self.client.patch(detail_url, {"body": "Meet at the entrance"}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["message"]["body"], "Meet at the entrance")
        self.assertTrue(edited.data["message"]["can_edit"])

        deleted = self.client.delete(detail_url)
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertTrue(deleted.data["message"]["is_deleted"])
        self.assertEqual(deleted.data["message"]["body"], "This message was deleted.")
        self.assertIsNotNone(TeamFixtureChatMessage.objects.get(pk=message_id).deleted_at)

    def test_fixture_chat_notifies_the_other_captain_with_a_room_link(self):
        self.client.force_authenticate(self.host)

        response = self.client.post(self.url, {"body": "Meet at the entrance", "client_message_id": "fixture-notification-1"}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        notification = Notification.objects.get(
            notification_type=Notification.NotificationType.CHAT_MESSAGE_RECEIVED,
            related_entity_type="fixture_chat_message",
            related_entity_id=response.data["message"]["id"],
        )
        self.assertEqual(notification.recipient, self.opponent)
        self.assertEqual(notification.actor, self.host)
        self.assertEqual(notification.action_url, f"/challenge-teams/{self.fixture.challenge_id}/room")

    def test_fixture_edit_window_and_message_ownership_are_enforced(self):
        self.client.force_authenticate(self.host)
        created = self.client.post(self.url, {"body": "Old fixture message", "client_message_id": "fixture-edit-2"}, format="json")
        message_id = created.data["message"]["id"]
        TeamFixtureChatMessage.objects.filter(pk=message_id).update(created_at=timezone.now() - timedelta(minutes=6))
        detail_url = reverse("team-fixture-chat-message", args=[self.fixture.id, message_id])

        expired = self.client.patch(detail_url, {"body": "Too late"}, format="json")
        self.assertEqual(expired.status_code, 400, expired.data)
        self.assertIn("no longer", expired.data["detail"])

        self.client.force_authenticate(self.opponent)
        self.assertEqual(self.client.patch(detail_url, {"body": "Not mine"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(detail_url).status_code, 403)
