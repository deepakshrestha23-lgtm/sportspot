from django.urls import path

from .views import PlayerProfileView

urlpatterns = [
    path("profile/", PlayerProfileView.as_view(), name="player-profile"),
]
