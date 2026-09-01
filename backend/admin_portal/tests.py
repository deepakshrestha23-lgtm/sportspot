from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from players.models import ParticipationCommitment
from venues.models import Venue


class AdminPortalApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="portal-admin@example.com",
            password="test-password",
            full_name="Portal Admin",
            phone="9800000011",
            role=User.Role.ADMIN,
            is_staff=True,
            email_verified=True,
        )
        self.player = User.objects.create_user(
            email="portal-player@example.com",
            password="test-password",
            full_name="Portal Player",
            phone="9800000012",
            role=User.Role.PLAYER,
            email_verified=True,
        )

    def test_admin_can_search_user_directory(self):
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/admin/users/?role=PLAYER&q=Portal")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pagination"]["total"], 1)
        self.assertEqual(response.data["users"][0]["email"], self.player.email)

    def test_admin_user_directory_respects_pagination(self):
        second_player = User.objects.create_user(
            email="portal-player-two@example.com",
            password="test-password",
            full_name="Portal Player Two",
            phone="9800000013",
            role=User.Role.PLAYER,
            email_verified=True,
        )
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/admin/users/?role=PLAYER&page=2&page_size=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pagination"], {"page": 2, "page_size": 1, "total": 2, "has_more": False})
        self.assertEqual(response.data["users"][0]["email"], self.player.email)

    def test_admin_venue_queue_respects_pagination(self):
        for index in range(2):
            owner = User.objects.create_user(
                email=f"venue-owner-{index}@example.com",
                password="test-password",
                full_name=f"Venue Owner {index}",
                phone=f"98000000{20 + index}",
                role=User.Role.COURT_OWNER,
            )
            Venue.objects.create(
                owner=owner,
                name=f"Venue {index}",
                status=Venue.Status.PENDING,
                submitted_at=timezone.now() - timedelta(minutes=index),
            )
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/venues/admin/venues/?status=PENDING&page=2&page_size=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pagination"], {"page": 2, "page_size": 1, "total": 2, "has_more": False})
        self.assertEqual(len(response.data["venues"]), 1)

    def test_admin_can_view_disputed_attendance_ledger(self):
        start_at = timezone.now() + timedelta(days=1)
        commitment = ParticipationCommitment.objects.create(
            player=self.player,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=999,
            source_participant_id=999,
            start_at=start_at,
            end_at=start_at + timedelta(hours=1),
            late_cutoff_at=start_at - timedelta(hours=1),
            status=ParticipationCommitment.Status.DISPUTED,
            dispute_reason="I attended this game.",
            disputed_at=timezone.now(),
        )
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/admin/reliability/?status=DISPUTED")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["attendance"][0]["id"], commitment.id)
        self.assertEqual(response.data["attendance"][0]["status"], ParticipationCommitment.Status.DISPUTED)

    def test_non_admin_cannot_access_admin_portal(self):
        self.client.force_authenticate(self.player)

        response = self.client.get("/api/admin/overview/")

        self.assertEqual(response.status_code, 403)

    def test_admin_can_monitor_scorecard_operations(self):
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/admin/operations/?type=SCORECARDS")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["type"], "SCORECARDS")
        self.assertEqual(response.data["items"], [])
