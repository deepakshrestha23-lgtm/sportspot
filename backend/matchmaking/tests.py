from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from sportspot_api.maintenance import run_platform_maintenance

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from players.models import PlayerProfile
from teams.models import Team, TeamMember
from venues.models import Booking, Court, CourtSlot, Venue

from .models import Game, GameParticipant, GameRoleRequirement, JoinRequest
from .services import expire_matchmaking_deadlines


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
                "booking_deadline": (timezone.now() + timedelta(days=2)).isoformat(),
                "recruitment_deadline": (timezone.now() + timedelta(days=4)).isoformat(),
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
        self.assertEqual(game.participants.get(user=self.host).status, GameParticipant.Status.PROVISIONAL)

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
            recruitment_deadline=timezone.now() + timedelta(days=1),
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
            recruitment_deadline=timezone.now() + timedelta(days=3),
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
    @patch("sportspot_api.maintenance.expire_expired_reservations")
    def test_unified_maintenance_runs_booking_matchmaking_and_reminders(
        self,
        expire_reservations,
        complete_bookings,
        expire_matchmaking,
        call_command,
    ):
        expire_reservations.return_value = {"checked_count": 2, "expired_count": 1}
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
            recruitment_deadline=timezone.now() + timedelta(days=3),
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

