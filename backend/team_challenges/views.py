from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from teams.models import Team, TeamMember
from venues.permissions import IsPlayer

from .models import ACTIVE_CHALLENGE_STATUSES, OpenChallengeResponse, TeamChallenge
from .serializers import (
    ChallengeBookingAttachSerializer,
    ChallengeCounterSerializer,
    ChallengeDecisionSerializer,
    ChallengeTeamSummarySerializer,
    OpenChallengeResponseCreateSerializer,
    OpenOpponentSelectionSerializer,
    TeamChallengeCreateSerializer,
    TeamChallengeSerializer,
)
from .services import (
    attach_booking_to_challenge,
    cancel_challenge,
    counter_challenge,
    create_challenge,
    decide_challenge,
    expire_team_challenges,
    respond_to_open_challenge,
    select_open_opponent,
    withdraw_challenge,
)


def readable_error(error):
    messages = getattr(error, "messages", None) or [str(error)]
    return " ".join(str(message) for message in messages)


def challenge_queryset():
    return (
        TeamChallenge.objects.select_related(
            "challenger_team",
            "challenger_team__captain",
            "challenged_team",
            "challenged_team__captain",
            "current_proposal",
            "current_proposal__created_by_team",
            "current_proposal__booking",
            "current_proposal__booking__venue",
            "current_proposal__booking__court",
            "booking",
            "booking__venue",
            "booking__court",
            "fixture",
        )
        .prefetch_related(
            "open_responses__responding_team",
            "open_responses__responding_team__captain",
        )
        .annotate(
            open_response_count=Count(
                "open_responses",
                filter=Q(open_responses__status=OpenChallengeResponse.Status.PENDING),
                distinct=True,
            )
        )
    )


def user_team_ids(user):
    return TeamMember.objects.filter(
        user=user,
        status=TeamMember.MemberStatus.ACTIVE,
    ).values("team_id")


def can_view_challenge(user, challenge):
    if challenge.is_open_for_opponent_response:
        return True
    if not user or not user.is_authenticated:
        return False
    team_ids = user_team_ids(user)
    visible_team_ids = [team_id for team_id in [challenge.challenger_team_id, challenge.challenged_team_id] if team_id]
    if Team.objects.filter(pk__in=team_ids).filter(pk__in=visible_team_ids).exists():
        return True
    # Keep a respondent able to see the final outcome of an open challenge
    # after another team has been selected, without exposing it to strangers.
    return OpenChallengeResponse.objects.filter(challenge=challenge, responding_by=user).exists()


class PublicChallengeTeamListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        teams = Team.objects.filter(
            accepts_team_challenges=True,
            members__status=TeamMember.MemberStatus.ACTIVE,
        ).select_related("captain").annotate(
            active_members_total=Count(
                "members",
                filter=Q(members__status=TeamMember.MemberStatus.ACTIVE),
                distinct=True,
            )
        ).distinct()
        search = str(request.query_params.get("search", "")).strip()
        if search:
            teams = teams.filter(
                Q(name__icontains=search)
                | Q(location__icontains=search)
                | Q(preferred_playing_area__icontains=search)
            )
        if request.user and request.user.is_authenticated:
            teams = teams.exclude(pk__in=user_team_ids(request.user))
        skill_level = str(request.query_params.get("skill_level", "")).strip().upper()
        if skill_level:
            teams = teams.filter(skill_level=skill_level)
        try:
            requested_limit = int(request.query_params.get("limit", 30) or 30)
        except (TypeError, ValueError):
            requested_limit = 30
        limit = min(max(requested_limit, 1), 100)
        return Response({"teams": ChallengeTeamSummarySerializer(teams[:limit], many=True).data})


class PublicChallengeTeamDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, team_id):
        team = get_object_or_404(
            Team.objects.filter(accepts_team_challenges=True).select_related("captain").annotate(
                active_members_total=Count(
                    "members",
                    filter=Q(members__status=TeamMember.MemberStatus.ACTIVE),
                    distinct=True,
                )
            ),
            pk=team_id,
        )
        return Response({"team": ChallengeTeamSummarySerializer(team).data})


class TeamChallengeListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        expire_team_challenges(limit=50)
        team_ids = user_team_ids(request.user)
        challenges = challenge_queryset().filter(
            Q(challenger_team_id__in=team_ids)
            | Q(challenged_team_id__in=team_ids)
            | Q(open_responses__responding_by=request.user)
        ).distinct()
        scope = str(request.query_params.get("scope", "all")).strip().lower()
        if scope == "sent":
            challenges = challenges.filter(challenger_team_id__in=team_ids)
        elif scope == "received":
            challenges = challenges.filter(challenged_team_id__in=team_ids)
        elif scope == "open":
            challenges = challenges.filter(
                is_public=True,
                challenge_type="OPEN",
                challenged_team__isnull=True,
                status="OPEN",
                response_deadline__gt=timezone.now(),
            )
        elif scope == "closed":
            challenges = challenges.exclude(status__in=ACTIVE_CHALLENGE_STATUSES)
        search = str(request.query_params.get("search", "")).strip()
        if search:
            challenges = challenges.filter(
                Q(challenger_team__name__icontains=search)
                | Q(challenged_team__name__icontains=search)
                | Q(current_proposal__preferred_area__icontains=search)
                | Q(current_proposal__preferred_district__icontains=search)
                | Q(current_proposal__preferred_venue_name__icontains=search)
            )
        return Response({"challenges": TeamChallengeSerializer(challenges, many=True, context={"request": request}).data})

    def post(self, request):
        serializer = TeamChallengeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = create_challenge(serializer.validated_data, request.user)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"detail": "This challenge could not be created because one of the selected records is already in use. Refresh and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        response_status = status.HTTP_200_OK if getattr(challenge, "_idempotent_replay", False) else status.HTTP_201_CREATED
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response(
            {"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data},
            status=response_status,
        )


class PublicOpenChallengeListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        expire_team_challenges(limit=50)
        challenges = challenge_queryset().filter(
            is_public=True,
            challenge_type="OPEN",
            challenged_team__isnull=True,
            status="OPEN",
            response_deadline__gt=timezone.now(),
        )
        search = str(request.query_params.get("search", "")).strip()
        if search:
            challenges = challenges.filter(
                Q(challenger_team__name__icontains=search)
                | Q(current_proposal__preferred_area__icontains=search)
                | Q(current_proposal__preferred_district__icontains=search)
                | Q(current_proposal__preferred_venue_name__icontains=search)
            )
        return Response({"challenges": TeamChallengeSerializer(challenges[:100], many=True, context={"request": request}).data})


class TeamChallengeDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, challenge_id):
        # Keep a directly opened challenge consistent with list views even if
        # the scheduled maintenance process has not run since its deadline.
        expire_team_challenges(limit=50)
        challenge = get_object_or_404(challenge_queryset(), pk=challenge_id)
        if not can_view_challenge(request.user, challenge):
            return Response({"detail": "This team challenge is not available."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class ChallengeDecisionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = ChallengeDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = decide_challenge(challenge_id, request.user, serializer.validated_data["action"])
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class ChallengeCounterView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = ChallengeCounterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = counter_challenge(challenge_id, request.user, serializer.validated_data)
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class OpenChallengeResponseView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = OpenChallengeResponseCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            response = respond_to_open_challenge(
                challenge_id,
                request.user,
                message=serializer.validated_data.get("message", ""),
                team_id=serializer.validated_data["team"].pk,
            )
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This open challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"detail": "That team has just responded to this challenge. Refresh to see the latest status."}, status=status.HTTP_409_CONFLICT)
        response_status = status.HTTP_200_OK if getattr(response, "_idempotent_replay", False) else status.HTTP_201_CREATED
        return Response({"response_id": response.id, "status": response.status}, status=response_status)


class OpenOpponentSelectionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = OpenOpponentSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = select_open_opponent(challenge_id, serializer.validated_data["response_id"], request.user)
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This open challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"detail": "Another team was selected just now. Refresh to see the latest challenge status."}, status=status.HTTP_409_CONFLICT)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class ChallengeWithdrawView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        try:
            challenge = withdraw_challenge(challenge_id, request.user)
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class ChallengeBookingAttachView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = ChallengeBookingAttachSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = attach_booking_to_challenge(challenge_id, serializer.validated_data["booking"].pk, request.user)
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class ChallengeCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        try:
            challenge = cancel_challenge(challenge_id, request.user)
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})
