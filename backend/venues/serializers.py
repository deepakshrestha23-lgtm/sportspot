from rest_framework import serializers
from django.utils import timezone

from .models import Booking, BookingMessage, Court, CourtSlot, Venue, VenuePhoto
from .policies import (
    build_cancellation_policy_snapshot,
    get_cancellation_quote as calculate_cancellation_quote,
    get_booking_start_at,
    get_policy_summary,
    normalize_cancellation_policy_snapshot,
)


class VenuePhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenuePhoto
        fields = ("id", "venue", "category", "image", "uploaded_at")
        read_only_fields = ("id", "venue", "uploaded_at")

    def validate_image(self, value):
        return validate_upload(value, {"image/jpeg", "image/png"}, "Venue photo must be a JPG, JPEG, or PNG image.")


class CourtSerializer(serializers.ModelSerializer):
    venue_name = serializers.CharField(source="venue.name", read_only=True)
    venue_area = serializers.CharField(source="venue.area", read_only=True)
    venue_city = serializers.CharField(source="venue.city", read_only=True)
    venue_facilities = serializers.JSONField(source="venue.facilities", read_only=True)
    lowest_price = serializers.SerializerMethodField()
    bookings_count = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    delete_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = Court
        fields = (
            "id",
            "venue",
            "venue_name",
            "venue_area",
            "venue_city",
            "venue_facilities",
            "name",
            "description",
            "court_type",
            "surface_type",
            "court_photo",
            "is_active",
            "lowest_price",
            "bookings_count",
            "can_delete",
            "delete_block_reason",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "venue",
            "venue_name",
            "venue_area",
            "venue_city",
            "venue_facilities",
            "lowest_price",
            "bookings_count",
            "can_delete",
            "delete_block_reason",
            "created_at",
            "updated_at",
        )

    def get_lowest_price(self, court):
        slot = court.slots.order_by("price").first()
        return str(slot.price) if slot else None

    def get_bookings_count(self, court):
        return court.bookings.count()

    def get_can_delete(self, court):
        return not court.bookings.exists()

    def get_delete_block_reason(self, court):
        if court.bookings.exists():
            return "This court has booking history, so it cannot be permanently deleted. Deactivate it instead to hide it from players while keeping booking records safe."
        return ""

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError("Court name must be at least 3 characters.")
        return value

    def validate_court_photo(self, value):
        return validate_upload(value, {"image/jpeg", "image/png"}, "Court photo must be a JPG, JPEG, or PNG image.")


class SlotSerializer(serializers.ModelSerializer):
    court_name = serializers.CharField(source="court.name", read_only=True)
    venue_name = serializers.CharField(source="court.venue.name", read_only=True)
    display_time = serializers.CharField(read_only=True)
    is_past = serializers.SerializerMethodField()
    active_booking = serializers.SerializerMethodField()

    class Meta:
        model = CourtSlot
        fields = (
            "id",
            "court",
            "court_name",
            "venue_name",
            "date",
            "start_time",
            "end_time",
            "display_time",
            "slot_duration_minutes",
            "price",
            "status",
            "is_past",
            "active_booking",
            "reserved_until",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "court_name", "venue_name", "display_time", "is_past", "active_booking", "reserved_until", "created_at", "updated_at")

    def get_is_past(self, slot):
        today = timezone.localdate()
        now_time = timezone.localtime().time()
        return slot.date < today or (slot.date == today and slot.start_time <= now_time)

    def get_active_booking(self, slot):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if user.role != "ADMIN" and slot.court.venue.owner_id != user.id:
            return None

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


class VenueSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source="owner.full_name", read_only=True)
    courts = CourtSerializer(many=True, read_only=True)
    photos = VenuePhotoSerializer(many=True, read_only=True)
    setup_is_complete = serializers.BooleanField(read_only=True)
    minimum_price = serializers.SerializerMethodField()
    bookings_count = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    delete_block_reason = serializers.SerializerMethodField()
    cancellation_policy_details = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = (
            "id",
            "owner",
            "owner_name",
            "name",
            "description",
            "address",
            "city",
            "area",
            "map_location",
            "contact_phone",
            "opening_time",
            "closing_time",
            "facilities",
            "rules",
            "cancellation_policy",
            "cancellation_full_refund_hours",
            "cancellation_partial_refund_enabled",
            "cancellation_partial_refund_hours",
            "cancellation_partial_refund_percent",
            "cancellation_policy_version",
            "cancellation_policy_details",
            "is_active",
            "status",
            "front_photo",
            "court_area_photo",
            "additional_photo",
            "verification_document",
            "verification_document_type",
            "declaration_accepted",
            "admin_review_note",
            "submitted_at",
            "reviewed_at",
            "approved_at",
            "reviewed_by",
            "setup_is_complete",
            "minimum_price",
            "bookings_count",
            "can_delete",
            "delete_block_reason",
            "courts",
            "photos",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "owner",
            "owner_name",
            "status",
            "admin_review_note",
            "submitted_at",
            "reviewed_at",
            "approved_at",
            "reviewed_by",
            "setup_is_complete",
            "minimum_price",
            "bookings_count",
            "can_delete",
            "delete_block_reason",
            "cancellation_policy_version",
            "cancellation_policy_details",
            "courts",
            "photos",
            "created_at",
            "updated_at",
        )

    def get_minimum_price(self, venue):
        return str(venue.minimum_price) if venue.minimum_price is not None else None

    def get_bookings_count(self, venue):
        return venue.bookings.count()

    def get_can_delete(self, venue):
        return venue.status in [Venue.Status.DRAFT, Venue.Status.PENDING] and not venue.bookings.exists()

    def get_delete_block_reason(self, venue):
        if venue.bookings.exists():
            return "This venue has booking history, so it cannot be permanently deleted. Deactivate it instead to hide it from players while keeping courts, bookings, payments, and passes safe."
        if venue.status not in [Venue.Status.DRAFT, Venue.Status.PENDING]:
            return "Only draft or pending venues without booking history can be permanently deleted. Deactivate this venue instead."
        return ""

    def get_cancellation_policy_details(self, venue):
        snapshot = build_cancellation_policy_snapshot(venue)
        return {
            **snapshot,
            "summary": get_policy_summary(snapshot),
        }

    def validate_facilities(self, value):
        if value in ("", None):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Facilities must be a list.")
        return value

    def validate_front_photo(self, value):
        return validate_upload(value, {"image/jpeg", "image/png"}, "Front venue photo must be a JPG, JPEG, or PNG image.")

    def validate_court_area_photo(self, value):
        return validate_upload(value, {"image/jpeg", "image/png"}, "Court area photo must be a JPG, JPEG, or PNG image.")

    def validate_additional_photo(self, value):
        return validate_upload(value, {"image/jpeg", "image/png"}, "Additional photo must be a JPG, JPEG, or PNG image.")

    def validate_verification_document(self, value):
        return validate_upload(
            value,
            {"image/jpeg", "image/png", "application/pdf"},
            "Verification document must be JPG, JPEG, PNG, or PDF.",
            max_size_mb=5,
        )

    def validate_verification_document_type(self, value):
        return value.strip() if isinstance(value, str) else value

    def validate(self, attrs):
        opening_time = attrs.get("opening_time", getattr(self.instance, "opening_time", None))
        closing_time = attrs.get("closing_time", getattr(self.instance, "closing_time", None))
        if opening_time and closing_time and opening_time >= closing_time:
            raise serializers.ValidationError({"closing_time": "Closing time must be after opening time."})
        full_hours = attrs.get(
            "cancellation_full_refund_hours",
            getattr(self.instance, "cancellation_full_refund_hours", 24),
        )
        partial_enabled = attrs.get(
            "cancellation_partial_refund_enabled",
            getattr(self.instance, "cancellation_partial_refund_enabled", True),
        )
        partial_hours = attrs.get(
            "cancellation_partial_refund_hours",
            getattr(self.instance, "cancellation_partial_refund_hours", 12),
        )
        if partial_enabled and partial_hours >= full_hours:
            raise serializers.ValidationError(
                {
                    "cancellation_partial_refund_hours": (
                        "Partial-refund cutoff must be earlier than the full-refund cutoff."
                    )
                }
            )
        return attrs

    def update(self, instance, validated_data):
        policy_fields = [
            "cancellation_policy",
            "cancellation_full_refund_hours",
            "cancellation_partial_refund_enabled",
            "cancellation_partial_refund_hours",
            "cancellation_partial_refund_percent",
        ]
        if any(
            field in validated_data and validated_data[field] != getattr(instance, field)
            for field in policy_fields
        ):
            validated_data["cancellation_policy_version"] = instance.cancellation_policy_version + 1
        return super().update(instance, validated_data)


class PublicCourtDetailSerializer(CourtSerializer):
    venue = VenueSerializer(read_only=True)

    class Meta(CourtSerializer.Meta):
        fields = CourtSerializer.Meta.fields + ("venue",)


class PublicVenueSerializer(serializers.ModelSerializer):
    courts = serializers.SerializerMethodField()
    photos = VenuePhotoSerializer(many=True, read_only=True)
    court_count = serializers.SerializerMethodField()
    minimum_price = serializers.SerializerMethodField()
    cancellation_policy_details = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = (
            "id",
            "name",
            "description",
            "address",
            "city",
            "area",
            "map_location",
            "contact_phone",
            "opening_time",
            "closing_time",
            "facilities",
            "rules",
            "cancellation_policy",
            "cancellation_full_refund_hours",
            "cancellation_partial_refund_enabled",
            "cancellation_partial_refund_hours",
            "cancellation_partial_refund_percent",
            "cancellation_policy_version",
            "cancellation_policy_details",
            "is_active",
            "status",
            "front_photo",
            "court_area_photo",
            "additional_photo",
            "minimum_price",
            "court_count",
            "courts",
            "photos",
        )
        read_only_fields = fields

    def get_courts(self, venue):
        courts = venue.courts.filter(is_active=True)
        return CourtSerializer(courts, many=True, context=self.context).data

    def get_cancellation_policy_details(self, venue):
        snapshot = build_cancellation_policy_snapshot(venue)
        return {
            **snapshot,
            "summary": get_policy_summary(snapshot),
        }

    def get_court_count(self, venue):
        return venue.courts.filter(is_active=True).count()

    def get_minimum_price(self, venue):
        slot = CourtSlot.objects.filter(court__venue=venue, court__is_active=True).order_by("price").first()
        return str(slot.price) if slot else None


class BookingMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)
    message_type_display = serializers.CharField(source="get_message_type_display", read_only=True)

    class Meta:
        model = BookingMessage
        fields = (
            "id",
            "booking",
            "sender",
            "sender_name",
            "message_type",
            "message_type_display",
            "message",
            "created_at",
        )
        read_only_fields = ("id", "booking", "sender", "sender_name", "message_type_display", "created_at")

    def validate_message(self, value):
        value = value.strip()
        if len(value) < 5:
            raise serializers.ValidationError("Message must be at least 5 characters.")
        return value


class BookingSerializer(serializers.ModelSerializer):
    player_name = serializers.CharField(source="player.full_name", read_only=True)
    court_name = serializers.CharField(source="court.name", read_only=True)
    venue_name = serializers.CharField(source="venue.name", read_only=True)
    venue_address = serializers.CharField(source="venue.address", read_only=True)
    venue_area = serializers.CharField(source="venue.area", read_only=True)
    venue_city = serializers.CharField(source="venue.city", read_only=True)
    venue_cancellation_policy = serializers.SerializerMethodField()
    cancelled_by_name = serializers.CharField(source="cancelled_by.full_name", read_only=True)
    refund_reviewed_by_name = serializers.CharField(source="refund_reviewed_by.full_name", read_only=True)
    slot_date = serializers.DateField(source="slot.date", read_only=True)
    slot_start_time = serializers.TimeField(source="slot.start_time", read_only=True)
    slot_end_time = serializers.TimeField(source="slot.end_time", read_only=True)
    slot_display_time = serializers.CharField(source="slot.display_time", read_only=True)
    slots = serializers.SerializerMethodField()
    slot_ids = serializers.SerializerMethodField()
    booking_start_time = serializers.SerializerMethodField()
    booking_end_time = serializers.SerializerMethodField()
    booking_display_time = serializers.SerializerMethodField()
    slots_count = serializers.SerializerMethodField()
    total_duration_minutes = serializers.SerializerMethodField()
    slot_start_at = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    cancellation_refund_preview = serializers.SerializerMethodField()
    cancellation_quote = serializers.SerializerMethodField()
    cancellation_policy_details = serializers.SerializerMethodField()
    venue_messages = BookingMessageSerializer(many=True, read_only=True)

    class Meta:
        model = Booking
        fields = (
            "id",
            "booking_code",
            "player",
            "player_name",
            "venue",
            "venue_name",
            "venue_address",
            "venue_area",
            "venue_city",
            "venue_cancellation_policy",
            "court",
            "court_name",
            "slot",
            "slot_date",
            "slot_start_time",
            "slot_end_time",
            "slot_display_time",
            "slots",
            "slot_ids",
            "booking_start_time",
            "booking_end_time",
            "booking_display_time",
            "slots_count",
            "total_duration_minutes",
            "slot_start_at",
            "can_cancel",
            "cancellation_refund_preview",
            "cancellation_quote",
            "cancellation_policy_details",
            "amount",
            "status",
            "payment_status",
            "payment_provider",
            "khalti_pidx",
            "khalti_payment_url",
            "khalti_transaction_id",
            "khalti_status",
            "refund_status",
            "refund_reason",
            "refund_owner_note",
            "refund_requested_at",
            "refund_reviewed_at",
            "refund_reviewed_by",
            "refund_reviewed_by_name",
            "reserved_until",
            "confirmed_at",
            "completed_at",
            "cancelled_at",
            "cancelled_by",
            "cancelled_by_name",
            "cancellation_actor_role",
            "cancellation_reason",
            "cancellation_slot_action",
            "cancellation_policy_snapshot",
            "cancellation_tier",
            "refund_percentage",
            "refund_amount",
            "venue_messages",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_slots(self, booking):
        return BookingSlotSerializer(get_booking_slots(booking), many=True).data

    def get_slot_ids(self, booking):
        return [slot.id for slot in get_booking_slots(booking)]

    def get_booking_start_time(self, booking):
        slots = get_booking_slots(booking)
        return slots[0].start_time if slots else None

    def get_booking_end_time(self, booking):
        slots = get_booking_slots(booking)
        return slots[-1].end_time if slots else None

    def get_booking_display_time(self, booking):
        slots = get_booking_slots(booking)
        if not slots:
            return ""
        return f"{slots[0].start_time.strftime('%I:%M %p')} - {slots[-1].end_time.strftime('%I:%M %p')}"

    def get_slots_count(self, booking):
        return len(get_booking_slots(booking))

    def get_total_duration_minutes(self, booking):
        return sum(slot.slot_duration_minutes for slot in get_booking_slots(booking))

    def get_slot_start_at(self, booking):
        start_at = get_booking_start_at(booking)
        return start_at.isoformat() if start_at else None

    def get_can_cancel(self, booking):
        request = self.context.get("request")
        role = getattr(getattr(request, "user", None), "role", "")
        return calculate_cancellation_quote(booking, role)["can_cancel"]

    def get_cancellation_refund_preview(self, booking):
        request = self.context.get("request")
        role = getattr(getattr(request, "user", None), "role", "")
        return calculate_cancellation_quote(booking, role)["message"]

    def get_cancellation_quote(self, booking):
        request = self.context.get("request")
        role = getattr(getattr(request, "user", None), "role", "")
        quote = calculate_cancellation_quote(booking, role)
        return {
            **quote,
            "refund_amount": str(quote["refund_amount"]),
        }

    def get_cancellation_policy_details(self, booking):
        snapshot = normalize_cancellation_policy_snapshot(booking)
        return {
            **snapshot,
            "summary": get_policy_summary(snapshot),
        }

    def get_venue_cancellation_policy(self, booking):
        snapshot = normalize_cancellation_policy_snapshot(booking)
        details = get_policy_summary(snapshot)
        if snapshot["additional_notes"]:
            details.append(snapshot["additional_notes"])
        return "\n".join(details)


class BookingSlotSerializer(serializers.ModelSerializer):
    display_time = serializers.CharField(read_only=True)

    class Meta:
        model = CourtSlot
        fields = ("id", "date", "start_time", "end_time", "display_time", "slot_duration_minutes", "price")


def get_booking_slots(booking):
    slots = [item.slot for item in booking.slot_items.select_related("slot").order_by("slot__date", "slot__start_time", "slot__end_time")]
    return slots or [booking.slot]


def can_booking_be_cancelled(booking, role=""):
    return calculate_cancellation_quote(booking, role)["can_cancel"]


def get_cancellation_refund_preview(booking):
    return calculate_cancellation_quote(booking, "PLAYER")["message"]


class AdminVenueSerializer(VenueSerializer):
    courts = CourtSerializer(many=True, read_only=True)


def validate_upload(value, allowed_content_types, message, max_size_mb=3):
    if not value:
        return value

    content_type = getattr(value, "content_type", "")
    if content_type and content_type not in allowed_content_types:
        raise serializers.ValidationError(message)

    if getattr(value, "size", 0) > max_size_mb * 1024 * 1024:
        raise serializers.ValidationError(f"File must be {max_size_mb}MB or smaller.")

    return value
