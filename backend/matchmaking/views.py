import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from datetime import time as datetime_time

from django.db.models import Count, ExpressionWrapper, F, IntegerField, Prefetch, Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from players.models import PlayerProfile
from players.services import get_attendance_submission_deadline
from teams.models import TeamMember
from team_challenges.models import TeamFixture, TeamFixtureParticipant
from team_challenges.serializers import MyTeamFixtureSerializer
from team_challenges.services import synchronize_confirmed_team_challenges
from teams.serializers import TeamMemberSerializer
from venues.models import Booking
from venues.permissions import IsPlayer
from sportspot_api.chat import can_edit_chat_message
from sportspot_api.throttling import MutationThrottleMixin

from .models import ACTIVE_PARTICIPANT_STATUSES, Game, GameChatMessage, JoinRequest, JoinRequestEvent
from .serializers import (
    EligibleBookingSerializer,
    GameChatMessageCreateSerializer,
    GameChatMessageSerializer,
    GameCreateSerializer,
    GameParticipantSerializer,
    GameHostUpdateSerializer,
    GameSerializer,
    PublicGameSerializer,
    JoinRequestCreateSerializer,
    JoinRequestSerializer,
)
logger = logging.getLogger(__name__)


from .services import (
    resequence_waitlist,
    add_guest_participant,
    attach_booking_to_game,
    close_game_recruitment,
    reopen_game_recruitment,
    confirm_guest_schedule,
    decide_join_request,
    expire_open_join_requests_for_game,
    game_room_access_level,
    eligible_bookings_for_user,
    ensure_role_has_space,
    invite_player_to_game,
    invite_temporary_participant_to_team,
    leave_game,
    notify_game_cancelled,
    notify_game_chat_message,
    record_game_attendance,
    dispute_game_attendance,
    reconfirm_game,
    respond_game_invitation,
    synchronize_and_require_game_host,
    synchronize_game_lifecycle,
    remove_game_participant,
    update_game_host_settings,
    update_game_participant,
)
from .realtime import publish_game_chat_message


class GameListCreateView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        games = get_public_games(request)
        return Response({"games": PublicGameSerializer(games, many=True, context={"request": request}).data})

    def post(self, request):
        if not request.user or not request.user.is_authenticated or request.user.role != "PLAYER":
            return Response({"detail": "Log in as a player to open a game."}, status=status.HTTP_403_FORBIDDEN)
        serializer = GameCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            game = serializer.save()
        except DjangoValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            logger.exception("Game creation failed because of a database integrity conflict.")
            return Response(
                {"detail": "This game could not be created because the selected booking may already be in use. Refresh your bookings and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        response_status = status.HTTP_200_OK if getattr(serializer, "was_idempotent_replay", False) else status.HTTP_201_CREATED
        return Response({"game": GameSerializer(game, context={"request": request}).data}, status=response_status)


class EligibleBookingListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        bookings = eligible_bookings_for_user(request.user)
        return Response({"bookings": EligibleBookingSerializer(bookings, many=True).data})


class GameDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game)
        is_authenticated = bool(request.user and request.user.is_authenticated)
        if not game.is_public and (not is_authenticated or not can_view_game_private(request.user, game)):
            # Do not reveal whether a private game exists to an unauthorized user.
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer_class = GameSerializer if not game.is_public else PublicGameSerializer
        return Response({"game": serializer_class(game, context={"request": request}).data})


class GameJoinRequestCreateView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = JoinRequestCreateSerializer(data=request.data, context={"request": request, "game": game})
        serializer.is_valid(raise_exception=True)
        try:
            join_request = serializer.save()
        except IntegrityError:
            return Response(
                {"detail": "You already have an active request for this game."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"request": JoinRequestSerializer(join_request).data}, status=status.HTTP_201_CREATED)


class JoinRequestDecisionView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, request_id):
        join_request = JoinRequest.objects.select_related("game", "player", "game__host").filter(id=request_id).first()
        if not join_request:
            return Response({"detail": "Request not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            updated_request = decide_join_request(join_request, request.user, request.data.get("decision"))
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"request": JoinRequestSerializer(updated_request).data})


class JoinRequestWithdrawView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    @transaction.atomic
    def post(self, request, request_id):
        game_id = (
            JoinRequest.objects.filter(id=request_id, player=request.user)
            .values_list("game_id", flat=True)
            .first()
        )
        if not game_id:
            return Response({"detail": "Request not found."}, status=status.HTTP_404_NOT_FOUND)
        # Lock the game before the request, matching host decisions and expiry.
        game = Game.objects.select_for_update(of=("self",)).get(pk=game_id)
        synchronize_game_lifecycle(game, expire_requests=True)
        join_request = (
            JoinRequest.objects.select_for_update()
            .select_related("game", "player")
            .filter(id=request_id, player=request.user)
            .first()
        )
        if not join_request:
            return Response({"detail": "Request not found."}, status=status.HTTP_404_NOT_FOUND)
        if join_request.status not in [JoinRequest.Status.PENDING, JoinRequest.Status.WAITLISTED]:
            return Response({"detail": "This request can no longer be withdrawn."}, status=status.HTTP_400_BAD_REQUEST)
        from .services import record_join_request_event

        previous_status = join_request.status
        join_request.status = JoinRequest.Status.WITHDRAWN
        join_request.decided_at = timezone.now()
        join_request.save(update_fields=["status", "decided_at", "updated_at"])
        record_join_request_event(
            join_request,
            JoinRequestEvent.EventType.WITHDRAWN,
            actor=request.user,
            previous_status=previous_status,
        )
        resequence_waitlist(game)
        return Response({"request": JoinRequestSerializer(join_request).data})


class MyGamesView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        user = request.user
        # Keep a read of My Games current when the scheduler has not yet run.
        # The service only changes fixtures whose booking or clock requires it;
        # the database remains the source of truth for the returned feed.
        synchronize_confirmed_team_challenges(notify=True)
        hosted = base_game_queryset().filter(
            Q(host=user)
            | Q(
                game_type=Game.GameType.FILL_SQUAD,
                team__captain=user,
                team__members__user=user,
                team__members__member_type=TeamMember.MemberType.REGISTERED,
                team__members__status=TeamMember.MemberStatus.ACTIVE,
            )
        ).distinct()
        participating = base_game_queryset().filter(
            participants__user=user,
            participants__status__in=ACTIVE_PARTICIPANT_STATUSES,
        ).distinct()
        requests = JoinRequest.objects.filter(player=user).select_related("game", "game__booking", "game__booking__venue", "game__booking__court", "game__host")
        incoming_requests = JoinRequest.objects.filter(game__host=user).select_related("game", "player", "player__player_profile")
        seen_game_ids = set()
        for game in list(hosted) + list(participating):
            if game.id in seen_game_ids:
                continue
            seen_game_ids.add(game.id)
            synchronize_game_lifecycle(game, expire_requests=True)
        upcoming = participating.filter(status__in=[
            Game.Status.RECRUITING,
            Game.Status.FULL,
            Game.Status.CLOSED,
            Game.Status.BOOKING_PENDING,
            Game.Status.IN_PROGRESS,
        ])
        completed = participating.filter(status=Game.Status.COMPLETED)
        cancelled = participating.filter(status=Game.Status.CANCELLED)

        team_fixture_participant_statuses = [
            TeamFixtureParticipant.Status.SELECTED,
            TeamFixtureParticipant.Status.ATTENDED,
            TeamFixtureParticipant.Status.ABSENT,
            TeamFixtureParticipant.Status.UNVERIFIED,
        ]
        viewer_fixture_participants = TeamFixtureParticipant.objects.filter(
            player=user,
            status__in=team_fixture_participant_statuses,
        ).select_related("team")
        captain_membership = Q(
            challenge__challenger_team__captain_id=user.id,
            challenge__challenger_team__members__user_id=user.id,
            challenge__challenger_team__members__member_type=TeamMember.MemberType.REGISTERED,
            challenge__challenger_team__members__status=TeamMember.MemberStatus.ACTIVE,
        ) | Q(
            challenge__challenged_team__captain_id=user.id,
            challenge__challenged_team__members__user_id=user.id,
            challenge__challenged_team__members__member_type=TeamMember.MemberType.REGISTERED,
            challenge__challenged_team__members__status=TeamMember.MemberStatus.ACTIVE,
        )
        participant_access = Q(
            participants__player=user,
            participants__status__in=team_fixture_participant_statuses,
        )
        team_fixtures = (
            TeamFixture.objects.select_related(
                "challenge",
                "challenge__challenger_team",
                "challenge__challenged_team",
                "booking",
                "booking__venue",
                "booking__court",
            )
            .prefetch_related(
                "booking__slot_items__slot",
                Prefetch(
                    "participants",
                    queryset=viewer_fixture_participants,
                    to_attr="_viewer_fixture_participants",
                ),
            )
            .filter(captain_membership | participant_access)
            .filter(booking__isnull=False)
            .distinct()
        )
        team_upcoming = team_fixtures.filter(
            status__in=[
                TeamFixture.Status.SCHEDULED,
                TeamFixture.Status.RECONFIRMATION_REQUIRED,
                TeamFixture.Status.IN_PROGRESS,
            ],
            booking__status=Booking.BookingStatus.CONFIRMED,
        ).order_by("booking__slot__date", "booking__slot__start_time", "id")
        team_completed = team_fixtures.filter(status=TeamFixture.Status.COMPLETED).order_by(
            "-booking__slot__date", "-booking__slot__start_time", "-id"
        )
        team_cancelled = team_fixtures.filter(status=TeamFixture.Status.CANCELLED).order_by(
            "-updated_at", "-id"
        )
        return Response(
            {
                "upcoming": GameSerializer(upcoming, many=True, context={"request": request}).data,
                "hosted": GameSerializer(hosted.exclude(status=Game.Status.COMPLETED), many=True, context={"request": request}).data,
                "requests": JoinRequestSerializer(requests, many=True).data,
                "incoming_requests": JoinRequestSerializer(incoming_requests, many=True).data,
                "completed": GameSerializer(completed, many=True, context={"request": request}).data,
                "cancelled": GameSerializer(cancelled, many=True, context={"request": request}).data,
                "team_matches": {
                    "upcoming": MyTeamFixtureSerializer(team_upcoming, many=True, context={"request": request}).data,
                    "completed": MyTeamFixtureSerializer(team_completed, many=True, context={"request": request}).data,
                    "cancelled": MyTeamFixtureSerializer(team_cancelled, many=True, context={"request": request}).data,
                },
            }
        )


class GameManageView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game, expire_requests=True)
        if not can_view_game_private(request.user, game):
            return Response({"detail": "You do not have access to this game."}, status=status.HTTP_403_FORBIDDEN)
        payload = {"game": GameSerializer(game, context={"request": request}).data}
        if game.host_id == request.user.id:
            payload["join_requests"] = JoinRequestSerializer(game.join_requests.select_related("player", "player__player_profile"), many=True).data
            payload["eligible_bookings"] = EligibleBookingSerializer(eligible_bookings_for_user(request.user), many=True).data
        return Response(payload)

    def patch(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = GameHostUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            updated_game = update_game_host_settings(game.id, request.user, serializer.validated_data)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except DjangoValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"game": GameSerializer(updated_game, context={"request": request}).data})


class GameParticipantManageView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def patch(self, request, game_id, participant_id):
        try:
            participant = update_game_participant(game_id, participant_id, request.user, request.data)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except DjangoValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"participant": GameParticipantSerializer(participant).data})

    def delete(self, request, game_id, participant_id):
        try:
            participant = remove_game_participant(game_id, participant_id, request.user)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except DjangoValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"participant": GameParticipantSerializer(participant).data})


class GameParticipantAttendanceView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id, participant_id):
        try:
            commitment = record_game_attendance(
                game_id,
                participant_id,
                request.user,
                request.data.get("status"),
            )
        except Game.DoesNotExist:
            return Response({"detail": "This game is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except (ValidationError, DjangoValidationError) as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "attendance": {
                "id": commitment.id,
                "status": commitment.status,
                "review_deadline_at": commitment.review_deadline_at.isoformat() if commitment.review_deadline_at else None,
                "attendance_submission_deadline_at": get_attendance_submission_deadline(commitment).isoformat(),
            },
        })


class GameParticipantAttendanceDisputeView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id, participant_id):
        try:
            commitment = dispute_game_attendance(
                game_id,
                participant_id,
                request.user,
                request.data.get("reason", ""),
            )
        except Game.DoesNotExist:
            return Response({"detail": "This game is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except (ValidationError, DjangoValidationError) as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "attendance": {
                "id": commitment.id,
                "status": commitment.status,
                "disputed_at": commitment.disputed_at.isoformat() if commitment.disputed_at else None,
            },
        })

class GameGuestParticipantView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        try:
            participant = add_guest_participant(
                game_id=game_id,
                actor=request.user,
                guest_name=request.data.get("guest_name", ""),
                role=request.data.get("role") or "ANY",
            )
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"participant": GameParticipantSerializer(participant).data}, status=status.HTTP_201_CREATED)


class GamePlayerLookupView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game, expire_requests=True)
        if game.host_id != request.user.id:
            return Response({"detail": "Only the host can invite players."}, status=status.HTTP_403_FORBIDDEN)
        sportspot_id = str(request.query_params.get("sportspot_id", "")).strip().upper()
        if not sportspot_id:
            return Response({"detail": "SportSpot ID is required."}, status=status.HTTP_400_BAD_REQUEST)
        profile = PlayerProfile.objects.select_related("user").filter(sportspot_id=sportspot_id, user__role="PLAYER", user__is_active=True).first()
        if not profile:
            return Response({"detail": "No registered player found with this SportSpot ID."}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            "player": {
                "id": profile.user_id,
                "full_name": profile.user.full_name,
                "sportspot_id": profile.sportspot_id,
                "skill_level": profile.skill_level,
                "preferred_role": profile.preferred_cricksal_role,
                "reliability_label": getattr(profile, "reliability_label", ""),
                "average_rating": str(getattr(profile, "average_rating", "")),
                "profile_photo": profile.profile_photo.url if profile.profile_photo else "",
            }
        })


class GameRegisteredPlayerInviteView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        try:
            invitation = invite_player_to_game(
                game_id=game_id,
                actor=request.user,
                sportspot_id=request.data.get("sportspot_id", ""),
                requested_role=request.data.get("requested_role") or "ANY",
                message=request.data.get("message", ""),
            )
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"request": JoinRequestSerializer(invitation).data}, status=status.HTTP_201_CREATED)


class GameTemporaryPlayerTeamInviteView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id, participant_id):
        try:
            invitation = invite_temporary_participant_to_team(game_id, participant_id, request.user)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "invitation": TeamMemberSerializer(invitation).data,
                "detail": "The permanent team invitation has been sent.",
            },
            status=status.HTTP_201_CREATED,
        )


class GameInvitationResponseView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, request_id):
        invitation = JoinRequest.objects.select_related("game", "player", "game__host").filter(id=request_id, player=request.user).first()
        if not invitation:
            return Response({"detail": "Invitation not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            updated = respond_game_invitation(invitation, request.user, request.data.get("response"))
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"request": JoinRequestSerializer(updated).data})


class GameAttachBookingView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        booking = Booking.objects.select_related("venue", "court", "slot", "player").prefetch_related("slot_items__slot").filter(id=request.data.get("booking_id")).first()
        if not booking:
            return Response({"detail": "Choose a confirmed booking."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            updated_game = attach_booking_to_game(game, booking, request.user)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"game": GameSerializer(updated_game, context={"request": request}).data})


class GameReconfirmView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            reconfirm_game(game, request.user, request.data.get("response"))
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"game": GameSerializer(get_game_or_none(game_id), context={"request": request}).data})


class GuestScheduleConfirmationView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id, participant_id):
        try:
            participant = confirm_guest_schedule(game_id, participant_id, request.user)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"participant": GameParticipantSerializer(participant).data})


class GameLeaveView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            participant = leave_game(game, request.user)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"participant": GameParticipantSerializer(participant).data})


class GameCancelView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    @transaction.atomic
    def post(self, request, game_id):
        # Use the same game -> booking -> slots lock order as payment
        # verification, reservation expiry and booking cancellation.
        game = Game.objects.select_for_update(of=("self",)).order_by().select_related("host").filter(id=game_id).first()
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        Booking.objects.select_for_update().filter(
            matchmaking_game_id=game_id,
            status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
        ).first()
        try:
            synchronize_and_require_game_host(game, request.user, "Only the host can cancel this game.")
        except DjangoValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_403_FORBIDDEN)
        synchronize_game_lifecycle(game, expire_requests=True)
        if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED]:
            return Response({"detail": "This game can no longer be cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        reason = str(request.data.get("reason", "")).strip()
        if len(reason) < 5:
            return Response({"detail": "Add a short reason for cancelling the game."}, status=status.HTTP_400_BAD_REQUEST)
        game.status = Game.Status.CANCELLED
        now = timezone.now()
        game.cancelled_at = now
        game.cancellation_reason = reason
        game.is_public = False
        game.booking_handoff_was_public = False
        game.save(update_fields=[
            "status", "is_public", "cancelled_at", "cancellation_reason",
            "booking_handoff_was_public", "updated_at",
        ])
        from .services import void_game_participation_commitments

        void_game_participation_commitments(game, actor=request.user, reason=reason)
        if game.status == Game.Status.CANCELLED:
            from venues.services import release_reserved_booking_for_game

            release_reserved_booking_for_game(game.id, now=now)
        # Close pending requests immediately; the scheduled worker remains
        # the recovery path for cancellations made outside this endpoint.
        expire_open_join_requests_for_game(game, now=now)
        notify_game_cancelled(game, request.user)
        return Response({"game": GameSerializer(game, context={"request": request}).data})


class GameCloseRecruitmentView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        game = Game.objects.filter(id=game_id).first()
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            game = close_game_recruitment(game, request.user)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"game": GameSerializer(game, context={"request": request}).data})


class GameReopenRecruitmentView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id):
        game = Game.objects.filter(id=game_id).first()
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            game = reopen_game_recruitment(game, request.user)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"game": GameSerializer(game, context={"request": request}).data})


class GameRoomView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game, expire_requests=True)
        access_level = game_room_access_level(game, request.user)
        if access_level == "NONE":
            return Response({"detail": "You do not have access to this game room."}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            "room_access": access_level,
            "game": GameSerializer(game, context={"request": request, "room_access": access_level}).data,
        })

    def patch(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            synchronize_and_require_game_host(game, request.user, "Only the host can update game room instructions.")
        except DjangoValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_403_FORBIDDEN)
        synchronize_game_lifecycle(game, expire_requests=True)
        if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED]:
            return Response({"detail": "Instructions cannot be changed after this game has ended."}, status=status.HTTP_400_BAD_REQUEST)
        game.game_room_note = str(request.data.get("game_room_note", "")).strip()[:500]
        game.save(update_fields=["game_room_note", "updated_at"])
        return Response({"game": GameSerializer(game, context={"request": request}).data})


class GameChatView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, game_id):
        game = get_game_or_none(game_id)
        access_level = self._room_access(game, request)
        if isinstance(access_level, Response):
            return access_level

        try:
            limit = int(request.query_params.get("limit", "50"))
        except (TypeError, ValueError):
            limit = 50
        limit = max(min(limit, 100), 1)

        before = request.query_params.get("before")
        if before:
            try:
                before = int(before)
                if before <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                return Response({"detail": "The message cursor is invalid."}, status=status.HTTP_400_BAD_REQUEST)

        messages_query = GameChatMessage.objects.filter(game=game).select_related("sender")
        if before:
            messages_query = messages_query.filter(id__lt=before)
        rows = list(messages_query.order_by("-created_at", "-id")[: limit + 1])
        has_more = len(rows) > limit
        messages = list(reversed(rows[:limit]))
        return Response({
            "messages": GameChatMessageSerializer(messages, many=True, context={"request": request}).data,
            "has_more": has_more,
            "next_before": messages[0].id if has_more and messages else None,
            "room_access": access_level,
        })

    def post(self, request, game_id):
        game = get_game_or_none(game_id)
        access_level = self._room_access(game, request)
        if isinstance(access_level, Response):
            return access_level
        if access_level == "READ_ONLY":
            return Response({"detail": "This game room is read-only."}, status=status.HTTP_400_BAD_REQUEST)

        payload_serializer = GameChatMessageCreateSerializer(data=request.data)
        payload_serializer.is_valid(raise_exception=True)
        body = payload_serializer.validated_data["body"]
        client_message_id = payload_serializer.validated_data.get("client_message_id", "")
        message = None
        created = False

        try:
            with transaction.atomic():
                if client_message_id:
                    message = GameChatMessage.objects.filter(
                        game=game,
                        sender=request.user,
                        client_message_id=client_message_id,
                    ).select_related("sender").first()
                if message:
                    if message.body != body:
                        return Response({"detail": "This message retry does not match the original message."}, status=status.HTTP_409_CONFLICT)
                else:
                    sender_name = (request.user.full_name or request.user.email).strip()[:120]
                    message = GameChatMessage.objects.create(
                        game=game,
                        sender=request.user,
                        sender_name=sender_name,
                        body=body,
                        client_message_id=client_message_id,
                    )
                    created = True
                    notify_game_chat_message(message)
                    transaction.on_commit(lambda created_message=message: publish_game_chat_message(created_message))
        except IntegrityError:
            message = GameChatMessage.objects.filter(
                game=game,
                sender=request.user,
                client_message_id=client_message_id,
            ).select_related("sender").first()
            if not message or message.body != body:
                return Response({"detail": "We could not save that message. Please try again."}, status=status.HTTP_409_CONFLICT)

        return Response({
            "message": GameChatMessageSerializer(message, context={"request": request}).data,
            "created": created,
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def _room_access(self, game, request):
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game, expire_requests=True)
        access_level = game_room_access_level(game, request.user)
        if access_level == "NONE":
            return Response({"detail": "You do not have access to this game chat."}, status=status.HTTP_403_FORBIDDEN)
        return access_level


class GameChatMessageDetailView(GameChatView):
    def patch(self, request, game_id, message_id):
        game = get_game_or_none(game_id)
        access_level = self._room_access(game, request)
        if isinstance(access_level, Response):
            return access_level
        if access_level == "READ_ONLY":
            return Response({"detail": "This game room is read-only."}, status=status.HTTP_400_BAD_REQUEST)

        payload_serializer = GameChatMessageCreateSerializer(data=request.data)
        payload_serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                message = GameChatMessage.objects.select_for_update().filter(game=game, pk=message_id).first()
                if not message:
                    return Response({"detail": "Message not found."}, status=status.HTTP_404_NOT_FOUND)
                if message.sender_id != request.user.id:
                    return Response({"detail": "You can only edit your own messages."}, status=status.HTTP_403_FORBIDDEN)
                if message.deleted_at:
                    return Response({"detail": "Deleted messages cannot be edited."}, status=status.HTTP_400_BAD_REQUEST)
                if not can_edit_chat_message(message, request.user):
                    return Response({"detail": "This message can no longer be edited."}, status=status.HTTP_400_BAD_REQUEST)
                message.body = payload_serializer.validated_data["body"]
                message.edited_at = timezone.now()
                message.save(update_fields=["body", "edited_at", "updated_at"])
                transaction.on_commit(lambda updated_message=message: publish_game_chat_message(updated_message))
        except IntegrityError:
            return Response({"detail": "We could not update that message. Please try again."}, status=status.HTTP_409_CONFLICT)

        return Response({"message": GameChatMessageSerializer(message, context={"request": request}).data})

    def delete(self, request, game_id, message_id):
        game = get_game_or_none(game_id)
        access_level = self._room_access(game, request)
        if isinstance(access_level, Response):
            return access_level

        with transaction.atomic():
            message = GameChatMessage.objects.select_for_update().filter(game=game, pk=message_id).first()
            if not message:
                return Response({"detail": "Message not found."}, status=status.HTTP_404_NOT_FOUND)
            if message.sender_id != request.user.id:
                return Response({"detail": "You can only delete your own messages."}, status=status.HTTP_403_FORBIDDEN)
            if not message.deleted_at:
                message.deleted_at = timezone.now()
                message.save(update_fields=["deleted_at", "updated_at"])
                transaction.on_commit(lambda deleted_message=message: publish_game_chat_message(deleted_message))

        return Response({"message": GameChatMessageSerializer(message, context={"request": request}).data})


def base_game_queryset():
    return (
        Game.objects.select_related("host", "host__player_profile", "team", "booking", "booking__venue", "booking__court", "booking__slot")
        .prefetch_related("booking__slot_items__slot", "role_requirements", "participants__user__player_profile", "join_requests")
    )


def get_game_or_none(game_id):
    return base_game_queryset().filter(id=game_id).first()


def get_public_games(request):
    games = list(get_public_games_queryset(request))
    for game in games:
        synchronize_game_lifecycle(game)
    games = [game for game in games if game.status in [Game.Status.RECRUITING, Game.Status.FULL]]
    sort = str(request.query_params.get("sort", "soonest")).lower()
    if sort == "newest":
        return sorted(games, key=lambda item: item.published_at, reverse=True)
    if sort == "spots":
        return sorted(games, key=lambda item: item.available_spots, reverse=True)
    return sorted(games, key=lambda item: item.start_at or timezone.now())


def get_public_games_queryset(request):
    games = base_game_queryset().filter(is_public=True).exclude(status__in=[Game.Status.DRAFT, Game.Status.CANCELLED, Game.Status.COMPLETED])
    game_type = str(request.query_params.get("game_type", "")).upper()
    if game_type in Game.GameType.values:
        games = games.filter(game_type=game_type)
    search = str(request.query_params.get("search", "")).strip()
    if search:
        games = games.filter(
            Q(title__icontains=search)
            | Q(description__icontains=search)
            | Q(preferred_district__icontains=search)
            | Q(preferred_area__icontains=search)
            | Q(preferred_venue_name__icontains=search)
            | Q(booking__venue__name__icontains=search)
            | Q(booking__venue__area__icontains=search)
            | Q(booking__venue__city__icontains=search)
            | Q(booking__court__name__icontains=search)
        )
    booking_state = str(request.query_params.get("booking_state", "")).lower()
    if booking_state == "verified":
        games = games.filter(booking__isnull=False)
    elif booking_state == "planning":
        games = games.filter(booking__isnull=True)
    date = str(request.query_params.get("date", "")).strip()
    if date:
        games = games.filter(Q(booking__slot__date=date) | Q(proposed_date=date))
    area = str(request.query_params.get("area", "")).strip()
    if area:
        games = games.filter(Q(preferred_area__icontains=area) | Q(booking__venue__area__icontains=area) | Q(booking__venue__city__icontains=area))
    role = str(request.query_params.get("role", "")).upper()
    if role:
        games = games.filter(role_requirements__role=role).distinct()
    intensity = str(request.query_params.get("intensity", "")).upper()
    if intensity in Game.GameIntensity.values:
        games = games.filter(game_intensity=intensity)

    skill = str(request.query_params.get("skill", "")).upper()
    if skill in Game.SkillLevel.values and skill != Game.SkillLevel.OPEN:
        games = games.filter(Q(min_skill_level=skill) | Q(min_skill_level=Game.SkillLevel.OPEN))

    time_period = str(request.query_params.get("time_period", "")).lower()
    period_bounds = {
        "morning": (datetime_time(0, 0), datetime_time(12, 0)),
        "afternoon": (datetime_time(12, 0), datetime_time(17, 0)),
        "evening": (datetime_time(17, 0), datetime_time(23, 59, 59)),
    }
    if time_period in period_bounds:
        start_time, end_time = period_bounds[time_period]
        games = games.filter(
            Q(booking__slot__start_time__gte=start_time, booking__slot__start_time__lte=end_time)
            | Q(proposed_start_time__gte=start_time, proposed_start_time__lte=end_time)
        )

    games = games.annotate(
        active_spots_for_filter=Count(
            "participants",
            filter=Q(participants__status__in=ACTIVE_PARTICIPANT_STATUSES),
            distinct=True,
        )
    ).annotate(
        available_spots_for_filter=ExpressionWrapper(
            F("total_capacity") - F("active_spots_for_filter"),
            output_field=IntegerField(),
        )
    )
    min_spots = request.query_params.get("min_spots")
    try:
        min_spots_value = max(int(min_spots), 0) if min_spots not in [None, ""] else None
    except (TypeError, ValueError):
        min_spots_value = None
    if min_spots_value is not None:
        games = games.filter(available_spots_for_filter__gte=min_spots_value)

    waitlist_filter = str(request.query_params.get("waitlist", "")).lower()
    if waitlist_filter in {"1", "true", "enabled"}:
        games = games.filter(waitlist_enabled=True)

    status_filter = str(request.query_params.get("status", "")).upper()
    if status_filter in Game.Status.values:
        games = games.filter(status=status_filter)
    return games


def can_view_game_private(user, game):
    if game.host_id == user.id:
        return True
    if (
        game.game_type == Game.GameType.FILL_SQUAD
        and game.team_id
        and game.team.captain_id == user.id
        and TeamMember.objects.filter(
            team_id=game.team_id,
            user_id=user.id,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).exists()
    ):
        return True
    return game.participants.filter(user=user, status__in=ACTIVE_PARTICIPANT_STATUSES).exists()


def readable_error(exc):
    if hasattr(exc, "message_dict"):
        detail = exc.message_dict
    elif hasattr(exc, "messages"):
        detail = exc.messages
    else:
        detail = getattr(exc, "detail", exc)
    if isinstance(detail, list):
        return " ".join(str(item) for item in detail)
    if isinstance(detail, dict):
        return " ".join(str(item) for values in detail.values() for item in (values if isinstance(values, list) else [values]))
    return str(detail)




