from django.urls import path

from .views import (
    CricketDeliveryEditView,
    CricketDeliveryUndoView,
    CricketInningsStartView,
    CricketNextBowlerView,
    CricketScorerAssignmentView,
    CricketScorecardDetailView,
    CricketScorecardAvailableView,
    CricketScorecardSetupView,
    CricketScoreDeliveryView,
    CricketSquadConfirmView,
    PlayerCricketPerformanceView,
    CricketTossView,
    ScoringMatchRequestDecisionView,
    ScoringMatchRequestListCreateView,
    ScoringTeamsView,
)


urlpatterns = [
    path("my-performance/", PlayerCricketPerformanceView.as_view(), name="player-cricket-performance"),
    path("teams/", ScoringTeamsView.as_view(), name="scoring-teams"),
    path("match-requests/", ScoringMatchRequestListCreateView.as_view(), name="scoring-match-requests"),
    path("match-requests/<int:request_id>/<str:decision>/", ScoringMatchRequestDecisionView.as_view(), name="scoring-match-request-decision"),
    path("fixtures/available/", CricketScorecardAvailableView.as_view(), name="cricket-scorecards-available"),
    path("fixtures/<int:fixture_id>/", CricketScorecardDetailView.as_view(), name="cricket-scorecard-detail"),
    path("fixtures/<int:fixture_id>/setup/", CricketScorecardSetupView.as_view(), name="cricket-scorecard-setup"),
    path("fixtures/<int:fixture_id>/squad/", CricketSquadConfirmView.as_view(), name="cricket-scorecard-squad"),
    path("fixtures/<int:fixture_id>/scorer/", CricketScorerAssignmentView.as_view(), name="cricket-scorecard-scorer"),
    path("fixtures/<int:fixture_id>/toss/", CricketTossView.as_view(), name="cricket-scorecard-toss"),
    path("fixtures/<int:fixture_id>/innings/start/", CricketInningsStartView.as_view(), name="cricket-innings-start"),
    path("fixtures/<int:fixture_id>/innings/bowler/", CricketNextBowlerView.as_view(), name="cricket-innings-bowler"),
    path("fixtures/<int:fixture_id>/deliveries/", CricketScoreDeliveryView.as_view(), name="cricket-delivery-create"),
    path("fixtures/<int:fixture_id>/deliveries/undo/", CricketDeliveryUndoView.as_view(), name="cricket-delivery-undo"),
    path("fixtures/<int:fixture_id>/deliveries/edit/", CricketDeliveryEditView.as_view(), name="cricket-delivery-edit"),
]
