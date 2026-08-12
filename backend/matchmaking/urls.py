from django.urls import path

from .views import (
    EligibleBookingListView,
    GameAttachBookingView,
    GameCancelView,
    GameDetailView,
    GameGuestParticipantView,
    GameInvitationResponseView,
    GameJoinRequestCreateView,
    GameLeaveView,
    GamePlayerLookupView,
    GameRegisteredPlayerInviteView,
    GameListCreateView,
    GameManageView,
    GameReconfirmView,
    GameRoomView,
    JoinRequestDecisionView,
    JoinRequestWithdrawView,
    MyGamesView,
)

urlpatterns = [
    path("games/", GameListCreateView.as_view(), name="matchmaking-games"),
    path("games/eligible-bookings/", EligibleBookingListView.as_view(), name="matchmaking-eligible-bookings"),
    path("games/my/", MyGamesView.as_view(), name="matchmaking-my-games"),
    path("games/<int:game_id>/", GameDetailView.as_view(), name="matchmaking-game-detail"),
    path("games/<int:game_id>/manage/", GameManageView.as_view(), name="matchmaking-game-manage"),
    path("games/<int:game_id>/request/", GameJoinRequestCreateView.as_view(), name="matchmaking-game-request"),
    path("games/<int:game_id>/guests/", GameGuestParticipantView.as_view(), name="matchmaking-game-guests"),
    path("games/<int:game_id>/players/lookup/", GamePlayerLookupView.as_view(), name="matchmaking-game-player-lookup"),
    path("games/<int:game_id>/invite/", GameRegisteredPlayerInviteView.as_view(), name="matchmaking-game-invite"),
    path("games/<int:game_id>/attach-booking/", GameAttachBookingView.as_view(), name="matchmaking-game-attach-booking"),
    path("games/<int:game_id>/reconfirm/", GameReconfirmView.as_view(), name="matchmaking-game-reconfirm"),
    path("games/<int:game_id>/leave/", GameLeaveView.as_view(), name="matchmaking-game-leave"),
    path("games/<int:game_id>/cancel/", GameCancelView.as_view(), name="matchmaking-game-cancel"),
    path("games/<int:game_id>/room/", GameRoomView.as_view(), name="matchmaking-game-room"),
    path("requests/<int:request_id>/decide/", JoinRequestDecisionView.as_view(), name="matchmaking-request-decision"),
    path("requests/<int:request_id>/withdraw/", JoinRequestWithdrawView.as_view(), name="matchmaking-request-withdraw"),
    path("requests/<int:request_id>/respond-invitation/", GameInvitationResponseView.as_view(), name="matchmaking-request-respond-invitation"),
]

