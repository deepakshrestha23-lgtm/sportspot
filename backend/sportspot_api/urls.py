from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/players/", include("players.urls")),
    path("api/teams/", include("teams.urls")),
    path("api/matchmaking/", include("matchmaking.urls")),
    path("api/team-challenges/", include("team_challenges.urls")),
    path("api/scoring/", include("scoring.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/venues/", include("venues.urls")),
    path("api/wishlist/", include("wishlists.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

