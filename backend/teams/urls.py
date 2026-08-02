from django.urls import path

from .views import (
    GuestMemberCreateView,
    InvitationDecisionView,
    MyInvitationsView,
    MyTeamsView,
    PlayerLookupView,
    RegisteredPlayerInviteView,
    TeamCreateView,
    TeamDetailView,
    TeamLeaveView,
    TeamMemberRemoveView,
)

urlpatterns = [
    path("players/lookup/", PlayerLookupView.as_view(), name="team-player-lookup"),
    path("my-teams/", MyTeamsView.as_view(), name="my-teams"),
    path("invitations/", MyInvitationsView.as_view(), name="my-team-invitations"),
    path("invitations/<int:member_id>/accept/", InvitationDecisionView.as_view(), {"decision": "accept"}, name="team-invitation-accept"),
    path("invitations/<int:member_id>/reject/", InvitationDecisionView.as_view(), {"decision": "reject"}, name="team-invitation-reject"),
    path("", TeamCreateView.as_view(), name="team-create"),
    path("<int:team_id>/", TeamDetailView.as_view(), name="team-detail"),
    path("<int:team_id>/invite/", RegisteredPlayerInviteView.as_view(), name="team-registered-player-invite"),
    path("<int:team_id>/leave/", TeamLeaveView.as_view(), name="team-leave"),
    path("<int:team_id>/members/guest/", GuestMemberCreateView.as_view(), name="team-guest-member-create"),
    path("<int:team_id>/members/<int:member_id>/", TeamMemberRemoveView.as_view(), name="team-member-remove"),
]
