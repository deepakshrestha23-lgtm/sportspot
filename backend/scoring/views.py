from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from team_challenges.models import TeamFixture
from venues.permissions import IsPlayer

from .serializers import (
    BowlerChangeSerializer,
    DeliverySerializer,
    InningsStartSerializer,
    ScoringMatchRequestCreateSerializer,
    ScorecardSetupSerializer,
    ScorecardSquadSerializer,
    ScorerAssignmentSerializer,
    TossSerializer,
)


def readable_error(error):
    messages = getattr(error, "messages", None) or [str(error)]
    return " ".join(str(message) for message in messages)
from .services import (
    accept_scoring_match_request,
    assign_scorer,
    cancel_scoring_match_request,
    choose_next_bowler,
    confirm_team_squad,
    create_or_update_scorecard,
    decline_scoring_match_request,
    edit_last_delivery,
    get_available_scorecards,
    get_scorer_teams,
    get_scoring_match_requests,
    get_scorecard_for_fixture,
    record_delivery,
    record_toss,
    send_scoring_match_request,
    start_innings,
    undo_last_delivery,
    scorecard_snapshot,
)
from .performance import get_player_cricket_performance
from .models import ScoringMatchRequest


class CricketScorecardView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def _not_found(self):
        return Response(
            {"detail": "This confirmed team match is no longer available."},
            status=status.HTTP_404_NOT_FOUND,
        )

    def _validation_error(self, error):
        return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)

    def _snapshot_response(self, match, request, response_status=status.HTTP_200_OK):
        return Response(
            {"scorecard": scorecard_snapshot(match, request.user)},
            status=response_status,
        )


class CricketScorecardAvailableView(CricketScorecardView):
    def get(self, request):
        return Response({"fixtures": get_available_scorecards(request.user)})


class PlayerCricketPerformanceView(APIView):
    """Authenticated player's private, scorer-backed performance record."""

    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        period = request.query_params.get("period", "ALL").upper()
        if period not in {"ALL", "RECENT"}:
            return Response({"detail": "Choose ALL or RECENT for the performance period."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            team_id = int(request.query_params["team_id"]) if request.query_params.get("team_id") else None
            page = max(int(request.query_params.get("page", "1")), 1)
            page_size = min(max(int(request.query_params.get("page_size", "10")), 1), 25)
        except (TypeError, ValueError):
            return Response({"detail": "The selected performance filter is invalid."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            get_player_cricket_performance(
                request.user,
                team_id=team_id,
                period=period,
                page=page,
                page_size=page_size,
            )
        )


class ScoringTeamsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        return Response(get_scorer_teams(request.user, search=request.query_params.get("search", "")))


class ScoringMatchRequestListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        return Response(get_scoring_match_requests(request.user))

    def post(self, request):
        serializer = ScoringMatchRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            match_request, created = send_scoring_match_request(actor=request.user, **serializer.validated_data)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        snapshot = get_scoring_match_requests(request.user)
        created_request = next((item for item in snapshot["outgoing"] if item["id"] == match_request.id), None)
        return Response({"request": created_request}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ScoringMatchRequestDecisionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, request_id, decision):
        if decision not in {"accept", "decline", "cancel"}:
            return Response({"detail": "Choose accept, decline, or cancel."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            if decision == "accept":
                match_request, _created = accept_scoring_match_request(request_id=request_id, actor=request.user)
            elif decision == "decline":
                match_request = decline_scoring_match_request(request_id=request_id, actor=request.user)
            else:
                match_request = cancel_scoring_match_request(request_id=request_id, actor=request.user)
        except ScoringMatchRequest.DoesNotExist:
            return Response({"detail": "That scoring match request is no longer available."}, status=status.HTTP_404_NOT_FOUND)
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "request_id": match_request.id,
            "status": match_request.status,
            "fixture_id": match_request.fixture_id,
            "requests": get_scoring_match_requests(request.user),
        })


class CricketScorecardDetailView(CricketScorecardView):
    def get(self, request, fixture_id):
        try:
            return Response({"scorecard": get_scorecard_for_fixture(fixture_id, request.user)})
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return Response({"detail": readable_error(error)}, status=status.HTTP_403_FORBIDDEN)


class CricketScorecardSetupView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = ScorecardSetupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            match = create_or_update_scorecard(
                fixture_id,
                request.user,
                serializer.validated_data["overs_per_innings"],
            )
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(match, request, status.HTTP_201_CREATED)


class CricketSquadConfirmView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = ScorecardSquadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            match = confirm_team_squad(fixture_id, request.user, serializer.validated_data["player_ids"])
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(match, request)


class CricketScorerAssignmentView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = ScorerAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            match = assign_scorer(fixture_id, request.user, serializer.validated_data["scorer_id"])
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(match, request)


class CricketTossView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = TossSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            match = record_toss(
                fixture_id,
                request.user,
                serializer.validated_data["winner_team_id"],
                serializer.validated_data["decision"],
            )
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(match, request)


class CricketInningsStartView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = InningsStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            innings = start_innings(fixture_id, request.user, **serializer.validated_data)
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(innings.match, request)


class CricketNextBowlerView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = BowlerChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            innings = choose_next_bowler(fixture_id, request.user, serializer.validated_data["bowler_id"])
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(innings.match, request)


class CricketScoreDeliveryView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = DeliverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            delivery = record_delivery(fixture_id, request.user, serializer.validated_data)
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(delivery.innings.match, request, status.HTTP_201_CREATED)


class CricketDeliveryUndoView(CricketScorecardView):
    def post(self, request, fixture_id):
        try:
            delivery = undo_last_delivery(fixture_id, request.user)
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(delivery.innings.match, request)


class CricketDeliveryEditView(CricketScorecardView):
    def post(self, request, fixture_id):
        serializer = DeliverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            delivery = edit_last_delivery(fixture_id, request.user, serializer.validated_data)
        except TeamFixture.DoesNotExist:
            return self._not_found()
        except DjangoValidationError as error:
            return self._validation_error(error)
        return self._snapshot_response(delivery.innings.match, request)
