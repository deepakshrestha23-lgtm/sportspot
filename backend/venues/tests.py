from datetime import datetime, time, timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from notifications.models import EmailDelivery, Notification
from notifications.services import (
    notify_booking_cancelled,
    notify_booking_confirmed,
    notify_owner_venue_review,
)
from players.models import ParticipationCommitment, ReliabilityEvent
from venues.policies import build_cancellation_policy_snapshot, get_cancellation_quote
from venues.location import search_locations
from venues.models import Booking, BookingCheckIn, BookingSlot, Court, CourtFeedbackReport, CourtFeedbackReaction, CourtReview, CourtReviewComment, CourtSlot, Venue


class VenueLocationApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="location-owner@example.com",
            password="test-password",
            full_name="Location Owner",
            phone="9800000001",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="location-player@example.com",
            password="test-password",
            full_name="Location Player",
            phone="9800000002",
            role="PLAYER",
        )

    def test_owner_can_save_a_confirmed_coordinate_pair(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {
                "name": "Location Cricksal Arena",
                "latitude": "27.717200",
                "longitude": "85.324000",
                "location_source": "MANUAL_PIN",
                "location_confirmed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        venue = Venue.objects.get(owner=self.owner)
        self.assertEqual(str(venue.latitude), "27.717200")
        self.assertEqual(str(venue.longitude), "85.324000")
        self.assertTrue(venue.location_confirmed)
        self.assertIsNotNone(venue.location_updated_at)

    def test_coordinate_precision_is_normalized_for_map_updates(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {
                "name": "Precision Location Arena",
                "latitude": "27.717200987",
                "longitude": "85.324000123",
                "location_source": "MANUAL_PIN",
                "location_confirmed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        venue = Venue.objects.get(owner=self.owner)
        self.assertEqual(str(venue.latitude), "27.717201")
        self.assertEqual(str(venue.longitude), "85.324000")

    def test_owner_can_save_a_confirmed_device_location_source(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {
                "name": "Device Location Arena",
                "latitude": "27.717200",
                "longitude": "85.324000",
                "location_source": "DEVICE_LOCATION",
                "location_confirmed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        venue = Venue.objects.get(owner=self.owner)
        self.assertEqual(venue.location_source, Venue.LocationSource.DEVICE_LOCATION)
        self.assertTrue(venue.location_confirmed)

    def test_approved_venue_map_change_requires_review_and_confirmed_pin(self):
        venue = Venue.objects.create(
            owner=self.owner,
            name="Approved Location Arena",
            city="Kathmandu",
            area="Baneshwor",
            latitude="27.717200",
            longitude="85.324000",
            location_source=Venue.LocationSource.MANUAL_PIN,
            location_confirmed=True,
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.client.force_authenticate(self.owner)
        changed_location = {
            "latitude": "27.718000",
            "longitude": "85.325000",
            "location_source": Venue.LocationSource.MANUAL_PIN,
            "location_confirmed": True,
        }

        blocked_response = self.client.post(reverse("owner-venue"), changed_location, format="json")
        self.assertEqual(blocked_response.status_code, 400)
        venue.refresh_from_db()
        self.assertEqual(venue.status, Venue.Status.APPROVED)
        self.assertEqual(str(venue.latitude), "27.717200")

        unconfirmed_response = self.client.post(
            reverse("owner-venue"),
            {**changed_location, "location_confirmed": False, "submit_for_review": True},
            format="json",
        )
        self.assertEqual(unconfirmed_response.status_code, 400)
        self.assertIn("Confirm the new venue pin", str(unconfirmed_response.data))

        submitted_response = self.client.post(
            reverse("owner-venue"),
            {**changed_location, "submit_for_review": True},
            format="json",
        )
        self.assertEqual(submitted_response.status_code, 200)
        venue.refresh_from_db()
        self.assertEqual(venue.status, Venue.Status.PENDING)
        self.assertEqual(str(venue.latitude), "27.718000")
        self.assertTrue(venue.location_confirmed)

    def test_owner_map_link_must_be_a_http_or_https_url(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {"name": "Invalid Link Arena", "map_location": "maps.google.com/place/arena"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("map_location", response.data)

    def test_coordinate_timestamp_is_saved_with_targeted_model_updates(self):
        venue = Venue.objects.create(owner=self.owner, name="Targeted Update Arena")
        venue.latitude = "27.717200"
        venue.longitude = "85.324000"
        venue.save(update_fields=["latitude", "longitude"])

        venue.refresh_from_db()
        self.assertIsNotNone(venue.location_updated_at)

    def test_incomplete_coordinate_pair_is_rejected(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {"name": "Incomplete Location", "latitude": "27.717200"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("latitude", response.data)

    def test_coordinates_outside_nepal_are_rejected(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {
                "name": "Outside Location",
                "latitude": "40.712800",
                "longitude": "-74.006000",
                "location_source": "MANUAL_PIN",
                "location_confirmed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("within Nepal", str(response.data))

    def test_location_lookup_is_owner_only_and_provider_data_is_sanitised(self):
        with patch(
            "venues.views.search_locations",
            return_value=[
                {
                    "latitude": 27.7172,
                    "longitude": 85.324,
                    "display_name": "Kathmandu, Nepal",
                    "place_type": "city",
                    "secret": "must-not-leak",
                }
            ],
        ):
            self.client.force_authenticate(self.owner)
            response = self.client.get(reverse("owner-location-search"), {"q": "Kathmandu"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["display_name"], "Kathmandu, Nepal")
        self.assertNotIn("secret", response.data["results"][0])

        self.client.force_authenticate(self.player)
        denied_response = self.client.get(reverse("owner-location-search"), {"q": "Kathmandu"})
        self.assertEqual(denied_response.status_code, 403)

    def test_location_lookup_tries_a_nepal_scoped_query_when_needed(self):
        search_locations.cache_clear()

    def test_location_lookup_falls_back_to_a_recognised_area_for_a_specific_poi(self):
        search_locations.cache_clear()
        provider_result = {
            "lat": "27.7051196",
            "lon": "85.3335568",
            "display_name": "Maitidevi, Kathmandu, Nepal",
            "type": "neighbourhood",
        }
        with patch("venues.location._request_json", side_effect=[[], [], [provider_result]]) as request_json:
            results = search_locations("Maitidevi petrol pump")

        self.assertEqual(results[0]["area"], "Maitidevi")
        self.assertEqual(results[0]["district"], "Kathmandu")
        self.assertEqual(request_json.call_args_list[2].args[1]["q"], "Maitidevi, Kathmandu, Nepal")
        search_locations.cache_clear()

    def test_owner_venue_uses_canonical_district_and_area_values(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-venue"),
            {"name": "Maitidevi Cricksal Arena", "city": "kathmandu", "area": "maitidevi"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        venue = Venue.objects.get(owner=self.owner)
        self.assertEqual(venue.city, "Kathmandu")
        self.assertEqual(venue.area, "Maitidevi")

        invalid_response = self.client.post(
            reverse("owner-venue"),
            {"city": "Kathmandu", "area": "Jawalakhel"},
            format="json",
        )
        self.assertEqual(invalid_response.status_code, 400)
        self.assertIn("selected district", str(invalid_response.data).lower())
        provider_result = {
            "lat": "27.7051196",
            "lon": "85.3335568",
            "display_name": "Maitidevi, Kathmandu, Nepal",
            "type": "neighbourhood",
        }
        with patch("venues.location._request_json", side_effect=[[], [provider_result]]) as request_json:
            results = search_locations("Maitidevi")

        self.assertEqual(results[0]["display_name"], "Maitidevi, Kathmandu, Nepal")
        self.assertEqual(request_json.call_count, 2)
        self.assertEqual(request_json.call_args_list[1].args[1]["q"], "Maitidevi, Nepal")
        search_locations.cache_clear()

    def test_reverse_lookup_rejects_locations_outside_supported_country_boundary(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(
            reverse("owner-location-reverse"),
            {"lat": "40.7128", "lng": "-74.0060"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("within Nepal", response.data["detail"])

    def test_public_venue_returns_coordinates_without_owner_location_metadata(self):
        venue = Venue.objects.create(
            owner=self.owner,
            name="Public Location Arena",
            city="Kathmandu",
            area="Baneshwor",
            latitude="27.717200",
            longitude="85.324000",
            location_source=Venue.LocationSource.MANUAL_PIN,
            location_confirmed=True,
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        Court.objects.create(
            venue=venue,
            name="Public Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )
        response = self.client.get(reverse("public-venue-detail", args=[venue.id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["venue"]["latitude"], "27.717200")
        self.assertEqual(response.data["venue"]["longitude"], "85.324000")
        self.assertNotIn("location_source", response.data["venue"])
        self.assertNotIn("location_confirmed", response.data["venue"])

        venue.location_confirmed = False
        venue.save(update_fields=["location_confirmed"])
        unconfirmed_response = self.client.get(reverse("public-venue-detail", args=[venue.id]))
        self.assertIsNone(unconfirmed_response.data["venue"]["latitude"])
        self.assertIsNone(unconfirmed_response.data["venue"]["longitude"])
        court_response = self.client.get(reverse("public-court-detail", args=[venue.courts.first().id]))
        self.assertIsNone(court_response.data["court"]["venue"]["latitude"])
        self.assertIsNone(court_response.data["court"]["venue"]["longitude"])

    def test_owner_can_replace_and_clear_a_legacy_venue_photo(self):
        self.client.force_authenticate(self.owner)
        venue = Venue.objects.create(owner=self.owner, name="Photo Test Arena")
        original = SimpleUploadedFile("original.jpg", b"original", content_type="image/jpeg")
        upload_response = self.client.post(reverse("owner-venue"), {"front_photo": original}, format="multipart")

        self.assertEqual(upload_response.status_code, 200)
        venue.refresh_from_db()
        original_name = venue.front_photo.name
        replacement = SimpleUploadedFile("replacement.jpg", b"replacement", content_type="image/jpeg")
        replace_response = self.client.post(reverse("owner-venue"), {"front_photo": replacement}, format="multipart")

        self.assertEqual(replace_response.status_code, 200)
        venue.refresh_from_db()
        self.assertTrue(venue.front_photo.name.endswith("replacement.jpg"))
        self.assertFalse(venue.front_photo.storage.exists(original_name))

        clear_response = self.client.post(reverse("owner-venue"), {"clear_front_photo": "true"}, format="multipart")

        self.assertEqual(clear_response.status_code, 200)
        venue.refresh_from_db()
        self.assertFalse(venue.front_photo)

    def test_owner_can_clear_a_court_photo_without_touching_the_court(self):
        self.client.force_authenticate(self.owner)
        venue = Venue.objects.create(owner=self.owner, name="Court Photo Test Arena")
        court = Court.objects.create(
            venue=venue,
            name="Court One",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            court_photo=SimpleUploadedFile("court.jpg", b"court", content_type="image/jpeg"),
        )
        photo_name = court.court_photo.name

        response = self.client.patch(
            reverse("owner-court-detail", args=[court.id]),
            {"clear_court_photo": "true"},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        court.refresh_from_db()
        self.assertFalse(court.court_photo)
        self.assertEqual(court.name, "Court One")
        self.assertFalse(court.court_photo.storage.exists(photo_name))


class OwnerReportsApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="reports-owner@example.com",
            password="test-password",
            full_name="Reports Owner",
            phone="9800000090",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="reports-player@example.com",
            password="test-password",
            full_name="Reports Player",
            phone="9800000091",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Reports Cricksal Arena",
            city="Kathmandu",
            area="Maitidevi",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Main Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )

    def test_owner_report_uses_real_booking_slot_and_check_in_records(self):
        report_date = timezone.localdate() - timedelta(days=1)
        booked_slot = CourtSlot.objects.create(
            court=self.court,
            date=report_date,
            start_time=time(9, 0),
            end_time=time(10, 0),
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        CourtSlot.objects.create(
            court=self.court,
            date=report_date,
            start_time=time(10, 0),
            end_time=time(11, 0),
            price=Decimal("1800.00"),
            status=CourtSlot.Status.AVAILABLE,
        )
        booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=booked_slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.COMPLETED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() - timedelta(days=2),
            confirmed_at=timezone.now() - timedelta(days=2),
            completed_at=timezone.now() - timedelta(days=1),
        )
        BookingCheckIn.objects.create(
            booking=booking,
            checked_in_at=timezone.now() - timedelta(days=1),
            checked_in_by=self.owner,
            last_scanned_at=timezone.now() - timedelta(days=1),
        )

        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("owner-reports"), {"period": 7})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["booking_count"], 1)
        self.assertEqual(response.data["summary"]["paid_value"], "1500.00")
        self.assertEqual(response.data["summary"]["check_in_count"], 1)
        self.assertEqual(response.data["summary"]["published_slot_count"], 2)
        self.assertEqual(response.data["summary"]["booked_slot_count"], 1)
        self.assertEqual(response.data["summary"]["utilization_percent"], 50.0)
        self.assertEqual(response.data["courts"][0]["check_in_count"], 1)
        self.assertEqual(response.data["period"]["mode"], "preset")

    def test_owner_report_separates_captured_value_from_refunds(self):
        report_date = timezone.localdate() - timedelta(days=2)
        booking_values = [
            (Decimal("1500.00"), Booking.BookingStatus.COMPLETED, Booking.PaymentStatus.PAID, Booking.RefundStatus.NOT_REQUIRED, Decimal("0.00")),
            (Decimal("500.00"), Booking.BookingStatus.CANCELLED, Booking.PaymentStatus.NO_REFUND, Booking.RefundStatus.NOT_ELIGIBLE, Decimal("0.00")),
            (Decimal("700.00"), Booking.BookingStatus.CANCELLED, Booking.PaymentStatus.REFUNDED, Booking.RefundStatus.REFUNDED, Decimal("700.00")),
            (Decimal("300.00"), Booking.BookingStatus.CANCELLED, Booking.PaymentStatus.REFUND_PENDING, Booking.RefundStatus.PENDING_OWNER_ACTION, Decimal("300.00")),
        ]
        for index, (amount, booking_status, payment_status, refund_status, refund_amount) in enumerate(booking_values):
            slot = CourtSlot.objects.create(
                court=self.court,
                date=report_date,
                start_time=time(9 + index, 0),
                end_time=time(10 + index, 0),
                price=amount,
                status=CourtSlot.Status.BOOKED if booking_status == Booking.BookingStatus.COMPLETED else CourtSlot.Status.AVAILABLE,
            )
            Booking.objects.create(
                player=self.player,
                venue=self.venue,
                court=self.court,
                slot=slot,
                amount=amount,
                status=booking_status,
                payment_status=payment_status,
                refund_status=refund_status,
                refund_amount=refund_amount,
                reserved_until=timezone.now() - timedelta(days=3),
                confirmed_at=timezone.now() - timedelta(days=3) if booking_status == Booking.BookingStatus.COMPLETED else None,
                completed_at=timezone.now() - timedelta(days=2) if booking_status == Booking.BookingStatus.COMPLETED else None,
            )

        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("owner-reports"), {"period": 7})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["paid_booking_count"], 4)
        self.assertEqual(response.data["summary"]["paid_value"], "3000.00")
        self.assertEqual(response.data["summary"]["processed_refund_value"], "700.00")
        self.assertEqual(response.data["summary"]["pending_refund_value"], "300.00")
        self.assertEqual(response.data["summary"]["net_value"], "2000.00")

    def test_owner_report_accepts_a_bounded_custom_date_range(self):
        today = timezone.localdate()
        start_date = today - timedelta(days=4)
        end_date = today - timedelta(days=1)

        self.client.force_authenticate(self.owner)
        response = self.client.get(
            reverse("owner-reports"),
            {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["period"],
            {
                "days": 4,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "mode": "custom",
            },
        )
        self.assertEqual(len(response.data["trend"]), 4)

    def test_owner_report_rejects_invalid_custom_date_ranges(self):
        today = timezone.localdate()
        self.client.force_authenticate(self.owner)
        invalid_ranges = [
            ({"start_date": today.isoformat()}, "both a custom start date and end date"),
            ({"start_date": "30-08-2026", "end_date": today.isoformat()}, "valid start and end date"),
            (
                {"start_date": today.isoformat(), "end_date": (today - timedelta(days=1)).isoformat()},
                "on or before",
            ),
            (
                {"start_date": today.isoformat(), "end_date": (today + timedelta(days=1)).isoformat()},
                "future dates",
            ),
            (
                {"start_date": (today - timedelta(days=365)).isoformat(), "end_date": today.isoformat()},
                "365 days or fewer",
            ),
        ]

        for query_params, message in invalid_ranges:
            with self.subTest(query_params=query_params):
                response = self.client.get(reverse("owner-reports"), query_params)
                self.assertEqual(response.status_code, 400)
                self.assertIn(message, response.data["detail"])

    def test_report_period_is_validated_and_owner_scope_is_enforced(self):
        self.client.force_authenticate(self.owner)
        invalid_response = self.client.get(reverse("owner-reports"), {"period": 14})
        self.assertEqual(invalid_response.status_code, 400)

        other_owner = get_user_model().objects.create_user(
            email="reports-other@example.com",
            password="test-password",
            full_name="Other Reports Owner",
            phone="9800000092",
            role="COURT_OWNER",
        )
        self.client.force_authenticate(other_owner)
        response = self.client.get(reverse("owner-reports"), {"period": 7})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["venue"])
        self.assertEqual(response.data["summary"]["booking_count"], 0)


class OwnerOverviewApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="overview-owner@example.com",
            password="test-password",
            full_name="Overview Owner",
            phone="9800000093",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="overview-player@example.com",
            password="test-password",
            full_name="Overview Player",
            phone="9800000094",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Overview Cricksal Arena",
            city="Kathmandu",
            area="Maitidevi",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Overview Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )

    def create_booking(self, *, amount, booking_status, payment_status, slot_status, start_time):
        slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate(),
            start_time=start_time,
            end_time=time(start_time.hour + 1, start_time.minute),
            price=amount,
            status=slot_status,
            reserved_until=timezone.now() + timedelta(minutes=10) if slot_status == CourtSlot.Status.RESERVED else None,
        )
        return Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=slot,
            amount=amount,
            status=booking_status,
            payment_status=payment_status,
            reserved_until=timezone.now() + timedelta(minutes=10),
            confirmed_at=timezone.now() if booking_status in [Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED] else None,
            completed_at=timezone.now() if booking_status == Booking.BookingStatus.COMPLETED else None,
        )

    def test_overview_counts_operational_bookings_and_paid_revenue_separately_from_holds(self):
        self.create_booking(
            amount=Decimal("1500.00"),
            booking_status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            slot_status=CourtSlot.Status.BOOKED,
            start_time=time(18, 0),
        )
        self.create_booking(
            amount=Decimal("2000.00"),
            booking_status=Booking.BookingStatus.COMPLETED,
            payment_status=Booking.PaymentStatus.PAID,
            slot_status=CourtSlot.Status.BOOKED,
            start_time=time(19, 0),
        )
        self.create_booking(
            amount=Decimal("1200.00"),
            booking_status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
            slot_status=CourtSlot.Status.RESERVED,
            start_time=time(20, 0),
        )
        cancelled = self.create_booking(
            amount=Decimal("900.00"),
            booking_status=Booking.BookingStatus.CANCELLED,
            payment_status=Booking.PaymentStatus.NO_REFUND,
            slot_status=CourtSlot.Status.AVAILABLE,
            start_time=time(21, 0),
        )
        cancelled.refund_status = Booking.RefundStatus.NOT_ELIGIBLE
        cancelled.save(update_fields=["refund_status", "updated_at"])

        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("owner-overview"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["today_bookings"], 2)
        self.assertEqual(response.data["summary"]["today_revenue"], "3500.00")
        self.assertEqual(response.data["summary"]["today_expected_revenue"], "3500.00")
        self.assertEqual(response.data["summary"]["today_payment_holds"], 1)
        self.assertEqual(len(response.data["today_schedule"]), 3)
        self.assertNotIn(Booking.BookingStatus.CANCELLED, {item["booking_status"] for item in response.data["today_schedule"]})


class OwnerCalendarApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="calendar-owner@example.com",
            password="test-password",
            full_name="Calendar Owner",
            phone="9800000095",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="calendar-player@example.com",
            password="test-password",
            full_name="Calendar Player",
            phone="9800000096",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Calendar Cricksal Arena",
            city="Kathmandu",
            area="Maitidevi",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Calendar Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )

    def test_calendar_stats_use_exact_booking_lifecycle_counts(self):
        calendar_date = timezone.localdate() + timedelta(days=1)
        for index, booking_status in enumerate([
            Booking.BookingStatus.CONFIRMED,
            Booking.BookingStatus.COMPLETED,
            Booking.BookingStatus.RESERVED,
        ]):
            slot_status = CourtSlot.Status.RESERVED if booking_status == Booking.BookingStatus.RESERVED else CourtSlot.Status.BOOKED
            slot = CourtSlot.objects.create(
                court=self.court,
                date=calendar_date,
                start_time=time(9 + index, 0),
                end_time=time(10 + index, 0),
                price=Decimal("1500.00"),
                status=slot_status,
                reserved_until=timezone.now() + timedelta(minutes=10) if slot_status == CourtSlot.Status.RESERVED else None,
            )
            Booking.objects.create(
                player=self.player,
                venue=self.venue,
                court=self.court,
                slot=slot,
                amount=Decimal("1500.00"),
                status=booking_status,
                payment_status=Booking.PaymentStatus.PENDING if booking_status == Booking.BookingStatus.RESERVED else Booking.PaymentStatus.PAID,
                reserved_until=timezone.now() + timedelta(minutes=10),
            )

        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("owner-calendar"), {"date": calendar_date.isoformat(), "view": "day"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["stats"]["bookings_count"], 3)
        self.assertEqual(response.data["stats"]["confirmed_bookings"], 1)
        self.assertEqual(response.data["stats"]["completed_bookings"], 1)
        self.assertEqual(response.data["stats"]["reserved_holds"], 1)


class OwnerCourtInventoryCalculationTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="inventory-owner@example.com",
            password="test-password",
            full_name="Inventory Owner",
            phone="9800000097",
            role="COURT_OWNER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Inventory Cricksal Arena",
            city="Kathmandu",
            area="Maitidevi",
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Inventory Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )

    def test_future_published_count_excludes_historical_and_blocked_slots(self):
        today = timezone.localdate()
        CourtSlot.objects.create(
            court=self.court,
            date=today - timedelta(days=1),
            start_time=time(10, 0),
            end_time=time(11, 0),
            price=Decimal("500.00"),
            status=CourtSlot.Status.AVAILABLE,
        )
        CourtSlot.objects.create(
            court=self.court,
            date=today + timedelta(days=1),
            start_time=time(10, 0),
            end_time=time(11, 0),
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BLOCKED,
        )

        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("owner-courts"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["courts"][0]["future_published_slot_count"], 0)

        CourtSlot.objects.create(
            court=self.court,
            date=today + timedelta(days=2),
            start_time=time(10, 0),
            end_time=time(11, 0),
            price=Decimal("1500.00"),
            status=CourtSlot.Status.AVAILABLE,
        )
        response = self.client.get(reverse("owner-courts"))
        self.assertEqual(response.data["courts"][0]["future_published_slot_count"], 1)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class BookingMessageApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="owner@example.com", password="test-password", full_name="Venue Owner",
            phone="9800000010", role="COURT_OWNER",
        )
        self.other_owner = user_model.objects.create_user(
            email="other-owner@example.com", password="test-password", full_name="Other Owner",
            phone="9800000011", role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="booking-player@example.com", password="test-password", full_name="Booking Player",
            phone="9800000012", role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="NCS Indoor Cricksal",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Court 1",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )
        self.slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=2),
            start_time=time(10, 0),
            end_time=time(11, 0),
            price=1500,
            status=CourtSlot.Status.BOOKED,
        )
        self.booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=self.slot,
            amount=1500,
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() + timedelta(minutes=10),
            confirmed_at=timezone.now(),
        )

    def test_owner_can_message_only_player_on_own_active_booking(self):
        self.client.force_authenticate(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                reverse("owner-booking-message", args=[self.booking.id]),
                {
                    "message_type": "ENTRY_INSTRUCTIONS",
                    "message": "Please arrive 15 minutes early and show your booking pass.",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get(
            recipient=self.player,
            notification_type=Notification.NotificationType.VENUE_MESSAGE,
        )
        self.assertEqual(notification.related_entity_type, "booking_message")
        self.assertEqual(notification.metadata["booking_id"], self.booking.id)
        self.assertNotIn(self.player.email, notification.message)
        self.assertNotIn(self.player.phone, notification.message)
        delivery = EmailDelivery.objects.get(
            recipient=self.player,
            email_type=EmailDelivery.EmailType.VENUE_MESSAGE,
        )
        self.assertEqual(delivery.status, EmailDelivery.Status.SENT)
        self.assertEqual(len(mail.outbox), 1)

    def test_other_owner_cannot_message_booking(self):
        self.client.force_authenticate(self.other_owner)
        response = self.client.post(
            reverse("owner-booking-message", args=[self.booking.id]),
            {"message_type": "GENERAL", "message": "This must not be delivered."},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Notification.objects.filter(recipient=self.player).exists())


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class StructuredCancellationPolicyTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="policy-owner@example.com",
            password="test-password",
            full_name="Policy Venue Owner",
            phone="9800000020",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="policy-player@example.com",
            password="test-password",
            full_name="Policy Player",
            phone="9800000021",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Policy Cricksal Arena",
            city="Kathmandu",
            area="Lalitpur",
            status=Venue.Status.APPROVED,
            cancellation_full_refund_hours=24,
            cancellation_partial_refund_enabled=True,
            cancellation_partial_refund_hours=12,
            cancellation_partial_refund_percent=50,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Main Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
        )

    def create_confirmed_booking(self, hours_until_start):
        start_at = timezone.localtime(
            timezone.now() + timedelta(hours=hours_until_start)
        ).replace(
            minute=0,
            second=0,
            microsecond=0,
        )
        end_at = start_at + timedelta(hours=1)
        slot = CourtSlot.objects.create(
            court=self.court,
            date=start_at.date(),
            start_time=start_at.time(),
            end_time=end_at.time(),
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        return Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() + timedelta(minutes=10),
            confirmed_at=timezone.now(),
            cancellation_policy_snapshot=build_cancellation_policy_snapshot(self.venue),
        )

    def test_policy_calculates_full_partial_and_no_refund_tiers(self):
        booking = self.create_confirmed_booking(48)
        now = timezone.now()

        full_quote = get_cancellation_quote(
            booking,
            "PLAYER",
            start_at=now + timedelta(hours=30),
            now=now,
        )
        partial_quote = get_cancellation_quote(
            booking,
            "PLAYER",
            start_at=now + timedelta(hours=18),
            now=now,
        )
        no_refund_quote = get_cancellation_quote(
            booking,
            "PLAYER",
            start_at=now + timedelta(hours=6),
            now=now,
        )

        self.assertEqual(full_quote["tier"], Booking.CancellationTier.FULL_REFUND)
        self.assertEqual(full_quote["refund_amount"], Decimal("1500.00"))
        self.assertEqual(partial_quote["tier"], Booking.CancellationTier.PARTIAL_REFUND)
        self.assertEqual(partial_quote["refund_amount"], Decimal("750.00"))
        self.assertEqual(no_refund_quote["tier"], Booking.CancellationTier.NO_REFUND)
        self.assertEqual(no_refund_quote["refund_amount"], Decimal("0.00"))
        self.assertTrue(no_refund_quote["late_cancellation"])

    def test_policy_snapshot_is_not_changed_by_later_venue_edits(self):
        booking = self.create_confirmed_booking(48)
        self.venue.cancellation_full_refund_hours = 72
        self.venue.cancellation_partial_refund_hours = 48
        self.venue.cancellation_partial_refund_percent = 25
        self.venue.cancellation_policy_version = 2
        self.venue.save()

        now = timezone.now()
        quote = get_cancellation_quote(
            booking,
            "PLAYER",
            start_at=now + timedelta(hours=30),
            now=now,
        )

        self.assertEqual(quote["policy"]["version"], 1)
        self.assertEqual(quote["policy"]["full_refund_hours"], 24)
        self.assertEqual(quote["tier"], Booking.CancellationTier.FULL_REFUND)
        self.assertEqual(quote["refund_percentage"], 100)

    def test_owner_cancellation_always_requires_full_refund(self):
        booking = self.create_confirmed_booking(6)
        now = timezone.now()

        quote = get_cancellation_quote(
            booking,
            "COURT_OWNER",
            start_at=now + timedelta(hours=2),
            now=now,
        )

        self.assertEqual(quote["tier"], Booking.CancellationTier.OWNER_FULL_REFUND)
        self.assertEqual(quote["refund_percentage"], 100)
        self.assertEqual(quote["refund_amount"], Decimal("1500.00"))

    def test_partial_refund_is_calculated_then_processed_by_owner(self):
        booking = self.create_confirmed_booking(18)
        self.client.force_authenticate(self.player)

        cancel_response = self.client.post(
            reverse("booking-cancel", args=[booking.id]),
            {},
            format="json",
        )

        self.assertEqual(cancel_response.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.cancellation_tier, Booking.CancellationTier.PARTIAL_REFUND)
        self.assertEqual(booking.refund_percentage, 50)
        self.assertEqual(booking.refund_amount, Decimal("750.00"))
        self.assertEqual(booking.payment_status, Booking.PaymentStatus.REFUND_PENDING)
        self.assertEqual(booking.refund_status, Booking.RefundStatus.PENDING_OWNER_ACTION)
        self.assertEqual(booking.slot.status, CourtSlot.Status.AVAILABLE)

        self.client.force_authenticate(self.owner)
        process_response = self.client.post(
            reverse("owner-refund-review", args=[booking.id]),
            {"action": "MARK_REFUNDED", "owner_note": "Mock refund reference RF-1001."},
            format="json",
        )

        self.assertEqual(process_response.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.payment_status, Booking.PaymentStatus.PARTIALLY_REFUNDED)
        self.assertEqual(booking.refund_status, Booking.RefundStatus.PARTIALLY_REFUNDED)
        self.assertEqual(booking.refund_amount, Decimal("750.00"))

    def test_owner_cannot_reject_system_approved_refund(self):
        booking = self.create_confirmed_booking(48)
        booking.status = Booking.BookingStatus.CANCELLED
        booking.payment_status = Booking.PaymentStatus.REFUND_PENDING
        booking.refund_status = Booking.RefundStatus.PENDING_OWNER_ACTION
        booking.cancellation_tier = Booking.CancellationTier.FULL_REFUND
        booking.refund_percentage = 100
        booking.refund_amount = booking.amount
        booking.save()
        self.client.force_authenticate(self.owner)

        response = self.client.post(
            reverse("owner-refund-review", args=[booking.id]),
            {"action": "REJECT", "owner_note": "Attempted rejection."},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        booking.refresh_from_db()
        self.assertEqual(booking.refund_status, Booking.RefundStatus.PENDING_OWNER_ACTION)

    def test_owner_must_record_refund_processing_note(self):
        booking = self.create_confirmed_booking(48)
        booking.status = Booking.BookingStatus.CANCELLED
        booking.payment_status = Booking.PaymentStatus.REFUND_PENDING
        booking.refund_status = Booking.RefundStatus.PENDING_OWNER_ACTION
        booking.cancellation_tier = Booking.CancellationTier.FULL_REFUND
        booking.refund_percentage = 100
        booking.refund_amount = booking.amount
        booking.save()
        self.client.force_authenticate(self.owner)

        response = self.client.post(
            reverse("owner-refund-review", args=[booking.id]),
            {"action": "MARK_REFUNDED", "owner_note": ""},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        booking.refresh_from_db()
        self.assertEqual(booking.refund_status, Booking.RefundStatus.PENDING_OWNER_ACTION)

    def test_booking_confirmation_emails_player_and_owner_once(self):
        booking = self.create_confirmed_booking(48)

        with self.captureOnCommitCallbacks(execute=True):
            notify_booking_confirmed(booking, self.player)
            notify_booking_confirmed(booking, self.player)

        deliveries = EmailDelivery.objects.filter(
            email_type=EmailDelivery.EmailType.BOOKING_CONFIRMED,
            related_entity_id=booking.id,
        )
        self.assertEqual(deliveries.count(), 2)
        self.assertSetEqual(
            set(deliveries.values_list("recipient_id", flat=True)),
            {self.player.id, self.owner.id},
        )

    def test_owner_cancellation_emails_the_player(self):
        booking = self.create_confirmed_booking(48)
        booking.cancellation_actor_role = "COURT_OWNER"
        booking.cancellation_reason = "Emergency maintenance closure."
        booking.status = Booking.BookingStatus.CANCELLED
        booking.refund_status = Booking.RefundStatus.PENDING_OWNER_ACTION
        booking.refund_amount = booking.amount
        booking.refund_percentage = 100
        booking.save()

        with self.captureOnCommitCallbacks(execute=True):
            notify_booking_cancelled(booking, self.owner)

        delivery = EmailDelivery.objects.get(
            recipient=self.player,
            email_type=EmailDelivery.EmailType.BOOKING_CANCELLED,
            related_entity_id=booking.id,
        )
        self.assertEqual(delivery.status, EmailDelivery.Status.SENT)
        self.assertIn("Emergency maintenance closure", mail.outbox[-1].body)

    def test_venue_approval_emails_the_correct_owner(self):
        admin_user = get_user_model().objects.create_superuser(
            email="venue-admin@example.com",
            password="AdminPass123!",
            full_name="Venue Admin",
            phone="9800000098",
        )
        self.venue.status = Venue.Status.APPROVED
        self.venue.reviewed_at = timezone.now()
        self.venue.admin_review_note = "Verification completed."
        self.venue.save()

        with self.captureOnCommitCallbacks(execute=True):
            notify_owner_venue_review(self.venue, admin_user, "APPROVE")

        delivery = EmailDelivery.objects.get(
            recipient=self.owner,
            email_type=EmailDelivery.EmailType.VENUE_STATUS,
            related_entity_id=self.venue.id,
        )
        self.assertEqual(delivery.status, EmailDelivery.Status.SENT)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class ReservationExpiryLifecycleTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="expiry-owner@example.com",
            password="test-password",
            full_name="Expiry Owner",
            phone="9800000030",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="expiry-player@example.com",
            password="test-password",
            full_name="Expiry Player",
            phone="9800000031",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Expiry Cricksal Arena",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Expiry Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )

    def create_reserved_booking(self, *, expired=True):
        reserved_until = timezone.now() - timedelta(minutes=1) if expired else timezone.now() + timedelta(minutes=5)
        slot_date = timezone.localdate() + timedelta(days=1)
        first_slot = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(8, 0),
            end_time=time(9, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.RESERVED,
            reserved_until=reserved_until,
        )
        second_slot = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(9, 0),
            end_time=time(10, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.RESERVED,
            reserved_until=reserved_until,
        )
        booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=first_slot,
            amount=Decimal("3000.00"),
            status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
            reserved_until=reserved_until,
        )
        BookingSlot.objects.bulk_create(
            [
                BookingSlot(booking=booking, slot=first_slot, price=first_slot.price),
                BookingSlot(booking=booking, slot=second_slot, price=second_slot.price),
            ]
        )
        return booking, [first_slot, second_slot]

    def test_expire_reservations_command_releases_all_slots_once(self):
        booking, slots = self.create_reserved_booking(expired=True)

        with self.captureOnCommitCallbacks(execute=True):
            output = StringIO()
            call_command("expire_reservations", stdout=output)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.BookingStatus.EXPIRED)
        self.assertEqual(booking.payment_status, Booking.PaymentStatus.FAILED)
        self.assertEqual(booking.refund_status, Booking.RefundStatus.NOT_REQUIRED)
        self.assertIn("expired 1 booking", output.getvalue())

        for slot in slots:
            slot.refresh_from_db()
            self.assertEqual(slot.status, CourtSlot.Status.AVAILABLE)
            self.assertIsNone(slot.reserved_until)

        self.assertEqual(
            Notification.objects.filter(
                related_entity_type="booking",
                related_entity_id=booking.id,
                notification_type=Notification.NotificationType.BOOKING_PAYMENT_FAILED,
            ).count(),
            2,
        )
        self.assertEqual(
            EmailDelivery.objects.filter(
                email_type=EmailDelivery.EmailType.BOOKING_PAYMENT_FAILED,
                related_entity_id=booking.id,
            ).count(),
            1,
        )

        with self.captureOnCommitCallbacks(execute=True):
            call_command("expire_reservations", stdout=StringIO())

        self.assertEqual(
            Notification.objects.filter(
                related_entity_type="booking",
                related_entity_id=booking.id,
                notification_type=Notification.NotificationType.BOOKING_PAYMENT_FAILED,
            ).count(),
            2,
        )
        self.assertEqual(
            EmailDelivery.objects.filter(
                email_type=EmailDelivery.EmailType.BOOKING_PAYMENT_FAILED,
                related_entity_id=booking.id,
            ).count(),
            1,
        )

    def test_khalti_success_after_expiry_confirms_when_original_slots_are_still_held(self):
        booking, slots = self.create_reserved_booking(expired=True)
        booking.payment_provider = Booking.PaymentProvider.KHALTI
        booking.khalti_pidx = "expired-pidx"
        booking.save()
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.lookup_khalti_payment",
            return_value={"status": "Completed", "total_amount": 300000, "transaction_id": "late-txn"},
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse("khalti-payment-verify", args=[booking.id]),
                    {"pidx": "expired-pidx"},
                    format="json",
                )

        self.assertEqual(response.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.BookingStatus.CONFIRMED)
        self.assertEqual(booking.payment_status, Booking.PaymentStatus.PAID)
        self.assertEqual(booking.khalti_transaction_id, "late-txn")
        for slot in slots:
            slot.refresh_from_db()
            self.assertEqual(slot.status, CourtSlot.Status.BOOKED)
            self.assertIsNone(slot.reserved_until)

    def test_future_reservation_is_not_expired_by_command(self):
        booking, slots = self.create_reserved_booking(expired=False)

        output = StringIO()
        call_command("expire_reservations", stdout=output)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.BookingStatus.RESERVED)
        self.assertIn("expired 0 booking", output.getvalue())
        for slot in slots:
            slot.refresh_from_db()
            self.assertEqual(slot.status, CourtSlot.Status.RESERVED)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class KhaltiPaymentApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="khalti-owner@example.com",
            password="test-password",
            full_name="Khalti Owner",
            phone="9800000050",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="khalti-player@example.com",
            password="test-password",
            full_name="Khalti Player",
            phone="9800000051",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Khalti Cricksal Arena",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Khalti Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )
        self.slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=1),
            start_time=time(8, 0),
            end_time=time(9, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.RESERVED,
            reserved_until=timezone.now() + timedelta(minutes=10),
        )
        self.booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=self.slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
            reserved_until=timezone.now() + timedelta(minutes=10),
        )
        BookingSlot.objects.create(booking=self.booking, slot=self.slot, price=self.slot.price)

    def test_khalti_initiate_stores_payment_reference(self):
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.initiate_khalti_payment",
            return_value={"pidx": "test-pidx-1", "payment_url": "https://pay.khalti.com/test"},
        ):
            response = self.client.post(reverse("khalti-payment-initiate", args=[self.booking.id]), {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.payment_provider, Booking.PaymentProvider.KHALTI)
        self.assertEqual(self.booking.khalti_pidx, "test-pidx-1")
        self.assertEqual(response.data["payment_url"], "https://pay.khalti.com/test")

    def test_khalti_initiate_is_idempotent_for_existing_payment_reference(self):
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.initiate_khalti_payment",
            return_value={"pidx": "same-pidx", "payment_url": "https://pay.khalti.com/same"},
        ) as mocked_initiate:
            first_response = self.client.post(reverse("khalti-payment-initiate", args=[self.booking.id]), {}, format="json")
            second_response = self.client.post(reverse("khalti-payment-initiate", args=[self.booking.id]), {}, format="json")

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(first_response.data["pidx"], "same-pidx")
        self.assertEqual(second_response.data["pidx"], "same-pidx")
        mocked_initiate.assert_called_once()

    def test_khalti_completed_after_slots_released_starts_refund_review(self):
        self.booking.reserved_until = timezone.now() - timedelta(minutes=5)
        self.booking.payment_provider = Booking.PaymentProvider.KHALTI
        self.booking.khalti_pidx = "released-pidx"
        self.booking.save()
        self.slot.status = CourtSlot.Status.AVAILABLE
        self.slot.reserved_until = None
        self.slot.save()
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.lookup_khalti_payment",
            return_value={"status": "Completed", "total_amount": 150000, "transaction_id": "late-paid-txn"},
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse("khalti-payment-verify", args=[self.booking.id]),
                    {"pidx": "released-pidx"},
                    format="json",
                )

        self.assertEqual(response.status_code, 200)
        self.booking.refresh_from_db()
        self.slot.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.BookingStatus.EXPIRED)
        self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.REFUND_PENDING)
        self.assertEqual(self.booking.refund_status, Booking.RefundStatus.PENDING_OWNER_ACTION)
        self.assertEqual(self.booking.refund_percentage, 100)
        self.assertEqual(self.booking.refund_amount, Decimal("1500.00"))
        self.assertEqual(self.booking.khalti_transaction_id, "late-paid-txn")
        self.assertEqual(self.slot.status, CourtSlot.Status.AVAILABLE)

    def test_khalti_completed_after_slot_re_reserved_starts_refund_review_without_releasing_new_hold(self):
        self.booking.reserved_until = timezone.now() - timedelta(minutes=5)
        self.booking.payment_provider = Booking.PaymentProvider.KHALTI
        self.booking.khalti_pidx = "reused-pidx"
        self.booking.save()
        new_hold_until = timezone.now() + timedelta(minutes=10)
        self.slot.status = CourtSlot.Status.RESERVED
        self.slot.reserved_until = new_hold_until
        self.slot.save()
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.lookup_khalti_payment",
            return_value={"status": "Completed", "total_amount": 150000, "transaction_id": "reused-paid-txn"},
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse("khalti-payment-verify", args=[self.booking.id]),
                    {"pidx": "reused-pidx"},
                    format="json",
                )

        self.assertEqual(response.status_code, 200)
        self.booking.refresh_from_db()
        self.slot.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.BookingStatus.EXPIRED)
        self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.REFUND_PENDING)
        self.assertEqual(self.booking.refund_status, Booking.RefundStatus.PENDING_OWNER_ACTION)
        self.assertEqual(self.slot.status, CourtSlot.Status.RESERVED)
        self.assertEqual(self.slot.reserved_until, new_hold_until)

    def test_khalti_completed_lookup_confirms_booking_and_books_slot(self):
        self.booking.payment_provider = Booking.PaymentProvider.KHALTI
        self.booking.khalti_pidx = "test-pidx-2"
        self.booking.save()
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.lookup_khalti_payment",
            return_value={"status": "Completed", "total_amount": 150000, "transaction_id": "txn-1001"},
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse("khalti-payment-verify", args=[self.booking.id]),
                    {"pidx": "test-pidx-2"},
                    format="json",
                )

        self.assertEqual(response.status_code, 200)
        self.booking.refresh_from_db()
        self.slot.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.BookingStatus.CONFIRMED)
        self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.PAID)
        self.assertEqual(self.booking.khalti_transaction_id, "txn-1001")
        self.assertEqual(self.slot.status, CourtSlot.Status.BOOKED)

    def test_khalti_failed_lookup_releases_reserved_slot(self):
        self.booking.payment_provider = Booking.PaymentProvider.KHALTI
        self.booking.khalti_pidx = "test-pidx-3"
        self.booking.save()
        self.client.force_authenticate(self.player)

        with patch(
            "venues.views.lookup_khalti_payment",
            return_value={"status": "Expired", "total_amount": 0},
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse("khalti-payment-verify", args=[self.booking.id]),
                    {"pidx": "test-pidx-3"},
                    format="json",
                )

        self.assertEqual(response.status_code, 200)
        self.booking.refresh_from_db()
        self.slot.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.BookingStatus.EXPIRED)
        self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.FAILED)
        self.assertEqual(self.slot.status, CourtSlot.Status.AVAILABLE)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class BookingCompletionLifecycleTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="completion-owner@example.com",
            password="test-password",
            full_name="Completion Owner",
            phone="9800000040",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="completion-player@example.com",
            password="test-password",
            full_name="Completion Player",
            phone="9800000041",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Completion Cricksal Arena",
            city="Kathmandu",
            area="Lalitpur",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Completion Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )

    def create_confirmed_booking(self, *, finished=True):
        slot_date = timezone.localdate() - timedelta(days=1) if finished else timezone.localdate() + timedelta(days=1)
        first_slot = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(8, 0),
            end_time=time(9, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        second_slot = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(9, 0),
            end_time=time(10, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=first_slot,
            amount=Decimal("3000.00"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() - timedelta(days=2) if finished else timezone.now() + timedelta(minutes=10),
            confirmed_at=timezone.now() - timedelta(days=2) if finished else timezone.now(),
            cancellation_policy_snapshot=build_cancellation_policy_snapshot(self.venue),
        )
        BookingSlot.objects.bulk_create(
            [
                BookingSlot(booking=booking, slot=first_slot, price=first_slot.price),
                BookingSlot(booking=booking, slot=second_slot, price=second_slot.price),
            ]
        )
        return booking, [first_slot, second_slot]

    def create_expired_reserved_booking(self):
        reserved_until = timezone.now() - timedelta(minutes=5)
        slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=1),
            start_time=time(12, 0),
            end_time=time(13, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.RESERVED,
            reserved_until=reserved_until,
        )
        booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
            reserved_until=reserved_until,
        )
        BookingSlot.objects.create(booking=booking, slot=slot, price=slot.price)
        return booking, slot

    def test_complete_bookings_command_marks_finished_booking_once(self):
        booking, slots = self.create_confirmed_booking(finished=True)

        output = StringIO()
        call_command("complete_bookings", stdout=output)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.BookingStatus.COMPLETED)
        self.assertEqual(booking.payment_status, Booking.PaymentStatus.PAID)
        self.assertIsNotNone(booking.completed_at)
        self.assertIn("completed 1 booking", output.getvalue())

        for slot in slots:
            slot.refresh_from_db()
            self.assertEqual(slot.status, CourtSlot.Status.BOOKED)

        self.assertEqual(
            Notification.objects.filter(
                related_entity_type="booking",
                related_entity_id=booking.id,
                notification_type=Notification.NotificationType.BOOKING_COMPLETED,
            ).count(),
            2,
        )

        call_command("complete_bookings", stdout=StringIO())
        self.assertEqual(
            Notification.objects.filter(
                related_entity_type="booking",
                related_entity_id=booking.id,
                notification_type=Notification.NotificationType.BOOKING_COMPLETED,
            ).count(),
            2,
        )

    def test_future_confirmed_booking_is_not_completed(self):
        booking, slots = self.create_confirmed_booking(finished=False)

        output = StringIO()
        call_command("complete_bookings", stdout=output)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.BookingStatus.CONFIRMED)
        self.assertIsNone(booking.completed_at)
        self.assertIn("completed 0 booking", output.getvalue())
        for slot in slots:
            slot.refresh_from_db()
            self.assertEqual(slot.status, CourtSlot.Status.BOOKED)

    def test_completed_booking_cannot_be_cancelled(self):
        booking, _slots = self.create_confirmed_booking(finished=True)
        call_command("complete_bookings", stdout=StringIO())
        self.client.force_authenticate(self.player)

        response = self.client.post(
            reverse("booking-cancel", args=[booking.id]),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Completed bookings cannot be cancelled", response.data["detail"])

    def test_run_booking_maintenance_expires_and_completes_without_notifications(self):
        expired_booking, expired_slot = self.create_expired_reserved_booking()
        finished_booking, _slots = self.create_confirmed_booking(finished=True)

        output = StringIO()
        call_command("run_booking_maintenance", "--no-notify", stdout=output)

        expired_booking.refresh_from_db()
        expired_slot.refresh_from_db()
        finished_booking.refresh_from_db()

        self.assertEqual(expired_booking.status, Booking.BookingStatus.EXPIRED)
        self.assertEqual(expired_slot.status, CourtSlot.Status.AVAILABLE)
        self.assertEqual(finished_booking.status, Booking.BookingStatus.COMPLETED)
        self.assertIn("Booking maintenance complete", output.getvalue())


class GenerateSlotsApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="slot-owner@example.com",
            password="test-password",
            full_name="Slot Owner",
            phone="9800000099",
            role="COURT_OWNER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Slot Test Venue",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.DRAFT,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Court 1",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.MAT,
        )
        self.client.force_authenticate(self.owner)

    def test_generation_honours_explicit_range_and_is_idempotent(self):
        start_date = timezone.localdate() + timedelta(days=1)
        end_date = start_date + timedelta(days=6)
        payload = {
            "available_days": [start_date.strftime("%A")],
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "opening_time": "10:00",
            "closing_time": "12:00",
            "slot_duration_minutes": 60,
            "base_price": "1200",
        }

        first_response = self.client.post(reverse("owner-generate-slots", args=[self.court.id]), payload, format="json")
        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(first_response.data["created_count"], 2)
        self.assertEqual(first_response.data["days_in_range"], 7)
        self.assertEqual(first_response.data["start_date"], start_date.isoformat())
        self.assertEqual(first_response.data["end_date"], end_date.isoformat())

        second_response = self.client.post(reverse("owner-generate-slots", args=[self.court.id]), payload, format="json")
        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(second_response.data["created_count"], 0)
        self.assertEqual(second_response.data["existing_count"], 2)
        self.assertEqual(CourtSlot.objects.filter(court=self.court).count(), 2)

    def test_generation_rejects_past_and_overlong_ranges(self):
        base_payload = {
            "available_days": ["MONDAY"],
            "opening_time": "10:00",
            "closing_time": "12:00",
            "slot_duration_minutes": 60,
            "base_price": "1200",
        }
        past_date = timezone.localdate() - timedelta(days=1)
        past_response = self.client.post(
            reverse("owner-generate-slots", args=[self.court.id]),
            {**base_payload, "start_date": past_date.isoformat(), "end_date": past_date.isoformat()},
            format="json",
        )
        self.assertEqual(past_response.status_code, 400)
        self.assertIn("today onward", past_response.data["detail"])

        start_date = timezone.localdate()
        long_response = self.client.post(
            reverse("owner-generate-slots", args=[self.court.id]),
            {**base_payload, "start_date": start_date.isoformat(), "end_date": (start_date + timedelta(days=90)).isoformat()},
            format="json",
        )
        self.assertEqual(long_response.status_code, 400)
        self.assertIn("up to 90 days", long_response.data["detail"])

    def test_generation_never_creates_overlapping_duration_inventory(self):
        slot_date = timezone.localdate() + timedelta(days=1)
        CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_duration_minutes=60,
            price=1200,
        )

        response = self.client.post(
            reverse("owner-generate-slots", args=[self.court.id]),
            {
                "available_days": [slot_date.strftime("%A")],
                "start_date": slot_date.isoformat(),
                "end_date": slot_date.isoformat(),
                "opening_time": "10:00",
                "closing_time": "11:00",
                "slot_duration_minutes": 30,
                "base_price": "700",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["created_count"], 0)
        self.assertEqual(response.data["overlap_count"], 2)
        self.assertEqual(CourtSlot.objects.filter(court=self.court).count(), 1)

    def test_booking_rejects_legacy_overlapping_inventory(self):
        player = get_user_model().objects.create_user(
            email="slot-player@example.com",
            password="test-password",
            full_name="Slot Player",
            phone="9800000098",
            role="PLAYER",
        )
        self.venue.status = Venue.Status.APPROVED
        self.venue.save(update_fields=["status", "updated_at"])
        primary_slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=2),
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_duration_minutes=60,
            price=1200,
        )
        CourtSlot.objects.create(
            court=self.court,
            date=primary_slot.date,
            start_time=time(10, 0),
            end_time=time(10, 30),
            slot_duration_minutes=30,
            price=700,
        )
        self.client.force_authenticate(player)

        response = self.client.post(
            reverse("booking-reserve"),
            {"slot_ids": [primary_slot.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("overlapping", response.data["detail"])

    def test_clear_future_availability_only_removes_unbooked_slots(self):
        player = get_user_model().objects.create_user(
            email="clear-player@example.com",
            password="test-password",
            full_name="Clear Player",
            phone="9800000097",
            role="PLAYER",
        )
        slot_date = timezone.localdate() + timedelta(days=2)
        clearable = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_duration_minutes=60,
            price=1200,
        )
        booked = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(11, 0),
            end_time=time(12, 0),
            slot_duration_minutes=60,
            price=1200,
            status=CourtSlot.Status.BOOKED,
        )
        reserved = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(12, 0),
            end_time=time(13, 0),
            slot_duration_minutes=60,
            price=1200,
            status=CourtSlot.Status.RESERVED,
            reserved_until=timezone.now() + timedelta(minutes=10),
        )
        blocked = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(13, 0),
            end_time=time(14, 0),
            slot_duration_minutes=60,
            price=1200,
            status=CourtSlot.Status.BLOCKED,
        )
        historical = CourtSlot.objects.create(
            court=self.court,
            date=slot_date,
            start_time=time(14, 0),
            end_time=time(15, 0),
            slot_duration_minutes=60,
            price=1200,
        )
        Booking.objects.create(
            player=player,
            venue=self.venue,
            court=self.court,
            slot=historical,
            amount=Decimal("1200.00"),
            status=Booking.BookingStatus.CANCELLED,
            payment_status=Booking.PaymentStatus.CANCELLED,
            reserved_until=timezone.now() + timedelta(minutes=10),
            cancelled_at=timezone.now(),
        )

        response = self.client.post(
            reverse("owner-clear-future-slots", args=[self.court.id]),
            {"start_date": slot_date.isoformat(), "end_date": slot_date.isoformat()},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["cleared_count"], 1)
        self.assertEqual(response.data["protected_count"], 4)
        self.assertFalse(CourtSlot.objects.filter(pk=clearable.pk).exists())
        self.assertTrue(CourtSlot.objects.filter(pk=booked.pk).exists())
        self.assertTrue(CourtSlot.objects.filter(pk=reserved.pk).exists())
        self.assertTrue(CourtSlot.objects.filter(pk=blocked.pk).exists())
        self.assertTrue(CourtSlot.objects.filter(pk=historical.pk).exists())

    def test_clear_future_availability_requires_a_bounded_future_range(self):
        response = self.client.post(
            reverse("owner-clear-future-slots", args=[self.court.id]),
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("date range", response.data["detail"])

        start_date = timezone.localdate()
        response = self.client.post(
            reverse("owner-clear-future-slots", args=[self.court.id]),
            {"start_date": start_date.isoformat(), "end_date": (start_date + timedelta(days=90)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("up to 90 days", response.data["detail"])

    def test_past_slots_are_history_not_bookable_availability(self):
        past_slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() - timedelta(days=1),
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_duration_minutes=60,
            price=1200,
        )
        self.court.venue.status = Venue.Status.APPROVED
        self.court.venue.save(update_fields=["status", "updated_at"])

        owner_action = self.client.post(
            reverse("owner-slot-status", args=[past_slot.id, "block"]),
            {},
            format="json",
        )
        self.assertEqual(owner_action.status_code, 400)
        self.assertIn("kept for history", owner_action.data["detail"])

        self.client.force_authenticate(user=None)
        public_response = self.client.get(
            reverse("public-court-slots", args=[self.court.id]),
            {"date": past_slot.date.isoformat()},
        )
        self.assertEqual(public_response.status_code, 200)
        self.assertEqual(public_response.data["slots"], [])


class CourtReviewApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="court-review-owner@example.com",
            password="test-password",
            full_name="Court Review Owner",
            phone="9800000090",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="court-review-player@example.com",
            password="test-password",
            full_name="Court Review Player",
            phone="9800000091",
            role="PLAYER",
        )
        self.other_player = user_model.objects.create_user(
            email="court-review-other@example.com",
            password="test-password",
            full_name="Other Player",
            phone="9800000092",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Review Cricksal Arena",
            city="Kathmandu",
            area="Maitidevi",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Review Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )
        slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() - timedelta(days=2),
            start_time=time(8, 0),
            end_time=time(9, 0),
            slot_duration_minutes=60,
            price=Decimal("1200.00"),
            status=CourtSlot.Status.BOOKED,
        )
        self.booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=slot,
            amount=Decimal("1200.00"),
            status=Booking.BookingStatus.COMPLETED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() - timedelta(days=3),
            confirmed_at=timezone.now() - timedelta(days=3),
            completed_at=timezone.now() - timedelta(days=2),
            cancellation_policy_snapshot=build_cancellation_policy_snapshot(self.venue),
        )
        BookingSlot.objects.create(booking=self.booking, slot=slot, price=slot.price)

    def review_url(self):
        return reverse("court-reviews", args=[self.court.id])

    def comment_url(self):
        return reverse("court-review-comments", args=[self.court.id])

    def comment_detail_url(self, comment_id):
        return reverse("court-review-comment-detail", args=[self.court.id, comment_id])

    def reaction_url(self):
        return reverse("court-feedback-reactions", args=[self.court.id])

    def report_url(self):
        return reverse("court-feedback-reports", args=[self.court.id])

    def test_completed_player_can_create_edit_and_delete_one_review(self):
        self.client.force_authenticate(self.player)
        response = self.client.post(
            self.review_url(),
            {"booking_id": self.booking.id, "rating": 5, "comment": "Clean court and helpful staff."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CourtReview.objects.count(), 1)

        response = self.client.get(self.review_url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["average_rating"], "5.00")
        self.assertTrue(response.data["eligibility"]["can_review"] is False)
        self.assertTrue(response.data["reviews"][0]["is_author"])

        response = self.client.patch(
            self.review_url(),
            {"rating": 4, "comment": "Updated after another visit."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["review"]["rating"], 4)

        response = self.client.delete(self.review_url())
        self.assertEqual(response.status_code, 204)
        self.assertFalse(CourtReview.objects.exists())

    def test_unverified_users_and_non_players_cannot_write_reviews(self):
        response = self.client.post(self.review_url(), {"rating": 5}, format="json")
        self.assertEqual(response.status_code, 401)

        self.client.force_authenticate(self.owner)
        response = self.client.post(self.review_url(), {"rating": 5}, format="json")
        self.assertEqual(response.status_code, 403)

        self.client.force_authenticate(self.other_player)
        response = self.client.post(self.review_url(), {"rating": 5}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("paid booking", response.data["detail"])

    def test_a_player_can_only_have_one_review_for_a_court(self):
        self.client.force_authenticate(self.player)
        first_response = self.client.post(
            self.review_url(),
            {"booking_id": self.booking.id, "rating": 4},
            format="json",
        )
        self.assertEqual(first_response.status_code, 201)

        second_response = self.client.post(
            self.review_url(),
            {"booking_id": self.booking.id, "rating": 2},
            format="json",
        )
        self.assertEqual(second_response.status_code, 409)
        self.assertEqual(CourtReview.objects.count(), 1)

    def test_player_can_submit_multiple_comments_without_changing_rating(self):
        self.client.force_authenticate(self.player)
        rating_response = self.client.post(
            self.review_url(),
            {"booking_id": self.booking.id, "rating": 4, "comment": "Good first visit."},
            format="json",
        )
        self.assertEqual(rating_response.status_code, 201)

        first_response = self.client.post(
            self.comment_url(),
            {"comment": "The surface was clean."},
            format="json",
        )
        second_response = self.client.post(
            self.comment_url(),
            {"comment": "Parking was easy to find."},
            format="json",
        )
        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(CourtReviewComment.objects.count(), 2)

        response = self.client.get(self.review_url())
        self.assertEqual(response.data["summary"]["average_rating"], "4.00")
        self.assertEqual(response.data["summary"]["review_count"], 1)
        self.assertEqual(response.data["summary"]["comment_count"], 2)

        comment_id = first_response.data["comment"]["id"]
        response = self.client.patch(
            self.comment_detail_url(comment_id),
            {"comment": "The playing surface was clean."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["comment"]["comment"], "The playing surface was clean.")

        response = self.client.delete(self.comment_detail_url(second_response.data["comment"]["id"]))
        self.assertEqual(response.status_code, 204)
        self.assertEqual(CourtReviewComment.objects.count(), 1)

    def test_player_can_submit_a_comment_without_submitting_a_rating(self):
        self.client.force_authenticate(self.player)
        response = self.client.post(
            self.comment_url(),
            {"comment": "The staff explained the rules clearly."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(CourtReview.objects.exists())
        self.assertEqual(CourtReviewComment.objects.count(), 1)

    def test_only_the_comment_author_can_edit_or_delete_it(self):
        self.client.force_authenticate(self.player)
        response = self.client.post(self.comment_url(), {"comment": "Useful comment."}, format="json")
        self.assertEqual(response.status_code, 201)
        comment_id = response.data["comment"]["id"]

        self.client.force_authenticate(self.other_player)
        response = self.client.patch(
            self.comment_detail_url(comment_id),
            {"comment": "Changed by somebody else."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(CourtReviewComment.objects.get(pk=comment_id).comment, "Useful comment.")

    def test_player_can_toggle_like_and_dislike_on_feedback(self):
        self.client.force_authenticate(self.player)
        review_response = self.client.post(
            self.review_url(),
            {"booking_id": self.booking.id, "rating": 5},
            format="json",
        )
        review_id = review_response.data["review"]["id"]

        response = self.client.post(
            self.reaction_url(),
            {"target_type": "review", "target_id": review_id, "reaction": "LIKE"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["reaction"], "LIKE")
        self.assertEqual(response.data["like_count"], 1)

        response = self.client.post(
            self.reaction_url(),
            {"target_type": "review", "target_id": review_id, "reaction": "LIKE"},
            format="json",
        )
        self.assertEqual(response.data["reaction"], None)
        self.assertEqual(response.data["like_count"], 0)

        response = self.client.post(
            self.reaction_url(),
            {"target_type": "review", "target_id": review_id, "reaction": "DISLIKE"},
            format="json",
        )
        self.assertEqual(response.data["reaction"], "DISLIKE")
        self.assertEqual(response.data["dislike_count"], 1)
        self.assertEqual(CourtFeedbackReaction.objects.count(), 1)

    def test_feedback_reports_are_private_and_duplicate_reports_are_blocked(self):
        self.client.force_authenticate(self.player)
        comment_response = self.client.post(self.comment_url(), {"comment": "Helpful information."}, format="json")
        comment_id = comment_response.data["comment"]["id"]

        self.client.force_authenticate(self.other_player)
        response = self.client.post(
            self.report_url(),
            {"target_type": "comment", "target_id": comment_id, "reason": "MISLEADING", "details": "The information looks outdated."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CourtFeedbackReport.objects.count(), 1)
        self.assertNotIn("status", response.data)

        response = self.client.post(
            self.report_url(),
            {"target_type": "comment", "target_id": comment_id, "reason": "SPAM"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(CourtFeedbackReport.objects.count(), 1)


class OwnerReviewsApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="owner-feedback@example.com",
            password="test-password",
            full_name="Owner Feedback",
            phone="9800000190",
            role="COURT_OWNER",
        )
        self.other_owner = user_model.objects.create_user(
            email="other-owner-feedback@example.com",
            password="test-password",
            full_name="Other Owner Feedback",
            phone="9800000191",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="player-feedback@example.com",
            password="test-password",
            full_name="Player Feedback",
            phone="9800000192",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Owner Feedback Arena",
            city="Kathmandu",
            area="Maitidevi",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.other_venue = Venue.objects.create(
            owner=self.other_owner,
            name="Other Feedback Arena",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Main Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )
        self.second_court = Court.objects.create(
            venue=self.venue,
            name="Training Court",
            court_type=Court.CourtType.OUTDOOR,
            surface_type=Court.SurfaceType.CEMENT,
            is_active=False,
        )
        slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() - timedelta(days=4),
            start_time=time(8, 0),
            end_time=time(9, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        self.booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.COMPLETED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=timezone.now() - timedelta(days=5),
            confirmed_at=timezone.now() - timedelta(days=5),
            completed_at=timezone.now() - timedelta(days=4),
            cancellation_policy_snapshot=build_cancellation_policy_snapshot(self.venue),
        )
        BookingSlot.objects.create(booking=self.booking, slot=slot, price=slot.price)

    def owner_url(self):
        return reverse("owner-reviews")

    def test_owner_can_read_verified_feedback_for_only_their_venue(self):
        review = CourtReview.objects.create(
            reviewer=self.player,
            venue=self.venue,
            court=self.court,
            booking=self.booking,
            rating=5,
            comment="Excellent surface and lighting.",
        )
        comment = CourtReviewComment.objects.create(
            reviewer=self.player,
            venue=self.venue,
            court=self.court,
            booking=self.booking,
            comment="The changing area was clean.",
        )

        self.client.force_authenticate(self.owner)
        response = self.client.get(self.owner_url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["venue"]["id"], self.venue.id)
        self.assertEqual(response.data["summary"]["average_rating"], "5.00")
        self.assertEqual(response.data["summary"]["rating_count"], 1)
        self.assertEqual(response.data["summary"]["comment_count"], 1)
        self.assertEqual(response.data["pagination"]["total"], 2)
        self.assertEqual({item["content_type"] for item in response.data["feedback"]}, {"review", "comment"})
        review_item = next(item for item in response.data["feedback"] if item["content_type"] == "review")
        self.assertEqual(review_item["id"], review.id)
        self.assertNotIn("booking", review_item)
        self.assertNotIn("reviewer", review_item)
        self.assertEqual(response.data["courts"][0]["name"], self.court.name)
        self.assertEqual(response.data["courts"][1]["name"], self.second_court.name)
        self.assertEqual(comment.comment, "The changing area was clean.")

    def test_owner_feedback_filters_and_date_period_are_scoped(self):
        CourtReview.objects.create(
            reviewer=self.player,
            venue=self.venue,
            court=self.court,
            booking=self.booking,
            rating=4,
            comment="Good court.",
        )
        CourtReviewComment.objects.create(
            reviewer=self.player,
            venue=self.venue,
            court=self.court,
            booking=self.booking,
            comment="Helpful staff.",
        )

        self.client.force_authenticate(self.owner)
        response = self.client.get(self.owner_url(), {"type": "comments", "period": "30", "court_id": self.court.id})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["filters"]["type"], "comments")
        self.assertEqual(response.data["filters"]["court_id"], self.court.id)
        self.assertEqual(response.data["pagination"]["total"], 1)
        self.assertEqual(response.data["feedback"][0]["content_type"], "comment")
        self.assertEqual(response.data["filters"]["period"], "30")

    def test_owner_feedback_endpoint_is_read_only_and_does_not_leak_other_venues(self):
        self.client.force_authenticate(self.other_owner)
        response = self.client.get(self.owner_url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["venue"]["id"], self.other_venue.id)
        self.assertEqual(response.data["feedback"], [])

        self.client.force_authenticate(self.owner)
        response = self.client.post(self.owner_url(), {"rating": 1}, format="json")
        self.assertEqual(response.status_code, 405)
        response = self.client.delete(self.owner_url())
        self.assertEqual(response.status_code, 405)

    def test_owner_can_report_feedback_without_editing_or_deleting_it(self):
        review = CourtReview.objects.create(
            reviewer=self.player,
            venue=self.venue,
            court=self.court,
            booking=self.booking,
            rating=1,
            comment="This review needs moderation.",
        )
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse("owner-feedback-report"),
            {"target_type": "review", "target_id": review.id, "reason": "INAPPROPRIATE", "details": "Please review this content."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CourtFeedbackReport.objects.filter(reporter=self.owner, review=review).count(), 1)
        self.assertTrue(CourtReview.objects.filter(pk=review.id).exists())


class BookingCheckInApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            email="checkin-owner@example.com",
            password="test-password",
            full_name="Check-in Owner",
            phone="9800000210",
            role="COURT_OWNER",
        )
        self.other_owner = user_model.objects.create_user(
            email="other-checkin-owner@example.com",
            password="test-password",
            full_name="Other Owner",
            phone="9800000211",
            role="COURT_OWNER",
        )
        self.player = user_model.objects.create_user(
            email="checkin-player@example.com",
            password="test-password",
            full_name="Check-in Player",
            phone="9800000212",
            role="PLAYER",
        )
        self.venue = Venue.objects.create(
            owner=self.owner,
            name="Check-in Cricksal Arena",
            city="Kathmandu",
            area="Maitidevi",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.other_venue = Venue.objects.create(
            owner=self.other_owner,
            name="Other Cricksal Arena",
            city="Kathmandu",
            area="Baneshwor",
            status=Venue.Status.APPROVED,
            is_active=True,
        )
        self.court = Court.objects.create(
            venue=self.venue,
            name="Check-in Court",
            court_type=Court.CourtType.INDOOR,
            surface_type=Court.SurfaceType.TURF,
            is_active=True,
        )
        self.slot = CourtSlot.objects.create(
            court=self.court,
            date=timezone.localdate() + timedelta(days=1),
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_duration_minutes=60,
            price=Decimal("1500.00"),
            status=CourtSlot.Status.BOOKED,
        )
        self.fake_now = timezone.make_aware(datetime.combine(self.slot.date, time(9, 0)), timezone.get_current_timezone())
        self.booking = Booking.objects.create(
            player=self.player,
            venue=self.venue,
            court=self.court,
            slot=self.slot,
            amount=Decimal("1500.00"),
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            reserved_until=self.fake_now + timedelta(minutes=10),
            confirmed_at=self.fake_now - timedelta(days=1),
            cancellation_policy_snapshot=build_cancellation_policy_snapshot(self.venue),
        )

    def test_player_receives_real_signed_pass_and_owner_can_verify_it_once(self):
        self.client.force_authenticate(self.player)
        with patch("venues.views.timezone.now", return_value=self.fake_now), patch("venues.services.timezone.now", return_value=self.fake_now):
            response = self.client.get(reverse("booking-detail", args=[self.booking.id]))

        self.assertEqual(response.status_code, 200)
        qr_token = response.data["booking"]["check_in"]["qr_token"]
        self.assertTrue(qr_token)
        self.assertEqual(response.data["booking"]["check_in"]["status"], "READY")

        self.client.force_authenticate(self.owner)
        with patch("venues.views.timezone.now", return_value=self.fake_now), patch("venues.services.timezone.now", return_value=self.fake_now):
            first_response = self.client.post(
                reverse("owner-booking-verify"),
                {"token": qr_token},
                format="json",
            )
            second_response = self.client.post(
                reverse("owner-booking-verify"),
                {"booking_code": self.booking.booking_code.lower()},
                format="json",
            )

        self.assertEqual(first_response.status_code, 200)
        self.assertTrue(first_response.data["valid"])
        self.assertFalse(first_response.data["already_checked_in"])
        self.assertEqual(second_response.status_code, 200)
        self.assertTrue(second_response.data["already_checked_in"])
        check_in = BookingCheckIn.objects.get(booking=self.booking)
        self.assertEqual(check_in.scan_count, 2)
        self.assertEqual(first_response.data["booking"]["payment_status"], Booking.PaymentStatus.PAID)
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.player,
                notification_type=Notification.NotificationType.BOOKING_CHECKED_IN,
            ).count(),
            1,
        )
        self.assertFalse(
            Notification.objects.filter(
                recipient=self.owner,
                notification_type=Notification.NotificationType.BOOKING_CHECKED_IN,
            ).exists()
        )
        self.assertFalse(ParticipationCommitment.objects.exists())
        self.assertFalse(ReliabilityEvent.objects.exists())

    def test_tampered_or_foreign_pass_is_rejected_without_leaking_booking_details(self):
        self.client.force_authenticate(self.player)
        with patch("venues.views.timezone.now", return_value=self.fake_now), patch("venues.services.timezone.now", return_value=self.fake_now):
            detail_response = self.client.get(reverse("booking-detail", args=[self.booking.id]))
        qr_token = detail_response.data["booking"]["check_in"]["qr_token"]

        self.client.force_authenticate(self.other_owner)
        with patch("venues.views.timezone.now", return_value=self.fake_now), patch("venues.services.timezone.now", return_value=self.fake_now):
            foreign_response = self.client.post(reverse("owner-booking-verify"), {"token": qr_token}, format="json")
            tampered_response = self.client.post(reverse("owner-booking-verify"), {"token": f"{qr_token}x"}, format="json")

        self.assertEqual(foreign_response.status_code, 404)
        self.assertNotIn("booking", foreign_response.data)
        self.assertEqual(tampered_response.status_code, 400)
        self.assertNotIn("booking", tampered_response.data)
        self.assertFalse(BookingCheckIn.objects.exists())

    def test_cancelled_booking_cannot_be_checked_in(self):
        from venues.services import generate_booking_check_in_token

        token = generate_booking_check_in_token(self.booking)
        self.booking.status = Booking.BookingStatus.CANCELLED
        self.booking.payment_status = Booking.PaymentStatus.REFUND_PENDING
        self.booking.save(update_fields=["status", "payment_status", "updated_at"])

        self.client.force_authenticate(self.owner)
        with patch("venues.views.timezone.now", return_value=self.fake_now), patch("venues.services.timezone.now", return_value=self.fake_now):
            response = self.client.post(reverse("owner-booking-verify"), {"token": token}, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.data["valid"])
        self.assertEqual(response.data["verification_status"], "NOT_AVAILABLE")
        self.assertFalse(BookingCheckIn.objects.exists())

    def test_check_in_is_not_open_before_the_two_hour_window(self):
        from venues.services import generate_booking_check_in_token

        token = generate_booking_check_in_token(self.booking)
        early_now = timezone.make_aware(datetime.combine(self.slot.date, time(7, 0)), timezone.get_current_timezone())
        self.client.force_authenticate(self.owner)
        with patch("venues.views.timezone.now", return_value=early_now), patch("venues.services.timezone.now", return_value=early_now):
            response = self.client.post(reverse("owner-booking-verify"), {"token": token}, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["verification_status"], "NOT_YET_OPEN")
        self.assertFalse(BookingCheckIn.objects.exists())
