from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient
from django.utils import timezone

from players.models import PlayerProfile, PlayerRatingEligibility
from teams.models import Team, TeamMember
from venues.models import Booking, Court, CourtSlot, Venue
from matchmaking.services import booking_end_at, get_booking_start_at, player_has_overlapping_commitment

from .models import ChallengeEvent, ChallengeProposal, OpenChallengeResponse, TeamChallenge, TeamFixture, TeamFixtureParticipant
from .services import (
    counter_challenge,
    cancel_challenges_for_booking,
    create_challenge,
    decide_challenge,
    expire_team_challenges,
    respond_to_open_challenge,
    select_open_opponent,
    attach_booking_to_challenge,
    add_fixture_participant,
    confirm_fixture_result,
    record_fixture_attendance,
    reconfirm_challenge,
    reschedule_challenge,
    get_challenge_fixture_room,
    synchronize_confirmed_team_challenges,
    synchronize_team_challenge_captains,
    submit_fixture_result,
    withdraw_challenge,
    withdraw_open_challenge_response,
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

    def test_challenge_reference_data_keeps_supported_options_available(self):
        response = APIClient().get("/api/team-challenges/reference/")

        self.assertEqual(response.status_code, 200)
        filters = response.json()["filters"]
        self.assertEqual(filters["districts"], [
            {"value": "Kathmandu", "label": "Kathmandu"},
            {"value": "Lalitpur", "label": "Lalitpur"},
            {"value": "Bhaktapur", "label": "Bhaktapur"},
        ])
        self.assertIn({"value": "Maitidevi", "label": "Maitidevi"}, filters["areas_by_district"]["Kathmandu"])
        self.assertIn({"value": "Patan", "label": "Patan"}, filters["areas_by_district"]["Lalitpur"])
        self.assertEqual(
            {item["value"] for item in filters["court_modes"]},
            {TeamChallenge.CourtMode.PLAN_FIRST, TeamChallenge.CourtMode.BOOKING_FIRST},
        )

    def test_public_team_filters_use_supported_location_and_skill_values(self):
        client = APIClient()
        self.member_team.preferred_playing_area = "Baneshwor, Chabahil"
        self.member_team.save(update_fields=["preferred_playing_area"])

        response = client.get(
            "/api/team-challenges/teams/",
            {"district": "Kathmandu", "area": "Baneshwor", "skill_level": Team.SkillLevel.INTERMEDIATE},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 3)
        self.assertEqual({team["id"] for team in response.json()["teams"]}, {
            self.host_team.id,
            self.opponent_team.id,
            self.member_team.id,
        })

        empty_response = client.get("/api/team-challenges/teams/", {"district": "Lalitpur"})
        self.assertEqual(empty_response.status_code, 200)
        self.assertEqual(empty_response.json()["count"], 0)

    def test_invalid_challenge_area_filter_returns_a_user_facing_validation_response(self):
        response = APIClient().get(
            "/api/team-challenges/teams/",
            {"district": "Lalitpur", "area": "Baneshwor"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("area", response.json())

    @patch("team_challenges.services.notify_challenge_received")
    def test_public_open_challenges_filter_by_date_and_location(self, _received):
        challenge = create_challenge({
            **self.challenge_data(request_id="filtered-open-challenge"),
            "challenge_type": TeamChallenge.ChallengeType.OPEN,
            "challenged_team": None,
        }, self.host)
        match_date = challenge.current_proposal.proposed_date

        response = APIClient().get(
            "/api/team-challenges/challenges/public/",
            {
                "district": "Kathmandu",
                "area": "Baneshwor",
                "date_from": match_date.isoformat(),
                "date_to": match_date.isoformat(),
                "court_mode": TeamChallenge.CourtMode.PLAN_FIRST,
                "players_per_side": "6",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        self.assertEqual(response.json()["challenges"][0]["id"], challenge.id)

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
    def test_repeating_the_same_challenge_decision_is_idempotent(self, _decision, _received):
        challenge = create_challenge(self.challenge_data(), self.host)
        first = decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        replay = decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        self.assertEqual(first.pk, replay.pk)
        self.assertTrue(getattr(replay, "_idempotent_replay", False))
        self.assertEqual(
            ChallengeEvent.objects.filter(
                challenge=challenge,
                event_type=ChallengeEvent.EventType.ACCEPTED,
            ).count(),
            1,
        )

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

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_fixture_room_supports_planning_and_reconfirmation_states(self, _received, _decision, _status):
        challenge = create_challenge(self.challenge_data(request_id="room-lifecycle"), self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        client = APIClient()
        client.force_authenticate(self.host)
        planning_response = client.get(f"/api/team-challenges/challenges/{challenge.pk}/room/")
        self.assertEqual(planning_response.status_code, 200, planning_response.data)
        self.assertEqual(planning_response.data["fixture"]["room_state"], "PLANNING")
        self.assertEqual(planning_response.data["fixture"]["room_access"], "PLANNING")

        original_booking = self.create_confirmed_booking(days=3, owner=self.host)
        attach_booking_to_challenge(challenge.pk, original_booking.id, self.host)
        replacement = self.create_confirmed_booking(days=4, start=time(19, 0), end=time(21, 0), owner=self.opponent)
        reschedule_challenge(
            challenge.pk,
            self.opponent,
            {"booking": replacement, "response_deadline": timezone.now() + timedelta(hours=2)},
        )

        reconfirmation_response = client.get(f"/api/team-challenges/challenges/{challenge.pk}/room/")
        self.assertEqual(reconfirmation_response.status_code, 200, reconfirmation_response.data)
        self.assertEqual(reconfirmation_response.data["fixture"]["room_state"], "RECONFIRMATION")
        self.assertEqual(reconfirmation_response.data["fixture"]["room_access"], "RECONFIRMATION")

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
        replay = select_open_opponent(challenge.pk, first.pk, self.host)

        challenge.refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(selected.pk, challenge.pk)
        self.assertEqual(replay.pk, challenge.pk)
        self.assertTrue(getattr(replay, "_idempotent_replay", False))
        self.assertEqual(challenge.challenged_team_id, self.opponent_team.pk)
        self.assertEqual(first.status, "SELECTED")
        self.assertEqual(second.status, "NOT_SELECTED")
        self.assertEqual(_selected.call_count, 1)
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

    @patch("team_challenges.services.notify_open_challenge_response")
    def test_open_response_can_be_withdrawn_before_opponent_selection(self, _response):
        data = self.challenge_data(request_id="open-withdraw")
        data.update({"challenge_type": TeamChallenge.ChallengeType.OPEN, "challenged_team": None})
        challenge = create_challenge(data, self.host)
        response = respond_to_open_challenge(challenge.pk, self.opponent, team_id=self.opponent_team.pk)

        withdrawn = withdraw_open_challenge_response(challenge.pk, response.pk, self.opponent)

        self.assertEqual(withdrawn.status, OpenChallengeResponse.Status.WITHDRAWN)
        self.assertEqual(
            ChallengeEvent.objects.filter(
                challenge=challenge,
                event_type=ChallengeEvent.EventType.WITHDRAWN,
            ).count(),
            1,
        )

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
    def test_my_games_includes_only_authorised_scheduled_team_fixtures(self, _received, _decision, _status):
        booking = self.create_confirmed_booking(days=3, owner=self.host)
        challenge_data = self.challenge_data(request_id="my-games-team-fixture")
        challenge_data.update({
            "court_mode": TeamChallenge.CourtMode.BOOKING_FIRST,
            "booking": booking,
            "booking_deadline": None,
        })
        challenge = create_challenge(challenge_data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        fixture = challenge.fixture

        TeamMember.objects.create(
            team=self.host_team,
            user=self.member,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BOWLER,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        TeamFixtureParticipant.objects.create(
            fixture=fixture,
            team=self.host_team,
            player=self.member,
            selected_by=self.host,
        )

        host_client = APIClient()
        host_client.force_authenticate(self.host)
        host_response = host_client.get("/api/matchmaking/games/my/")
        self.assertEqual(host_response.status_code, 200, host_response.data)
        host_matches = host_response.data["team_matches"]["upcoming"]
        self.assertEqual(len(host_matches), 1)
        self.assertEqual(host_matches[0]["challenge_id"], challenge.id)
        self.assertEqual(host_matches[0]["team_name"], self.host_team.name)
        self.assertEqual(host_matches[0]["opponent_team_name"], self.opponent_team.name)
        self.assertTrue(host_matches[0]["is_captain"])
        self.assertEqual(host_matches[0]["room_access"], "CONFIRMED")

        member_client = APIClient()
        member_client.force_authenticate(self.member)
        member_response = member_client.get("/api/matchmaking/games/my/")
        self.assertEqual(member_response.status_code, 200, member_response.data)
        member_matches = member_response.data["team_matches"]["upcoming"]
        self.assertEqual(len(member_matches), 1)
        self.assertEqual(member_matches[0]["team_name"], self.host_team.name)
        self.assertTrue(member_matches[0]["is_participant"])
        self.assertEqual(member_matches[0]["room_access"], "CONFIRMED")

        alternate_team = self.create_team("Alternate Host Team", self.host)
        plan_only_data = self.challenge_data(request_id="my-games-plan-only")
        plan_only_data["challenger_team"] = alternate_team
        plan_only = create_challenge(plan_only_data, self.host)
        decide_challenge(plan_only.pk, self.opponent, "ACCEPT")

        outsider = self.create_player("team-outsider@example.com", "Team Outsider")
        TeamMember.objects.create(
            team=self.host_team,
            user=outsider,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.ALL_ROUNDER,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        outsider_client = APIClient()
        outsider_client.force_authenticate(outsider)
        outsider_response = outsider_client.get("/api/matchmaking/games/my/")
        self.assertEqual(outsider_response.status_code, 200, outsider_response.data)
        self.assertEqual(outsider_response.data["team_matches"]["upcoming"], [])

        host_after_plan = host_client.get("/api/matchmaking/games/my/")
        self.assertEqual(host_after_plan.status_code, 200, host_after_plan.data)
        self.assertEqual(
            [item["challenge_id"] for item in host_after_plan.data["team_matches"]["upcoming"]],
            [challenge.id],
        )

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_either_captain_can_attach_the_agreed_plan_first_booking(self, _received, _decision, _status):
        challenge = create_challenge(self.challenge_data(request_id="challenged-booking-owner"), self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        booking = self.create_confirmed_booking(days=3, start=time(18, 0), end=time(20, 0), owner=self.opponent)

        attach_booking_to_challenge(challenge.pk, booking.pk, self.opponent)
        challenge.refresh_from_db()

        self.assertEqual(challenge.status, TeamChallenge.Status.CONFIRMED)
        self.assertEqual(challenge.booking_id, booking.pk)
        self.assertEqual(challenge.booking_owner_id, self.opponent.id)

    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    @patch("team_challenges.services.notify_challenge_received")
    def test_repeating_booking_attachment_is_idempotent(self, _received, _decision, _status):
        challenge = create_challenge(self.challenge_data(request_id="booking-attach-replay"), self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        booking = self.create_confirmed_booking(days=3, start=time(18, 0), end=time(20, 0), owner=self.opponent)

        attach_booking_to_challenge(challenge.pk, booking.pk, self.opponent)
        replay = attach_booking_to_challenge(challenge.pk, booking.pk, self.opponent)

        self.assertEqual(replay.pk, challenge.pk)
        self.assertTrue(getattr(replay, "_idempotent_replay", False))
        self.assertEqual(
            ChallengeEvent.objects.filter(
                challenge=challenge,
                event_type=ChallengeEvent.EventType.BOOKING_CONFIRMED,
            ).count(),
            1,
        )

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

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_reschedule_accepts_booking_from_either_captain_and_requires_both_confirmations(self, _decision, _status, _received):
        original_booking = self.create_confirmed_booking(days=3, owner=self.host)
        data = self.challenge_data(request_id="reschedule-either-captain")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": original_booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        replacement = self.create_confirmed_booking(days=4, start=time(19, 0), end=time(21, 0), owner=self.opponent)
        response_deadline = timezone.now() + timedelta(hours=2)
        reschedule_challenge(
            challenge.pk,
            self.opponent,
            {"booking": replacement, "response_deadline": response_deadline},
        )
        challenge.refresh_from_db()

        self.assertEqual(challenge.status, TeamChallenge.Status.RECONFIRMATION_REQUIRED)
        self.assertEqual(challenge.booking_id, replacement.id)
        reconfirm_challenge(challenge.pk, self.host, "ACCEPT")
        reconfirm_challenge(challenge.pk, self.opponent, "ACCEPT")
        challenge.refresh_from_db()
        self.assertEqual(challenge.status, TeamChallenge.Status.CONFIRMED)
        self.assertIsNone(challenge.reconfirmation_deadline)

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_reconfirmation_deadline_expires_a_team_match(self, _decision, _status, _received):
        original_booking = self.create_confirmed_booking(days=3, owner=self.host)
        data = self.challenge_data(request_id="reconfirmation-expiry")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": original_booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        replacement = self.create_confirmed_booking(days=4, start=time(19, 0), end=time(21, 0), owner=self.host)
        reschedule_challenge(
            challenge.pk,
            self.host,
            {"booking": replacement, "response_deadline": timezone.now() + timedelta(hours=2)},
        )
        TeamChallenge.objects.filter(pk=challenge.pk).update(
            reconfirmation_deadline=timezone.now() - timedelta(minutes=1),
        )

        expired = expire_team_challenges(now=timezone.now())
        challenge.refresh_from_db()

        self.assertEqual(expired, 1)
        self.assertEqual(challenge.status, TeamChallenge.Status.EXPIRED)
        self.assertEqual(challenge.fixture.status, TeamFixture.Status.CANCELLED)

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_fixture_attendance_result_confirmation_creates_verified_rating_eligibility(self, _decision, _status, _received):
        team_member = self.create_player("fixture-member@example.com", "Fixture Member")
        TeamMember.objects.create(
            team=self.host_team,
            user=team_member,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BOWLER,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        booking = self.create_confirmed_booking(days=3, owner=self.host)
        data = self.challenge_data(request_id="fixture-flow")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        fixture = challenge.fixture
        host_lineup = add_fixture_participant(fixture.id, self.host, team_member.id)
        opponent_lineup = add_fixture_participant(fixture.id, self.opponent, self.opponent.id)

        synchronize_confirmed_team_challenges(now=timezone.now() + timedelta(days=4), notify=False)
        record_fixture_attendance(fixture.id, host_lineup.id, self.host, "ATTENDED")
        record_fixture_attendance(fixture.id, opponent_lineup.id, self.opponent, "ATTENDED")
        submit_fixture_result(fixture.id, self.host, "Host Team won by 4 wickets")
        with self.assertRaises(ValidationError):
            submit_fixture_result(fixture.id, self.opponent, "Opponent Team won by 2 runs")
        confirm_fixture_result(fixture.id, self.opponent)

        self.assertEqual(
            PlayerRatingEligibility.objects.filter(
                related_entity_type="team_fixture",
                related_entity_id=fixture.id,
            ).count(),
            2,
        )

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_selected_fixture_participant_counts_as_a_schedule_commitment(self, _decision, _status, _received):
        team_member = self.create_player("fixture-overlap@example.com", "Fixture Overlap")
        TeamMember.objects.create(
            team=self.host_team,
            user=team_member,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BOWLER,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        booking = self.create_confirmed_booking(days=3, owner=self.host)
        data = self.challenge_data(request_id="fixture-overlap")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")
        fixture_participant = add_fixture_participant(challenge.fixture.id, self.host, team_member.id)

        self.assertEqual(fixture_participant.status, TeamFixtureParticipant.Status.SELECTED)
        self.assertTrue(
            player_has_overlapping_commitment(
                team_member,
                get_booking_start_at(booking),
                booking_end_at(booking),
            )
        )

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    def test_active_challenge_closes_when_a_team_loses_its_active_captain(self, _status, _received):
        challenge = create_challenge(self.challenge_data(request_id="captain-continuity"), self.host)
        TeamMember.objects.filter(team=self.host_team, user=self.host).update(
            status=TeamMember.MemberStatus.REMOVED,
        )

        changed = synchronize_team_challenge_captains(notify=True)
        challenge.refresh_from_db()

        self.assertEqual(changed, 1)
        self.assertEqual(challenge.status, TeamChallenge.Status.CANCELLED)
        self.assertFalse(challenge.is_public)

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_fixture_room_is_limited_to_captains_and_selected_players(self, _decision, _status, _received):
        booking = self.create_confirmed_booking(days=3, owner=self.host)
        data = self.challenge_data(request_id="fixture-room-access")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        room = get_challenge_fixture_room(challenge.pk, self.host)
        self.assertEqual(room.pk, challenge.fixture.pk)
        with self.assertRaises(ValidationError):
            get_challenge_fixture_room(challenge.pk, self.member)

        TeamMember.objects.create(
            team=self.host_team,
            user=self.member,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BATSMAN,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        add_fixture_participant(challenge.fixture.id, self.host, self.member.id)
        participant_room = get_challenge_fixture_room(challenge.pk, self.member)
        self.assertEqual(participant_room.pk, room.pk)

    @patch("team_challenges.services.notify_challenge_received")
    @patch("team_challenges.services.notify_challenge_status")
    @patch("team_challenges.services.notify_challenge_decision")
    def test_captain_can_add_a_lineup_player_through_the_api(self, _decision, _status, _received):
        team_member = self.create_player("lineup-api-member@example.com", "Lineup API Member")
        TeamMember.objects.create(
            team=self.host_team,
            user=team_member,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BOWLER,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        booking = self.create_confirmed_booking(days=3)
        data = self.challenge_data(request_id="lineup-api")
        data.update({"court_mode": TeamChallenge.CourtMode.BOOKING_FIRST, "booking": booking, "booking_deadline": None})
        challenge = create_challenge(data, self.host)
        decide_challenge(challenge.pk, self.opponent, "ACCEPT")

        client = APIClient()
        client.force_authenticate(self.host)
        response = client.post(
            f"/api/team-challenges/fixtures/{challenge.fixture.id}/participants/",
            {"player_id": team_member.id},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIn("fixture", response.data)
        self.assertEqual(response.data["fixture"]["participants"][0]["player"], team_member.id)
        self.assertTrue(
            TeamFixtureParticipant.objects.filter(
                fixture=challenge.fixture,
                player=team_member,
                status=TeamFixtureParticipant.Status.SELECTED,
            ).exists()
        )
