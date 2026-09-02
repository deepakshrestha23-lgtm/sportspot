from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from sportspot_api.maintenance import run_platform_maintenance

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.exceptions import ValidationError as DRFValidationError

from players.models import ParticipationCommitment, PlayerProfile, PlayerRatingEligibility
from teams.models import Team, TeamMember
from venues.models import Booking, Court, CourtSlot, Venue

from .models import Game, GameParticipant, GameRoleRequirement, JoinRequest, JoinRequestEvent
from .services import (
    attach_booking_to_game,
    cancel_games_for_booking,
    expire_matchmaking_deadlines,
    maybe_create_game_rating_eligibilities,
    player_has_overlapping_confirmed_game,
    record_game_attendance,
    synchronize_game_lifecycle,
)


class PickupGameApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="pickup-owner@example.com", password="test-password", full_name="Pickup Owner", phone="9800001000", role="COURT_OWNER"
        )
        self.host = self.create_player("pickup-host@example.com", "Pickup Host", "BATSMAN")
        self.player_one = self.create_player("pickup-one@example.com", "Player One", "BATSMAN")
        self.player_two = self.create_player("pickup-two@example.com", "Player Two", "BATSMAN")
        self.team = Team.objects.create(
            name="Kathmandu Warriors",
            description="Permanent Cricksal squad",
            location="Kathmandu",
            preferred_playing_area="Baneshwor",
            preferred_playing_time="Evening",
            skill_level=Team.SkillLevel.INTERMEDIATE,
            captain=self.host,
        )
        self.host_membership = TeamMember.objects.create(
            team=self.team,
            user=self.host,
            role_in_team=TeamMember.TeamRole.CAPTAIN,
            cricksal_role=TeamMember.CricksalRole.BATSMAN,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        self.member_membership = TeamMember.objects.create(
            team=self.team,
            user=self.player_one,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BOWLER,
            status=TeamMember.MemberStatus.ACTIVE,
        )
        self.venue = Venue.objects.create(owner=self.owner, name="NCS Indoor Cricksal", city="Kathmandu", area="Baneshwor", status=Venue.Status.APPROVED)
        self.court = Court.objects.create(venue=self.venue, name="Court 1", court_type=Court.CourtType.INDOOR, surface_type=Court.SurfaceType.TURF)
        self.slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=3),
            start_time=time(18, 0),
            end_time=time(19, 0),
            price=Decimal("1500"),
            status=CourtSlot.Status.BOOKED,
        )
        self.booking = Booking.objects.create(
            player=self.host,
            venue=self.venue,
            court=self.court,
            slot=self.slot,
            amount=Decimal("1500"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            confirmed_at=timezone.now(),
            reserved_until=timezone.now() + timedelta(minutes=10),
        )

    def create_player(self, email, name, role):
        user_model = get_user_model()
        user = user_model.objects.create_user(email=email, password="test-password", full_name=name, phone="9800000000", role="PLAYER", email_verified=True)
        PlayerProfile.objects.create(
            user=user,
            preferred_sport=PlayerProfile.PreferredSport.CRICKSAL,
            skill_level=PlayerProfile.SkillLevel.INTERMEDIATE,
            location="Kathmandu",
            preferred_cricksal_role=role,
        )
        return user

    def test_fill_squad_host_follows_a_valid_team_captain_change(self):
        game = Game.objects.create(
            game_type=Game.GameType.FILL_SQUAD,
            team=self.team,
            host=self.host,
            booking=self.booking,
            title="Captain handoff game",
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role=GameRoleRequirement.CricksalRole.BATSMAN,
        )

        self.team.captain = self.player_one
        self.team.save(update_fields=["captain", "updated_at"])
        synchronize_game_lifecycle(game)
        game.refresh_from_db()

        self.assertEqual(game.host_id, self.player_one.id)
        self.assertEqual(game.booking_id, self.booking.id)
        self.assertEqual(game.status, Game.Status.RECRUITING)

        self.client.force_authenticate(self.player_one)
        my_games = self.client.get(reverse("matchmaking-my-games"))
        self.assertEqual(my_games.status_code, 200, my_games.data)
        self.assertIn(game.id, [item["id"] for item in my_games.data["hosted"]])

        private_detail = self.client.get(reverse("matchmaking-game-manage", args=[game.id]))
        self.assertEqual(private_detail.status_code, 200, private_detail.data)

    def test_invalid_plan_first_times_return_json_validation_errors(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-games"),
            {
                "game_type": "PICKUP",
                "creation_mode": "PLAN_FIRST",
                "title": "Invalid time game",
                "proposed_date": (timezone.localdate() + timedelta(days=5)).isoformat(),
                "proposed_start_time": "20:00",
                "proposed_end_time": "18:00",
                "preferred_area": "Baneshwor",
                "booking_deadline": (timezone.now() + timedelta(days=2)).isoformat(),
                "recruitment_deadline": (timezone.now() + timedelta(days=4)).isoformat(),
                "total_capacity": 6,
                "minimum_players_to_proceed": 4,
                "role_requirements": [{"role": "ANY", "required_count": 5}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["proposed_end_time"][0], "The end time must be after the start time.")
        self.assertNotIn("<html", response.content.decode().lower())
        self.assertEqual(Game.objects.filter(title="Invalid time game").count(), 0)

    def test_plan_first_pickup_game_can_be_published_without_booking(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-games"),
            {
                "game_type": "PICKUP",
                "creation_mode": "PLAN_FIRST",
                "title": "Saturday pickup",
                "proposed_date": (timezone.localdate() + timedelta(days=5)).isoformat(),
                "proposed_start_time": "18:00",
                "proposed_end_time": "20:00",
                "preferred_area": "Baneshwor",
                "booking_deadline": (timezone.now() + timedelta(days=3)).isoformat(),
                "recruitment_deadline": (timezone.now() + timedelta(days=2)).isoformat(),
                "total_capacity": 6,
                "minimum_players_to_proceed": 4,
                "role_requirements": [{"role": "ANY", "required_count": 5}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        game = Game.objects.get(id=response.data["game"]["id"])
        self.assertIsNone(game.booking)
        self.assertEqual(game.creation_mode, Game.CreationMode.PLAN_FIRST)
        self.assertEqual(game.preferred_district, "Kathmandu")
        self.assertEqual(game.participants.get(user=self.host).status, GameParticipant.Status.PROVISIONAL)

    def test_plan_first_rejects_booking_deadline_before_recruitment_deadline(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-games"),
            {
                "game_type": "PICKUP",
                "creation_mode": "PLAN_FIRST",
                "title": "Impossible deadline order",
                "proposed_date": (timezone.localdate() + timedelta(days=5)).isoformat(),
                "proposed_start_time": "18:00",
                "proposed_end_time": "20:00",
                "preferred_area": "Baneshwor",
                "booking_deadline": (timezone.now() + timedelta(days=2)).isoformat(),
                "recruitment_deadline": (timezone.now() + timedelta(days=2, minutes=15)).isoformat(),
                "total_capacity": 6,
                "minimum_players_to_proceed": 4,
                "role_requirements": [{"role": "ANY", "required_count": 5}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["recruitment_deadline"][0], "Recruitment must close at least 30 minutes before the court-booking deadline.")
        self.assertFalse(Game.objects.filter(title="Impossible deadline order").exists())

    def test_plan_first_rejects_unsupported_area(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-games"),
            {
                "game_type": "PICKUP",
                "creation_mode": "PLAN_FIRST",
                "title": "Unsupported area game",
                "proposed_date": (timezone.localdate() + timedelta(days=5)).isoformat(),
                "proposed_start_time": "18:00",
                "proposed_end_time": "20:00",
                "preferred_area": "Somewhere else",
                "booking_deadline": (timezone.now() + timedelta(days=3)).isoformat(),
                "recruitment_deadline": (timezone.now() + timedelta(days=2)).isoformat(),
                "total_capacity": 6,
                "minimum_players_to_proceed": 4,
                "role_requirements": [{"role": "ANY", "required_count": 5}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["preferred_area"][0], "Choose an area from the supported SportSpot locations.")
        self.assertFalse(Game.objects.filter(title="Unsupported area game").exists())

    def test_captain_can_publish_fill_my_squad_with_selected_permanent_members(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-games"),
            {
                "game_type": "FILL_SQUAD",
                "team_id": self.team.id,
                "selected_team_member_ids": [self.member_membership.id],
                "creation_mode": "BOOKING_FIRST",
                "booking_id": self.booking.id,
                "title": "Warriors need bowlers",
                "total_capacity": 5,
                "minimum_players_to_proceed": 4,
                "role_requirements": [{"role": "BOWLER", "required_count": 2}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        game = Game.objects.get(id=response.data["game"]["id"])
        self.assertEqual(game.game_type, Game.GameType.FILL_SQUAD)
        self.assertEqual(game.team, self.team)
        self.assertTrue(GameParticipant.objects.filter(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST).exists())
        self.assertTrue(GameParticipant.objects.filter(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEAM_MEMBER).exists())

    def test_normal_team_member_cannot_create_fill_my_squad_for_team(self):
        self.client.force_authenticate(self.player_one)
        response = self.client.post(
            reverse("matchmaking-games"),
            {
                "game_type": "FILL_SQUAD",
                "team_id": self.team.id,
                "creation_mode": "PLAN_FIRST",
                "title": "Member should not recruit",
                "proposed_date": (timezone.localdate() + timedelta(days=5)).isoformat(),
                "proposed_start_time": "18:00",
                "proposed_end_time": "20:00",
                "preferred_area": "Baneshwor",
                "total_capacity": 6,
                "minimum_players_to_proceed": 4,
                "role_requirements": [{"role": "ANY", "required_count": 5}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_permanent_team_member_cannot_request_temporary_fill_squad_spot(self):
        game = Game.objects.create(game_type=Game.GameType.FILL_SQUAD, team=self.team, host=self.host, booking=self.booking, title="Team listing", total_capacity=5, minimum_players_to_proceed=4)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.BOWLER, required_count=2)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="BATSMAN")

        self.client.force_authenticate(self.player_one)
        response = self.client.post(reverse("matchmaking-game-request", args=[game.id]), {"requested_role": "BOWLER", "attendance_confirmed": True}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("temporary outside players", response.data["requested_role"][0] if isinstance(response.data, dict) and "requested_role" in response.data else str(response.data))

    def test_fill_squad_accepts_outside_player_without_team_membership(self):
        game = Game.objects.create(game_type=Game.GameType.FILL_SQUAD, team=self.team, host=self.host, booking=self.booking, title="Temporary recruit", total_capacity=4, minimum_players_to_proceed=3)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=2)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="BATSMAN")
        JoinRequest.objects.create(game=game, player=self.player_two, requested_role="ANY", attendance_confirmed=True)

        self.client.force_authenticate(self.host)
        response = self.client.post(reverse("matchmaking-request-decision", args=[JoinRequest.objects.get(player=self.player_two).id]), {"decision": "ACCEPT"}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(GameParticipant.objects.filter(game=game, user=self.player_two, participant_type=GameParticipant.ParticipantType.TEMPORARY).exists())
        self.assertFalse(TeamMember.objects.filter(team=self.team, user=self.player_two, status=TeamMember.MemberStatus.ACTIVE).exists())

    def test_strict_role_cannot_be_overfilled(self):
        game = Game.objects.create(host=self.host, booking=self.booking, title="Role capped pickup", total_capacity=3, minimum_players_to_proceed=2)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.BATSMAN, required_count=1)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=1)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")

        self.client.force_authenticate(self.player_one)
        request_response = self.client.post(reverse("matchmaking-game-request", args=[game.id]), {"requested_role": "BATSMAN", "attendance_confirmed": True}, format="json")
        self.assertEqual(request_response.status_code, 201, request_response.data)
        self.client.force_authenticate(self.host)
        decision_response = self.client.post(reverse("matchmaking-request-decision", args=[request_response.data["request"]["id"]]), {"decision": "ACCEPT"}, format="json")
        self.assertEqual(decision_response.status_code, 200, decision_response.data)

        self.client.force_authenticate(self.player_two)
        blocked_response = self.client.post(reverse("matchmaking-game-request", args=[game.id]), {"requested_role": "BATSMAN", "attendance_confirmed": True}, format="json")
        self.assertEqual(blocked_response.status_code, 400)

    def test_full_game_accepts_waitlist_request_when_enabled(self):
        game = Game.objects.create(host=self.host, booking=self.booking, title="Waitlist pickup", total_capacity=2, minimum_players_to_proceed=2, waitlist_enabled=True)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=1)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        JoinRequest.objects.create(game=game, player=self.player_one, requested_role="ANY", attendance_confirmed=True)
        self.client.force_authenticate(self.host)
        self.client.post(reverse("matchmaking-request-decision", args=[JoinRequest.objects.get(player=self.player_one).id]), {"decision": "ACCEPT"}, format="json")
        game.refresh_status()
        self.assertEqual(game.status, Game.Status.FULL)

        self.client.force_authenticate(self.player_two)
        response = self.client.post(reverse("matchmaking-game-request", args=[game.id]), {"requested_role": "ANY", "attendance_confirmed": True}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["request"]["status"], JoinRequest.Status.WAITLISTED)
        self.assertEqual(response.data["request"]["waitlist_position"], 1)



    def test_host_can_add_guest_player_without_server_error(self):
        game = Game.objects.create(host=self.host, booking=self.booking, title="Guest friendly pickup", total_capacity=4, minimum_players_to_proceed=2)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")

        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-game-guests", args=[game.id]),
            {"guest_name": "Ramesh Guest", "role": "ANY"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(GameParticipant.objects.filter(game=game, participant_type=GameParticipant.ParticipantType.GUEST).count(), 1)

    def test_host_can_invite_registered_player_by_sportspot_id_and_player_accepts(self):
        game = Game.objects.create(host=self.host, booking=self.booking, title="Invite pickup", total_capacity=4, minimum_players_to_proceed=2)
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        sportspot_id = self.player_one.player_profile.sportspot_id

        self.client.force_authenticate(self.host)
        invite_response = self.client.post(
            reverse("matchmaking-game-invite", args=[game.id]),
            {"sportspot_id": sportspot_id, "requested_role": "ANY", "message": "Join us if you are free."},
            format="json",
        )

        self.assertEqual(invite_response.status_code, 201, invite_response.data)
        request_id = invite_response.data["request"]["id"]
        self.assertEqual(invite_response.data["request"]["status"], JoinRequest.Status.INVITED)

        self.client.force_authenticate(self.player_one)
        accept_response = self.client.post(
            reverse("matchmaking-request-respond-invitation", args=[request_id]),
            {"response": "ACCEPT"},
            format="json",
        )

        self.assertEqual(accept_response.status_code, 200, accept_response.data)
        self.assertEqual(accept_response.data["request"]["status"], JoinRequest.Status.ACCEPTED)
        self.assertTrue(GameParticipant.objects.filter(game=game, user=self.player_one, status=GameParticipant.Status.CONFIRMED).exists())

    def test_duplicate_registered_invitation_is_rejected(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Duplicate invite guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")

        self.client.force_authenticate(self.host)
        payload = {"sportspot_id": self.player_one.player_profile.sportspot_id, "requested_role": "ANY"}
        first = self.client.post(reverse("matchmaking-game-invite", args=[game.id]), payload, format="json")
        second = self.client.post(reverse("matchmaking-game-invite", args=[game.id]), payload, format="json")

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 400, second.data)
        self.assertEqual(JoinRequest.objects.filter(game=game, player=self.player_one).count(), 1)

    def test_invitations_cannot_be_sent_after_recruitment_deadline(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Closed invitation test",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() - timedelta(minutes=1),
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=3)
        GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
        )

        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-game-invite", args=[game.id]),
            {"sportspot_id": self.player_one.player_profile.sportspot_id, "requested_role": "ANY"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(JoinRequest.objects.filter(game=game, player=self.player_one).exists())

    def test_maintenance_recovers_cancelled_game_requests_and_is_idempotent(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Cancelled maintenance test",
            status=Game.Status.CANCELLED,
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        request = JoinRequest.objects.create(
            game=game,
            player=self.player_one,
            requested_role="ANY",
            attendance_confirmed=True,
        )

        first = expire_matchmaking_deadlines()
        request.refresh_from_db()
        self.assertEqual(request.status, JoinRequest.Status.EXPIRED)
        self.assertGreaterEqual(first["requests_expired"], 1)

        second = expire_matchmaking_deadlines()
        self.assertEqual(second["requests_expired"], 0)

    def test_maintenance_batch_only_processes_due_games(self):
        future_game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Future game should wait",
            recruitment_deadline=timezone.now() + timedelta(days=1),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        expired_game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Expired game should run",
            proposed_date=timezone.localdate() + timedelta(days=2),
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() - timedelta(minutes=1),
            recruitment_deadline=timezone.now() - timedelta(minutes=32),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )

        stats = expire_matchmaking_deadlines(limit=1)

        future_game.refresh_from_db()
        expired_game.refresh_from_db()
        self.assertEqual(future_game.status, Game.Status.RECRUITING)
        self.assertEqual(expired_game.status, Game.Status.CANCELLED)
        self.assertGreaterEqual(stats["games_cancelled"], 1)
    def test_invitation_cannot_be_accepted_after_recruitment_deadline(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Expired invitation guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() - timedelta(minutes=1),
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        invitation = JoinRequest.objects.create(
            game=game,
            player=self.player_one,
            requested_role="ANY",
            attendance_confirmed=False,
            status=JoinRequest.Status.INVITED,
            decided_by=self.host,
            decided_at=timezone.now() - timedelta(minutes=2),
        )

        self.client.force_authenticate(self.player_one)
        response = self.client.post(
            reverse("matchmaking-request-respond-invitation", args=[invitation.id]),
            {"response": "ACCEPT"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["request"]["status"], JoinRequest.Status.EXPIRED)
        self.assertFalse(GameParticipant.objects.filter(game=game, user=self.player_one).exists())

    def test_waitlist_positions_are_resequenced_when_a_player_leaves_the_queue(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Waitlist ordering guard",
            total_capacity=2,
            minimum_players_to_proceed=2,
            waitlist_enabled=True,
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=1)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        first_request = JoinRequest.objects.create(
            game=game,
            player=self.player_one,
            requested_role="ANY",
            attendance_confirmed=True,
            status=JoinRequest.Status.ACCEPTED,
        )
        GameParticipant.objects.create(
            game=game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEMPORARY,
            role="ANY",
        )
        game.refresh_status()

        self.client.force_authenticate(self.player_two)
        response = self.client.post(
            reverse("matchmaking-game-request", args=[game.id]),
            {"requested_role": "ANY", "attendance_confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        waitlisted = JoinRequest.objects.get(game=game, player=self.player_two)
        self.assertEqual(waitlisted.waitlist_position, 1)

        waitlisted.status = JoinRequest.Status.REJECTED
        waitlisted.waitlist_position = None
        waitlisted.save(update_fields=["status", "waitlist_position", "updated_at"])

        player_three = self.create_player("pickup-three@example.com", "Player Three", "ALL_ROUNDER")
        self.client.force_authenticate(player_three)
        next_response = self.client.post(
            reverse("matchmaking-game-request", args=[game.id]),
            {"requested_role": "ANY", "attendance_confirmed": True},
            format="json",
        )
        self.assertEqual(next_response.status_code, 201, next_response.data)
        self.assertEqual(next_response.data["request"]["waitlist_position"], 1)

    def test_public_game_details_do_not_expose_registered_account_details(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Public privacy guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")

        response = self.client.get(reverse("matchmaking-game-detail", args=[game.id]))

        self.assertEqual(response.status_code, 200, response.data)
        participant = response.data["game"]["participants"][0]
        self.assertNotIn("user", participant)
        self.assertNotIn("sportspot_id", participant)
        self.assertNotIn("reliability_label", participant)
        self.assertNotIn("average_rating", participant)

    def test_public_discovery_excludes_games_after_recruitment_deadline(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Closed game must leave discovery",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() - timedelta(minutes=5),
        )

        response = self.client.get(reverse("matchmaking-games"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn(game.id, {item["id"] for item in response.data["games"]})
        game.refresh_from_db()
        self.assertEqual(game.status, Game.Status.CLOSED)

    def test_recommended_discovery_ranks_profile_fit_and_excludes_incompatible_skill(self):
        profile = self.player_one.player_profile
        recommended_date = timezone.localdate() + timedelta(days=5)
        profile.availability_days = [
            ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")[recommended_date.weekday()]
        ]
        profile.availability_time_periods = ["EVENING"]
        profile.preferred_cricksal_role = "BATSMAN"
        profile.save(update_fields=["availability_days", "availability_time_periods", "preferred_cricksal_role", "updated_at"])

        recommended = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Profile fit game",
            proposed_date=recommended_date,
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_district="Kathmandu",
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=2),
            recruitment_deadline=timezone.now() + timedelta(days=1),
            min_skill_level=Game.SkillLevel.INTERMEDIATE,
            total_capacity=6,
            minimum_players_to_proceed=4,
        )
        GameRoleRequirement.objects.create(game=recommended, role="BATSMAN", required_count=2)

        incompatible = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Advanced game should not be recommended",
            proposed_date=recommended_date,
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_district="Kathmandu",
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=2),
            recruitment_deadline=timezone.now() + timedelta(days=1),
            min_skill_level=Game.SkillLevel.ADVANCED,
            total_capacity=6,
            minimum_players_to_proceed=4,
        )
        GameRoleRequirement.objects.create(game=incompatible, role="BATSMAN", required_count=2)

        self.client.force_authenticate(self.player_one)
        response = self.client.get(reverse("matchmaking-games"), {"sort": "recommended"})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["recommendation"]["available"])
        self.assertIn("profile fit game", {item["title"].lower() for item in response.data["games"]})
        self.assertNotIn(incompatible.id, {item["id"] for item in response.data["games"]})
        profile_item = next(item for item in response.data["games"] if item["id"] == recommended.id)
        self.assertEqual(profile_item["recommendation"]["fit_label"], "Strong fit")
        self.assertIn("Fits your availability", profile_item["recommendation"]["reasons"])
        self.assertIn("In your preferred district", profile_item["recommendation"]["reasons"])

    def test_default_discovery_response_has_no_recommendation_mode_metadata(self):
        self.client.force_authenticate(self.player_one)
        response = self.client.get(reverse("matchmaking-games"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("recommendation", response.data)

    def test_my_games_synchronizes_expired_requests_inside_a_transaction(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="My games lifecycle repair",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() - timedelta(minutes=5),
        )
        GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
        )
        pending = JoinRequest.objects.create(
            game=game,
            player=self.player_one,
            requested_role="ANY",
            attendance_confirmed=True,
        )

        self.client.force_authenticate(self.host)
        response = self.client.get(reverse("matchmaking-my-games"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("upcoming", response.data)
        self.assertIn("hosted", response.data)
        self.assertNotIn("<!doctype html", response.content.decode().lower())
        pending.refresh_from_db()
        self.assertEqual(pending.status, JoinRequest.Status.EXPIRED)

    def test_private_game_details_are_hidden_from_unauthorized_users(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Private game access guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
            is_public=False,
        )

        anonymous_response = self.client.get(reverse("matchmaking-game-detail", args=[game.id]))
        self.assertEqual(anonymous_response.status_code, 404)

        self.client.force_authenticate(self.player_one)
        unauthorized_response = self.client.get(reverse("matchmaking-game-detail", args=[game.id]))
        self.assertEqual(unauthorized_response.status_code, 404)

        self.client.force_authenticate(self.host)
        owner_response = self.client.get(reverse("matchmaking-game-detail", args=[game.id]))
        self.assertEqual(owner_response.status_code, 200, owner_response.data)
        self.assertEqual(owner_response.data["game"]["id"], game.id)

    def test_cancel_rechecks_actual_game_time_when_stored_status_is_stale(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Stale status cancellation guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        CourtSlot.objects.filter(pk=self.slot.pk).update(
            date=timezone.localdate() - timedelta(days=1),
            start_time=time(18, 0),
            end_time=time(19, 0),
        )

        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-game-cancel", args=[game.id]),
            {"reason": "No longer needed"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.Status.COMPLETED)
        self.assertNotEqual(game.cancellation_reason, "No longer needed")

    def test_deadline_job_closes_recruitment_and_expires_open_requests(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Expired recruitment pickup",
            total_capacity=6,
            minimum_players_to_proceed=4,
            recruitment_deadline=timezone.now() - timedelta(minutes=5),
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=5)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        pending = JoinRequest.objects.create(game=game, player=self.player_one, requested_role="ANY", attendance_confirmed=True)
        accepted = JoinRequest.objects.create(game=game, player=self.player_two, requested_role="ANY", attendance_confirmed=True, status=JoinRequest.Status.ACCEPTED)

        stats = expire_matchmaking_deadlines()

        game.refresh_from_db()
        pending.refresh_from_db()
        accepted.refresh_from_db()
        self.assertEqual(game.status, Game.Status.CLOSED)
        self.assertEqual(pending.status, JoinRequest.Status.EXPIRED)
        self.assertEqual(accepted.status, JoinRequest.Status.ACCEPTED)
        self.assertGreaterEqual(stats["games_closed"], 1)
        self.assertGreaterEqual(stats["requests_expired"], 1)

    def test_completed_pickup_unlocks_peer_ratings_once_after_attendance(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Completed pickup feedback",
            total_capacity=4,
            minimum_players_to_proceed=2,
            status=Game.Status.COMPLETED,
        )
        host_participant = GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
            status=GameParticipant.Status.CONFIRMED,
        )
        player_participant = GameParticipant.objects.create(
            game=game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEMPORARY,
            role="ANY",
            status=GameParticipant.Status.CONFIRMED,
        )
        CourtSlot.objects.filter(pk=self.slot.pk).update(date=timezone.localdate() - timedelta(days=1))

        record_game_attendance(game.id, host_participant.id, self.host, "ATTENDED")
        record_game_attendance(game.id, player_participant.id, self.host, "ATTENDED")

        game.refresh_from_db()
        commitments = ParticipationCommitment.objects.filter(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=game.id,
        )
        self.assertEqual(game.status, Game.Status.COMPLETED)
        self.assertEqual(commitments.count(), 2)
        self.assertEqual(
            commitments.filter(status=ParticipationCommitment.Status.ATTENDED).count(),
            2,
        )
        eligibility_count = PlayerRatingEligibility.objects.filter(
            related_entity_type="matchmaking_game",
            related_entity_id=game.id,
        ).count()
        self.assertEqual(eligibility_count, 2)
        self.assertEqual(maybe_create_game_rating_eligibilities(game.id), 0)
        self.assertEqual(
            PlayerRatingEligibility.objects.filter(
                related_entity_type="matchmaking_game",
                related_entity_id=game.id,
            ).count(),
            2,
        )
        self.assertEqual(
            ParticipationCommitment.objects.filter(
                source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
                source_id=game.id,
                status=ParticipationCommitment.Status.ATTENDED,
            ).count(),
            2,
        )

    def test_completed_fill_my_squad_unlocks_peer_ratings_after_captain_attendance(self):
        game = Game.objects.create(
            game_type=Game.GameType.FILL_SQUAD,
            team=self.team,
            host=self.host,
            booking=self.booking,
            title="Completed squad feedback",
            total_capacity=4,
            minimum_players_to_proceed=2,
            status=Game.Status.COMPLETED,
        )
        host_participant = GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
            status=GameParticipant.Status.CONFIRMED,
        )
        member_participant = GameParticipant.objects.create(
            game=game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEAM_MEMBER,
            role="ANY",
            status=GameParticipant.Status.CONFIRMED,
        )
        CourtSlot.objects.filter(pk=self.slot.pk).update(date=timezone.localdate() - timedelta(days=1))

        record_game_attendance(game.id, host_participant.id, self.host, "ATTENDED")
        record_game_attendance(game.id, member_participant.id, self.host, "ATTENDED")

        self.assertEqual(
            PlayerRatingEligibility.objects.filter(
                related_entity_type="matchmaking_game",
                related_entity_id=game.id,
            ).count(),
            2,
        )
        self.assertEqual(maybe_create_game_rating_eligibilities(game.id), 0)

    def test_only_the_game_host_can_record_pickup_attendance(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Host attendance authority",
            total_capacity=4,
            minimum_players_to_proceed=2,
            status=Game.Status.COMPLETED,
        )
        participant = GameParticipant.objects.create(
            game=game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEMPORARY,
            role="ANY",
            status=GameParticipant.Status.CONFIRMED,
        )

        with self.assertRaises((ValidationError, DRFValidationError)):
            record_game_attendance(game.id, participant.id, self.player_one, "ATTENDED")

        self.assertFalse(
            ParticipationCommitment.objects.filter(
                source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
                source_id=game.id,
            ).exists()
        )

    def test_host_can_update_listing_and_role_plan(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Editable pickup",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")

        self.client.force_authenticate(self.host)
        response = self.client.patch(
            reverse("matchmaking-game-manage", args=[game.id]),
            {
                "title": "Updated pickup plan",
                "description": "Bring your own bat.",
                "total_capacity": 5,
                "minimum_players_to_proceed": 3,
                "recruitment_deadline": (timezone.now() + timedelta(days=2)).isoformat(),
                "role_requirements": [{"role": "BOWLER", "required_count": 2}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        game.refresh_from_db()
        self.assertEqual(game.title, "Updated pickup plan")
        self.assertEqual(game.total_capacity, 5)
        self.assertTrue(game.role_requirements.filter(role="BOWLER", required_count=2).exists())

    def test_host_cannot_reduce_a_role_below_an_accepted_player(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Role capacity guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.BOWLER, required_count=1)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        GameParticipant.objects.create(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEMPORARY, role="BOWLER")

        self.client.force_authenticate(self.host)
        response = self.client.patch(
            reverse("matchmaking-game-manage", args=[game.id]),
            {"role_requirements": [{"role": "BOWLER", "required_count": 0}], "recruitment_deadline": (timezone.now() + timedelta(days=1)).isoformat()},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("role requirement", str(response.data).lower())

    def test_plan_first_schedule_edit_requires_existing_players_to_reconfirm(self):
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Editable plan first",
            proposed_date=timezone.localdate() + timedelta(days=5),
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=3),
            recruitment_deadline=timezone.now() + timedelta(days=2),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY", status=GameParticipant.Status.PROVISIONAL)
        player_participant = GameParticipant.objects.create(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEMPORARY, role="ANY", status=GameParticipant.Status.PROVISIONAL)

        self.client.force_authenticate(self.host)
        response = self.client.patch(
            reverse("matchmaking-game-manage", args=[game.id]),
            {"proposed_date": (timezone.localdate() + timedelta(days=6)).isoformat()},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        player_participant.refresh_from_db()
        game.refresh_from_db()
        self.assertEqual(player_participant.status, GameParticipant.Status.RECONFIRM_REQUIRED)
        self.assertTrue(game.requires_reconfirmation)

    def test_booking_change_separates_registered_reconfirmation_from_guest_acknowledgement(self):
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Guest schedule change",
            proposed_date=self.slot.date,
            proposed_start_time=time(16, 0),
            proposed_end_time=time(17, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=1),
            recruitment_deadline=timezone.now() + timedelta(hours=12),
            total_capacity=5,
            minimum_players_to_proceed=2,
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=4)
        GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
            status=GameParticipant.Status.PROVISIONAL,
        )
        registered = GameParticipant.objects.create(
            game=game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEMPORARY,
            role="ANY",
            status=GameParticipant.Status.PROVISIONAL,
        )
        guest = GameParticipant.objects.create(
            game=game,
            guest_name="Offline Guest",
            participant_type=GameParticipant.ParticipantType.GUEST,
            role="ANY",
            status=GameParticipant.Status.PROVISIONAL,
            added_by=self.host,
        )

        attach_booking_to_game(game, self.booking, self.host)
        registered.refresh_from_db()
        guest.refresh_from_db()
        game.refresh_from_db()
        self.assertEqual(registered.status, GameParticipant.Status.RECONFIRM_REQUIRED)
        self.assertEqual(guest.status, GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED)
        self.assertEqual(game.guest_confirmation_pending_count, 1)
        self.assertEqual(game.registered_reconfirmation_pending_count, 1)
        self.assertTrue(game.requires_reconfirmation)

        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-guest-confirm-schedule", args=[game.id, guest.id]),
        )
        self.assertEqual(response.status_code, 200, response.data)
        guest.refresh_from_db()
        game.refresh_from_db()
        self.assertEqual(guest.status, GameParticipant.Status.CONFIRMED)
        self.assertTrue(game.requires_reconfirmation)

        self.client.force_authenticate(self.player_one)
        response = self.client.post(
            reverse("matchmaking-game-reconfirm", args=[game.id]),
            {"response": "RECONFIRM"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        registered.refresh_from_db()
        game.refresh_from_db()
        self.assertEqual(registered.status, GameParticipant.Status.CONFIRMED)
        self.assertFalse(game.requires_reconfirmation)

    def test_guest_added_after_booking_does_not_need_reconfirmation(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Guest added after booking",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=3)
        GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
        )
        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("matchmaking-game-guests", args=[game.id]),
            {"guest_name": "Late Guest", "role": "ANY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        guest = GameParticipant.objects.get(game=game, guest_name="Late Guest")
        self.assertEqual(guest.status, GameParticipant.Status.CONFIRMED)
        game.refresh_from_db()
        self.assertFalse(game.requires_reconfirmation)

    def test_invalid_host_edit_returns_json_validation_error(self):
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Validation response game",
            proposed_date=timezone.localdate() + timedelta(days=5),
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=3),
            recruitment_deadline=timezone.now() + timedelta(days=2),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY", status=GameParticipant.Status.PROVISIONAL)

        self.client.force_authenticate(self.host)
        response = self.client.patch(
            reverse("matchmaking-game-manage", args=[game.id]),
            {"preferred_area": "Not a SportSpot area"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("area", str(response.data).lower())
        self.assertNotIn("<html", response.content.decode().lower())

    def test_host_can_remove_participant_and_private_request_is_closed(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Roster removal",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        participant = GameParticipant.objects.create(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEMPORARY, role="ANY")
        join_request = JoinRequest.objects.create(game=game, player=self.player_one, requested_role="ANY", status=JoinRequest.Status.ACCEPTED, attendance_confirmed=True)

        self.client.force_authenticate(self.host)
        response = self.client.delete(reverse("matchmaking-game-participant-manage", args=[game.id, participant.id]))

        self.assertEqual(response.status_code, 200, response.data)
        participant.refresh_from_db()
        join_request.refresh_from_db()
        self.assertEqual(participant.status, GameParticipant.Status.REMOVED)
        self.assertEqual(join_request.status, JoinRequest.Status.REMOVED)

    def test_host_can_close_and_reopen_recruitment_without_losing_roster_or_booking(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Close and reopen recruitment",
            total_capacity=2,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameRoleRequirement.objects.create(game=game, role="ANY", required_count=1)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        participant = GameParticipant.objects.create(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEMPORARY, role="ANY")
        game.refresh_status()

        self.client.force_authenticate(self.host)
        response = self.client.post(reverse("matchmaking-game-close-recruitment", args=[game.id]))

        self.assertEqual(response.status_code, 200, response.data)
        game.refresh_from_db()
        participant.refresh_from_db()
        self.assertEqual(game.status, Game.Status.CLOSED)
        self.assertFalse(game.is_public)
        self.assertEqual(game.booking_id, self.booking.id)
        self.assertEqual(participant.status, GameParticipant.Status.CONFIRMED)

        response = self.client.post(reverse("matchmaking-game-reopen-recruitment", args=[game.id]))

        self.assertEqual(response.status_code, 200, response.data)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.Status.FULL)
        self.assertTrue(game.is_public)

    def test_leaving_full_game_reopens_spot_when_recruitment_deadline_is_open(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Player leaves full game",
            total_capacity=2,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        GameParticipant.objects.create(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEMPORARY, role="ANY")
        game.refresh_status()
        self.assertEqual(game.status, Game.Status.FULL)

        self.client.force_authenticate(self.player_one)
        response = self.client.post(reverse("matchmaking-game-leave", args=[game.id]))

        self.assertEqual(response.status_code, 200, response.data)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.Status.RECRUITING)
        self.assertEqual(game.available_spots, 1)

    def test_cancelled_linked_booking_cancels_game_but_keeps_booking_history(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Booking cancellation sync",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        self.booking.status = Booking.BookingStatus.CANCELLED
        self.booking.payment_status = Booking.PaymentStatus.REFUNDED
        self.booking.cancelled_at = timezone.now()
        self.booking.save(update_fields=["status", "payment_status", "cancelled_at", "updated_at"])

        cancelled_count = cancel_games_for_booking(self.booking, actor=self.host)

        self.assertEqual(cancelled_count, 1)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.Status.CANCELLED)
        self.assertFalse(game.is_public)
        self.assertEqual(game.booking_id, self.booking.id)

    def test_expired_request_can_be_submitted_again_after_recruitment_reopens(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Retry after recruitment reopens",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")
        previous_request = JoinRequest.objects.create(
            game=game,
            player=self.player_one,
            requested_role="ANY",
            attendance_confirmed=True,
            status=JoinRequest.Status.EXPIRED,
        )

        self.client.force_authenticate(self.player_one)
        response = self.client.post(
            reverse("matchmaking-game-request", args=[game.id]),
            {"requested_role": "ANY", "attendance_confirmed": True, "message": "I can attend."},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        previous_request.refresh_from_db()
        self.assertEqual(previous_request.status, JoinRequest.Status.PENDING)
        self.assertEqual(previous_request.attempt_number, 2)
        self.assertEqual(JoinRequest.objects.filter(game=game, player=self.player_one).count(), 1)
        self.assertTrue(
            JoinRequestEvent.objects.filter(
                join_request=previous_request,
                event_type=JoinRequestEvent.EventType.SUBMITTED,
                attempt_number=2,
            ).exists()
        )

    def test_non_host_cannot_edit_or_remove_game_participants(self):
        game = Game.objects.create(
            host=self.host,
            booking=self.booking,
            title="Host permission guard",
            total_capacity=4,
            minimum_players_to_proceed=2,
            recruitment_deadline=timezone.now() + timedelta(days=1),
        )
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY")

        self.client.force_authenticate(self.player_one)
        response = self.client.patch(reverse("matchmaking-game-manage", args=[game.id]), {"title": "Hijacked"}, format="json")

        self.assertEqual(response.status_code, 400, response.data)
        game.refresh_from_db()
        self.assertEqual(game.title, "Host permission guard")

    def test_deadline_job_cancels_unbooked_plan_first_after_booking_deadline(self):
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Expired plan first pickup",
            proposed_date=timezone.localdate() + timedelta(days=2),
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() - timedelta(minutes=10),
            recruitment_deadline=timezone.now() - timedelta(minutes=41),
            total_capacity=6,
            minimum_players_to_proceed=4,
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=5)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY", status=GameParticipant.Status.PROVISIONAL)
        request = JoinRequest.objects.create(game=game, player=self.player_one, requested_role="ANY", attendance_confirmed=True)

        stats = expire_matchmaking_deadlines()

        game.refresh_from_db()
        request.refresh_from_db()
        self.assertEqual(game.status, Game.Status.CANCELLED)
        self.assertEqual(request.status, JoinRequest.Status.EXPIRED)
        self.assertGreaterEqual(stats["games_cancelled"], 1)
        self.assertGreaterEqual(stats["requests_expired"], 1)


    def create_available_slots(self, start_hour=18, count=2, days=6):
        slots = []
        slot_date = timezone.localdate() + timedelta(days=days)
        for offset in range(count):
            slots.append(
                CourtSlot.objects.create(
                    court=self.court,
                    date=slot_date,
                    start_time=time(start_hour + offset, 0),
                    end_time=time(start_hour + offset + 1, 0),
                    price=Decimal("1500"),
                    status=CourtSlot.Status.AVAILABLE,
                )
            )
        return slots

    @patch("venues.views.lookup_khalti_payment")
    def test_plan_first_guided_booking_confirms_payment_and_attaches_game(self, lookup_payment):
        slots = self.create_available_slots()
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Guided plan-first pickup",
            proposed_date=slots[0].date,
            proposed_start_time=slots[0].start_time,
            proposed_end_time=slots[-1].end_time,
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=2),
            recruitment_deadline=timezone.now() + timedelta(days=1),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY", status=GameParticipant.Status.PROVISIONAL)
        GameParticipant.objects.create(game=game, user=self.player_one, participant_type=GameParticipant.ParticipantType.TEMPORARY, role="ANY", status=GameParticipant.Status.PROVISIONAL)

        self.client.force_authenticate(self.host)
        reserve_response = self.client.post(
            reverse("booking-reserve"),
            {"slot_ids": [slot.id for slot in slots], "matchmaking_game_id": game.id},
            format="json",
        )

        self.assertEqual(reserve_response.status_code, 201, reserve_response.data)
        booking = Booking.objects.get(id=reserve_response.data["booking"]["id"])
        self.assertEqual(booking.matchmaking_game_id, game.id)
        self.assertEqual(booking.matchmaking_sync_status, Booking.MatchmakingSyncStatus.PENDING_PAYMENT)
        game.refresh_from_db()
        self.assertEqual(game.status, Game.Status.BOOKING_PENDING)
        booking.payment_provider = Booking.PaymentProvider.KHALTI
        booking.khalti_pidx = "guided-plan-pidx"
        booking.khalti_payment_url = "https://pay.khalti.com/guided-plan"
        booking.save(update_fields=["payment_provider", "khalti_pidx", "khalti_payment_url", "updated_at"])
        lookup_payment.return_value = {
            "status": "Completed",
            "total_amount": 300000,
            "transaction_id": "guided-plan-transaction",
        }

        verify_response = self.client.post(
            reverse("khalti-payment-verify", args=[booking.id]),
            {"pidx": "guided-plan-pidx"},
            format="json",
        )

        self.assertEqual(verify_response.status_code, 200, verify_response.data)
        booking.refresh_from_db()
        game.refresh_from_db()
        self.assertEqual(booking.status, Booking.BookingStatus.CONFIRMED)
        self.assertEqual(booking.payment_status, Booking.PaymentStatus.PAID)
        self.assertEqual(game.booking_id, booking.id)
        self.assertEqual(verify_response.data["matchmaking_game"]["id"], game.id)
        self.assertTrue(GameParticipant.objects.filter(game=game, status=GameParticipant.Status.CONFIRMED).exists())

    @patch("sportspot_api.maintenance.call_command")
    @patch("sportspot_api.maintenance.expire_matchmaking_deadlines")
    @patch("sportspot_api.maintenance.complete_finished_bookings")
    @patch("sportspot_api.maintenance.reconcile_matchmaking_booking_handoffs")
    @patch("sportspot_api.maintenance.expire_expired_reservations")
    def test_unified_maintenance_runs_booking_matchmaking_and_reminders(
        self,
        expire_reservations,
        reconcile_handoffs,
        complete_bookings,
        expire_matchmaking,
        call_command,
    ):
        expire_reservations.return_value = {"checked_count": 2, "expired_count": 1}
        reconcile_handoffs.return_value = {"checked_count": 1, "attached_count": 1, "review_count": 0}
        complete_bookings.return_value = {"checked_count": 3, "completed_count": 1}
        expire_matchmaking.return_value = {
            "games_closed": 1,
            "games_cancelled": 0,
            "games_in_progress": 0,
            "games_completed": 0,
            "requests_expired": 2,
        }
        run_at = timezone.now()

        result = run_platform_maintenance(
            limit=17,
            notify=True,
            run_reminders=True,
            now=run_at,
        )

        expire_reservations.assert_called_once_with(now=run_at, limit=17, notify=True)
        reconcile_handoffs.assert_called_once_with(limit=17)
        complete_bookings.assert_called_once_with(now=run_at, limit=17, notify=True)
        expire_matchmaking.assert_called_once_with(now=run_at, limit=17, notify=True)
        call_command.assert_called_once()
        self.assertTrue(result["reminders_enabled"])
        self.assertEqual(result["matchmaking"]["requests_expired"], 2)

    def test_plan_first_guided_booking_blocks_until_minimum_players_ready(self):
        slots = self.create_available_slots(start_hour=15, count=1, days=7)
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Needs more players before booking",
            proposed_date=slots[0].date,
            proposed_start_time=slots[0].start_time,
            proposed_end_time=slots[0].end_time,
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=2),
            recruitment_deadline=timezone.now() + timedelta(days=1),
            total_capacity=4,
            minimum_players_to_proceed=3,
        )
        GameRoleRequirement.objects.create(game=game, role=GameRoleRequirement.CricksalRole.ANY, required_count=3)
        GameParticipant.objects.create(game=game, user=self.host, participant_type=GameParticipant.ParticipantType.HOST, role="ANY", status=GameParticipant.Status.PROVISIONAL)

        self.client.force_authenticate(self.host)
        response = self.client.post(
            reverse("booking-reserve"),
            {"slot_ids": [slots[0].id], "matchmaking_game_id": game.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("more confirmed or provisional player spot", str(response.data))
        slots[0].refresh_from_db()
        self.assertEqual(slots[0].status, CourtSlot.Status.AVAILABLE)

    def test_provisional_participation_blocks_an_overlapping_game(self):
        first_game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="First proposed pickup",
            proposed_date=timezone.localdate() + timedelta(days=5),
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=3),
            recruitment_deadline=timezone.now() + timedelta(days=2),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameParticipant.objects.create(
            game=first_game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEMPORARY,
            role="ANY",
            status=GameParticipant.Status.PROVISIONAL,
        )
        second_game = Game.objects.create(
            host=self.player_two,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Overlapping proposed pickup",
            proposed_date=first_game.proposed_date,
            proposed_start_time=time(19, 0),
            proposed_end_time=time(21, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=3),
            recruitment_deadline=timezone.now() + timedelta(days=2),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )

        self.assertTrue(player_has_overlapping_confirmed_game(self.player_one, second_game))

    def test_planning_room_is_limited_and_cancelled_games_become_read_only(self):
        game = Game.objects.create(
            host=self.host,
            creation_mode=Game.CreationMode.PLAN_FIRST,
            title="Private planning room",
            proposed_date=timezone.localdate() + timedelta(days=5),
            proposed_start_time=time(18, 0),
            proposed_end_time=time(20, 0),
            preferred_area="Baneshwor",
            booking_deadline=timezone.now() + timedelta(days=3),
            recruitment_deadline=timezone.now() + timedelta(days=2),
            total_capacity=4,
            minimum_players_to_proceed=2,
        )
        GameParticipant.objects.create(
            game=game,
            user=self.host,
            participant_type=GameParticipant.ParticipantType.HOST,
            role="ANY",
            status=GameParticipant.Status.PROVISIONAL,
        )
        GameParticipant.objects.create(
            game=game,
            user=self.player_one,
            participant_type=GameParticipant.ParticipantType.TEMPORARY,
            role="ANY",
            status=GameParticipant.Status.PROVISIONAL,
        )

        self.client.force_authenticate(self.player_one)
        room_response = self.client.get(reverse("matchmaking-game-room", args=[game.id]))

        self.assertEqual(room_response.status_code, 200, room_response.data)
        self.assertEqual(room_response.data["room_access"], "PLANNING")
        self.assertNotIn("sportspot_id", room_response.data["game"]["participants"][0])

        self.client.force_authenticate(self.host)
        cancel_response = self.client.post(
            reverse("matchmaking-game-cancel", args=[game.id]),
            {"reason": "The proposed game is no longer going ahead."},
            format="json",
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.client.force_authenticate(self.player_one)
        historical_room_response = self.client.get(reverse("matchmaking-game-room", args=[game.id]))
        self.assertEqual(historical_room_response.status_code, 200, historical_room_response.data)
        self.assertEqual(historical_room_response.data["room_access"], "READ_ONLY")

