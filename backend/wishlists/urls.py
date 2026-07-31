from django.urls import path

from .views import WishlistItemDeleteView, WishlistListView, WishlistSummaryView, WishlistToggleView

urlpatterns = [
    path("", WishlistListView.as_view(), name="wishlist-list"),
    path("summary/", WishlistSummaryView.as_view(), name="wishlist-summary"),
    path("toggle/", WishlistToggleView.as_view(), name="wishlist-toggle"),
    path("<int:item_id>/", WishlistItemDeleteView.as_view(), name="wishlist-delete"),
]
