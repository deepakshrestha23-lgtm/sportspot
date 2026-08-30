from django.urls import path

from .views import (
    PlayerDashboardOverviewView,
    PlayerProfileView,
    PlayerRatingEligibilitySubmitView,
    PlayerRatingsReliabilityView,
    ParticipationDisputeResolveView,
)

urlpatterns = [
    path("profile/", PlayerProfileView.as_view(), name="player-profile"),
    path("dashboard/overview/", PlayerDashboardOverviewView.as_view(), name="player-dashboard-overview"),
    path("ratings-reliability/", PlayerRatingsReliabilityView.as_view(), name="player-ratings-reliability"),
    path(
        "ratings/eligibilities/<int:eligibility_id>/submit/",
        PlayerRatingEligibilitySubmitView.as_view(),
        name="player-rating-submit",
    ),
    path(
        "attendance/<int:commitment_id>/resolve/",
        ParticipationDisputeResolveView.as_view(),
        name="player-attendance-dispute-resolve",
    ),
]
