from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient
from django.utils import timezone

from players.models import PlayerProfile
from teams.models import Team, TeamMember
from venues.models import Booking, Court, CourtSlot, Venue

from .models import ChallengeEvent, ChallengeProposal, OpenChallengeResponse, TeamChallenge
from .services import (
    counter_challenge,
    cancel_challenges_for_booking,
    create_challenge,
    decide_challenge,
    expire_team_challenges,
    respond_to_open_challenge,
    select_open_opponent,
    attach_booking_to_challenge,
    synchronize_confirmed_team_challenges,
    withdraw_challenge,
)


class TeamChallengeServiceTests(TestCase):
    def setUp(self):
        self.host = self.create_player("challenge-host@example.com", "Challenge Host")
        self.opponent = self.create_player("challenge-opponent@example.com", "Challenge Opponent")
        self.member = self.create_player("challenge-member@example.com", "Challenge Member")
        self.host_team = self.create_team("Host Team", self.host)
        self.opponent_team = self.create_team("Opponent Team", self.opponent)
        self.member_team = self.create_team("Member Team", self.member)

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

    def test_public_team_directory_returns_real_member_counts(self):
        response = APIClient().get("/api/team-challenges/teams/")

        self.assertEqual(response.status_code, 200)
        teams = response.json()["teams"]
        host_team = next(item for item in teams if item["id"] == self.host_team.id)
        self.assertEqual(host_team["members_count"], 1)

    def challenge_data(self, *, request_id="challenge-request"):
        now = timezone.now()
        return {
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
            "client_request_id": request_id,
        }

    @patch("team_challenges.services.notify_challenge_received")
    def test_only_captain_can_create_a_challenge(self, _notify):
        with self.assertRaises(ValidationError):
            create_challenge(self.challenge_data(), self.member)

    @patch("team_challenges.services.notify_challenge_received")
    def test_create_is_idempotent_for_the_same_client_request(self, _notify):
        data = self.challenge_data()
        first = create_challenge(data, self.host)
        replay = create_challenge(data, self.host)

        self.assertEqual(first.pk, replay.pk)
        self.assertEqual(TeamChallenge.objects.count(), 1)

    @patch("team_challenges.services.notify_challenge_received")
    def test_plan_first_rejects_an_area_from_another_district(self, _notify):
        data = self.challenge_data()
        data["preferred_area"] = "Jawalakhel"

        with self.assertRaises(ValidationError):
            create_challenge(data, self.host)

        self.assertEqual(TeamChallenge.objects.count(), 0)

    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_response_deadline_must_be_before_the_game(self, _received, _decision):
        data = self.challenge_data()
        data["response_deadline"] = timezone.now() + timedelta(days=4)

        with self.assertRaises(ValidationError):
            create_challenge(data, self.host)

        self.assertEqual(TeamChallenge.objects.count(), 0)

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_a_captain_cannot_decide_on_the_same_proposal_twice(self, _decision, _received):
        challenge = create_challenge(self.challenge_data(), self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        with self.assertRaises(ValidationError):
            decide_challenge(challenge.pk, self.opponent, "ACCEPT")

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_accepting_both_sides_of_plan_first_waits_for_booking(self, _received, _decision, _status):
        challenge = create_challenge(self.challenge_data(), self.host)

        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        challenge.refresh_from_db()

        self.assertEqual(challenge.status, TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING)
        self.assertIsNotNone(challenge.fixture)
        self.assertEqual(challenge.fixture.status, "AWAITING_COURT")

    @patch("team_challenges.services.notify_challenge_countered")
    @patch("team_challenges.services.notify_challenge_received")
    def test_counter_creates_a_new_current_proposal(self, _received, _countered):
        challenge = create_challenge(self.challenge_data(), self.host)
        now = timezone.now()
        counter_challenge(
            challenge.pk,
            self.opponent,
            {
                "court_mode": TeamChallenge.CourtMode.PLAN_FIRST,
                "proposed_date": timezone.localdate() + timedelta(days=4),
                "proposed_start_time": time(19, 0),
                "proposed_end_time": time(21, 0),
                "preferred_district": "Kathmandu",
                "preferred_area": "Thamel",
                "response_deadline": now + timedelta(hours=6),
                "booking_deadline": now + timedelta(hours=7),
            },
        )

        challenge.refresh_from_db()
        self.assertEqual(challenge.status, TeamChallenge.Status.COUNTERED)
        self.assertEqual(challenge.current_proposal.version, 2)
        self.assertEqual(ChallengeProposal.objects.filter(challenge=challenge).count(), 2)
        self.assertEqual(challenge.current_proposal.challenged_decision, ChallengeProposal.Decision.ACCEPTED)

    @patch("team_challenges.services.notify_challenge_expired")
    @patch("team_challenges.services.notify_challenge_received")
    def test_expiry_closes_a_challenge_after_response_deadline(self, _received, _expired):
        challenge = create_challenge(self.challenge_data(), self.host)
        challenge.response_deadline = timezone.now() - timedelta(minutes=1)
        challenge.save(update_fields=["response_deadline", "updated_at"])

        expired = expire_team_challenges(now=timezone.now(), notify=True)
        challenge.refresh_from_db()

        self.assertEqual(expired, 1)
        self.assertEqual(challenge.status, TeamChallenge.Status.EXPIRED)
        self.assertFalse(challenge.is_public)

    @patch("team_challenges.services.notify_challenge_received")
    def test_creator_cannot_withdraw_after_response_deadline(self, _received):
        challenge = create_challenge(self.challenge_data(), self.host)
        challenge.response_deadline = timezone.now() - timedelta(minutes=1)
        challenge.save(update_fields=["response_deadline", "updated_at"])

        with self.assertRaises(ValidationError):
            withdraw_challenge(challenge.pk, self.host)

    @patch("team_challenges.services.notify_challenge_received")
    def test_my_challenges_search_matches_team_and_proposal_details(self, _received):
        create_challenge(self.challenge_data(), self.host)
        client = APIClient()
        client.force_authenticate(self.host)

        response = client.get("/api/team-challenges/challenges/", {"scope": "all", "search": "Opponent Team"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["challenges"]), 1)

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    def test_cancelling_a_linked_booking_closes_the_team_challenge(self, _status, _received):
        owner = get_user_model().objects.create_user(
            email="challenge-venue-owner@example.com",
            password="test-password",
            full_name="Venue Owner",
            phone="9800001000",
            role="COURT_OWNER",
            email_verified=True,
        )
        venue = Venue.objects.create(
            owner=owner,
            name="Challenge Court",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
        )
        court = Court.objects.create(
            venue=venue,
            name="Court 1",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )
        slot = CourtSlot.objects.create(
            court=court,
            date=timezone.localdate() + timedelta(days=3),
            start_time=time(18, 0),
            end_time=time(19, 0),
            price=Decimal("1500"),
            status=CourtSlot.Status.BOOKED,
        )
        booking = Booking.objects.create(
            player=self.host,
            venue=venue,
            court=court,
            slot=slot,
            amount=Decimal("1500"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            confirmed_at=timezone.now(),
            reserved_until=timezone.now() + timedelta(minutes=10),
        )
        data = self.challenge_data(request_id="booking-linked")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)

        cancelled = cancel_challenges_for_booking(booking, notify=True)
        challenge.refresh_from_db()

        self.assertEqual(cancelled, 1)
        self.assertEqual(challenge.status, TeamChallenge.Status.CANCELLED)
        self.assertFalse(challenge.is_public)

    @patch("team_challenges.services.notify_open_challenge_not_selected")
    @patch("team_challenges.services.notify_opponent_selected")
    @patch("team_challenges.services.notify_open_challenge_response")
    def test_open_challenge_accepts_multiple_responses_but_selection_is_one_time(self, _response, _selected, _not_selected):
        data = self.challenge_data(request_id="open-responses")
        data.update({"challenge_type": TeamChallenge.ChallengeType.OPEN, "challenged_team": None})
        challenge = create_challenge(data, self.host)

        first = respond_to_open_challenge(challenge.pk, self.opponent, team_id=self.opponent_team.pk)
        second = respond_to_open_challenge(challenge.pk, self.member, team_id=self.member_team.pk)
        selected = select_open_opponent(challenge.pk, first.pk, self.host)

        challenge.refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(selected.pk, challenge.pk)
        self.assertEqual(challenge.challenged_team_id, self.opponent_team.pk)
        self.assertEqual(first.status, "SELECTED")
        self.assertEqual(second.status, "NOT_SELECTED")
        self.assertEqual(_not_selected.call_count, 1)

        with self.assertRaises(ValidationError):
            respond_to_open_challenge(challenge.pk, self.member, team_id=self.member_team.pk)
        with self.assertRaises(ValidationError):
            select_open_opponent(challenge.pk, second.pk, self.host)

    @patch("team_challenges.services.notify_open_challenge_response")
    def test_open_challenge_rejects_response_after_public_listing_is_selected(self, _response):
        data = self.challenge_data(request_id="selected-open")
        data.update({"challenge_type": TeamChallenge.ChallengeType.OPEN, "challenged_team": None})
        challenge = create_challenge(data, self.host)
        response = respond_to_open_challenge(challenge.pk, self.opponent, team_id=self.opponent_team.pk)
        select_open_opponent(challenge.pk, response.pk, self.host)

        with self.assertRaises(ValidationError):
            respond_to_open_challenge(challenge.pk, self.member, team_id=self.member_team.pk)

    @patch("team_challenges.services.notify_open_challenge_response")
    def test_repeated_open_response_is_idempotent_without_duplicate_activity(self, notify_response):
        data = self.challenge_data(request_id="open-response-retry")
        data.update({"challenge_type": TeamChallenge.ChallengeType.OPEN, "challenged_team": None})
        challenge = create_challenge(data, self.host)

        first = respond_to_open_challenge(challenge.pk, self.opponent, message="Available", team_id=self.opponent_team.pk)
        events_after_first = ChallengeEvent.objects.filter(
            challenge=challenge,
            event_type=ChallengeEvent.EventType.RESPONSE_RECEIVED,
        ).count()
        second = respond_to_open_challenge(challenge.pk, self.opponent, message="Still available", team_id=self.opponent_team.pk)

        self.assertEqual(first.pk, second.pk)
        self.assertTrue(getattr(second, "_idempotent_replay", False))
        self.assertEqual(events_after_first, ChallengeEvent.objects.filter(
            challenge=challenge,
            event_type=ChallengeEvent.EventType.RESPONSE_RECEIVED,
        ).count())
        self.assertEqual(notify_response.call_count, 1)
        self.assertEqual(OpenChallengeResponse.objects.get(pk=first.pk).message, "Still available")

    def create_confirmed_booking(self, *, days=3, start=time(18, 0), end=time(20, 0), owner=None):
        owner = owner or self.host
        venue_owner = get_user_model().objects.create_user(
            email=f"venue-owner-{days}-{start.hour}-{owner.id}@example.com",
            password="test-password",
            full_name="Challenge Venue Owner",
            phone=f"980000{owner.id:04d}",
            role="COURT_OWNER",
            email_verified=True,
        )
        venue = Venue.objects.create(
            owner=venue_owner,
            name="Challenge Venue",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
        )
        court = Court.objects.create(
            venue=venue,
            name="Court 1",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )
        slot = CourtSlot.objects.create(
            court=court,
            date=timezone.localdate() + timedelta(days=days),
            start_time=start,
            end_time=end,
            price=Decimal("1500"),
            status=CourtSlot.Status.BOOKED,
        )
        return Booking.objects.create(
            player=owner,
            venue=venue,
            court=court,
            slot=slot,
            amount=Decimal("3000"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            confirmed_at=timezone.now(),
            reserved_until=timezone.now() + timedelta(minutes=10),
        )

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_plan_first_attach_requires_the_agreed_schedule(self, _received, _decision, _status):
        challenge = create_challenge(self.challenge_data(request_id="schedule-match"), self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        booking = self.create_confirmed_booking(days=4)

        with self.assertRaises(ValidationError):
            attach_booking_to_challenge(challenge.pk, booking.pk, self.host)

        challenge.refresh_from_db()
        self.assertIsNone(challenge.booking_id)
        self.assertEqual(challenge.status, TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING)

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_plan_first_attach_accepts_a_booking_with_the_agreed_schedule(self, _received, _decision, _status):
        challenge = create_challenge(self.challenge_data(request_id="matching-schedule"), self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        booking = self.create_confirmed_booking(days=3, start=time(18, 0), end=time(20, 0))

        attach_booking_to_challenge(challenge.pk, booking.pk, self.host)
        challenge.refresh_from_db()

        self.assertEqual(challenge.status, TeamChallenge.Status.CONFIRMED)
        self.assertEqual(challenge.booking_id, booking.pk)
        self.assertEqual(challenge.fixture.status, "SCHEDULED")

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_booking_first_cannot_be_confirmed_after_the_booking_is_cancelled(self, _received, _decision, _status):
        booking = self.create_confirmed_booking(days=3)
        data = self.challenge_data(request_id="stale-booking")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)

        booking.status = Booking.BookingStatus.CANCELLED
        booking.payment_status = Booking.PaymentStatus.REFUNDED
        booking.save(update_fields=["status", "payment_status", "updated_at"])

        with self.assertRaises(ValidationError):
            decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        challenge.refresh_from_db()
        self.assertEqual(challenge.status, TeamChallenge.Status.OPEN)
        self.assertEqual(challenge.current_proposal.challenged_decision, ChallengeProposal.Decision.PENDING)

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_confirmed_team_challenge_moves_to_completed_after_booking_end(self, _received, _decision, _status):
        booking = self.create_confirmed_booking(days=3)
        data = self.challenge_data(request_id="lifecycle-booking")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        finished_at = timezone.now() + timedelta(days=4)
        changed = synchronize_confirmed_team_challenges(now=finished_at, notify=True)
        challenge.refresh_from_db()

        self.assertGreaterEqual(changed, 1)
        self.assertEqual(challenge.status, TeamChallenge.Status.COMPLETED)
        self.assertEqual(challenge.fixture.status, "COMPLETED")
