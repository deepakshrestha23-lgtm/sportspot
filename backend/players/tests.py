from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from notifications.models import Notification
from players.models import ParticipationAttendanceEvent, ParticipationCommitment, PlayerProfile, PlayerRating, PlayerRatingEligibility, ReliabilityEvent
from players.services import (
    create_participation_commitment,
    create_rating_eligibility,
    create_rating_eligibilities_for_players,
    dispute_commitment,
    excuse_participation_commitment,
    finalize_pending_attendance,
    get_player_reliability_snapshot,
    record_commitment_attendance,
    record_player_rating,
    record_reliability_event,
    reconcile_rating_feedback_notifications,
    submit_player_rating_eligibility,
)
from teams.models import Team, TeamMember
from venues.models import Booking, BookingSlot, Court, CourtSlot, Venue


class PlayerPreferredLocationTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.player = user_model.objects.create_user(
            email="location-player@example.com",
            password="test-password",
            full_name="Location Player",
            phone="9800000201",
            role="PLAYER",
            email_verified=True,
        )
        self.profile = PlayerProfile.objects.create(
            user=self.player,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            playing_style="All-round player",
            preferred_cricksal_role=PlayerProfile.CricksalRole.ALL_ROUNDER,
        )
        self.client.force_authenticate(self.player)

    def test_profile_can_store_a_private_confirmed_playing_location(self):
        response = self.client.patch(
            reverse("player-profile"),
            {
                "location": "Kathmandu",
                "preferred_area": "Baneshwor",
                "latitude": "27.691500",
                "longitude": "85.342000",
                "location_source": PlayerProfile.LocationSource.GEOCODED,
                "location_confirmed": True,
                "travel_radius_km": 15,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.location_confirmed)
        self.assertEqual(self.profile.preferred_area, "Baneshwor")
        self.assertEqual(self.profile.travel_radius_km, 15)
        self.assertIsNotNone(self.profile.location_updated_at)

    def test_profile_rejects_a_confirmed_location_outside_nepal(self):
        response = self.client.patch(
            reverse("player-profile"),
            {
                "latitude": "51.507400",
                "longitude": "-0.127800",
                "location_confirmed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("latitude", response.data)

    @patch("players.views.search_locations")
    def test_player_location_search_returns_structured_nepal_result(self, search_mock):
        search_mock.return_value = [{
            "latitude": 27.6915,
            "longitude": 85.342,
            "display_name": "Baneshwor, Kathmandu, Nepal",
            "place_type": "suburb",
            "district": "Kathmandu",
            "area": "Baneshwor",
        }]

        response = self.client.get(reverse("player-location-search"), {"q": "Baneshwor"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["district"], "Kathmandu")
        self.assertEqual(response.data["results"][0]["area"], "Baneshwor")

    def test_precise_location_can_be_removed_without_losing_district_fallback(self):
        self.profile.latitude = Decimal("27.691500")
        self.profile.longitude = Decimal("85.342000")
        self.profile.location_confirmed = True
        self.profile.save()

        response = self.client.patch(
            reverse("player-profile"),
            {"remove_precise_location": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.location, "Kathmandu")
        self.assertIsNone(self.profile.latitude)
        self.assertFalse(self.profile.location_confirmed)

    def test_changing_coordinates_without_confirmation_disables_distance_matching(self):
        self.profile.latitude = Decimal("27.691500")
        self.profile.longitude = Decimal("85.342000")
        self.profile.location_confirmed = True
        self.profile.save()

        response = self.client.patch(
            reverse("player-profile"),
            {"latitude": "27.700000", "longitude": "85.350000"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.location_confirmed)


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

class ParticipationCommitmentServiceTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.player = user_model.objects.create_user(
            email="commitment-player@example.com",
            password="test-password",
            full_name="Commitment Player",
            phone="9800000091",
            role="PLAYER",
            email_verified=True,
        )
        self.profile = PlayerProfile.objects.create(
            user=self.player,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            weekly_availability="Evenings",
            playing_style="Reliable player",
            preferred_cricksal_role=PlayerProfile.CricksalRole.BOWLER,
        )

    def create_commitment(self, source_id, *, start_offset=2, participant_id=1):
        start_at = timezone.now() + timedelta(hours=start_offset)
        end_at = start_at + timedelta(hours=1)
        commitment, created = create_participation_commitment(
            player=self.player,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=source_id,
            source_participant_id=participant_id,
            start_at=start_at,
            end_at=end_at,
            created_by=self.player,
        )
        self.assertTrue(created)
        return commitment

    def test_commitment_creation_is_idempotent(self):
        first = self.create_commitment(501)
        second, created = create_participation_commitment(
            player=self.player,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=501,
            source_participant_id=1,
            start_at=first.start_at,
            end_at=first.end_at,
        )

        self.assertFalse(created)
        self.assertEqual(first.id, second.id)
        self.assertEqual(ParticipationCommitment.objects.count(), 1)

    def test_no_show_is_reviewable_and_dispute_prevents_penalty(self):
        commitment = self.create_commitment(502)
        record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=False)
        commitment.refresh_from_db()

        self.assertEqual(commitment.status, ParticipationCommitment.Status.NO_SHOW_REPORTED)
        self.assertFalse(
            ReliabilityEvent.objects.filter(
                metadata__commitment_id=commitment.id,
            ).exists()
        )

        dispute_commitment(
            commitment_id=commitment.id,
            player=self.player,
            reason="I was present and the report is incorrect.",
        )
        commitment.refresh_from_db()
        self.assertEqual(commitment.status, ParticipationCommitment.Status.DISPUTED)
        self.assertEqual(self.profile.reliability_score, 100)

        self.assertEqual(finalize_pending_attendance(now=timezone.now() + timedelta(days=2)), 0)
        self.assertEqual(ReliabilityEvent.objects.filter(player=self.player).count(), 0)

    def test_undisputed_no_show_is_finalized_by_maintenance(self):
        commitment = self.create_commitment(503)
        record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=False)
        commitment.refresh_from_db()
        commitment.review_deadline_at = timezone.now() - timedelta(minutes=1)
        commitment.save(update_fields=["review_deadline_at", "updated_at"])

        self.assertEqual(finalize_pending_attendance(now=timezone.now()), 1)
        commitment.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(commitment.status, ParticipationCommitment.Status.FINALIZED_NO_SHOW)
        self.assertEqual(self.profile.no_show_count, 1)
        self.assertEqual(self.profile.reliability_score, 0)
        self.assertEqual(ReliabilityEvent.objects.filter(player=self.player).count(), 1)
        self.assertEqual(finalize_pending_attendance(now=timezone.now()), 0)

    def test_missing_attendance_report_becomes_neutral_and_is_audited(self):
        commitment = self.create_commitment(509, start_offset=-26)

        self.assertEqual(finalize_pending_attendance(now=timezone.now()), 1)
        commitment.refresh_from_db()
        self.profile.refresh_from_db()

        self.assertEqual(commitment.status, ParticipationCommitment.Status.UNVERIFIED)
        self.assertEqual(self.profile.reliability_score, 100)
        self.assertEqual(ReliabilityEvent.objects.filter(player=self.player).count(), 0)
        event = ParticipationAttendanceEvent.objects.get(commitment=commitment)
        self.assertEqual(event.event_type, ParticipationAttendanceEvent.EventType.ATTENDANCE_UNVERIFIED)
        self.assertEqual(event.previous_status, ParticipationCommitment.Status.COMMITTED)
        event.reason = "Attempted audit mutation"
        with self.assertRaises(ValidationError):
            event.save()

        self.assertEqual(finalize_pending_attendance(now=timezone.now()), 0)
        self.assertEqual(ParticipationAttendanceEvent.objects.filter(commitment=commitment).count(), 1)

    def test_attendance_submission_is_closed_after_the_deadline(self):
        commitment = self.create_commitment(510, start_offset=-26)

        with self.assertRaises(ValidationError):
            record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=True)

        commitment.refresh_from_db()
        self.assertEqual(commitment.status, ParticipationCommitment.Status.COMMITTED)
        self.assertFalse(ParticipationAttendanceEvent.objects.filter(commitment=commitment).exists())

    def test_reliability_snapshot_hides_legacy_score_when_a_commitment_is_pending(self):
        self.profile.completed_matches_count = 5
        self.profile.save(update_fields=["completed_matches_count", "updated_at"])
        self.create_commitment(511)

        snapshot = get_player_reliability_snapshot(self.profile)

        self.assertTrue(snapshot["is_provisional"])
        self.assertIsNone(snapshot["display_score"])
        self.assertEqual(snapshot["finalized_outcomes"], 0)

    def test_excused_commitment_can_be_replaced_when_a_player_rejoins(self):
        commitment = self.create_commitment(512)
        excuse_participation_commitment(
            commitment_id=commitment.id,
            actor=self.player,
            reason="The player declined the first schedule.",
        )

        replacement, created = create_participation_commitment(
            player=self.player,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=512,
            source_participant_id=commitment.source_participant_id,
            start_at=commitment.start_at,
            end_at=commitment.end_at,
        )

        self.assertTrue(created)
        self.assertEqual(replacement.source_version, commitment.source_version + 1)
        self.assertEqual(replacement.status, ParticipationCommitment.Status.COMMITTED)

    def test_repeated_no_show_report_is_idempotent_and_cannot_be_reversed_by_host(self):
        commitment = self.create_commitment(507)
        first = record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=False)
        first.refresh_from_db()

        replay = record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=False)
        self.assertTrue(getattr(replay, "_idempotent_replay", False))
        self.assertEqual(replay.review_deadline_at, first.review_deadline_at)

        with self.assertRaises(ValidationError):
            record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=True)

    def test_staff_resolution_of_dispute_creates_the_verified_outcome(self):
        staff = get_user_model().objects.create_user(
            email="attendance-staff@example.com",
            password="test-password",
            full_name="Attendance Staff",
            phone="9800000099",
            role="PLAYER",
            email_verified=True,
            is_staff=True,
        )
        commitment = self.create_commitment(508)
        record_commitment_attendance(commitment_id=commitment.id, actor=staff, attended=False)
        dispute_commitment(
            commitment_id=commitment.id,
            player=self.player,
            reason="I attended and checked in with the host.",
        )

        from players.services import resolve_commitment_dispute

        resolved = resolve_commitment_dispute(commitment_id=commitment.id, actor=staff, outcome="ATTENDED")
        self.profile.refresh_from_db()
        self.assertEqual(resolved.status, ParticipationCommitment.Status.ATTENDED)
        self.assertEqual(self.profile.completed_matches_count, 1)
        self.assertEqual(ReliabilityEvent.objects.filter(player=self.player).count(), 1)

    def test_attended_commitment_updates_reliability_without_duplicate_event(self):
        commitment = self.create_commitment(504)
        record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=True)
        record_commitment_attendance(commitment_id=commitment.id, actor=self.player, attended=True)
        commitment.refresh_from_db()
        self.profile.refresh_from_db()

        self.assertEqual(commitment.status, ParticipationCommitment.Status.ATTENDED)
        self.assertEqual(self.profile.completed_matches_count, 1)
        self.assertEqual(self.profile.reliability_score, 100)
        self.assertEqual(ReliabilityEvent.objects.filter(player=self.player).count(), 1)

    def test_late_cancellation_is_accountable_but_early_cancellation_is_neutral(self):
        early = self.create_commitment(505, start_offset=8, participant_id=1)
        from players.services import cancel_participation_commitment

        cancel_participation_commitment(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=505,
            player=self.player,
            actor=self.player,
            reason="Schedule changed.",
        )
        early.refresh_from_db()
        self.assertEqual(early.status, ParticipationCommitment.Status.CANCELLED_EARLY)
        self.assertEqual(ReliabilityEvent.objects.filter(player=self.player).count(), 0)

        late = self.create_commitment(506, start_offset=2, participant_id=1)
        cancel_participation_commitment(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=506,
            player=self.player,
            actor=self.player,
            reason="Cannot attend.",
        )
        late.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(late.status, ParticipationCommitment.Status.LATE_CANCELLED)
        self.assertEqual(self.profile.late_cancellation_count, 1)
        self.assertEqual(self.profile.reliability_score, 60)


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

    def test_completed_game_feedback_uses_one_task_and_resolves_after_all_ratings(self):
        third_player = get_user_model().objects.create_user(
            email="rating-third@example.com",
            password="test-password",
            full_name="Third Rating Player",
            phone="9800000044",
            role="PLAYER",
            email_verified=True,
        )
        PlayerProfile.objects.create(
            user=third_player,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            weekly_availability="Evenings",
            playing_style="Reliable teammate",
            preferred_cricksal_role=PlayerProfile.CricksalRole.ALL_ROUNDER,
        )
        create_rating_eligibilities_for_players(
            players=[self.rater, self.rated_player, third_player],
            title="Kathmandu Kings vs Urban Strikers",
            related_entity_type="game",
            related_entity_id=205,
            match_date=timezone.now() - timedelta(days=1),
        )

        notification = Notification.objects.get(
            recipient=self.rater,
            notification_type=Notification.NotificationType.RATING_REQUIRED,
            related_entity_type="game",
            related_entity_id=205,
        )
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.rater,
                notification_type=Notification.NotificationType.RATING_REQUIRED,
                related_entity_type="game",
                related_entity_id=205,
            ).count(),
            1,
        )
        self.assertEqual(notification.metadata["pending_rating_count"], 2)

        first_eligibility = PlayerRatingEligibility.objects.get(
            rater=self.rater,
            related_entity_type="game",
            related_entity_id=205,
            rated_player=self.rated_player,
        )
        submit_player_rating_eligibility(
            eligibility_id=first_eligibility.id,
            rater=self.rater,
            rating=5,
            feedback_tags=["RELIABLE"],
        )
        notification.refresh_from_db()
        self.assertTrue(notification.action_required)
        self.assertEqual(notification.action_status, Notification.ActionStatus.PENDING)
        self.assertEqual(notification.metadata["pending_rating_count"], 1)
        self.assertTrue(notification.is_read)

        second_eligibility = PlayerRatingEligibility.objects.get(
            rater=self.rater,
            related_entity_type="game",
            related_entity_id=205,
            rated_player=third_player,
        )
        submit_player_rating_eligibility(
            eligibility_id=second_eligibility.id,
            rater=self.rater,
            rating=4,
            feedback_tags=["TEAM_PLAYER"],
        )
        notification.refresh_from_db()
        self.assertFalse(notification.action_required)
        self.assertEqual(notification.action_status, Notification.ActionStatus.COMPLETED)
        self.assertEqual(notification.action_url, "")
        self.assertTrue(notification.is_read)

    def test_reconciliation_removes_legacy_duplicate_feedback_cards(self):
        eligibility, _created = create_rating_eligibility(
            rater=self.rater,
            rated_player=self.rated_player,
            title="Kathmandu Kings vs Urban Strikers",
            related_entity_type="game",
            related_entity_id=206,
            match_date=timezone.now() - timedelta(days=1),
            deadline_at=timezone.now() + timedelta(days=7),
        )
        for suffix in ["first", "second", "third"]:
            Notification.objects.create(
                recipient=self.rater,
                notification_type=Notification.NotificationType.RATING_REQUIRED,
                title="Share feedback on your completed game",
                message="Legacy feedback task.",
                action_url=f"/dashboard/player/ratings?rate={eligibility.id}",
                related_entity_type="game",
                related_entity_id=206,
                action_required=True,
                action_status=Notification.ActionStatus.PENDING,
                deduplication_key=f"legacy-rating-card:{suffix}",
            )

        reconcile_rating_feedback_notifications(self.rater)

        notifications = Notification.objects.filter(
            recipient=self.rater,
            notification_type=Notification.NotificationType.RATING_REQUIRED,
            related_entity_type="game",
            related_entity_id=206,
        )
        self.assertEqual(notifications.count(), 1)
        notification = notifications.get()
        self.assertEqual(notification.metadata["pending_rating_count"], 1)
        self.assertEqual(notification.action_url, f"/dashboard/player/ratings?rate={eligibility.id}")

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
