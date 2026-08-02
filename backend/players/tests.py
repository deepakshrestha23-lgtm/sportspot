from datetime import time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from notifications.models import Notification
from players.models import PlayerProfile, PlayerRating, PlayerRatingEligibility, ReliabilityEvent
from players.services import create_rating_eligibility, record_player_rating, record_reliability_event
from teams.models import Team, TeamMember
from venues.models import Booking, BookingSlot, Court, CourtSlot, Venue


class PlayerDashboardOverviewTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.player = user_model.objects.create_user(
            email="player@example.com",
            password="test-password",
            full_name="Player One",
            phone="9800000001",
            role="PLAYER",
            email_verified=True,
        )
        self.owner = user_model.objects.create_user(
            email="owner@example.com",
            password="test-password",
            full_name="Owner One",
            phone="9800000002",
            role="COURT_OWNER",
            email_verified=True,
        )
        self.profile = PlayerProfile.objects.create(
            user=self.player,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            weekly_availability="Evenings",
            playing_style="Balanced player",
            preferred_cricksal_role=PlayerProfile.CricksalRole.BOWLER,
            completed_matches_count=1,
        )
        self.team = Team.objects.create(
            name="Kathmandu Kings",
            location="Kathmandu",
            preferred_playing_area="Baneshwor",
            preferred_playing_time="Evening",
            skill_level=Team.SkillLevel.INTERMEDIATE,
            captain=self.player,
        )
        TeamMember.objects.create(
            team=self.team,
            user=self.player,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.CAPTAIN,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="NCS Indoor Cricksal",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Court 1",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )
        self.slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=1),
            start_time=time(18, 0),
            end_time=time(19, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        self.booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=self.slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() + timedelta(minutes=10),
            confirmed_at=timezone.now(),
        )
        BookingSlot.objects.create(booking=self.booking, slot=self.slot, price=self.slot.price)
        Notification.objects.create(
            recipient=self.player,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            category=Notification.Category.BOOKINGS,
            title="Booking confirmed",
            message="Your court has been booked successfully.",
            action_url=f"/dashboard/player/bookings/{self.booking.id}",
            related_entity_type="booking",
            related_entity_id=self.booking.id,
        )

    def test_player_dashboard_overview_uses_real_player_data(self):
        self.client.force_authenticate(self.player)

        response = self.client.get(reverse("player-dashboard-overview"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["player"]["full_name"], "Player One")
        self.assertEqual(response.data["player"]["sportspot_id"], self.profile.sportspot_id)
        self.assertEqual(response.data["summary"]["team_count"], 1)
        self.assertEqual(response.data["summary"]["upcoming_booking_count"], 1)
        self.assertEqual(response.data["summary"]["upcoming_game_count"], 0)
        self.assertEqual(response.data["next_activity"]["booking_code"], self.booking.booking_code)
        self.assertEqual(len(response.data["recent_activity"]), 1)


    def test_player_booking_cancellation_does_not_change_sports_reliability(self):
        self.profile.reliability_score = 95
        self.profile.late_cancellation_count = 0
        self.profile.save(update_fields=["reliability_score", "late_cancellation_count", "updated_at"])
        self.client.force_authenticate(self.player)

        response = self.client.post(reverse("booking-cancel", kwargs={"booking_id": self.booking.id}), {})

        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.reliability_score, 95)
        self.assertEqual(self.profile.late_cancellation_count, 0)
    def test_court_owner_cannot_access_player_dashboard_overview(self):
        self.client.force_authenticate(self.owner)

        response = self.client.get(reverse("player-dashboard-overview"))

        self.assertEqual(response.status_code, 403)

class ReliabilityEventServiceTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.player = user_model.objects.create_user(
            email="trust-player@example.com",
            password="test-password",
            full_name="Trust Player",
            phone="9800000031",
            role="PLAYER",
            email_verified=True,
        )
        self.owner = user_model.objects.create_user(
            email="trust-owner@example.com",
            password="test-password",
            full_name="Trust Owner",
            phone="9800000032",
            role="COURT_OWNER",
            email_verified=True,
        )
        self.profile = PlayerProfile.objects.create(
            user=self.player,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            weekly_availability="Evenings",
            playing_style="Balanced player",
            preferred_cricksal_role=PlayerProfile.CricksalRole.BOWLER,
        )

    def test_reliability_event_updates_profile_once_with_dedupe_key(self):
        event, created = record_reliability_event(
            player=self.player,
            event_type=ReliabilityEvent.EventType.GAME_LATE_CANCELLATION,
            impact=ReliabilityEvent.Impact.NEGATIVE,
            title="Late game cancellation",
            description="Player cancelled after the confirmed-game deadline.",
            points_delta=-5,
            related_entity_type="game",
            related_entity_id=42,
            dedupe_key="game-42-late-cancel-player",
            created_by=self.player,
        )

        self.assertTrue(created)
        self.assertIsNotNone(event)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.late_cancellation_count, 1)
        self.assertEqual(self.profile.reliability_score, 95)

        duplicate, duplicate_created = record_reliability_event(
            player=self.player,
            event_type=ReliabilityEvent.EventType.GAME_LATE_CANCELLATION,
            impact=ReliabilityEvent.Impact.NEGATIVE,
            title="Late game cancellation",
            description="Repeated request should not create another event.",
            points_delta=-5,
            related_entity_type="game",
            related_entity_id=42,
            dedupe_key="game-42-late-cancel-player",
            created_by=self.player,
        )

        self.assertFalse(duplicate_created)
        self.assertEqual(duplicate.id, event.id)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.late_cancellation_count, 1)
        self.assertEqual(self.profile.reliability_score, 95)

    def test_non_player_cannot_receive_reliability_event(self):
        event, created = record_reliability_event(
            player=self.owner,
            event_type=ReliabilityEvent.EventType.GAME_COMPLETED_ATTENDED,
            impact=ReliabilityEvent.Impact.POSITIVE,
            title="Completed game",
        )

        self.assertFalse(created)
        self.assertIsNone(event)
        self.assertEqual(ReliabilityEvent.objects.count(), 0)

    def test_ratings_reliability_endpoint_returns_event_activity(self):
        record_reliability_event(
            player=self.player,
            event_type=ReliabilityEvent.EventType.GAME_COMPLETED_ATTENDED,
            impact=ReliabilityEvent.Impact.POSITIVE,
            title="Verified game completed",
            description="Player attended a confirmed game.",
            related_entity_type="game",
            related_entity_id=77,
            dedupe_key="game-77-attended-player",
        )
        self.client.force_authenticate(self.player)

        response = self.client.get(reverse("player-ratings-reliability"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["metrics"]["completed_games"], 1)
        self.assertTrue(response.data["reliability"]["is_provisional"])
        self.assertEqual(response.data["activity"][0]["title"], "Verified game completed")
        self.assertEqual(response.data["activity"][0]["impact"], ReliabilityEvent.Impact.POSITIVE)

class PlayerRatingServiceTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.rater = user_model.objects.create_user(
            email="rating-rater@example.com",
            password="test-password",
            full_name="Rating Rater",
            phone="9800000041",
            role="PLAYER",
            email_verified=True,
        )
        self.rated_player = user_model.objects.create_user(
            email="rating-player@example.com",
            password="test-password",
            full_name="Rating Player",
            phone="9800000042",
            role="PLAYER",
            email_verified=True,
        )
        self.owner = user_model.objects.create_user(
            email="rating-owner@example.com",
            password="test-password",
            full_name="Rating Owner",
            phone="9800000043",
            role="COURT_OWNER",
            email_verified=True,
        )
        PlayerProfile.objects.create(
            user=self.rater,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            weekly_availability="Evenings",
            playing_style="Reliable teammate",
            preferred_cricksal_role=PlayerProfile.CricksalRole.BATSMAN,
        )
        self.profile = PlayerProfile.objects.create(
            user=self.rated_player,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            weekly_availability="Evenings",
            playing_style="Balanced player",
            preferred_cricksal_role=PlayerProfile.CricksalRole.BOWLER,
        )

    def test_record_player_rating_updates_average_rating(self):
        rating, created = record_player_rating(
            rater=self.rater,
            rated_player=self.rated_player,
            rating=5,
            related_entity_type="game",
            related_entity_id=101,
            feedback_tags=["PUNCTUAL", "TEAM_PLAYER", "UNKNOWN"],
            comment="Showed up on time and communicated clearly.",
        )

        self.assertTrue(created)
        self.assertIsNotNone(rating)
        self.profile.refresh_from_db()
        self.assertEqual(str(self.profile.average_rating), "5.00")
        self.assertEqual(PlayerRating.objects.count(), 1)
        self.assertEqual(rating.feedback_tags, ["PUNCTUAL", "TEAM_PLAYER"])

    def test_duplicate_rating_for_same_context_is_idempotent(self):
        first, first_created = record_player_rating(
            rater=self.rater,
            rated_player=self.rated_player,
            rating=4,
            related_entity_type="game",
            related_entity_id=102,
        )
        second, second_created = record_player_rating(
            rater=self.rater,
            rated_player=self.rated_player,
            rating=2,
            related_entity_type="game",
            related_entity_id=102,
        )

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(second.id, first.id)
        self.assertEqual(PlayerRating.objects.count(), 1)
        self.profile.refresh_from_db()
        self.assertEqual(str(self.profile.average_rating), "4.00")

    def test_player_cannot_rate_self_or_non_player(self):
        self_rating, self_created = record_player_rating(
            rater=self.rated_player,
            rated_player=self.rated_player,
            rating=5,
            related_entity_type="game",
            related_entity_id=103,
        )
        owner_rating, owner_created = record_player_rating(
            rater=self.rater,
            rated_player=self.owner,
            rating=5,
            related_entity_type="game",
            related_entity_id=103,
        )

        self.assertIsNone(self_rating)
        self.assertFalse(self_created)
        self.assertIsNone(owner_rating)
        self.assertFalse(owner_created)
        self.assertEqual(PlayerRating.objects.count(), 0)

    def test_ratings_reliability_endpoint_returns_rating_summary(self):
        record_player_rating(
            rater=self.rater,
            rated_player=self.rated_player,
            rating=4,
            related_entity_type="game",
            related_entity_id=104,
            feedback_tags=["RELIABLE", "SPORTSMANLIKE"],
        )
        self.client.force_authenticate(self.rated_player)

        response = self.client.get(reverse("player-ratings-reliability"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["rating"]["average"], "4.00")
        self.assertEqual(response.data["rating"]["total_ratings"], 1)
        self.assertEqual(response.data["rating"]["distribution"][1]["count"], 1)
        self.assertEqual(response.data["rating"]["feedback_tags"], ["Reliable", "Sportsmanlike"])
        self.assertEqual(response.data["recent_ratings"][0]["value"], "4")

    def test_pending_rating_eligibility_appears_in_summary(self):
        eligibility, created = create_rating_eligibility(
            rater=self.rater,
            rated_player=self.rated_player,
            title="Kathmandu Kings vs Urban Strikers",
            related_entity_type="game",
            related_entity_id=201,
            match_date=timezone.now() - timedelta(days=1),
            deadline_at=timezone.now() + timedelta(days=7),
        )
        self.client.force_authenticate(self.rater)

        response = self.client.get(reverse("player-ratings-reliability"))

        self.assertTrue(created)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["pending_ratings"]), 1)
        self.assertEqual(response.data["pending_ratings"][0]["id"], eligibility.id)
        self.assertEqual(response.data["pending_ratings"][0]["rated_player_name"], "Rating Player")
        self.assertEqual(response.data["pending_ratings"][0]["rated_player_sportspot_id"], self.profile.sportspot_id)

    def test_submit_rating_eligibility_creates_rating_and_marks_submitted(self):
        eligibility, _created = create_rating_eligibility(
            rater=self.rater,
            rated_player=self.rated_player,
            title="Kathmandu Kings vs Urban Strikers",
            related_entity_type="game",
            related_entity_id=202,
            match_date=timezone.now() - timedelta(days=1),
            deadline_at=timezone.now() + timedelta(days=7),
        )
        self.client.force_authenticate(self.rater)

        response = self.client.post(
            reverse("player-rating-submit", kwargs={"eligibility_id": eligibility.id}),
            {
                "rating": 5,
                "feedback_tags": ["PUNCTUAL", "RESPECTFUL"],
                "comment": "Arrived on time and played respectfully.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(PlayerRating.objects.count(), 1)
        eligibility.refresh_from_db()
        self.assertEqual(eligibility.status, PlayerRatingEligibility.Status.SUBMITTED)
        self.assertIsNotNone(eligibility.submitted_rating)
        self.profile.refresh_from_db()
        self.assertEqual(str(self.profile.average_rating), "5.00")

    def test_expired_rating_eligibility_cannot_be_submitted(self):
        eligibility, _created = create_rating_eligibility(
            rater=self.rater,
            rated_player=self.rated_player,
            title="Kathmandu Kings vs Urban Strikers",
            related_entity_type="game",
            related_entity_id=203,
            match_date=timezone.now() - timedelta(days=10),
            deadline_at=timezone.now() - timedelta(days=1),
        )
        self.client.force_authenticate(self.rater)

        response = self.client.post(
            reverse("player-rating-submit", kwargs={"eligibility_id": eligibility.id}),
            {"rating": 4, "feedback_tags": ["RELIABLE"]},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(PlayerRating.objects.count(), 0)
        eligibility.refresh_from_db()
        self.assertEqual(eligibility.status, PlayerRatingEligibility.Status.EXPIRED)

    def test_rating_eligibility_cannot_be_submitted_twice(self):
        eligibility, _created = create_rating_eligibility(
            rater=self.rater,
            rated_player=self.rated_player,
            title="Kathmandu Kings vs Urban Strikers",
            related_entity_type="game",
            related_entity_id=204,
            match_date=timezone.now() - timedelta(days=1),
            deadline_at=timezone.now() + timedelta(days=7),
        )
        self.client.force_authenticate(self.rater)
        url = reverse("player-rating-submit", kwargs={"eligibility_id": eligibility.id})

        first_response = self.client.post(url, {"rating": 5, "feedback_tags": ["SPORTSMANLIKE"]}, format="json")
        second_response = self.client.post(url, {"rating": 2, "feedback_tags": ["RELIABLE"]}, format="json")

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 400)
        self.assertEqual(PlayerRating.objects.count(), 1)
        eligibility.refresh_from_db()
        self.assertEqual(eligibility.status, PlayerRatingEligibility.Status.SUBMITTED)