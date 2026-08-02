import json
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.models import Notification
from notifications.services import (
    notify_admins_venue_submitted,
    notify_booking_cancelled,
    notify_booking_confirmed,
    notify_booking_payment_failed,
    notify_owner_booking_reserved,
    notify_owner_refund_requested,
    notify_owner_venue_review,
    notify_refund_updated,
    notify_venue_message,
)
from .khalti import (
    KhaltiAPIError,
    KhaltiConfigurationError,
    initiate_khalti_payment,
    lookup_khalti_payment,
    npr_to_paisa,
)
from .models import Booking, BookingMessage, BookingSlot, Court, CourtSlot, Venue, VenuePhoto
from .policies import build_cancellation_policy_snapshot, get_booking_start_at, get_cancellation_quote
from .reference_data import (
    SPORTSPOT_AREAS_BY_DISTRICT,
    SPORTSPOT_DISTRICTS,
    SPORTSPOT_DURATIONS,
    SPORTSPOT_FACILITIES,
    SPORTSPOT_TIME_PERIODS,
)
from .permissions import IsAdminRole, IsCourtOwner, IsPlayer
from .serializers import AdminVenueSerializer, BookingMessageSerializer, BookingSerializer, CourtSerializer, PublicCourtDetailSerializer, PublicVenueSerializer, SlotSerializer, VenuePhotoSerializer, VenueSerializer


class OwnerVenueView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        venue = Venue.objects.filter(owner=request.user).prefetch_related("courts").first()
        if not venue:
            return Response({"venue": None}, status=status.HTTP_200_OK)
        return Response({"venue": VenueSerializer(venue, context={"request": request}).data})

    def post(self, request):
        venue = Venue.objects.filter(owner=request.user).first()
        data = normalize_request_data(request.data)
        submit_for_review = parse_bool(data.pop("submit_for_review", False))
        critical_changes = bool(venue and venue.status == Venue.Status.APPROVED and has_critical_venue_changes(venue, data))

        if critical_changes and not submit_for_review:
            return Response(
                {"detail": "These venue identity/legal changes require admin review. Use Submit Major Changes for Review."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = VenueSerializer(venue, data=data, partial=bool(venue), context={"request": request})
        serializer.is_valid(raise_exception=True)
        venue = serializer.save(owner=request.user)

        if critical_changes and submit_for_review:
            venue.status = Venue.Status.PENDING
            venue.submitted_at = timezone.now()
            venue.admin_review_note = ""
            venue.save(update_fields=["status", "submitted_at", "admin_review_note", "updated_at"])
            notify_admins_venue_submitted(venue, request.user, is_change_request=True)
        elif venue.status in [Venue.Status.PENDING, Venue.Status.REJECTED, Venue.Status.NEEDS_CHANGES]:
            venue.status = Venue.Status.DRAFT
            venue.admin_review_note = ""
            venue.save(update_fields=["status", "admin_review_note", "updated_at"])
        return Response({"venue": VenueSerializer(venue, context={"request": request}).data}, status=status.HTTP_200_OK)

    def patch(self, request):
        return self.post(request)

    def delete(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"detail": "No venue found to delete."}, status=status.HTTP_404_NOT_FOUND)

        can_delete, reason = can_permanently_delete_venue(venue)
        if not can_delete:
            return Response(
                {
                    "detail": reason,
                    "can_deactivate": True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        venue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)



class OwnerOverviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def get(self, request):
        now = timezone.now()
        today = timezone.localdate()
        venue = (
            Venue.objects.filter(owner=request.user)
            .select_related("owner")
            .prefetch_related("courts", "photos")
            .first()
        )

        if not venue:
            return Response(
                {
                    "server_now": now.isoformat(),
                    "local_date": today.isoformat(),
                    "venue": None,
                    "lifecycle_state": "NO_VENUE",
                    "summary": empty_owner_summary(),
                    "today_schedule": [],
                    "next_booking": None,
                    "pending_actions": [
                        {
                            "id": "create-venue",
                            "title": "Complete venue setup",
                            "reason": "Add your venue details, courts, availability and verification proof.",
                            "priority": "IMPORTANT",
                            "action_label": "Complete Setup",
                            "action_url": "/dashboard/owner/venue-setup",
                        }
                    ],
                    "court_statuses": [],
                    "recent_activity": [],
                    "quick_actions": [
                        {"label": "Complete Venue Setup", "href": "/dashboard/owner/venue-setup", "tone": "primary"}
                    ],
                }
            )

        bookings = list(
            Booking.objects.filter(venue=venue)
            .select_related("player", "venue", "court", "slot")
            .prefetch_related("slot_items__slot", "venue_messages__sender", "venue__photos")
        )
        for booking in bookings:
            if booking.status in [Booking.BookingStatus.RESERVED, Booking.BookingStatus.CONFIRMED]:
                refresh_booking_lifecycle(booking)

        bookings = list(
            Booking.objects.filter(venue=venue)
            .select_related("player", "venue", "court", "slot")
            .prefetch_related("slot_items__slot", "venue_messages__sender", "venue__photos")
        )
        courts = list(venue.courts.all())
        today_revenue = (
            Booking.objects.filter(
                venue=venue,
                slot__date=today,
                status__in=[Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED],
                payment_status=Booking.PaymentStatus.PAID,
            ).aggregate(total=Sum("amount"))["total"]
            or Decimal("0.00")
        )
        pending_refunds_count = Booking.objects.filter(
            venue=venue,
            status=Booking.BookingStatus.CANCELLED,
            refund_status=Booking.RefundStatus.PENDING_OWNER_ACTION,
        ).count()

        court_statuses = build_court_statuses(courts, bookings, now)
        return Response(
            {
                "server_now": now.isoformat(),
                "local_date": today.isoformat(),
                "venue": VenueSerializer(venue, context={"request": request}).data,
                "lifecycle_state": get_owner_lifecycle_state(venue),
                "summary": {
                    "today_bookings": count_today_bookings(bookings, today),
                    "today_expected_revenue": str(today_revenue),
                    "courts_in_use": sum(1 for item in court_statuses if item["status"] == "OCCUPIED"),
                    "total_active_courts": sum(1 for court in courts if court.is_active),
                    "pending_refund_requests": pending_refunds_count,
                },
                "today_schedule": build_today_schedule(bookings, today)[:5],
                "next_booking": build_next_booking(bookings, now),
                "pending_actions": build_owner_pending_actions(venue, courts, pending_refunds_count),
                "court_statuses": court_statuses,
                "recent_activity": build_owner_recent_activity(request.user),
                "quick_actions": build_owner_quick_actions(venue, pending_refunds_count),
            }
        )

class OwnerVenueSubmitView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request):
        venue = Venue.objects.filter(owner=request.user).first()
        if not venue:
            return Response({"detail": "Create venue details before submitting for approval."}, status=status.HTTP_400_BAD_REQUEST)
        if not venue.setup_is_complete:
            return Response(
                {"detail": "Complete venue details, add at least one court, generate slots, upload proof, and accept the declaration."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if venue.status == Venue.Status.PENDING:
            return Response(
                {
                    "detail": "Venue is already pending admin review.",
                    "venue": VenueSerializer(venue, context={"request": request}).data,
                }
            )

        venue.status = Venue.Status.PENDING
        venue.submitted_at = timezone.now()
        venue.admin_review_note = ""
        venue.save(update_fields=["status", "submitted_at", "admin_review_note", "updated_at"])
        notify_admins_venue_submitted(venue, request.user)
        return Response({"venue": VenueSerializer(venue, context={"request": request}).data})


class OwnerVenueDeactivateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"detail": "No venue found to deactivate."}, status=status.HTTP_404_NOT_FOUND)
        if not venue.is_active:
            return Response({"venue": VenueSerializer(venue, context={"request": request}).data})

        venue.is_active = False
        venue.save(update_fields=["is_active", "updated_at"])
        return Response({"venue": VenueSerializer(venue, context={"request": request}).data})


class OwnerVenuePhotoListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"photos": []}, status=status.HTTP_200_OK)
        photos = venue.photos.all()
        return Response({"photos": VenuePhotoSerializer(photos, many=True, context={"request": request}).data})

    def post(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"detail": "Save venue details before uploading venue photos."}, status=status.HTTP_400_BAD_REQUEST)

        category = str(request.data.get("category", "")).upper()
        if category not in VenuePhoto.PhotoCategory.values:
            return Response({"detail": "Select a valid photo category."}, status=status.HTTP_400_BAD_REQUEST)

        images = request.FILES.getlist("images") or request.FILES.getlist("image")
        if not images:
            return Response({"detail": "Choose at least one photo to upload."}, status=status.HTTP_400_BAD_REQUEST)

        created_photos = []
        for image in images:
            serializer = VenuePhotoSerializer(data={"category": category, "image": image})
            serializer.is_valid(raise_exception=True)
            created_photos.append(serializer.save(venue=venue))

        return Response(
            {"photos": VenuePhotoSerializer(created_photos, many=True, context={"request": request}).data},
            status=status.HTTP_201_CREATED,
        )


class OwnerVenuePhotoDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def delete(self, request, photo_id):
        photo = get_object_or_404(VenuePhoto, pk=photo_id, venue__owner=request.user)
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class OwnerCourtListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        venue = get_owner_venue(request.user)
        courts = venue.courts.all() if venue else Court.objects.none()
        return Response({"courts": CourtSerializer(courts, many=True, context={"request": request}).data})

    def post(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"detail": "Create venue details before adding courts."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = CourtSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        court = serializer.save(venue=venue)
        if venue.status == Venue.Status.APPROVED:
            venue.status = Venue.Status.PENDING
            venue.submitted_at = timezone.now()
            venue.admin_review_note = ""
            venue.save(update_fields=["status", "submitted_at", "admin_review_note", "updated_at"])
            notify_admins_venue_submitted(venue, request.user, is_change_request=True)
        return Response({"court": CourtSerializer(court, context={"request": request}).data}, status=status.HTTP_201_CREATED)


class OwnerCourtDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, court_id):
        court = get_owner_court(request.user, court_id)
        return Response({"court": CourtSerializer(court, context={"request": request}).data})

    def patch(self, request, court_id):
        court = get_owner_court(request.user, court_id)
        serializer = CourtSerializer(court, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"court": CourtSerializer(court, context={"request": request}).data})

    def delete(self, request, court_id):
        court = get_owner_court(request.user, court_id)
        can_delete, reason = can_permanently_delete_court(court)
        if not can_delete:
            return Response(
                {
                    "detail": reason,
                    "can_deactivate": True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        court.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class OwnerCourtDeactivateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request, court_id):
        court = get_owner_court(request.user, court_id)
        if not court.is_active:
            return Response({"court": CourtSerializer(court, context={"request": request}).data})

        court.is_active = False
        court.save(update_fields=["is_active", "updated_at"])
        CourtSlot.objects.filter(court=court, status=CourtSlot.Status.AVAILABLE).update(status=CourtSlot.Status.BLOCKED, updated_at=timezone.now())
        return Response({"court": CourtSerializer(court, context={"request": request}).data})


class GenerateSlotsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request, court_id):
        court = get_owner_court(request.user, court_id)
        available_days = request.data.get("available_days") or []
        opening_time = parse_time(request.data.get("opening_time"))
        closing_time = parse_time(request.data.get("closing_time"))
        duration = int(request.data.get("slot_duration_minutes") or 60)
        price = request.data.get("base_price")

        if not available_days or not opening_time or not closing_time or not price:
            return Response({"detail": "Available days, opening time, closing time, and base price are required."}, status=status.HTTP_400_BAD_REQUEST)
        if duration not in [30, 60, 90]:
            return Response({"detail": "Slot duration must be 30, 60, or 90 minutes."}, status=status.HTTP_400_BAD_REQUEST)
        if opening_time >= closing_time:
            return Response({"detail": "Opening time must be before closing time."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_day_numbers = {day_name_to_number(day) for day in available_days}
        created_slots = []
        skipped_count = 0
        start_date = timezone.localdate()

        for offset in range(14):
            slot_date = start_date + timedelta(days=offset)
            if slot_date.weekday() not in allowed_day_numbers:
                continue

            cursor = datetime.combine(slot_date, opening_time)
            close_at = datetime.combine(slot_date, closing_time)
            while cursor + timedelta(minutes=duration) <= close_at:
                start_time = cursor.time()
                end_time = (cursor + timedelta(minutes=duration)).time()
                try:
                    slot, created = CourtSlot.objects.get_or_create(
                        court=court,
                        date=slot_date,
                        start_time=start_time,
                        end_time=end_time,
                        defaults={
                            "slot_duration_minutes": duration,
                            "price": price,
                            "status": CourtSlot.Status.AVAILABLE,
                        },
                    )
                    if created:
                        created_slots.append(slot)
                    else:
                        skipped_count += 1
                except IntegrityError:
                    skipped_count += 1
                cursor += timedelta(minutes=duration)

        return Response(
            {
                "created_count": len(created_slots),
                "skipped_count": skipped_count,
                "slots": SlotSerializer(created_slots, many=True, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class OwnerCalendarView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def get(self, request):
        selected_date = parse_date_value(request.query_params.get("date")) or timezone.localdate()
        view_mode = str(request.query_params.get("view") or "day").lower()
        if view_mode not in ["day", "week"]:
            return Response({"detail": "Choose either day or week view."}, status=status.HTTP_400_BAD_REQUEST)

        if view_mode == "week":
            start_date = selected_date - timedelta(days=selected_date.weekday())
            end_date = start_date + timedelta(days=6)
        else:
            start_date = selected_date
            end_date = selected_date

        now = timezone.now()
        venue = get_owner_venue(request.user)
        if not venue:
            return Response(
                {
                    "server_now": now.isoformat(),
                    "date": selected_date.isoformat(),
                    "view": view_mode,
                    "week_start": start_date.isoformat(),
                    "week_end": end_date.isoformat(),
                    "venue": None,
                    "courts": [],
                    "slots": [],
                    "bookings": [],
                    "opening_time": None,
                    "closing_time": None,
                    "stats": empty_calendar_stats(),
                }
            )

        courts = Court.objects.filter(venue=venue).order_by("name")
        slots = list(
            CourtSlot.objects.filter(court__venue=venue, date__range=(start_date, end_date))
            .select_related("court", "court__venue", "blocked_by")
            .prefetch_related("booking_items__booking", "bookings")
            .order_by("date", "start_time", "court__name")
        )
        release_expired_reservations(slots)

        bookings = list(
            Booking.objects.filter(
                Q(slot__date__range=(start_date, end_date)) | Q(slot_items__slot__date__range=(start_date, end_date)),
                venue=venue,
                status__in=[
                    Booking.BookingStatus.RESERVED,
                    Booking.BookingStatus.CONFIRMED,
                    Booking.BookingStatus.COMPLETED,
                ],
            )
            .select_related("player", "venue", "court", "slot")
            .prefetch_related("slot_items__slot", "venue__photos")
            .distinct()
            .order_by("slot__date", "slot__start_time")
        )
        for booking in bookings:
            if booking.status in [Booking.BookingStatus.RESERVED, Booking.BookingStatus.CONFIRMED]:
                refresh_booking_lifecycle(booking)

        bookings = list(
            Booking.objects.filter(
                Q(slot__date__range=(start_date, end_date)) | Q(slot_items__slot__date__range=(start_date, end_date)),
                venue=venue,
                status__in=[
                    Booking.BookingStatus.RESERVED,
                    Booking.BookingStatus.CONFIRMED,
                    Booking.BookingStatus.COMPLETED,
                ],
            )
            .select_related("player", "venue", "court", "slot")
            .prefetch_related("slot_items__slot", "venue__photos")
            .distinct()
            .order_by("slot__date", "slot__start_time")
        )

        return Response(
            {
                "server_now": timezone.now().isoformat(),
                "date": selected_date.isoformat(),
                "view": view_mode,
                "week_start": start_date.isoformat(),
                "week_end": end_date.isoformat(),
                "venue": VenueSerializer(venue, context={"request": request}).data,
                "courts": CourtSerializer(courts, many=True, context={"request": request}).data,
                "slots": SlotSerializer(slots, many=True, context={"request": request}).data,
                "bookings": BookingSerializer(bookings, many=True, context={"request": request}).data,
                "opening_time": get_calendar_opening_time(venue, slots),
                "closing_time": get_calendar_closing_time(venue, slots),
                "stats": build_calendar_stats(slots, bookings),
            }
        )


class OwnerCalendarBlockView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request):
        court_id = request.data.get("court_id")
        start_date = parse_date_value(request.data.get("start_date"))
        end_date = parse_date_value(request.data.get("end_date") or request.data.get("start_date"))
        start_time = parse_time(request.data.get("start_time"))
        end_time = parse_time(request.data.get("end_time"))
        block_type = str(request.data.get("block_type") or "OTHER").upper()
        reason = str(request.data.get("reason") or "").strip()
        note = str(request.data.get("internal_note") or "").strip()

        if not court_id or not start_date or not end_date or not start_time or not end_time:
            return Response({"detail": "Choose a court, date, start time and end time."}, status=status.HTTP_400_BAD_REQUEST)
        if block_type not in CourtSlot.BlockType.values:
            return Response({"detail": "Choose a valid block type."}, status=status.HTTP_400_BAD_REQUEST)
        if not reason:
            return Response({"detail": "Add a short reason for blocking this time."}, status=status.HTTP_400_BAD_REQUEST)
        if start_date > end_date:
            return Response({"detail": "End date must be after the start date."}, status=status.HTTP_400_BAD_REQUEST)

        start_at = timezone.make_aware(datetime.combine(start_date, start_time), timezone.get_current_timezone())
        end_at = timezone.make_aware(datetime.combine(end_date, end_time), timezone.get_current_timezone())
        if end_at <= start_at:
            return Response({"detail": "End time must be after start time."}, status=status.HTTP_400_BAD_REQUEST)
        if start_at < timezone.now():
            return Response({"detail": "Choose a future time to block."}, status=status.HTTP_400_BAD_REQUEST)

        court = get_owner_court(request.user, court_id)
        with transaction.atomic():
            slots = list(
                CourtSlot.objects.select_for_update()
                .select_related("court", "court__venue")
                .filter(court=court, date__range=(start_date, end_date))
                .order_by("date", "start_time")
            )
            release_expired_reservations(slots)
            affected_slots = [slot for slot in slots if slot_overlaps_period(slot, start_at, end_at)]
            if not affected_slots:
                return Response(
                    {"detail": "No generated slots match this time. Generate availability before blocking it."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            conflicting_slots = [slot for slot in affected_slots if slot.status in [CourtSlot.Status.RESERVED, CourtSlot.Status.BOOKED]]
            if conflicting_slots:
                return Response(
                    {
                        "detail": "This time includes an existing booking or payment hold. Review the affected booking before blocking the court.",
                        "conflicts": [build_slot_conflict(slot) for slot in conflicting_slots],
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            slots_to_block = [slot for slot in affected_slots if slot.status == CourtSlot.Status.AVAILABLE]
            if not slots_to_block:
                return Response({"detail": "The selected time is already unavailable."}, status=status.HTTP_400_BAD_REQUEST)

            now = timezone.now()
            for slot in slots_to_block:
                slot.status = CourtSlot.Status.BLOCKED
                slot.block_type = block_type
                slot.block_reason = reason[:180]
                slot.block_note = note
                slot.blocked_at = now
                slot.blocked_by = request.user
                slot.save(
                    update_fields=[
                        "status",
                        "block_type",
                        "block_reason",
                        "block_note",
                        "blocked_at",
                        "blocked_by",
                        "updated_at",
                    ]
                )

        return Response(
            {
                "blocked_count": len(slots_to_block),
                "slots": SlotSerializer(slots_to_block, many=True, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )

class OwnerSlotListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def get(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"slots": []})
        slots = CourtSlot.objects.filter(court__venue=venue).select_related("court", "court__venue")
        date = request.query_params.get("date")
        court_id = request.query_params.get("court_id")
        if date:
            slots = slots.filter(date=date)
        if court_id:
            slots = slots.filter(court_id=court_id)
        release_expired_reservations(slots)
        return Response({"slots": SlotSerializer(slots, many=True, context={"request": request}).data})


class SlotStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request, slot_id, action):
        slot = get_object_or_404(CourtSlot.objects.select_related("court", "court__venue"), pk=slot_id, court__venue__owner=request.user)
        slot.release_if_expired()

        if action == "block":
            if slot.status != CourtSlot.Status.AVAILABLE:
                return Response({"detail": "Only available slots can be blocked."}, status=status.HTTP_400_BAD_REQUEST)
            slot.status = CourtSlot.Status.BLOCKED
            slot.block_type = str(request.data.get("block_type") or CourtSlot.BlockType.OTHER).upper()
            if slot.block_type not in CourtSlot.BlockType.values:
                slot.block_type = CourtSlot.BlockType.OTHER
            slot.block_reason = str(request.data.get("reason") or "Blocked by venue owner.").strip()[:180]
            slot.block_note = str(request.data.get("internal_note") or "").strip()
            slot.blocked_at = timezone.now()
            slot.blocked_by = request.user
            slot.save(update_fields=["status", "block_type", "block_reason", "block_note", "blocked_at", "blocked_by", "updated_at"])
        elif action == "unblock":
            if slot.status != CourtSlot.Status.BLOCKED:
                return Response({"detail": "Only blocked slots can be unblocked."}, status=status.HTTP_400_BAD_REQUEST)
            slot.status = CourtSlot.Status.AVAILABLE
            slot.block_type = ""
            slot.block_reason = ""
            slot.block_note = ""
            slot.blocked_at = None
            slot.blocked_by = None
            slot.save(update_fields=["status", "block_type", "block_reason", "block_note", "blocked_at", "blocked_by", "updated_at"])
        else:
            return Response({"detail": "Invalid slot action."}, status=status.HTTP_400_BAD_REQUEST)

        return Response({"slot": SlotSerializer(slot, context={"request": request}).data})


class OwnerBookingsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def get(self, request):
        venue = get_owner_venue(request.user)
        if not venue:
            return Response({"bookings": []})
        bookings = Booking.objects.filter(venue=venue).select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot", "venue_messages__sender", "venue__photos")
        for booking in bookings:
            refresh_booking_lifecycle(booking)
        return Response({"bookings": BookingSerializer(bookings, many=True, context={"request": request}).data})


class OwnerBookingMessageView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def post(self, request, booking_id):
        booking = get_object_or_404(
            Booking.objects.select_related("player", "venue", "venue__owner", "court"),
            pk=booking_id,
            venue__owner=request.user,
        )
        if booking.status not in [Booking.BookingStatus.RESERVED, Booking.BookingStatus.CONFIRMED]:
            return Response(
                {"detail": "Messages can only be sent for an active reserved or confirmed booking."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = BookingMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        booking_message = serializer.save(booking=booking, sender=request.user)
        notify_venue_message(booking_message)
        return Response(
            {"message": BookingMessageSerializer(booking_message).data},
            status=status.HTTP_201_CREATED,
        )


class AdminVenueListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        venues = Venue.objects.select_related("owner", "reviewed_by").prefetch_related("courts")
        status_filter = request.query_params.get("status")
        if status_filter:
            venues = venues.filter(status=status_filter)
        else:
            venues = venues.filter(status__in=[Venue.Status.PENDING, Venue.Status.NEEDS_CHANGES, Venue.Status.REJECTED, Venue.Status.APPROVED, Venue.Status.SUSPENDED])
        return Response({"venues": AdminVenueSerializer(venues, many=True, context={"request": request}).data})


class AdminVenueReviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def post(self, request, venue_id):
        venue = get_object_or_404(Venue, pk=venue_id)
        action = str(request.data.get("action", "")).upper()
        note = str(request.data.get("admin_review_note", "")).strip()
        target_status = {
            "APPROVE": Venue.Status.APPROVED,
            "NEEDS_CHANGES": Venue.Status.NEEDS_CHANGES,
            "REJECT": Venue.Status.REJECTED,
            "SUSPEND": Venue.Status.SUSPENDED,
        }.get(action)
        if target_status and venue.status == target_status:
            return Response(
                {
                    "detail": f"Venue is already {venue.get_status_display().lower()}.",
                    "venue": AdminVenueSerializer(venue, context={"request": request}).data,
                }
            )

        if action == "APPROVE":
            venue.status = Venue.Status.APPROVED
            venue.approved_at = timezone.now()
            venue.admin_review_note = note
        elif action == "NEEDS_CHANGES":
            if not note:
                return Response({"detail": "Review note is required when requesting changes."}, status=status.HTTP_400_BAD_REQUEST)
            venue.status = Venue.Status.NEEDS_CHANGES
            venue.admin_review_note = note
        elif action == "REJECT":
            if not note:
                return Response({"detail": "Review note is required when rejecting a venue."}, status=status.HTTP_400_BAD_REQUEST)
            venue.status = Venue.Status.REJECTED
            venue.admin_review_note = note
        elif action == "SUSPEND":
            if not note:
                return Response({"detail": "Review note is required when suspending a venue."}, status=status.HTTP_400_BAD_REQUEST)
            venue.status = Venue.Status.SUSPENDED
            venue.admin_review_note = note
        else:
            return Response({"detail": "Invalid admin action."}, status=status.HTTP_400_BAD_REQUEST)

        venue.reviewed_by = request.user
        venue.reviewed_at = timezone.now()
        venue.save(update_fields=["status", "approved_at", "admin_review_note", "reviewed_by", "reviewed_at", "updated_at"])
        notify_owner_venue_review(venue, request.user, action)
        return Response({"venue": AdminVenueSerializer(venue, context={"request": request}).data})


class OwnerRefundListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    def get(self, request):
        refund_status = request.query_params.get("status")
        bookings = (
            Booking.objects.filter(
                venue__owner=request.user,
                status=Booking.BookingStatus.CANCELLED,
                refund_status__in=[
                    Booking.RefundStatus.PENDING_OWNER_ACTION,
                    Booking.RefundStatus.REJECTED,
                    Booking.RefundStatus.REFUNDED,
                    Booking.RefundStatus.PARTIALLY_REFUNDED,
                ],
            )
            .select_related("player", "venue", "court", "slot", "cancelled_by", "refund_reviewed_by")
            .prefetch_related("slot_items__slot")
        )
        if refund_status:
            bookings = bookings.filter(refund_status=str(refund_status).upper())
        return Response({"refunds": BookingSerializer(bookings, many=True, context={"request": request}).data})


class OwnerRefundReviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsCourtOwner]

    @transaction.atomic
    def post(self, request, booking_id):
        booking = get_object_or_404(
            Booking.objects.select_for_update().select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot"),
            pk=booking_id,
            venue__owner=request.user,
            status=Booking.BookingStatus.CANCELLED,
        )
        action = str(request.data.get("action", "")).upper()
        note = str(request.data.get("owner_note", "")).strip()

        if booking.refund_status in [
            Booking.RefundStatus.REFUNDED,
            Booking.RefundStatus.PARTIALLY_REFUNDED,
        ]:
            return Response(
                {
                    "detail": "This refund was already marked as processed.",
                    "booking": BookingSerializer(booking, context={"request": request}).data,
                }
            )
        if booking.refund_status != Booking.RefundStatus.PENDING_OWNER_ACTION:
            return Response(
                {"detail": "This booking has no system-approved refund awaiting owner processing."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if action == "MARK_REFUNDED":
            if len(note) < 3:
                return Response(
                    {"detail": "Add a refund processing reference or note of at least 3 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if booking.refund_percentage >= 100:
                booking.payment_status = Booking.PaymentStatus.REFUNDED
                booking.refund_status = Booking.RefundStatus.REFUNDED
            else:
                booking.payment_status = Booking.PaymentStatus.PARTIALLY_REFUNDED
                booking.refund_status = Booking.RefundStatus.PARTIALLY_REFUNDED
        else:
            return Response({"detail": "Action must be MARK_REFUNDED."}, status=status.HTTP_400_BAD_REQUEST)

        booking.refund_owner_note = note
        booking.refund_reviewed_by = request.user
        booking.refund_reviewed_at = timezone.now()
        booking.save(
            update_fields=[
                "payment_status",
                "refund_status",
                "refund_owner_note",
                "refund_reviewed_by",
                "refund_reviewed_at",
                "updated_at",
            ]
        )
        notify_refund_updated(booking, request.user)
        return Response({"booking": BookingSerializer(booking, context={"request": request}).data})


class PublicCourtListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        courts = get_public_courts()
        return Response({"courts": CourtSerializer(courts, many=True, context={"request": request}).data})


DISCOVERY_TIME_WINDOWS = {item["value"]: (item["start"], item["end"]) for item in SPORTSPOT_TIME_PERIODS}


DISCOVERY_SORTS = {"recommended", "price_asc", "price_desc", "earliest"}
DISCOVERY_PAGE_SIZE = 9
DISCOVERY_MAX_PAGE_SIZE = 24


def parse_discovery_query(request):
    query = request.query_params
    today = timezone.localdate()

    raw_date = query.get("date") or today.isoformat()
    try:
        selected_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
    except ValueError:
        return None, "Choose a valid date."
    if selected_date < today:
        return None, "Choose today or a future date."

    raw_duration = query.get("duration") or "60"
    try:
        duration = int(raw_duration)
    except (TypeError, ValueError):
        return None, "Choose a valid duration."
    if duration not in SPORTSPOT_DURATIONS:
        return None, "Choose a supported duration."

    min_price, error = parse_decimal_query(query.get("min_price"), "minimum price")
    if error:
        return None, error
    max_price, error = parse_decimal_query(query.get("max_price"), "maximum price")
    if error:
        return None, error
    if min_price is not None and max_price is not None and min_price > max_price:
        return None, "Minimum price cannot be higher than maximum price."

    time_window = (query.get("time_window") or "").lower()
    if time_window and time_window not in DISCOVERY_TIME_WINDOWS:
        return None, "Choose a valid preferred time."

    specific_time = None
    if query.get("start_time"):
        specific_time = parse_time(query.get("start_time"))
        if not specific_time:
            return None, "Choose a valid start time."

    sort = query.get("sort") or "recommended"
    if sort not in DISCOVERY_SORTS:
        sort = "recommended"

    try:
        page = max(1, int(query.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = min(DISCOVERY_MAX_PAGE_SIZE, max(1, int(query.get("page_size") or DISCOVERY_PAGE_SIZE)))
    except (TypeError, ValueError):
        page_size = DISCOVERY_PAGE_SIZE

    return {
        "search": (query.get("search") or "").strip()[:80],
        "district": normalize_supported_district(query.get("district") or query.get("city") or ""),
        "area": normalize_supported_area(query.get("district") or query.get("city") or "", query.get("area") or ""),
        "date": selected_date,
        "time_window": time_window,
        "start_time": specific_time,
        "duration": duration,
        "min_price": min_price,
        "max_price": max_price,
        "venue_types": normalize_supported_venue_types(normalize_multi_query(query, "venue_type")),
        "facilities": normalize_supported_facilities(normalize_multi_query(query, "facility")),
        "sort": sort,
        "page": page,
        "page_size": page_size,
    }, ""


def parse_decimal_query(value, label):
    if value in [None, ""]:
        return None, ""
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None, f"Choose a valid {label}."
    if parsed < 0:
        return None, f"The {label} cannot be negative."
    return parsed, ""


def normalize_supported_venue_types(values):
    supported = {value for value, _label in Court.CourtType.choices}
    return [value for value in values if value in supported]


def normalize_supported_facilities(values):
    normalized_map = {normalize_text(facility): facility for facility in SPORTSPOT_FACILITIES}
    return [normalized_map[normalize_text(value)] for value in values if normalize_text(value) in normalized_map]

def normalize_multi_query(query, key):
    values = []
    for raw_value in query.getlist(key):
        values.extend(str(raw_value).split(","))
    return [value.strip() for value in values if value.strip()]


def apply_discovery_base_filters(venues, params):
    if params["search"]:
        search = params["search"]
        venues = venues.filter(
            Q(name__icontains=search)
            | Q(city__icontains=search)
            | Q(area__icontains=search)
            | Q(address__icontains=search)
        )
    if params["district"]:
        venues = venues.filter(city__iexact=params["district"])
    if params["area"]:
        venues = venues.filter(area__iexact=params["area"])
    if params["venue_types"]:
        venues = venues.filter(courts__court_type__in=params["venue_types"])
    return venues.distinct()


def should_include_discovery_card(card, params):
    selected_facilities = {facility.lower() for facility in params["facilities"]}
    venue_facilities = {facility.lower() for facility in card.get("facilities", [])}
    if selected_facilities and not selected_facilities.issubset(venue_facilities):
        return False

    starting_price = card.get("starting_price")
    if params["min_price"] is not None:
        if starting_price is None or Decimal(str(starting_price)) < params["min_price"]:
            return False
    if params["max_price"] is not None:
        if starting_price is None or Decimal(str(starting_price)) > params["max_price"]:
            return False
    return True


def build_discovery_venue_card(venue, params, request):
    base_data = PublicVenueSerializer(venue, context={"request": request}).data
    active_courts = [court for court in venue.courts.all() if court.is_active]
    availability = calculate_venue_availability(active_courts, params)
    court_type_values = sorted({court.court_type for court in active_courts})

    base_data.update(
        {
            "primary_image": get_discovery_primary_image(venue, active_courts, request),
            "is_verified": venue.status == Venue.Status.APPROVED,
            "starting_price": decimal_to_string(availability["starting_price"]),
            "available_court_count": availability["available_court_count"],
            "available_slot_count": availability["available_slot_count"],
            "next_available_time": availability["next_available_time"],
            "availability_label": get_availability_label(availability, params),
            "court_types": [
                {"value": court_type, "label": Court.CourtType(court_type).label}
                for court_type in court_type_values
            ],
            "court_type_summary": ", ".join(Court.CourtType(court_type).label for court_type in court_type_values),
            "important_facilities": list((venue.facilities or [])[:2]),
            "average_rating": None,
            "review_count": 0,
        }
    )
    return base_data


def calculate_venue_availability(courts, params):
    available_court_ids = set()
    all_ranges = []
    all_hourly_prices = []

    for court in courts:
        slots = [slot for slot in court.slots.all() if slot.date == params["date"]]
        for slot in court.slots.all():
            hourly_price = get_slot_hourly_price(slot)
            if hourly_price is not None:
                all_hourly_prices.append(hourly_price)
        ranges = find_consecutive_slot_ranges(slots, params)
        if ranges:
            available_court_ids.add(court.id)
            all_ranges.extend(ranges)

    starting_price = min([slot_range["hourly_price"] for slot_range in all_ranges], default=None)
    if starting_price is None and all_hourly_prices:
        starting_price = min(all_hourly_prices)

    next_range = min(all_ranges, key=lambda slot_range: slot_range["start_time"]) if all_ranges else None
    return {
        "starting_price": starting_price,
        "available_court_count": len(available_court_ids),
        "available_slot_count": len(all_ranges),
        "next_available_time": next_range["start_time"].strftime("%H:%M") if next_range else None,
    }


def find_consecutive_slot_ranges(slots, params):
    ordered_slots = sorted(slots, key=lambda slot: (slot.start_time, slot.end_time))
    ranges = []
    target_minutes = params["duration"]

    for start_index, start_slot in enumerate(ordered_slots):
        if not slot_can_start_range(start_slot, params):
            continue

        selected_slots = []
        total_minutes = 0
        total_price = Decimal("0")
        previous_slot = None

        for slot in ordered_slots[start_index:]:
            if not is_discovery_slot_available(slot):
                break
            if previous_slot and previous_slot.end_time != slot.start_time:
                break
            selected_slots.append(slot)
            total_minutes += slot.slot_duration_minutes
            total_price += slot.price
            previous_slot = slot
            if total_minutes >= target_minutes:
                break

        if total_minutes == target_minutes and selected_slots:
            ranges.append(
                {
                    "start_time": selected_slots[0].start_time,
                    "end_time": selected_slots[-1].end_time,
                    "slots_count": len(selected_slots),
                    "hourly_price": total_price / Decimal(str(target_minutes / 60)),
                }
            )
    return ranges


def slot_can_start_range(slot, params):
    if not is_discovery_slot_available(slot):
        return False
    if params["start_time"] and slot.start_time != params["start_time"]:
        return False
    if params["time_window"]:
        start_value, end_value = DISCOVERY_TIME_WINDOWS[params["time_window"]]
        window_start = parse_time(start_value)
        window_end = parse_time(end_value)
        if not (window_start <= slot.start_time < window_end):
            return False
    return True


def is_discovery_slot_available(slot):
    return slot.status == CourtSlot.Status.AVAILABLE and not is_slot_in_past(slot)


def get_slot_hourly_price(slot):
    if not slot.slot_duration_minutes:
        return None
    return slot.price * Decimal("60") / Decimal(str(slot.slot_duration_minutes))


def get_availability_label(availability, params):
    if availability["available_court_count"] <= 0:
        return "No availability for this date"
    if availability["available_slot_count"] <= 3:
        return "Few slots remaining"
    if availability["date"] if False else False:
        return "Available today"
    if params["date"] == timezone.localdate():
        return "Available today"
    if availability["next_available_time"]:
        return f"Next available at {format_time_label(availability['next_available_time'])}"
    return f"{availability['available_court_count']} courts available"


def get_discovery_primary_image(venue, courts, request):
    raw_image = ""
    if venue.front_photo:
        raw_image = venue.front_photo.url
    elif venue.court_area_photo:
        raw_image = venue.court_area_photo.url
    elif venue.additional_photo:
        raw_image = venue.additional_photo.url
    else:
        photo = next(iter(venue.photos.all()), None)
        if photo and photo.image:
            raw_image = photo.image.url
        else:
            court = next((item for item in courts if item.court_photo), None)
            if court:
                raw_image = court.court_photo.url
    return request.build_absolute_uri(raw_image) if raw_image else ""


def sort_discovery_cards(cards, sort):
    if sort == "price_asc":
        return sorted(cards, key=lambda card: (card.get("starting_price") is None, Decimal(str(card.get("starting_price") or 0)), card.get("name", "")))
    if sort == "price_desc":
        return sorted(cards, key=lambda card: (card.get("starting_price") is None, -Decimal(str(card.get("starting_price") or 0)), card.get("name", "")))
    if sort == "earliest":
        return sorted(cards, key=lambda card: (card.get("next_available_time") is None, card.get("next_available_time") or "99:99", card.get("name", "")))
    return sorted(
        cards,
        key=lambda card: (
            card.get("available_court_count", 0) <= 0,
            card.get("starting_price") is None,
            Decimal(str(card.get("starting_price") or 0)),
            card.get("name", ""),
        ),
    )


def build_discovery_filter_options(cards=None, params=None):
    cards = cards or []
    params = params or {}
    venues = Venue.objects.filter(status=Venue.Status.APPROVED, is_active=True, courts__is_active=True).distinct()
    courts = Court.objects.filter(venue__status=Venue.Status.APPROVED, venue__is_active=True, is_active=True)
    slots = CourtSlot.objects.filter(court__in=courts)
    prices = [get_slot_hourly_price(slot) for slot in slots if get_slot_hourly_price(slot) is not None]

    return {
        "districts": [
            {
                "value": district,
                "label": district,
                "count": count_cards(cards, lambda card, item=district: normalize_text(card.get("city")) == normalize_text(item)),
            }
            for district in SPORTSPOT_DISTRICTS
        ],
        "areas_by_district": {
            district: [
                {
                    "value": area,
                    "label": area,
                    "count": count_cards(
                        cards,
                        lambda card, item=area, parent=district: normalize_text(card.get("city")) == normalize_text(parent)
                        and normalize_text(card.get("area")) == normalize_text(item),
                    ),
                }
                for area in areas
            ]
            for district, areas in SPORTSPOT_AREAS_BY_DISTRICT.items()
        },
        "facilities": [
            {
                "value": facility,
                "label": facility,
                "count": count_cards(
                    cards,
                    lambda card, item=facility: normalize_text(item) in {normalize_text(value) for value in card.get("facilities", [])},
                ),
            }
            for facility in SPORTSPOT_FACILITIES
        ],
        "venue_types": [
            {
                "value": value,
                "label": label,
                "count": count_cards(
                    cards,
                    lambda card, item=value: item in [court_type.get("value") for court_type in card.get("court_types", [])],
                ),
            }
            for value, label in Court.CourtType.choices
        ],
        "time_periods": SPORTSPOT_TIME_PERIODS,
        "durations": SPORTSPOT_DURATIONS,
        "price_min": decimal_to_string(min(prices)) if prices else None,
        "price_max": decimal_to_string(max(prices)) if prices else None,
        "supports_rating": False,
        "supports_nearest": False,
        "total_approved_venues": venues.count(),
        "total_active_courts": courts.count(),
    }


def count_cards(cards, predicate):
    return sum(1 for card in cards if predicate(card))


def normalize_text(value):
    return str(value or "").strip().lower()


def normalize_supported_district(value):
    normalized_value = normalize_text(value)
    for district in SPORTSPOT_DISTRICTS:
        if normalize_text(district) == normalized_value:
            return district
    return ""


def normalize_supported_area(district, area):
    supported_district = normalize_supported_district(district)
    if not supported_district:
        return ""
    normalized_area = normalize_text(area)
    for supported_area in SPORTSPOT_AREAS_BY_DISTRICT.get(supported_district, []):
        if normalize_text(supported_area) == normalized_area:
            return supported_area
    return ""


class DiscoveryReferenceDataView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({"filters": build_discovery_filter_options()})

def serialize_discovery_params(params):
    return {
        "search": params["search"],
        "district": params["district"],
        "area": params["area"],
        "date": params["date"].isoformat(),
        "time_window": params["time_window"],
        "start_time": params["start_time"].strftime("%H:%M") if params["start_time"] else "",
        "duration": params["duration"],
        "min_price": decimal_to_string(params["min_price"]),
        "max_price": decimal_to_string(params["max_price"]),
        "venue_types": params["venue_types"],
        "facilities": params["facilities"],
        "sort": params["sort"],
        "page": params["page"],
        "page_size": params["page_size"],
    }


def decimal_to_string(value):
    if value is None:
        return None
    return str(Decimal(value).quantize(Decimal("0.01")))


def format_time_label(value):
    parsed_time = parse_time(value) if isinstance(value, str) else value
    if not parsed_time:
        return ""
    return parsed_time.strftime("%I:%M %p").lstrip("0")

class PublicVenueListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        params, error = parse_discovery_query(request)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)

        release_expired_reservations(
            CourtSlot.objects.filter(
                court__venue__status=Venue.Status.APPROVED,
                court__venue__is_active=True,
                court__is_active=True,
                date=params["date"],
                status=CourtSlot.Status.RESERVED,
            ).select_related("court", "court__venue")
        )

        venues = apply_discovery_base_filters(get_public_venues(params["date"]), params)
        venue_cards = []
        for venue in venues:
            card = build_discovery_venue_card(venue, params, request)
            if should_include_discovery_card(card, params):
                venue_cards.append(card)

        venue_cards = sort_discovery_cards(venue_cards, params["sort"])
        page = params["page"]
        page_size = params["page_size"]
        total_count = len(venue_cards)
        total_pages = max(1, (total_count + page_size - 1) // page_size)
        if page > total_pages:
            page = total_pages
        start_index = (page - 1) * page_size
        paged_cards = venue_cards[start_index:start_index + page_size]

        return Response(
            {
                "venues": paged_cards,
                "count": total_count,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "filters": build_discovery_filter_options(venue_cards, params),
                "applied": serialize_discovery_params(params),
            }
        )


class PublicVenueDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, venue_id):
        venue = get_object_or_404(get_public_venues(), pk=venue_id)
        return Response({"venue": PublicVenueSerializer(venue, context={"request": request}).data})


class PublicCourtDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, court_id):
        court = get_object_or_404(get_public_courts(), pk=court_id)
        return Response({"court": PublicCourtDetailSerializer(court, context={"request": request}).data})


class PublicCourtSlotsView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, court_id):
        court = get_object_or_404(get_public_courts(), pk=court_id)
        slot_date = request.query_params.get("date") or timezone.localdate().isoformat()
        slots = court.slots.filter(date=slot_date)
        release_expired_reservations(slots)
        return Response({"slots": SlotSerializer(court.slots.filter(date=slot_date), many=True, context={"request": request}).data})


class BookingReserveView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    @transaction.atomic
    def post(self, request):
        slot_ids = request.data.get("slot_ids") or []
        if not slot_ids and request.data.get("slot_id"):
            slot_ids = [request.data.get("slot_id")]
        if not isinstance(slot_ids, list):
            return Response({"detail": "Slots must be sent as a list."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            slot_ids = list(dict.fromkeys([int(slot_id) for slot_id in slot_ids]))
        except (TypeError, ValueError):
            return Response({"detail": "Every selected slot must be a valid slot ID."}, status=status.HTTP_400_BAD_REQUEST)
        if not slot_ids:
            return Response({"detail": "Select at least one slot."}, status=status.HTTP_400_BAD_REQUEST)

        slots = list(
            CourtSlot.objects.select_for_update()
            .select_related("court", "court__venue")
            .filter(
                pk__in=slot_ids,
                court__venue__status=Venue.Status.APPROVED,
                court__venue__is_active=True,
                court__is_active=True,
            )
            .order_by("date", "start_time", "end_time")
        )
        if len(slots) != len(slot_ids):
            return Response({"detail": "One or more selected slots are not available."}, status=status.HTTP_400_BAD_REQUEST)

        for slot in slots:
            slot.release_if_expired()
            expire_bookings_for_slot(slot)

        validation_error = validate_multi_slot_selection(slots)
        if validation_error:
            return Response({"detail": validation_error}, status=status.HTTP_400_BAD_REQUEST)

        unavailable_slots = [slot for slot in slots if slot.status != CourtSlot.Status.AVAILABLE]
        if unavailable_slots:
            return Response({"detail": "One or more selected slots are no longer available."}, status=status.HTTP_400_BAD_REQUEST)

        reserved_until = timezone.now() + timedelta(minutes=10)
        slot_ids = [slot.id for slot in slots]
        CourtSlot.objects.filter(id__in=slot_ids).update(status=CourtSlot.Status.RESERVED, reserved_until=reserved_until, updated_at=timezone.now())

        booking = Booking.objects.create(
            player=request.user,
            venue=slots[0].court.venue,
            court=slots[0].court,
            slot=slots[0],
            amount=sum(slot.price for slot in slots),
            status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
            reserved_until=reserved_until,
            cancellation_policy_snapshot=build_cancellation_policy_snapshot(
                slots[0].court.venue
            ),
        )
        BookingSlot.objects.bulk_create([BookingSlot(booking=booking, slot=slot, price=slot.price) for slot in slots])
        notify_owner_booking_reserved(booking, request.user)
        return Response({"booking": BookingSerializer(booking, context={"request": request}).data}, status=status.HTTP_201_CREATED)


class PlayerBookingsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        bookings = Booking.objects.filter(player=request.user).select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot", "venue_messages__sender", "venue__photos")
        for booking in bookings:
            refresh_booking_lifecycle(booking)
        return Response({"bookings": BookingSerializer(bookings, many=True, context={"request": request}).data})


class BookingDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, booking_id):
        booking = get_object_or_404(Booking.objects.select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot", "venue_messages__sender", "venue__photos"), pk=booking_id)
        if request.user.role == "PLAYER" and booking.player_id != request.user.id:
            return Response({"detail": "You can only view your own bookings."}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role == "COURT_OWNER" and booking.venue.owner_id != request.user.id:
            return Response({"detail": "You can only view bookings for your own venue."}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role not in ["PLAYER", "COURT_OWNER", "ADMIN"]:
            return Response({"detail": "You do not have permission to view this booking."}, status=status.HTTP_403_FORBIDDEN)
        refresh_booking_lifecycle(booking)
        return Response({"booking": BookingSerializer(booking, context={"request": request}).data})


class KhaltiPaymentInitiateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, booking_id):
        booking = get_object_or_404(
            Booking.objects.select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot"),
            pk=booking_id,
            player=request.user,
        )
        refresh_booking_lifecycle(booking)

        if booking.status != Booking.BookingStatus.RESERVED or booking.payment_status != Booking.PaymentStatus.PENDING:
            return Response({"detail": "This booking is no longer waiting for payment."}, status=status.HTTP_400_BAD_REQUEST)

        if booking.reserved_until <= timezone.now():
            booking.expire_and_release()
            return Response({"detail": "This reservation has expired. Please choose another slot."}, status=status.HTTP_400_BAD_REQUEST)

        if booking.payment_provider == Booking.PaymentProvider.KHALTI and booking.khalti_pidx and booking.khalti_payment_url:
            return Response(
                {
                    "pidx": booking.khalti_pidx,
                    "payment_url": booking.khalti_payment_url,
                    "booking": BookingSerializer(booking, context={"request": request}).data,
                }
            )

        try:
            khalti_response = initiate_khalti_payment(booking)
        except KhaltiConfigurationError as error:
            return Response({"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except KhaltiAPIError as error:
            return Response({"detail": str(error)}, status=status.HTTP_502_BAD_GATEWAY)

        pidx = khalti_response.get("pidx")
        payment_url = khalti_response.get("payment_url")
        if not pidx or not payment_url:
            return Response({"detail": "Khalti did not return a valid payment URL."}, status=status.HTTP_502_BAD_GATEWAY)

        with transaction.atomic():
            locked_booking = get_object_or_404(
                Booking.objects.select_for_update()
                .select_related("player", "venue", "court", "slot")
                .prefetch_related("slot_items__slot"),
                pk=booking.id,
                player=request.user,
            )
            refresh_booking_lifecycle(locked_booking)
            if locked_booking.status != Booking.BookingStatus.RESERVED or locked_booking.payment_status != Booking.PaymentStatus.PENDING:
                return Response({"detail": "This booking is no longer waiting for payment."}, status=status.HTTP_400_BAD_REQUEST)
            if locked_booking.reserved_until <= timezone.now():
                locked_booking.expire_and_release()
                return Response({"detail": "This reservation has expired. Please choose another slot."}, status=status.HTTP_400_BAD_REQUEST)

            locked_booking.payment_provider = Booking.PaymentProvider.KHALTI
            locked_booking.khalti_pidx = pidx
            locked_booking.khalti_payment_url = payment_url
            locked_booking.khalti_status = str(khalti_response.get("status", "Initiated"))
            locked_booking.khalti_response = khalti_response
            locked_booking.save(
                update_fields=[
                    "payment_provider",
                    "khalti_pidx",
                    "khalti_payment_url",
                    "khalti_status",
                    "khalti_response",
                    "updated_at",
                ]
            )

        return Response(
            {
                "pidx": pidx,
                "payment_url": payment_url,
                "booking": BookingSerializer(locked_booking, context={"request": request}).data,
            }
        )


class KhaltiPaymentVerifyView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, booking_id):
        pidx = str(request.data.get("pidx") or request.query_params.get("pidx") or "").strip()
        booking = get_object_or_404(
            Booking.objects.select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot"),
            pk=booking_id,
            player=request.user,
        )

        if not pidx:
            return Response({"detail": "Khalti payment reference is missing."}, status=status.HTTP_400_BAD_REQUEST)
        if booking.khalti_pidx and pidx != booking.khalti_pidx:
            return Response({"detail": "Khalti payment reference does not match this booking."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            khalti_response = lookup_khalti_payment(pidx)
        except KhaltiConfigurationError as error:
            return Response({"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except KhaltiAPIError as error:
            return Response({"detail": str(error)}, status=status.HTTP_502_BAD_GATEWAY)

        khalti_status = str(khalti_response.get("status", "")).strip()

        with transaction.atomic():
            locked_booking = get_object_or_404(
                Booking.objects.select_for_update()
                .select_related("player", "venue", "court", "slot")
                .prefetch_related("slot_items__slot"),
                pk=booking.id,
                player=request.user,
            )
            slot_ids = get_booking_slot_ids(locked_booking)
            slots = list(CourtSlot.objects.select_for_update().filter(id__in=slot_ids))
            if locked_booking.status == Booking.BookingStatus.RESERVED and locked_booking.reserved_until <= timezone.now():
                locked_booking.status = Booking.BookingStatus.EXPIRED
                locked_booking.payment_status = Booking.PaymentStatus.FAILED
                locked_booking.payment_provider = Booking.PaymentProvider.KHALTI
                locked_booking.khalti_pidx = pidx
                locked_booking.khalti_status = khalti_status or "Expired"
                locked_booking.khalti_response = khalti_response
                locked_booking.refund_status = Booking.RefundStatus.NOT_REQUIRED
                locked_booking.refund_reason = "Payment was not completed before the reservation expired."
                locked_booking.save(
                    update_fields=[
                        "status",
                        "payment_status",
                        "payment_provider",
                        "khalti_pidx",
                        "khalti_status",
                        "khalti_response",
                        "refund_status",
                        "refund_reason",
                        "updated_at",
                    ]
                )
                CourtSlot.objects.filter(id__in=[slot.id for slot in slots if slot.status == CourtSlot.Status.RESERVED]).update(
                    status=CourtSlot.Status.AVAILABLE,
                    reserved_until=None,
                    updated_at=timezone.now(),
                )
                notify_booking_payment_failed(locked_booking, request.user)
                return Response(
                    {
                        "detail": "Payment could not be completed before the reservation expired. No booking has been confirmed.",
                        "booking": BookingSerializer(locked_booking, context={"request": request}).data,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if locked_booking.status == Booking.BookingStatus.CONFIRMED and locked_booking.payment_status == Booking.PaymentStatus.PAID:
                locked_booking.khalti_status = khalti_status or locked_booking.khalti_status
                locked_booking.khalti_response = khalti_response
                locked_booking.save(update_fields=["khalti_status", "khalti_response", "updated_at"])
                return Response({"booking": BookingSerializer(locked_booking, context={"request": request}).data})

            if locked_booking.status != Booking.BookingStatus.RESERVED:
                locked_booking.khalti_status = khalti_status or locked_booking.khalti_status
                locked_booking.khalti_response = khalti_response
                locked_booking.save(update_fields=["khalti_status", "khalti_response", "updated_at"])
                return Response(
                    {
                        "detail": "This booking is no longer reserved for payment.",
                        "booking": BookingSerializer(locked_booking, context={"request": request}).data,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if khalti_status == "Completed":
                paid_amount = khalti_response.get("total_amount") or khalti_response.get("amount")
                if paid_amount is not None and int(paid_amount) != npr_to_paisa(locked_booking.amount):
                    return Response({"detail": "Khalti amount does not match this booking."}, status=status.HTTP_400_BAD_REQUEST)

                locked_booking.status = Booking.BookingStatus.CONFIRMED
                locked_booking.payment_status = Booking.PaymentStatus.PAID
                locked_booking.payment_provider = Booking.PaymentProvider.KHALTI
                locked_booking.khalti_pidx = pidx
                locked_booking.khalti_status = khalti_status
                locked_booking.khalti_transaction_id = str(khalti_response.get("transaction_id") or "")
                locked_booking.khalti_response = khalti_response
                locked_booking.confirmed_at = timezone.now()
                locked_booking.save(
                    update_fields=[
                        "status",
                        "payment_status",
                        "payment_provider",
                        "khalti_pidx",
                        "khalti_status",
                        "khalti_transaction_id",
                        "khalti_response",
                        "confirmed_at",
                        "updated_at",
                    ]
                )
                CourtSlot.objects.filter(id__in=slot_ids).update(status=CourtSlot.Status.BOOKED, reserved_until=None, updated_at=timezone.now())
                notify_booking_confirmed(locked_booking, request.user)
                return Response({"booking": BookingSerializer(locked_booking, context={"request": request}).data})

            if khalti_status in ["Pending", "Initiated"]:
                locked_booking.payment_provider = Booking.PaymentProvider.KHALTI
                locked_booking.khalti_pidx = pidx
                locked_booking.khalti_status = khalti_status
                locked_booking.khalti_response = khalti_response
                locked_booking.save(
                    update_fields=["payment_provider", "khalti_pidx", "khalti_status", "khalti_response", "updated_at"]
                )
                return Response(
                    {
                        "detail": "Khalti payment is still pending. Please refresh after payment is completed.",
                        "booking": BookingSerializer(locked_booking, context={"request": request}).data,
                    },
                    status=status.HTTP_202_ACCEPTED,
                )

            locked_booking.status = Booking.BookingStatus.EXPIRED
            locked_booking.payment_status = Booking.PaymentStatus.FAILED
            locked_booking.payment_provider = Booking.PaymentProvider.KHALTI
            locked_booking.khalti_pidx = pidx
            locked_booking.khalti_status = khalti_status or "Failed"
            locked_booking.khalti_response = khalti_response
            locked_booking.refund_status = Booking.RefundStatus.NOT_REQUIRED
            locked_booking.refund_reason = "Khalti payment was not completed before booking confirmation."
            locked_booking.save(
                update_fields=[
                    "status",
                    "payment_status",
                    "payment_provider",
                    "khalti_pidx",
                    "khalti_status",
                    "khalti_response",
                    "refund_status",
                    "refund_reason",
                    "updated_at",
                ]
            )
            CourtSlot.objects.filter(id__in=[slot.id for slot in slots if slot.status == CourtSlot.Status.RESERVED]).update(
                status=CourtSlot.Status.AVAILABLE,
                reserved_until=None,
                updated_at=timezone.now(),
            )
            notify_booking_payment_failed(locked_booking, request.user)
            return Response({"booking": BookingSerializer(locked_booking, context={"request": request}).data})


class BookingCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request, booking_id):
        booking = get_object_or_404(
            Booking.objects.select_for_update().select_related("player", "venue", "court", "slot").prefetch_related("slot_items__slot"),
            pk=booking_id,
        )
        role = request.user.role

        permission_error = get_booking_cancel_permission_error(booking, request.user)
        if permission_error:
            return Response({"detail": permission_error}, status=status.HTTP_403_FORBIDDEN)

        slot_ids = get_booking_slot_ids(booking)
        slots = list(CourtSlot.objects.select_for_update().filter(id__in=slot_ids).order_by("date", "start_time", "end_time"))
        refresh_booking_lifecycle(booking)

        if booking.status == Booking.BookingStatus.EXPIRED:
            return Response(
                {
                    "detail": "This unpaid reservation has already expired and its slots were released.",
                    "booking": BookingSerializer(booking, context={"request": request}).data,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if booking.status == Booking.BookingStatus.CANCELLED:
            return Response({"detail": "This booking is already cancelled."}, status=status.HTTP_400_BAD_REQUEST)

        if booking.status == Booking.BookingStatus.COMPLETED:
            return Response({"detail": "Completed bookings cannot be cancelled."}, status=status.HTTP_400_BAD_REQUEST)

        if booking.status not in [Booking.BookingStatus.RESERVED, Booking.BookingStatus.CONFIRMED]:
            return Response({"detail": "This booking cannot be cancelled."}, status=status.HTTP_400_BAD_REQUEST)

        start_at = get_booking_start_at_from_slots(slots)
        if role != "ADMIN" and booking.status == Booking.BookingStatus.CONFIRMED and start_at and start_at <= timezone.now():
            return Response({"detail": "Confirmed bookings cannot be cancelled after the slot has started."}, status=status.HTTP_400_BAD_REQUEST)

        reason = str(request.data.get("reason", "")).strip()
        if role in ["COURT_OWNER", "ADMIN"] and not reason:
            return Response({"detail": "Cancellation reason is required."}, status=status.HTTP_400_BAD_REQUEST)

        cancellation_outcome = get_cancellation_outcome(
            booking=booking,
            role=role,
            reason=reason,
            requested_payment_status=request.data.get("payment_status"),
            requested_slot_action=request.data.get("slot_action"),
            start_at=start_at,
        )

        now = timezone.now()
        booking.status = Booking.BookingStatus.CANCELLED
        booking.payment_status = cancellation_outcome["payment_status"]
        booking.refund_status = cancellation_outcome["refund_status"]
        booking.refund_reason = cancellation_outcome["refund_reason"]
        booking.refund_requested_at = now if cancellation_outcome["refund_status"] == Booking.RefundStatus.PENDING_OWNER_ACTION else booking.refund_requested_at
        booking.cancelled_at = now
        booking.cancelled_by = request.user
        booking.cancellation_actor_role = role
        booking.cancellation_reason = reason or get_default_cancellation_reason(role, cancellation_outcome["payment_status"])
        booking.cancellation_slot_action = cancellation_outcome["slot_action"]
        booking.cancellation_tier = cancellation_outcome["cancellation_tier"]
        booking.refund_percentage = cancellation_outcome["refund_percentage"]
        booking.refund_amount = cancellation_outcome["refund_amount"]
        booking.save(
            update_fields=[
                "status",
                "payment_status",
                "refund_status",
                "refund_reason",
                "refund_requested_at",
                "cancelled_at",
                "cancelled_by",
                "cancellation_actor_role",
                "cancellation_reason",
                "cancellation_slot_action",
                "cancellation_tier",
                "refund_percentage",
                "refund_amount",
                "updated_at",
            ]
        )

        CourtSlot.objects.filter(id__in=slot_ids).update(status=cancellation_outcome["slot_status"], reserved_until=None, updated_at=now)

        if booking.refund_status == Booking.RefundStatus.PENDING_OWNER_ACTION:
            notify_owner_refund_requested(booking, request.user)
        notify_booking_cancelled(booking, request.user)
        return Response({"booking": BookingSerializer(booking, context={"request": request}).data})



def empty_owner_summary():
    return {
        "today_bookings": 0,
        "today_expected_revenue": "0.00",
        "courts_in_use": 0,
        "total_active_courts": 0,
        "pending_refund_requests": 0,
    }


def get_owner_lifecycle_state(venue):
    if not venue:
        return "NO_VENUE"
    if venue.status == Venue.Status.SUSPENDED:
        return "SUSPENDED"
    if venue.status == Venue.Status.APPROVED and not venue.is_active:
        return "TEMPORARILY_INACTIVE"
    if venue.status == Venue.Status.APPROVED:
        return "ACTIVE"
    if venue.status == Venue.Status.PENDING:
        return "PENDING_VERIFICATION"
    if venue.status in [Venue.Status.NEEDS_CHANGES, Venue.Status.REJECTED]:
        return "CHANGES_REQUIRED"
    return "SETUP_INCOMPLETE"


def count_today_bookings(bookings, today):
    return sum(
        1
        for booking in bookings
        if booking.slot.date == today
        and booking.status in [
            Booking.BookingStatus.RESERVED,
            Booking.BookingStatus.CONFIRMED,
            Booking.BookingStatus.COMPLETED,
        ]
    )


def build_today_schedule(bookings, today):
    schedule = []
    for booking in bookings:
        if booking.slot.date != today:
            continue
        if booking.status not in [
            Booking.BookingStatus.RESERVED,
            Booking.BookingStatus.CONFIRMED,
            Booking.BookingStatus.COMPLETED,
            Booking.BookingStatus.CANCELLED,
        ]:
            continue
        window = build_booking_window(booking)
        schedule.append(
            {
                "id": booking.id,
                "booking_code": booking.booking_code,
                "player_name": booking.player.full_name,
                "court_name": booking.court.name,
                "start_at": window["start_at"],
                "end_at": window["end_at"],
                "display_time": window["display_time"],
                "duration_minutes": window["duration_minutes"],
                "booking_status": booking.status,
                "payment_status": booking.payment_status,
                "amount": str(booking.amount),
                "action_url": f"/dashboard/owner/bookings?booking={booking.id}",
            }
        )
    return sorted(schedule, key=lambda item: item["start_at"] or "")


def build_next_booking(bookings, now):
    candidates = []
    for booking in bookings:
        if booking.status != Booking.BookingStatus.CONFIRMED:
            continue
        window = build_booking_window(booking)
        start_at = parse_iso_datetime(window["start_at"])
        end_at = parse_iso_datetime(window["end_at"])
        if not start_at or not end_at or end_at <= now:
            continue
        candidates.append(
            {
                "id": booking.id,
                "booking_code": booking.booking_code,
                "player_name": booking.player.full_name,
                "court_name": booking.court.name,
                "start_at": window["start_at"],
                "end_at": window["end_at"],
                "display_time": window["display_time"],
                "payment_status": booking.payment_status,
                "amount": str(booking.amount),
                "action_url": f"/dashboard/owner/bookings?booking={booking.id}",
                "sort_at": start_at,
            }
        )
    candidates.sort(key=lambda item: item["sort_at"])
    if not candidates:
        return None
    next_booking = candidates[0]
    next_booking.pop("sort_at", None)
    return next_booking


def build_court_statuses(courts, bookings, now):
    statuses = []
    for court in courts:
        if not court.is_active:
            statuses.append(
                {
                    "court_id": court.id,
                    "court_name": court.name,
                    "status": "INACTIVE",
                    "status_label": "Inactive",
                    "current_booking_end_at": None,
                    "next_booking_start_at": None,
                    "next_booking_label": "Hidden from players",
                }
            )
            continue

        current_booking = None
        next_booking = None
        for booking in bookings:
            if booking.court_id != court.id or booking.status != Booking.BookingStatus.CONFIRMED:
                continue
            window = build_booking_window(booking)
            start_at = parse_iso_datetime(window["start_at"])
            end_at = parse_iso_datetime(window["end_at"])
            if not start_at or not end_at:
                continue
            if start_at <= now < end_at:
                current_booking = {"booking": booking, "window": window}
                break
            if start_at > now and (not next_booking or start_at < next_booking["start_at"]):
                next_booking = {"start_at": start_at, "window": window}

        if current_booking:
            statuses.append(
                {
                    "court_id": court.id,
                    "court_name": court.name,
                    "status": "OCCUPIED",
                    "status_label": "Occupied",
                    "current_booking_end_at": current_booking["window"]["end_at"],
                    "next_booking_start_at": None,
                    "next_booking_label": f"Until {current_booking['window']['end_time_label']}",
                }
            )
            continue

        blocked_slot = CourtSlot.objects.filter(
            court=court,
            date=timezone.localdate(),
            status=CourtSlot.Status.BLOCKED,
            start_time__lte=timezone.localtime().time(),
            end_time__gt=timezone.localtime().time(),
        ).first()
        if blocked_slot:
            statuses.append(
                {
                    "court_id": court.id,
                    "court_name": court.name,
                    "status": "BLOCKED",
                    "status_label": "Blocked",
                    "current_booking_end_at": None,
                    "next_booking_start_at": None,
                    "next_booking_label": f"Blocked until {format_time_for_owner(blocked_slot.end_time)}",
                }
            )
            continue

        statuses.append(
            {
                "court_id": court.id,
                "court_name": court.name,
                "status": "AVAILABLE",
                "status_label": "Available",
                "current_booking_end_at": None,
                "next_booking_start_at": next_booking["window"]["start_at"] if next_booking else None,
                "next_booking_label": f"Next at {next_booking['window']['start_time_label']}" if next_booking else "No upcoming booking",
            }
        )
    return statuses


def build_owner_pending_actions(venue, courts, pending_refunds_count):
    actions = []
    lifecycle_state = get_owner_lifecycle_state(venue)
    if lifecycle_state == "SETUP_INCOMPLETE":
        actions.append(
            {
                "id": "continue-setup",
                "title": "Finish venue setup",
                "reason": "Complete the remaining venue, court, availability and verification details.",
                "priority": "IMPORTANT",
                "action_label": "Continue Setup",
                "action_url": "/dashboard/owner/venue-setup",
            }
        )
    if lifecycle_state == "PENDING_VERIFICATION":
        actions.append(
            {
                "id": "pending-verification",
                "title": "Verification in progress",
                "reason": "Your venue is under review. Players can book after approval.",
                "priority": "NORMAL",
                "action_label": "View Submission",
                "action_url": "/dashboard/owner/venue",
            }
        )
    if lifecycle_state == "CHANGES_REQUIRED":
        actions.append(
            {
                "id": "review-feedback",
                "title": "Review admin feedback",
                "reason": venue.admin_review_note or "Changes are required before your venue can be approved.",
                "priority": "URGENT",
                "action_label": "Review Feedback",
                "action_url": "/dashboard/owner/venue-setup",
            }
        )
    if lifecycle_state == "SUSPENDED":
        actions.append(
            {
                "id": "venue-suspended",
                "title": "Venue access restricted",
                "reason": "Your venue cannot accept new bookings while suspended.",
                "priority": "URGENT",
                "action_label": "Get Support",
                "action_url": "/support",
            }
        )
    if pending_refunds_count:
        actions.append(
            {
                "id": "pending-refunds",
                "title": "Refund request awaiting action",
                "reason": f"{pending_refunds_count} paid cancellation needs your refund update.",
                "priority": "URGENT",
                "action_label": "Review Refunds",
                "action_url": "/dashboard/owner/refunds",
            }
        )
    courts_without_slots = [court for court in courts if not court.slots.exists()]
    if venue and courts_without_slots:
        actions.append(
            {
                "id": "courts-without-slots",
                "title": "Court availability missing",
                "reason": f"{len(courts_without_slots)} court needs slots and pricing before players can book it.",
                "priority": "IMPORTANT",
                "action_label": "Manage Availability",
                "action_url": "/dashboard/owner/availability",
            }
        )
    if venue and venue.status == Venue.Status.APPROVED and venue.is_active and not CourtSlot.objects.filter(
        court__venue=venue,
        court__is_active=True,
        date__gte=timezone.localdate(),
        status=CourtSlot.Status.AVAILABLE,
    ).exists():
        actions.append(
            {
                "id": "no-future-availability",
                "title": "No bookable slots available",
                "reason": "Add future availability so players can reserve your courts.",
                "priority": "IMPORTANT",
                "action_label": "Add Availability",
                "action_url": "/dashboard/owner/availability",
            }
        )
    priority_order = {"URGENT": 0, "IMPORTANT": 1, "NORMAL": 2}
    return sorted(actions, key=lambda item: priority_order.get(item["priority"], 3))[:5]


def build_owner_recent_activity(user):
    notifications = Notification.objects.filter(
        recipient=user,
        category__in=[Notification.Category.BOOKINGS, Notification.Category.SYSTEM],
    ).order_by("-created_at")[:5]
    return [
        {
            "id": notification.id,
            "title": notification.title,
            "message": notification.message,
            "created_at": notification.created_at.isoformat(),
            "priority": notification.priority,
            "action_url": notification.action_url,
        }
        for notification in notifications
    ]


def build_owner_quick_actions(venue, pending_refunds_count):
    lifecycle_state = get_owner_lifecycle_state(venue)
    if lifecycle_state == "NO_VENUE":
        return [{"label": "Complete Venue Setup", "href": "/dashboard/owner/venue-setup", "tone": "primary"}]
    if lifecycle_state in ["SETUP_INCOMPLETE", "CHANGES_REQUIRED", "PENDING_VERIFICATION"]:
        return [
            {"label": "Continue Setup", "href": "/dashboard/owner/venue-setup", "tone": "primary"},
            {"label": "View Venue Details", "href": "/dashboard/owner/venue", "tone": "secondary"},
            {"label": "Add Court", "href": "/dashboard/owner/courts/create", "tone": "secondary"},
        ]
    if lifecycle_state == "SUSPENDED":
        return [
            {"label": "Get Support", "href": "/support", "tone": "primary"},
            {"label": "View Venue Details", "href": "/dashboard/owner/venue", "tone": "secondary"},
        ]

    actions = [
        {"label": "View Calendar", "href": "/dashboard/owner/calendar", "tone": "primary"},
        {"label": "Block Court Time", "href": "/dashboard/owner/calendar", "tone": "secondary"},
        {"label": "Add Court", "href": "/dashboard/owner/courts/create", "tone": "secondary"},
        {"label": "Manage Availability", "href": "/dashboard/owner/availability", "tone": "secondary"},
    ]
    if pending_refunds_count:
        actions.append({"label": "Review Refund Requests", "href": "/dashboard/owner/refunds", "tone": "warning"})
    return actions


def build_booking_window(booking):
    slots = booking.booked_slots
    start_at = get_booking_start_at(booking)
    end_at = None
    duration_minutes = 0
    if slots:
        end_at = timezone.make_aware(
            datetime.combine(slots[-1].date, slots[-1].end_time),
            timezone.get_current_timezone(),
        )
        duration_minutes = sum(slot.slot_duration_minutes for slot in slots)
    return {
        "start_at": start_at.isoformat() if start_at else None,
        "end_at": end_at.isoformat() if end_at else None,
        "display_time": f"{format_time_for_owner(slots[0].start_time)} - {format_time_for_owner(slots[-1].end_time)}" if slots else "",
        "start_time_label": format_time_for_owner(slots[0].start_time) if slots else "",
        "end_time_label": format_time_for_owner(slots[-1].end_time) if slots else "",
        "duration_minutes": duration_minutes,
    }


def parse_iso_datetime(value):
    if not value:
        return None
    return datetime.fromisoformat(value)


def format_time_for_owner(time_value):
    return time_value.strftime("%I:%M %p").lstrip("0") if hasattr(time_value, "strftime") else ""
def get_owner_venue(user):
    return Venue.objects.filter(owner=user).first()


def get_owner_court(user, court_id):
    return get_object_or_404(Court.objects.select_related("venue"), pk=court_id, venue__owner=user)


def get_public_courts():
    return Court.objects.filter(venue__status=Venue.Status.APPROVED, venue__is_active=True, is_active=True).select_related("venue").prefetch_related("slots")


def get_public_venues(slot_date=None):
    active_courts = Court.objects.filter(is_active=True)
    if slot_date:
        active_courts = active_courts.prefetch_related(
            Prefetch(
                "slots",
                queryset=CourtSlot.objects.filter(date=slot_date).order_by("date", "start_time", "end_time"),
            )
        )
    else:
        active_courts = active_courts.prefetch_related("slots")

    return (
        Venue.objects.filter(status=Venue.Status.APPROVED, is_active=True, courts__is_active=True)
        .select_related("owner")
        .prefetch_related(Prefetch("courts", queryset=active_courts), "photos")
        .distinct()
    )


def validate_multi_slot_selection(slots):
    if not slots:
        return "Select at least one slot."

    if any(is_slot_in_past(slot) for slot in slots):
        return "You cannot book a time slot that has already started or passed."

    court_id = slots[0].court_id
    slot_date = slots[0].date
    for slot in slots:
        if slot.court_id != court_id:
            return "All selected slots must be for the same court."
        if slot.date != slot_date:
            return "All selected slots must be for the same date."

    for previous_slot, next_slot in zip(slots, slots[1:]):
        if previous_slot.end_time != next_slot.start_time:
            return "Selected slots must be consecutive for MVP booking."
    return ""


def is_slot_in_past(slot):
    today = timezone.localdate()
    now_time = timezone.localtime().time()
    return slot.date < today or (slot.date == today and slot.start_time <= now_time)


def get_booking_slot_ids(booking):
    slot_ids = list(booking.slot_items.values_list("slot_id", flat=True))
    return slot_ids or [booking.slot_id]


def get_booking_cancel_permission_error(booking, user):
    if user.role == "PLAYER":
        if booking.player_id != user.id:
            return "You can only cancel your own bookings."
        return ""

    if user.role == "COURT_OWNER":
        if booking.venue.owner_id != user.id:
            return "You can only cancel bookings for your own venue."
        return ""

    if user.role == "ADMIN":
        return ""

    return "You do not have permission to cancel this booking."


def get_booking_start_at_from_slots(slots):
    if not slots:
        return None
    return timezone.make_aware(
        datetime.combine(slots[0].date, slots[0].start_time),
        timezone.get_current_timezone(),
    )


def get_cancellation_outcome(booking, role, reason, requested_payment_status, requested_slot_action, start_at):
    quote = get_cancellation_quote(booking, role, start_at=start_at)
    if role == "PLAYER":
        if booking.status == Booking.BookingStatus.RESERVED:
            return {
                "payment_status": Booking.PaymentStatus.CANCELLED,
                "refund_status": Booking.RefundStatus.NOT_REQUIRED,
                "refund_reason": "No refund needed because payment was still pending.",
                "slot_status": CourtSlot.Status.AVAILABLE,
                "slot_action": "AVAILABLE",
                "late_cancellation": False,
                "cancellation_tier": quote["tier"],
                "refund_percentage": quote["refund_percentage"],
                "refund_amount": quote["refund_amount"],
            }

        if quote["refund_required"]:
            return {
                "payment_status": Booking.PaymentStatus.REFUND_PENDING,
                "refund_status": Booking.RefundStatus.PENDING_OWNER_ACTION,
                "refund_reason": (
                    f"{quote['message']} Refund amount: Rs {quote['refund_amount']}."
                ),
                "slot_status": CourtSlot.Status.AVAILABLE,
                "slot_action": "AVAILABLE",
                "late_cancellation": quote["late_cancellation"],
                "cancellation_tier": quote["tier"],
                "refund_percentage": quote["refund_percentage"],
                "refund_amount": quote["refund_amount"],
            }

        return {
            "payment_status": Booking.PaymentStatus.NO_REFUND,
            "refund_status": Booking.RefundStatus.NOT_ELIGIBLE,
            "refund_reason": quote["message"],
            "slot_status": CourtSlot.Status.AVAILABLE,
            "slot_action": "AVAILABLE",
            "late_cancellation": quote["late_cancellation"],
            "cancellation_tier": quote["tier"],
            "refund_percentage": quote["refund_percentage"],
            "refund_amount": quote["refund_amount"],
        }

    if role == "COURT_OWNER":
        slot_action = resolve_slot_action(reason, requested_slot_action)
        slot_status = CourtSlot.Status.BLOCKED if slot_action == "BLOCK" else CourtSlot.Status.AVAILABLE
        if booking.status == Booking.BookingStatus.RESERVED:
            return {
                "payment_status": Booking.PaymentStatus.CANCELLED,
                "refund_status": Booking.RefundStatus.NOT_REQUIRED,
                "refund_reason": "No refund needed because payment was still pending.",
                "slot_status": slot_status,
                "slot_action": slot_action,
                "late_cancellation": False,
                "cancellation_tier": quote["tier"],
                "refund_percentage": quote["refund_percentage"],
                "refund_amount": quote["refund_amount"],
            }
        return {
            "payment_status": Booking.PaymentStatus.REFUND_PENDING,
            "refund_status": Booking.RefundStatus.PENDING_OWNER_ACTION,
            "refund_reason": (
                f"Court owner cancelled confirmed booking. A 100% refund of "
                f"Rs {quote['refund_amount']} is required. Reason: {reason}"
            ),
            "slot_status": slot_status,
            "slot_action": slot_action,
            "late_cancellation": False,
            "cancellation_tier": quote["tier"],
            "refund_percentage": quote["refund_percentage"],
            "refund_amount": quote["refund_amount"],
        }

    slot_action = resolve_slot_action(reason, requested_slot_action)
    slot_status = CourtSlot.Status.BLOCKED if slot_action == "BLOCK" else CourtSlot.Status.AVAILABLE
    payment_status, refund_status, refund_reason = normalize_admin_cancellation_refund(requested_payment_status, booking.payment_status)
    refund_percentage = 100 if payment_status in [
        Booking.PaymentStatus.REFUNDED,
        Booking.PaymentStatus.REFUND_PENDING,
    ] else 0
    return {
        "payment_status": payment_status,
        "refund_status": refund_status,
        "refund_reason": refund_reason,
        "slot_status": slot_status,
        "slot_action": slot_action,
        "late_cancellation": False,
        "cancellation_tier": Booking.CancellationTier.ADMIN_DECISION,
        "refund_percentage": refund_percentage,
        "refund_amount": booking.amount if refund_percentage else 0,
    }


def resolve_slot_action(reason, requested_slot_action):
    normalized_action = str(requested_slot_action or "").upper()
    if normalized_action in ["BLOCK", "AVAILABLE"]:
        return normalized_action

    normalized_reason = reason.lower()
    if "maintenance" in normalized_reason or "closure" in normalized_reason or "closed" in normalized_reason:
        return "BLOCK"
    return "AVAILABLE"


def normalize_admin_cancellation_refund(requested_payment_status, current_payment_status):
    normalized_status = str(requested_payment_status or "").upper()
    if normalized_status == Booking.PaymentStatus.REFUNDED:
        return Booking.PaymentStatus.REFUNDED, Booking.RefundStatus.REFUNDED, "Admin cancelled and marked the refund as completed."
    if normalized_status == Booking.PaymentStatus.NO_REFUND:
        return Booking.PaymentStatus.NO_REFUND, Booking.RefundStatus.REJECTED, "Admin cancelled and rejected the refund."
    if normalized_status == Booking.PaymentStatus.REFUND_PENDING:
        return Booking.PaymentStatus.REFUND_PENDING, Booking.RefundStatus.PENDING_OWNER_ACTION, "Admin cancelled and sent the paid booking refund to the court owner for processing."
    if normalized_status == Booking.PaymentStatus.FAILED:
        return Booking.PaymentStatus.FAILED, Booking.RefundStatus.NOT_REQUIRED, "No refund needed."
    if current_payment_status == Booking.PaymentStatus.PAID:
        return Booking.PaymentStatus.REFUND_PENDING, Booking.RefundStatus.PENDING_OWNER_ACTION, "Admin cancelled paid booking. Court owner must process the refund."
    return Booking.PaymentStatus.CANCELLED, Booking.RefundStatus.NOT_REQUIRED, "No refund needed because payment was not completed."


def get_default_cancellation_reason(role, payment_status):
    if role == "PLAYER" and payment_status == Booking.PaymentStatus.NO_REFUND:
        return "Player cancelled inside the policy's no-refund window."
    if role == "PLAYER":
        return "Player cancelled the booking."
    if role == "COURT_OWNER":
        return "Court owner cancelled the booking."
    return "Admin cancelled the booking."




def can_permanently_delete_court(court):
    if court.bookings.exists():
        return (
            False,
            "This court has booking history, so it cannot be permanently deleted. You can deactivate it instead. Deactivated courts are hidden from players, but existing booking history stays saved.",
        )
    return True, ""


def can_permanently_delete_venue(venue):
    if venue.bookings.exists():
        return (
            False,
            "This venue has booking history, so it cannot be permanently deleted. You can deactivate it instead. Deactivated venues are hidden from players, but existing courts, bookings, payments, and passes stay saved.",
        )
    if venue.status not in [Venue.Status.DRAFT, Venue.Status.PENDING]:
        return (
            False,
            "Only draft or pending venues without booking history can be permanently deleted. You can deactivate this venue instead.",
        )
    return True, ""


def normalize_request_data(data):
    normalized = {key: data.get(key) for key in data.keys()}
    facilities = normalized.get("facilities")
    if isinstance(facilities, str):
        try:
            normalized["facilities"] = json.loads(facilities)
        except json.JSONDecodeError:
            normalized["facilities"] = []
    if normalized.get("declaration_accepted") in ["true", "True", "1", "on"]:
        normalized["declaration_accepted"] = True
    if normalized.get("declaration_accepted") in ["false", "False", "0", "off", ""]:
        normalized["declaration_accepted"] = False
    return normalized


def parse_date_value(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        return None


def slot_start_end_at(slot):
    current_timezone = timezone.get_current_timezone()
    start_at = timezone.make_aware(datetime.combine(slot.date, slot.start_time), current_timezone)
    end_at = timezone.make_aware(datetime.combine(slot.date, slot.end_time), current_timezone)
    return start_at, end_at


def slot_overlaps_period(slot, start_at, end_at):
    slot_start_at, slot_end_at = slot_start_end_at(slot)
    return slot_start_at < end_at and slot_end_at > start_at


def empty_calendar_stats():
    return {
        "bookings_count": 0,
        "confirmed_bookings": 0,
        "reserved_holds": 0,
        "blocked_slots": 0,
        "available_slots": 0,
    }


def build_calendar_stats(slots, bookings):
    return {
        "bookings_count": len(bookings),
        "confirmed_bookings": len([booking for booking in bookings if booking.status in [Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED]]),
        "reserved_holds": len([booking for booking in bookings if booking.status == Booking.BookingStatus.RESERVED]),
        "blocked_slots": len([slot for slot in slots if slot.status == CourtSlot.Status.BLOCKED]),
        "available_slots": len([slot for slot in slots if slot.status == CourtSlot.Status.AVAILABLE]),
    }


def get_calendar_opening_time(venue, slots):
    if venue.opening_time:
        return venue.opening_time.strftime("%H:%M")
    if slots:
        return min(slot.start_time for slot in slots).strftime("%H:%M")
    return None


def get_calendar_closing_time(venue, slots):
    if venue.closing_time:
        return venue.closing_time.strftime("%H:%M")
    if slots:
        return max(slot.end_time for slot in slots).strftime("%H:%M")
    return None


def build_slot_conflict(slot):
    return {
        "slot_id": slot.id,
        "court_name": slot.court.name,
        "date": slot.date.isoformat(),
        "display_time": slot.display_time,
        "status": slot.status,
        "booking": get_slot_active_booking_summary(slot),
    }


def get_slot_active_booking_summary(slot):
    booking_statuses = [
        Booking.BookingStatus.RESERVED,
        Booking.BookingStatus.CONFIRMED,
        Booking.BookingStatus.COMPLETED,
    ]
    booking_item = (
        slot.booking_items.select_related("booking", "booking__player")
        .filter(booking__status__in=booking_statuses)
        .order_by("-booking__created_at")
        .first()
    )
    booking = booking_item.booking if booking_item else (
        slot.bookings.select_related("player")
        .filter(status__in=booking_statuses)
        .order_by("-created_at")
        .first()
    )
    if not booking:
        return None
    return {
        "id": booking.id,
        "booking_code": booking.booking_code,
        "player_name": booking.player.full_name,
        "status": booking.status,
        "payment_status": booking.payment_status,
    }

def parse_time(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%H:%M").time()
    except ValueError:
        try:
            return datetime.strptime(str(value), "%H:%M:%S").time()
        except ValueError:
            return None


def day_name_to_number(day):
    day_numbers = {
        "MONDAY": 0,
        "TUESDAY": 1,
        "WEDNESDAY": 2,
        "THURSDAY": 3,
        "FRIDAY": 4,
        "SATURDAY": 5,
        "SUNDAY": 6,
    }
    return day_numbers.get(str(day).upper(), -1)


def release_expired_reservations(slots):
    for slot in slots:
        slot.release_if_expired()
        expire_bookings_for_slot(slot)


def expire_bookings_for_slot(slot):
    for booking in slot.bookings.filter(status=Booking.BookingStatus.RESERVED, reserved_until__lte=timezone.now()):
        refresh_booking_lifecycle(booking)
    for booking in Booking.objects.filter(slot_items__slot=slot, status=Booking.BookingStatus.RESERVED, reserved_until__lte=timezone.now()).distinct():
        refresh_booking_lifecycle(booking)


def refresh_booking_lifecycle(booking):
    if booking.status == Booking.BookingStatus.RESERVED:
        booking.expire_and_release()
    elif booking.status == Booking.BookingStatus.CONFIRMED:
        booking.complete_if_finished()


def has_critical_venue_changes(venue, data):
    critical_fields = ["name", "address", "city", "area", "map_location", "verification_document_type"]
    for field in critical_fields:
        if field in data and normalize_compare_value(getattr(venue, field)) != normalize_compare_value(data.get(field)):
            return True
    return bool(data.get("verification_document"))


def normalize_compare_value(value):
    if value is None:
        return ""
    return str(value).strip()


def parse_bool(value):
    return value in [True, "true", "True", "1", "on", "yes", "YES"]
