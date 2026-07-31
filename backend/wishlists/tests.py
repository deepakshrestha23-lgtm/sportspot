from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from venues.models import Court, Venue
from .models import WishlistItem


class WishlistApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.player = User.objects.create_user(
            email="player@example.com",
            password="Password123!",
            full_name="Player One",
            phone="9800000000",
            role=User.Role.PLAYER,
            email_verified=True,
        )
        self.owner = User.objects.create_user(
            email="owner@example.com",
            password="Password123!",
            full_name="Owner One",
            phone="9800000001",
            role=User.Role.COURT_OWNER,
            email_verified=True,
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="NCS Indoor Cricksal",
            address="Baneshwor Height",
            city="Kathmandu",
            area="Baneshwor",
            contact_phone="9800000002",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Court 1",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )

    def test_player_can_toggle_venue_wishlist(self):
        self.client.force_authenticate(self.player)
        first_response = self.client.post("/api/wishlist/toggle/", {"item_type": "VENUE", "venue_id": self.venue.id}, format="json")
        self.assertEqual(first_response.status_code, 201)
        self.assertTrue(first_response.data["saved"])
        self.assertEqual(WishlistItem.objects.count(), 1)

        second_response = self.client.post("/api/wishlist/toggle/", {"item_type": "VENUE", "venue_id": self.venue.id}, format="json")
        self.assertEqual(second_response.status_code, 200)
        self.assertFalse(second_response.data["saved"])
        self.assertEqual(WishlistItem.objects.count(), 0)

    def test_summary_returns_saved_venue_and_court_ids(self):
        self.client.force_authenticate(self.player)
        WishlistItem.objects.create(user=self.player, item_type=WishlistItem.ItemType.VENUE, venue=self.venue)
        WishlistItem.objects.create(user=self.player, item_type=WishlistItem.ItemType.COURT, court=self.court)

        response = self.client.get("/api/wishlist/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["venue_ids"], [self.venue.id])
        self.assertEqual(response.data["court_ids"], [self.court.id])

    def test_court_owner_cannot_use_player_wishlist(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/wishlist/toggle/", {"item_type": "VENUE", "venue_id": self.venue.id}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(WishlistItem.objects.count(), 0)
