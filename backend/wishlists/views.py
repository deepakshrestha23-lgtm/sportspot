from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from venues.models import Court, Venue
from .models import WishlistItem
from .serializers import WishlistItemSerializer, WishlistToggleSerializer


class IsPlayer(permissions.BasePermission):
    message = "Only player accounts can use wishlist."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == User.Role.PLAYER)


class WishlistListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        items = get_player_wishlist(request.user)
        return Response({"items": WishlistItemSerializer(items, many=True, context={"request": request}).data})


class WishlistSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        items = get_player_wishlist(request.user)
        return Response(
            {
                "venue_ids": list(items.filter(item_type=WishlistItem.ItemType.VENUE).values_list("venue_id", flat=True)),
                "court_ids": list(items.filter(item_type=WishlistItem.ItemType.COURT).values_list("court_id", flat=True)),
            }
        )


class WishlistToggleView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request):
        serializer = WishlistToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item_type = serializer.validated_data["item_type"]

        if item_type == WishlistItem.ItemType.VENUE:
            venue = get_object_or_404(Venue, pk=serializer.validated_data["venue_id"], status=Venue.Status.APPROVED, is_active=True)
            item, created = WishlistItem.objects.get_or_create(user=request.user, item_type=item_type, venue=venue)
        else:
            court = get_object_or_404(Court.objects.select_related("venue"), pk=serializer.validated_data["court_id"], is_active=True, venue__status=Venue.Status.APPROVED, venue__is_active=True)
            item, created = WishlistItem.objects.get_or_create(user=request.user, item_type=item_type, court=court)

        if not created:
            item.delete()
            return Response({"saved": False, "item": None})

        return Response({"saved": True, "item": WishlistItemSerializer(item, context={"request": request}).data}, status=status.HTTP_201_CREATED)


class WishlistItemDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def delete(self, request, item_id):
        item = get_object_or_404(WishlistItem, pk=item_id, user=request.user)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def get_player_wishlist(user):
    return (
        WishlistItem.objects.filter(user=user)
        .select_related("venue", "court", "court__venue")
        .prefetch_related("venue__courts", "venue__photos", "court__slots")
    )
