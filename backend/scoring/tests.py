from datetime import time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Notification
from players.models import PlayerProfile
from team_challenges.models import TeamChallenge, TeamFixture, TeamFixtureParticipant
from team_challenges.services import submit_fixture_result
from teams.models import Team, TeamMember
from venues.models import Booking, Court, CourtSlot, Venue

from .models import CricketDelivery, CricketInnings, CricketMatch, CricketPlayerPerformance, ScoringMatchRequest
from .services import (
    accept_scoring_match_request,
    choose_next_bowler,
    confirm_team_squad,
    create_or_update_scorecard,
    edit_last_delivery,
    get_scorecard_for_fixture,
    record_delivery,
    record_toss,
    send_scoring_match_request,
    start_innings,
    undo_last_delivery,
)


class CricketScoringServiceTests(TestCase):
    def setUp(self):
        self.home_captain = self.create_player("home-captain@example.com", "Home Captain")
        self.home_one = self.create_player("home-one@example.com", "Home One")
        self.home_two = self.create_player("home-two@example.com", "Home Two")
        self.away_captain = self.create_player("away-captain@example.com", "Away Captain")
        self.away_one = self.create_player("away-one@example.com", "Away One")
        self.away_two = self.create_player("away-two@example.com", "Away Two")
        self.spectator = self.create_player("spectator@example.com", "Spectator")
        self.home_team = self.create_team("Home XI", self.home_captain)
        self.away_team = self.create_team("Away XI", self.away_captain)
        self.add_member(self.home_team, self.home_one)
        self.add_member(self.home_team, self.home_two)
        self.add_member(self.away_team, self.away_one)
        self.add_member(self.away_team, self.away_two)
        self.challenge = TeamChallenge.objects.create(
            challenger_team=self.home_team,
            challenged_team=self.away_team,
            created_by=self.home_captain,
            challenge_type=TeamChallenge.ChallengeType.DIRECT,
            court_mode=TeamChallenge.CourtMode.PLAN_FIRST,
            status=TeamChallenge.Status.CONFIRMED,
            response_deadline=timezone.now() + timedelta(days=1),
        )
        venue_owner = get_user_model().objects.create_user(
            email="scoring-venue-owner@example.com",
            password="test-password",
            full_name="Scoring Venue Owner",
            phone="9800001000",
            role="COURT_OWNER",
            email_verified=True,
        )
        venue = Venue.objects.create(
            owner=venue_owner,
            name="Scoring Test Ground",
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
            date=timezone.localdate() + timedelta(days=2),
            start_time=time(18, 0),
            end_time=time(19, 0),
            price=Decimal("1500"),
            status=CourtSlot.Status.BOOKED,
        )
        booking = Booking.objects.create(
            player=self.home_captain,
            venue=venue,
            court=court,
            slot=slot,
            amount=Decimal("1500"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            confirmed_at=timezone.now(),
            reserved_until=timezone.now() + timedelta(minutes=10),
        )
        self.fixture = TeamFixture.objects.create(
            challenge=self.challenge,
            booking=booking,
            status=TeamFixture.Status.SCHEDULED,
        )
        self.participants = {}
        for team, captain, players in (
            (self.home_team, self.home_captain, [self.home_captain, self.home_one, self.home_two]),
            (self.away_team, self.away_captain, [self.away_captain, self.away_one, self.away_two]),
        ):
            for player in players:
                self.participants[player.id] = TeamFixtureParticipant.objects.create(
                    fixture=self.fixture,
                    team=team,
                    player=player,
                    selected_by=captain,
                )

    def create_player(self, email, name):
        player = get_user_model().objects.create_user(
            email=email,
            password="test-password",
            full_name=name,
            phone="9800000000",
            role="PLAYER",
            email_verified=True,
        )
        PlayerProfile.objects.create(
            user=player,
            preferred_sport=PlayerProfile.PreferredSport.CRICKSAL,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            preferred_cricksal_role=PlayerProfile.CricksalRole.ALL_ROUNDER,
        )
        return player

    def create_team(self, name, captain):
        team = Team.objects.create(
            name=name,
            description="Test cricket team",
            location="Kathmandu",
            preferred_playing_area="Maitidevi",
            preferred_playing_time="Evening",
            skill_level=Team.SkillLevel.INTERMEDIATE,
            captain=captain,
        )
        self.add_member(team, captain, TeamMember.TeamRole.CAPTAIN)
        return team

    def add_member(self, team, player, role=TeamMember.TeamRole.PLAYER):
        TeamMember.objects.create(
            team=team,
            user=player,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=role,
            cricksal_role=TeamMember.CricksalRole.ALL_ROUNDER,
            status=TeamMember.MemberStatus.ACTIVE,
        )

    def setup_started_innings(self, overs=1):
        match = create_or_update_scorecard(self.fixture.id, self.home_captain, overs)
        confirm_team_squad(
            self.fixture.id,
            self.home_captain,
            [self.home_captain.id, self.home_one.id, self.home_two.id],
        )
        confirm_team_squad(
            self.fixture.id,
            self.away_captain,
            [self.away_captain.id, self.away_one.id, self.away_two.id],
        )
        record_toss(self.fixture.id, self.home_captain, self.home_team.id, CricketMatch.TossDecision.BAT)
        match.refresh_from_db()
        players = {
            row.player_id: row.id
            for row in match.squad_players.all()
        }
        start_innings(
            self.fixture.id,
            self.home_captain,
            players[self.home_captain.id],
            players[self.home_one.id],
            players[self.away_captain.id],
        )
        return match, players

    def test_wides_are_not_legal_balls_and_completed_score_keeps_attendance_neutral(self):
        match, players = self.setup_started_innings()

        record_delivery(
            self.fixture.id,
            self.home_captain,
            {"extra_type": CricketDelivery.ExtraType.WIDE, "extra_runs": 1},
        )
        for _ in range(6):
            record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 0})

        first = CricketInnings.objects.get(match=match, number=1)
        self.assertEqual(first.total_runs, 1)
        self.assertEqual(first.wide_runs, 1)
        self.assertEqual(first.legal_balls, 6)
        self.assertEqual(first.status, CricketInnings.Status.COMPLETED)
        self.assertEqual(match.innings.count(), 1)

        start_innings(
            self.fixture.id,
            self.home_captain,
            players[self.away_captain.id],
            players[self.away_one.id],
            players[self.home_captain.id],
        )
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 1})
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 1})

        match.refresh_from_db()
        self.fixture.refresh_from_db()
        self.assertEqual(match.status, CricketMatch.Status.COMPLETED)
        self.assertEqual(self.fixture.status, TeamFixture.Status.COMPLETED)
        self.assertIn("Away XI won by 2 wickets", match.result)
        self.assertEqual(self.fixture.result, match.result)
        self.assertIsNone(self.fixture.result_submitted_by)
        self.assertEqual(
            TeamFixtureParticipant.objects.filter(fixture=self.fixture, status=TeamFixtureParticipant.Status.SELECTED).count(),
            6,
        )
        self.home_captain.player_profile.refresh_from_db()
        self.assertEqual(self.home_captain.player_profile.completed_matches_count, 0)
        self.assertEqual(CricketPlayerPerformance.objects.filter(match=match).count(), 6)
        captain_performance = CricketPlayerPerformance.objects.get(match=match, player=self.home_captain)
        self.assertEqual(captain_performance.balls_bowled, 2)

        profile_client = APIClient()
        profile_client.force_authenticate(self.home_captain)
        profile_response = profile_client.get("/api/players/profile/")
        self.assertEqual(profile_response.status_code, 200, profile_response.data)
        cricket_summary = profile_response.data["profile"]["cricket_summary"]
        self.assertEqual(cricket_summary["matches"], 1)
        self.assertEqual(cricket_summary["total_runs"], 0)
        self.assertEqual(cricket_summary["wickets"], 0)

        submitted = submit_fixture_result(self.fixture.id, self.home_captain, match.result)
        self.assertEqual(submitted.result_submitted_by, self.home_captain)
        with self.assertRaisesMessage(ValidationError, "cannot be overwritten"):
            submit_fixture_result(self.fixture.id, self.home_captain, "Different winner")

    def test_my_performance_api_uses_only_finalized_scorecards_and_drops_reopened_corrections(self):
        match, players = self.setup_started_innings()
        record_delivery(
            self.fixture.id,
            self.home_captain,
            {"extra_type": CricketDelivery.ExtraType.WIDE, "extra_runs": 1},
        )
        for _ in range(6):
            record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 0})

        start_innings(
            self.fixture.id,
            self.home_captain,
            players[self.away_captain.id],
            players[self.away_one.id],
            players[self.home_captain.id],
        )
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 1})
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 1})
        match.refresh_from_db()
        self.assertEqual(match.status, CricketMatch.Status.COMPLETED)

        client = APIClient()
        client.force_authenticate(self.home_captain)
        response = client.get("/api/scoring/my-performance/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["summary"], {
            "matches": 1,
            "batting_innings": 1,
            "bowling_innings": 1,
            "not_outs": 1,
        })
        self.assertEqual(response.data["batting"]["balls"], 6)
        self.assertEqual(response.data["batting"]["average"], None)
        self.assertEqual(response.data["bowling"]["legal_balls"], 2)
        self.assertEqual(response.data["bowling"]["runs_conceded"], 2)
        self.assertEqual(response.data["history"]["total"], 1)
        self.assertEqual(response.data["recent_form"][0]["batting"]["not_out"], True)
        self.assertEqual(response.data["recent_form"][0]["bowling"]["wickets"], 0)

        scorecard_response = client.get(f"/api/scoring/fixtures/{self.fixture.id}/")
        self.assertEqual(scorecard_response.status_code, 200, scorecard_response.data)
        self.assertEqual(scorecard_response.data["scorecard"]["status"], CricketMatch.Status.COMPLETED)
        self.assertEqual(len(scorecard_response.data["scorecard"]["innings"]), 2)

        spectator_client = APIClient()
        spectator_client.force_authenticate(self.spectator)
        spectator_response = spectator_client.get("/api/scoring/my-performance/")
        self.assertEqual(spectator_response.status_code, 200, spectator_response.data)
        self.assertEqual(spectator_response.data["summary"]["matches"], 0)

        edit_last_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 0})
        self.assertEqual(CricketPlayerPerformance.objects.filter(match=match).count(), 0)
        corrected_response = client.get("/api/scoring/my-performance/")
        self.assertEqual(corrected_response.status_code, 200, corrected_response.data)
        self.assertEqual(corrected_response.data["summary"]["matches"], 0)

    def test_team_record_uses_completed_scorecards_and_drops_reopened_corrections(self):
        match, players = self.setup_started_innings()
        for _ in range(6):
            record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 0})

        start_innings(
            self.fixture.id,
            self.home_captain,
            players[self.away_captain.id],
            players[self.away_one.id],
            players[self.home_captain.id],
        )
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 1})

        match.refresh_from_db()
        self.assertEqual(match.status, CricketMatch.Status.COMPLETED)

        client = APIClient()
        client.force_authenticate(self.home_captain)
        response = client.get(f"/api/teams/{self.home_team.id}/")

        self.assertEqual(response.status_code, 200, response.data)
        record = response.data["team"]["cricket_record"]
        self.assertEqual(record["matches_played"], 1)
        self.assertEqual(record["wins"], 0)
        self.assertEqual(record["losses"], 1)
        self.assertEqual(record["ties"], 0)
        self.assertEqual(record["runs_for"], 0)
        self.assertEqual(record["runs_against"], 1)
        self.assertEqual(record["recent_results"][0]["outcome"], "LOSS")

        edit_last_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 0})
        corrected_response = client.get(f"/api/teams/{self.home_team.id}/")

        self.assertEqual(corrected_response.status_code, 200, corrected_response.data)
        self.assertEqual(corrected_response.data["team"]["cricket_record"]["matches_played"], 0)

    def test_scorecard_snapshot_includes_team_logo_sources(self):
        self.home_team.team_photo = "team_photos/home-xi.png"
        self.home_team.save(update_fields=["team_photo"])
        self.away_team.team_photo = "team_photos/away-xi.png"
        self.away_team.save(update_fields=["team_photo"])
        match = create_or_update_scorecard(self.fixture.id, self.home_captain, 6)

        snapshot = get_scorecard_for_fixture(self.fixture.id, self.home_captain)
        team_photos = {team["id"]: team["team_photo"] for team in snapshot["teams"]}

        self.assertEqual(match.status, CricketMatch.Status.SETUP)
        self.assertEqual(team_photos[self.home_team.id], "/media/team_photos/home-xi.png")
        self.assertEqual(team_photos[self.away_team.id], "/media/team_photos/away-xi.png")

    def test_last_ball_edit_and_undo_replay_the_persisted_event_log(self):
        match, _players = self.setup_started_innings(overs=2)
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 4})
        record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 2})

        replacement = edit_last_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 1})
        innings = CricketInnings.objects.get(match=match, number=1)
        self.assertEqual(innings.total_runs, 5)
        self.assertEqual(innings.legal_balls, 2)
        self.assertEqual(CricketDelivery.objects.filter(innings=innings, is_active=True).count(), 2)
        self.assertEqual(CricketDelivery.objects.filter(innings=innings, is_active=False).count(), 1)
        self.assertIsNotNone(replacement.supersedes_id)

        undo_last_delivery(self.fixture.id, self.home_captain)
        innings.refresh_from_db()
        self.assertEqual(innings.total_runs, 4)
        self.assertEqual(innings.legal_balls, 1)
        self.assertEqual(CricketDelivery.objects.filter(innings=innings, is_active=True).count(), 1)

    def test_no_ball_only_allows_run_out_and_an_unassigned_viewer_cannot_score(self):
        self.setup_started_innings()
        with self.assertRaisesMessage(ValidationError, "Only a run out"):
            record_delivery(
                self.fixture.id,
                self.home_captain,
                {
                    "extra_type": CricketDelivery.ExtraType.NO_BALL,
                    "extra_runs": 1,
                    "wicket_kind": CricketDelivery.WicketKind.CAUGHT,
                    "dismissed_player_id": 1,
                },
            )
        with self.assertRaisesMessage(ValidationError, "Only the appointed scorer"):
            record_delivery(self.fixture.id, self.spectator, {"runs_off_bat": 1})

    def test_wicket_flow_replaces_the_batter_and_requires_a_new_bowler_after_an_over(self):
        match, players = self.setup_started_innings(overs=2)
        record_delivery(
            self.fixture.id,
            self.home_captain,
            {
                "wicket_kind": CricketDelivery.WicketKind.CAUGHT,
                "dismissed_player_id": players[self.home_captain.id],
                "fielder_id": players[self.away_one.id],
                "incoming_batsman_id": players[self.home_two.id],
            },
        )
        for _ in range(5):
            record_delivery(self.fixture.id, self.home_captain, {"runs_off_bat": 0})

        innings = CricketInnings.objects.get(match=match, number=1)
        self.assertEqual(innings.wickets, 1)
        self.assertEqual(innings.legal_balls, 6)
        self.assertIsNone(innings.current_bowler_id)
        self.assertEqual(innings.current_striker_id, players[self.home_one.id])
        self.assertEqual(innings.current_non_striker_id, players[self.home_two.id])
        with self.assertRaisesMessage(ValidationError, "different bowler"):
            choose_next_bowler(self.fixture.id, self.home_captain, players[self.away_captain.id])

        choose_next_bowler(self.fixture.id, self.home_captain, players[self.away_one.id])
        innings.refresh_from_db()
        self.assertEqual(innings.current_bowler_id, players[self.away_one.id])
        snapshot = get_scorecard_for_fixture(self.fixture.id, self.home_one)
        first_innings = snapshot["innings"][0]
        self.assertEqual(first_innings["fall_of_wickets"][0]["batter"], "Home Captain")
        self.assertEqual(first_innings["bowling"][0]["wickets"], 1)

    def test_final_wicket_records_without_an_incoming_batter_and_closes_the_innings(self):
        match, players = self.setup_started_innings(overs=2)
        record_delivery(
            self.fixture.id,
            self.home_captain,
            {
                "wicket_kind": CricketDelivery.WicketKind.BOWLED,
                "dismissed_player_id": players[self.home_captain.id],
                "incoming_batsman_id": players[self.home_two.id],
            },
        )

        record_delivery(
            self.fixture.id,
            self.home_captain,
            {
                "wicket_kind": CricketDelivery.WicketKind.BOWLED,
                "dismissed_player_id": players[self.home_two.id],
            },
        )

        innings = CricketInnings.objects.get(match=match, number=1)
        self.assertEqual(innings.wickets, 2)
        self.assertEqual(innings.status, CricketInnings.Status.COMPLETED)
        self.assertEqual(innings.closing_reason, CricketInnings.ClosingReason.ALL_OUT)
        self.assertIsNone(innings.current_striker_id)
        self.assertIsNone(innings.current_non_striker_id)
        self.assertIsNone(innings.current_bowler_id)

    def test_scorecard_api_returns_the_same_persisted_state_to_a_selected_player(self):
        self.setup_started_innings()
        client = APIClient()
        client.force_authenticate(self.home_one)

        response = client.get(f"/api/scoring/fixtures/{self.fixture.id}/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["scorecard"]["status"], CricketMatch.Status.INNINGS_ONE)
        self.assertTrue(response.data["scorecard"]["permissions"]["can_view"])
        self.assertFalse(response.data["scorecard"]["permissions"]["can_score"])

    def test_scorer_hub_returns_only_paid_confirmed_fixtures_for_the_player(self):
        client = APIClient()
        client.force_authenticate(self.home_captain)

        response = client.get("/api/scoring/fixtures/available/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["fixtures"]), 1)
        fixture = response.data["fixtures"][0]
        self.assertEqual(fixture["fixture_id"], self.fixture.id)
        self.assertTrue(fixture["can_set_up"])
        self.assertFalse(fixture["scorecard_available"])
        self.assertEqual(fixture["booking"]["payment_status"], Booking.PaymentStatus.PAID)

    def test_instant_scoring_request_acceptance_creates_a_booking_free_fixture(self):
        request, created = send_scoring_match_request(
            actor=self.home_captain,
            challenger_team_id=self.home_team.id,
            challenged_team_id=self.away_team.id,
            client_request_id="instant-first-match",
        )
        self.assertTrue(created)
        self.assertEqual(request.status, ScoringMatchRequest.Status.PENDING)

        accepted, changed = accept_scoring_match_request(request_id=request.id, actor=self.away_captain)

        self.assertTrue(changed)
        self.assertEqual(accepted.status, ScoringMatchRequest.Status.ACCEPTED)
        self.assertIsNotNone(accepted.fixture_id)
        fixture = accepted.fixture
        self.assertIsNone(fixture.booking_id)
        self.assertEqual(fixture.challenge.source, TeamChallenge.Source.INSTANT_SCORER)
        self.assertEqual(fixture.status, TeamFixture.Status.SCHEDULED)

        room_client = APIClient()
        room_client.force_authenticate(self.home_captain)
        room_response = room_client.get(f"/api/team-challenges/challenges/{fixture.challenge_id}/room/")
        self.assertEqual(room_response.status_code, 200, room_response.data)
        self.assertEqual(room_response.data["challenge"]["source"], TeamChallenge.Source.INSTANT_SCORER)

        match = create_or_update_scorecard(fixture.id, self.home_captain, 5)
        self.assertEqual(match.scorer_id, self.home_captain.id)
        confirm_team_squad(fixture.id, self.home_captain, [self.home_captain.id, self.home_one.id])
        confirm_team_squad(fixture.id, self.away_captain, [self.away_captain.id, self.away_one.id])
        self.assertEqual(TeamFixtureParticipant.objects.filter(fixture=fixture).count(), 4)
        with self.assertRaisesMessage(ValidationError, "appointed scorer"):
            record_toss(fixture.id, self.away_captain, self.away_team.id, CricketMatch.TossDecision.BAT)

    def test_instant_scoring_requests_allow_repeated_matches_between_the_same_teams(self):
        first, _created = send_scoring_match_request(
            actor=self.home_captain,
            challenger_team_id=self.home_team.id,
            challenged_team_id=self.away_team.id,
            client_request_id="instant-repeat-one",
        )
        accept_scoring_match_request(request_id=first.id, actor=self.away_captain)
        second, _created = send_scoring_match_request(
            actor=self.home_captain,
            challenger_team_id=self.home_team.id,
            challenged_team_id=self.away_team.id,
            client_request_id="instant-repeat-two",
        )
        accept_scoring_match_request(request_id=second.id, actor=self.away_captain)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertNotEqual(first.fixture_id, second.fixture_id)
        self.assertEqual(
            TeamFixture.objects.filter(challenge__source=TeamChallenge.Source.INSTANT_SCORER).count(),
            2,
        )

    def test_only_the_receiving_captain_can_decide_an_instant_scoring_request(self):
        request, _created = send_scoring_match_request(
            actor=self.home_captain,
            challenger_team_id=self.home_team.id,
            challenged_team_id=self.away_team.id,
            client_request_id="instant-decision-permission",
        )
        with self.assertRaisesMessage(ValidationError, "actively captain"):
            accept_scoring_match_request(request_id=request.id, actor=self.away_one)

        client = APIClient()
        client.force_authenticate(self.away_captain)
        declined = client.post(f"/api/scoring/match-requests/{request.id}/decline/", format="json")
        self.assertEqual(declined.status_code, 200, declined.data)
        self.assertEqual(declined.data["status"], ScoringMatchRequest.Status.DECLINED)
        request.refresh_from_db()
        self.assertIsNone(request.fixture_id)

    def test_sending_captain_can_withdraw_a_pending_instant_scoring_request(self):
        request, _created = send_scoring_match_request(
            actor=self.home_captain,
            challenger_team_id=self.home_team.id,
            challenged_team_id=self.away_team.id,
            client_request_id="instant-withdraw",
        )
        client = APIClient()
        client.force_authenticate(self.home_captain)

        withdrawn = client.post(f"/api/scoring/match-requests/{request.id}/cancel/", format="json")

        self.assertEqual(withdrawn.status_code, 200, withdrawn.data)
        self.assertEqual(withdrawn.data["status"], ScoringMatchRequest.Status.CANCELLED)
        request.refresh_from_db()
        self.assertIsNone(request.fixture_id)
        notification = Notification.objects.get(
            related_entity_type="scoring_match_request",
            related_entity_id=request.id,
        )
        self.assertFalse(notification.action_required)
        self.assertEqual(notification.action_status, Notification.ActionStatus.CANCELLED)
        replacement, created = send_scoring_match_request(
            actor=self.home_captain,
            challenger_team_id=self.home_team.id,
            challenged_team_id=self.away_team.id,
            client_request_id="instant-withdraw-replacement",
        )
        self.assertTrue(created)
        self.assertEqual(replacement.status, ScoringMatchRequest.Status.PENDING)

    def test_instant_request_api_exposes_captain_decision_and_ready_fixture(self):
        client = APIClient()
        client.force_authenticate(self.home_captain)
        teams = client.get("/api/scoring/teams/?search=Away")
        self.assertEqual(teams.status_code, 200, teams.data)
        self.assertEqual(teams.data["my_teams"][0]["id"], self.home_team.id)
        self.assertEqual(teams.data["opponents"][0]["id"], self.away_team.id)
        created = client.post(
            "/api/scoring/match-requests/",
            {
                "challenger_team_id": self.home_team.id,
                "challenged_team_id": self.away_team.id,
                "client_request_id": "instant-api-request",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        request_id = created.data["request"]["id"]

        client.force_authenticate(self.away_captain)
        incoming = client.get("/api/scoring/match-requests/")
        self.assertEqual(incoming.status_code, 200, incoming.data)
        self.assertEqual(incoming.data["incoming"][0]["id"], request_id)
        self.assertTrue(incoming.data["incoming"][0]["can_accept_or_decline"])

        accepted = client.post(f"/api/scoring/match-requests/{request_id}/accept/", format="json")
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(accepted.data["status"], ScoringMatchRequest.Status.ACCEPTED)
        fixture_id = accepted.data["fixture_id"]

        client.force_authenticate(self.home_captain)
        hub = client.get("/api/scoring/fixtures/available/")
        instant_fixture = next(item for item in hub.data["fixtures"] if item["fixture_id"] == fixture_id)
        self.assertEqual(instant_fixture["match_source"], TeamChallenge.Source.INSTANT_SCORER)
        self.assertIsNone(instant_fixture["booking"])
