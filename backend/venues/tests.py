from datetime import time, timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core import mail
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
from venues.policies import build_cancellation_policy_snapshot, get_cancellation_quote
from venues.location import search_locations
from venues.models import Booking, BookingSlot, Court, CourtSlot, Venue


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
