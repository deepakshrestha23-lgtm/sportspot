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
from venues.reference_data import SPORTSPOT_AREAS_BY_DISTRICT, SPORTSPOT_DISTRICTS
from sportspot_api.throttling import MutationThrottleMixin

from .models import ACTIVE_CHALLENGE_STATUSES, OpenChallengeResponse, TeamChallenge, TeamFixture
from .serializers import (
    ChallengeBookingAttachSerializer,
    ChallengeCounterSerializer,
    ChallengeDecisionSerializer,
    ChallengeReconfirmationSerializer,
    ChallengeRescheduleSerializer,
    ChallengeTeamSummarySerializer,
    CHALLENGE_INTENSITY_CHOICES,
    OpenChallengeResponseCreateSerializer,
    OpenChallengeResponseWithdrawSerializer,
    OpenOpponentSelectionSerializer,
    TeamChallengeCreateSerializer,
    TeamChallengeSerializer,
    TeamChallengeFilterSerializer,
    TeamFixtureSerializer,
    FixtureEligiblePlayerSerializer,
    FixtureAttendanceSerializer,
    FixtureParticipantCreateSerializer,
    FixtureResultSerializer,
)
from .services import (
    attach_booking_to_challenge,
    cancel_challenge,
    counter_challenge,
    create_challenge,
    decide_challenge,
    expire_team_challenges,
    respond_to_open_challenge,
    reschedule_challenge,
    reconfirm_challenge,
    select_open_opponent,
    withdraw_challenge,
    withdraw_open_challenge_response,
    add_fixture_participant,
    remove_fixture_participant,
    record_fixture_attendance,
    dispute_fixture_attendance,
    submit_fixture_result,
    confirm_fixture_result,
    get_challenge_fixture_room,
    eligible_fixture_players,
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
        member_type=TeamMember.MemberType.REGISTERED,
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


def validated_challenge_filters(request):
    serializer = TeamChallengeFilterSerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def choice_options(choices):
    return [{"value": value, "label": label} for value, label in choices]


def proposal_date_query(lookup, value):
    return (
        Q(**{f"current_proposal__proposed_date__{lookup}": value})
        | Q(**{f"current_proposal__booking__slot__date__{lookup}": value})
        | Q(**{f"current_proposal__booking__slot_items__slot__date__{lookup}": value})
    )


def apply_challenge_location_filters(challenges, filters):
    if filters.get("district"):
        district = filters["district"]
        challenges = challenges.filter(
            Q(current_proposal__preferred_district__iexact=district)
            | Q(current_proposal__booking__venue__city__iexact=district)
        )
    if filters.get("area"):
        area = filters["area"]
        challenges = challenges.filter(
            Q(current_proposal__preferred_area__iexact=area)
            | Q(current_proposal__booking__venue__area__iexact=area)
        )
    if filters.get("date_from"):
        challenges = challenges.filter(proposal_date_query("gte", filters["date_from"]))
    if filters.get("date_to"):
        challenges = challenges.filter(proposal_date_query("lte", filters["date_to"]))
    return challenges


def order_challenges(challenges, filters, *, default="updated_desc"):
    sort = filters.get("sort") or default
    if sort == "name_asc":
        return challenges.order_by("challenger_team__name", "id")
    if sort == "deadline_asc":
        return challenges.order_by("response_deadline", "-updated_at", "id")
    if sort == "date_asc":
        return challenges.order_by("current_proposal__proposed_date", "current_proposal__proposed_start_time", "id")
    if sort == "recommended":
        return challenges.order_by("current_proposal__proposed_date", "response_deadline", "-updated_at", "id")
    return challenges.order_by("-updated_at", "-created_at", "id")


class ChallengeReferenceDataView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(
            {
                "filters": {
                    "districts": [{"value": item, "label": item} for item in SPORTSPOT_DISTRICTS],
                    "areas_by_district": {
                        district: [{"value": area, "label": area} for area in areas]
                        for district, areas in SPORTSPOT_AREAS_BY_DISTRICT.items()
                    },
                    "skill_levels": choice_options(Team.SkillLevel.choices),
                    "intensities": choice_options(CHALLENGE_INTENSITY_CHOICES),
                    "court_modes": choice_options(TeamChallenge.CourtMode.choices),
                    "statuses": choice_options(TeamChallenge.Status.choices),
                    "sort_options": {
                        "teams": choice_options((
                            ("recommended", "Recommended"),
                            ("name_asc", "Team name"),
                        )),
                        "open": choice_options((
                            ("recommended", "Recommended"),
                            ("date_asc", "Earliest match"),
                            ("deadline_asc", "Response deadline"),
                        )),
                        "mine": choice_options((
                            ("updated_desc", "Recently updated"),
                            ("date_asc", "Match date"),
                            ("deadline_asc", "Response deadline"),
                        )),
                    },
                }
            }
        )


class PublicChallengeTeamListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        filters = validated_challenge_filters(request)
        teams = Team.objects.filter(
            accepts_team_challenges=True,
            members__member_type=TeamMember.MemberType.REGISTERED,
            members__status=TeamMember.MemberStatus.ACTIVE,
        ).select_related("captain").annotate(
            active_members_total=Count(
                "members",
                filter=Q(members__status=TeamMember.MemberStatus.ACTIVE),
                distinct=True,
            )
        ).distinct()
        search = filters.get("search", "").strip()
        if search:
            teams = teams.filter(
                Q(name__icontains=search)
                | Q(location__icontains=search)
                | Q(preferred_playing_area__icontains=search)
            )
        if request.user and request.user.is_authenticated:
            teams = teams.exclude(pk__in=user_team_ids(request.user))
        if filters.get("district"):
            teams = teams.filter(location__iexact=filters["district"])
        if filters.get("area"):
            # Teams created before the controlled location catalogue may store
            # several preferred areas in one text field, so keep those teams
            # discoverable when one supported area is selected.
            teams = teams.filter(preferred_playing_area__icontains=filters["area"])
        skill_level = filters.get("skill_level", "")
        if skill_level:
            teams = teams.filter(skill_level=skill_level)
        team_sort = filters.get("sort") or "recommended"
        if team_sort == "name_asc":
            teams = teams.order_by("name", "id")
        else:
            teams = teams.order_by("-active_members_total", "-updated_at", "-created_at", "id")
        try:
            requested_limit = int(request.query_params.get("limit", 30) or 30)
        except (TypeError, ValueError):
            requested_limit = 30
        limit = min(max(requested_limit, 1), 100)
        result_count = teams.count()
        return Response({"count": result_count, "teams": ChallengeTeamSummarySerializer(teams[:limit], many=True).data})


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


class TeamChallengeListCreateView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        expire_team_challenges(limit=50)
        filters = validated_challenge_filters(request)
        team_ids = user_team_ids(request.user)
        challenges = challenge_queryset().filter(
            Q(challenger_team_id__in=team_ids)
            | Q(challenged_team_id__in=team_ids)
            | Q(open_responses__responding_by=request.user)
        ).distinct()
        scope = filters.get("scope", "all")
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
        search = filters.get("search", "").strip()
        if search:
            challenges = challenges.filter(
                Q(challenger_team__name__icontains=search)
                | Q(challenged_team__name__icontains=search)
                | Q(current_proposal__preferred_area__icontains=search)
                | Q(current_proposal__preferred_district__icontains=search)
                | Q(current_proposal__preferred_venue_name__icontains=search)
            )
        challenges = apply_challenge_location_filters(challenges, filters)
        if filters.get("intensity"):
            challenges = challenges.filter(current_proposal__intensity=filters["intensity"])
        if filters.get("court_mode"):
            challenges = challenges.filter(current_proposal__court_mode=filters["court_mode"])
        if filters.get("players_per_side"):
            challenges = challenges.filter(current_proposal__players_per_side=filters["players_per_side"])
        if filters.get("status"):
            challenges = challenges.filter(status=filters["status"])
        challenges = order_challenges(challenges, filters, default="updated_desc")
        return Response({"count": challenges.count(), "challenges": TeamChallengeSerializer(challenges, many=True, context={"request": request}).data})

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
        filters = validated_challenge_filters(request)
        challenges = challenge_queryset().filter(
            is_public=True,
            challenge_type="OPEN",
            challenged_team__isnull=True,
            status="OPEN",
            response_deadline__gt=timezone.now(),
        )
        search = filters.get("search", "").strip()
        if search:
            challenges = challenges.filter(
                Q(challenger_team__name__icontains=search)
                | Q(current_proposal__preferred_area__icontains=search)
                | Q(current_proposal__preferred_district__icontains=search)
                | Q(current_proposal__preferred_venue_name__icontains=search)
            )
        challenges = apply_challenge_location_filters(challenges, filters)
        if filters.get("intensity"):
            challenges = challenges.filter(current_proposal__intensity=filters["intensity"])
        if filters.get("court_mode"):
            challenges = challenges.filter(current_proposal__court_mode=filters["court_mode"])
        if filters.get("players_per_side"):
            challenges = challenges.filter(current_proposal__players_per_side=filters["players_per_side"])
        challenges = order_challenges(challenges, filters, default="recommended")
        result_count = challenges.count()
        return Response({"count": result_count, "challenges": TeamChallengeSerializer(challenges[:100], many=True, context={"request": request}).data})


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


class ChallengeDecisionView(MutationThrottleMixin, APIView):
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


class ChallengeCounterView(MutationThrottleMixin, APIView):
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


class ChallengeReconfirmationView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = ChallengeReconfirmationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = reconfirm_challenge(
                challenge_id,
                request.user,
                serializer.validated_data["action"],
            )
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class ChallengeRescheduleView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = ChallengeRescheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = reschedule_challenge(challenge_id, request.user, serializer.validated_data)
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This team challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"detail": "That court booking is no longer available for this schedule change. Refresh and choose another."}, status=status.HTTP_409_CONFLICT)
        challenge = challenge_queryset().get(pk=challenge.pk)
        return Response({"challenge": TeamChallengeSerializer(challenge, context={"request": request}).data})


class OpenChallengeResponseView(MutationThrottleMixin, APIView):
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


class OpenChallengeResponseWithdrawView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, challenge_id):
        serializer = OpenChallengeResponseWithdrawSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            response = withdraw_open_challenge_response(
                challenge_id,
                serializer.validated_data["response_id"],
                request.user,
            )
        except TeamChallenge.DoesNotExist:
            return Response({"detail": "This open challenge is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"response_id": response.id, "status": response.status})


class OpenOpponentSelectionView(MutationThrottleMixin, APIView):
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


class ChallengeWithdrawView(MutationThrottleMixin, APIView):
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


class ChallengeBookingAttachView(MutationThrottleMixin, APIView):
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


class ChallengeCancelView(MutationThrottleMixin, APIView):
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


class FixtureParticipantCreateView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, fixture_id):
        serializer = FixtureParticipantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            participant = add_fixture_participant(
                fixture_id,
                request.user,
                serializer.validated_data["player_id"],
            )
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"detail": "That player was just added to this lineup. Refresh to see the latest roster."}, status=status.HTTP_409_CONFLICT)
        return Response({"fixture": TeamFixtureSerializer(participant.fixture, context={"request": request}).data}, status=status.HTTP_201_CREATED)


class ChallengeFixtureRoomView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, challenge_id):
        try:
            fixture = get_challenge_fixture_room(challenge_id, request.user)
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match does not have a coordination room yet."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_403_FORBIDDEN)
        challenge = challenge_queryset().get(pk=fixture.challenge_id)
        return Response({
            "challenge": TeamChallengeSerializer(challenge, context={"request": request}).data,
            "fixture": TeamFixtureSerializer(fixture, context={"request": request}).data,
        })


class FixtureEligiblePlayersView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request, fixture_id):
        try:
            players = eligible_fixture_players(fixture_id, request.user)
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"players": FixtureEligiblePlayerSerializer(players, many=True).data})


class FixtureParticipantRemoveView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, fixture_id, participant_id):
        try:
            participant = remove_fixture_participant(fixture_id, participant_id, request.user)
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"fixture": TeamFixtureSerializer(participant.fixture, context={"request": request}).data})


class FixtureAttendanceView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, fixture_id, participant_id):
        serializer = FixtureAttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            participant = record_fixture_attendance(
                fixture_id,
                participant_id,
                request.user,
                serializer.validated_data["status"],
            )
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This completed team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"fixture": TeamFixtureSerializer(participant.fixture, context={"request": request}).data})


class FixtureAttendanceDisputeView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, fixture_id, participant_id):
        try:
            commitment = dispute_fixture_attendance(
                fixture_id,
                participant_id,
                request.user,
                request.data.get("reason", ""),
            )
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "attendance": {
                "id": commitment.id,
                "status": commitment.status,
                "disputed_at": commitment.disputed_at.isoformat() if commitment.disputed_at else None,
            },
        })


class FixtureResultView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, fixture_id):
        serializer = FixtureResultSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            fixture = submit_fixture_result(fixture_id, request.user, serializer.validated_data["result"])
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        response_status = status.HTTP_200_OK if getattr(fixture, "_idempotent_replay", False) else status.HTTP_201_CREATED
        return Response({"fixture": TeamFixtureSerializer(fixture, context={"request": request}).data}, status=response_status)


class FixtureResultConfirmView(MutationThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, fixture_id):
        try:
            fixture = confirm_fixture_result(fixture_id, request.user)
        except TeamFixture.DoesNotExist:
            return Response({"detail": "This team match is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"fixture": TeamFixtureSerializer(fixture, context={"request": request}).data})
