from django.urls import path

from .views import (
    ChallengeBookingAttachView,
    ChallengeCancelView,
    ChallengeCounterView,
    ChallengeDecisionView,
    ChallengeWithdrawView,
    OpenChallengeResponseView,
    OpenOpponentSelectionView,
    PublicChallengeTeamDetailView,
    PublicChallengeTeamListView,
    PublicOpenChallengeListView,
    TeamChallengeDetailView,
    TeamChallengeListCreateView,
)


urlpatterns = [
    path("teams/", PublicChallengeTeamListView.as_view(), name="challenge-team-list"),
    path("teams/<int:team_id>/", PublicChallengeTeamDetailView.as_view(), name="challenge-team-detail"),
    path("challenges/", TeamChallengeListCreateView.as_view(), name="team-challenge-list-create"),
    path("challenges/public/", PublicOpenChallengeListView.as_view(), name="public-open-challenge-list"),
    path("challenges/<int:challenge_id>/", TeamChallengeDetailView.as_view(), name="team-challenge-detail"),
    path("challenges/<int:challenge_id>/decision/", ChallengeDecisionView.as_view(), name="team-challenge-decision"),
    path("challenges/<int:challenge_id>/counter/", ChallengeCounterView.as_view(), name="team-challenge-counter"),
    path("challenges/<int:challenge_id>/open-response/", OpenChallengeResponseView.as_view(), name="team-challenge-open-response"),
    path("challenges/<int:challenge_id>/select-opponent/", OpenOpponentSelectionView.as_view(), name="team-challenge-select-opponent"),
    path("challenges/<int:challenge_id>/withdraw/", ChallengeWithdrawView.as_view(), name="team-challenge-withdraw"),
    path("challenges/<int:challenge_id>/attach-booking/", ChallengeBookingAttachView.as_view(), name="team-challenge-attach-booking"),
    path("challenges/<int:challenge_id>/cancel/", ChallengeCancelView.as_view(), name="team-challenge-cancel"),
]
