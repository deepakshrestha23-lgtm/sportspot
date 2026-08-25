import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from datetime import time as datetime_time

from django.db.models import Count, ExpressionWrapper, F, IntegerField, Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from players.models import PlayerProfile
from venues.models import Booking
from venues.permissions import IsPlayer

from .models import ACTIVE_PARTICIPANT_STATUSES, Game, JoinRequest
from .serializers import (
    EligibleBookingSerializer,
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
    eligible_bookings_for_user,
    ensure_role_has_space,
    invite_player_to_game,
    leave_game,
    notify_game_cancelled,
    reconfirm_game,
    respond_game_invitation,
    synchronize_game_lifecycle,
    remove_game_participant,
    update_game_host_settings,
    update_game_participant,
)


class GameListCreateView(APIView):
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
        return Response({"game": GameSerializer(game, context={"request": request}).data}, status=status.HTTP_201_CREATED)


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


class GameJoinRequestCreateView(APIView):
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


class JoinRequestDecisionView(APIView):
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


class JoinRequestWithdrawView(APIView):
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
        game = Game.objects.select_for_update().get(pk=game_id)
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
        join_request.status = JoinRequest.Status.WITHDRAWN
        join_request.decided_at = timezone.now()
        join_request.save(update_fields=["status", "decided_at", "updated_at"])
        resequence_waitlist(game)
        return Response({"request": JoinRequestSerializer(join_request).data})


class MyGamesView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        user = request.user
        hosted = base_game_queryset().filter(host=user)
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
        upcoming = participating.filter(status__in=[Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED, Game.Status.IN_PROGRESS])
        completed = participating.filter(status=Game.Status.COMPLETED)
        cancelled = participating.filter(status=Game.Status.CANCELLED)
        return Response(
            {
                "upcoming": GameSerializer(upcoming, many=True, context={"request": request}).data,
                "hosted": GameSerializer(hosted.exclude(status=Game.Status.COMPLETED), many=True, context={"request": request}).data,
                "requests": JoinRequestSerializer(requests, many=True).data,
                "incoming_requests": JoinRequestSerializer(incoming_requests, many=True).data,
                "completed": GameSerializer(completed, many=True, context={"request": request}).data,
                "cancelled": GameSerializer(cancelled, many=True, context={"request": request}).data,
            }
        )


class GameManageView(APIView):
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


class GameParticipantManageView(APIView):
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


class GameGuestParticipantView(APIView):
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


class GameRegisteredPlayerInviteView(APIView):
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


class GameInvitationResponseView(APIView):
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


class GameAttachBookingView(APIView):
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


class GameReconfirmView(APIView):
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


class GuestScheduleConfirmationView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, game_id, participant_id):
        try:
            participant = confirm_guest_schedule(game_id, participant_id, request.user)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError as exc:
            return Response({"detail": readable_error(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"participant": GameParticipantSerializer(participant).data})


class GameLeaveView(APIView):
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


class GameCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    @transaction.atomic
    def post(self, request, game_id):
        game = Game.objects.select_for_update(of=("self",)).order_by().select_related("host").filter(id=game_id).first()
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        if game.host_id != request.user.id:
            return Response({"detail": "Only the host can cancel this game."}, status=status.HTTP_403_FORBIDDEN)
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
        game.save(update_fields=["status", "is_public", "cancelled_at", "cancellation_reason", "updated_at"])
        # Close pending requests immediately; the scheduled worker remains
        # the recovery path for cancellations made outside this endpoint.
        expire_open_join_requests_for_game(game, now=now)
        notify_game_cancelled(game, request.user)
        return Response({"game": GameSerializer(game, context={"request": request}).data})


class GameCloseRecruitmentView(APIView):
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


class GameReopenRecruitmentView(APIView):
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


class GameRoomView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game, expire_requests=True)
        if not can_view_game_private(request.user, game):
            return Response({"detail": "You do not have access to this game room."}, status=status.HTTP_403_FORBIDDEN)
        return Response({"game": GameSerializer(game, context={"request": request}).data})

    def patch(self, request, game_id):
        game = get_game_or_none(game_id)
        if not game:
            return Response({"detail": "Game not found."}, status=status.HTTP_404_NOT_FOUND)
        synchronize_game_lifecycle(game, expire_requests=True)
        if game.host_id != request.user.id:
            return Response({"detail": "Only the host can update game room instructions."}, status=status.HTTP_403_FORBIDDEN)
        game.game_room_note = str(request.data.get("game_room_note", "")).strip()[:500]
        game.save(update_fields=["game_room_note", "updated_at"])
        return Response({"game": GameSerializer(game, context={"request": request}).data})


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




