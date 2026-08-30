from django.contrib import admin

from .models import Booking, BookingCheckIn, BookingMessage, BookingSlot, Court, CourtSlot, Venue, VenuePhoto


class CourtInline(admin.TabularInline):
    model = Court
    extra = 0


@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "owner",
        "city",
        "area",
        "status",
        "cancellation_policy_version",
        "is_active",
        "submitted_at",
        "approved_at",
    )
    list_filter = ("status", "city", "is_active")
    search_fields = ("name", "owner__full_name", "owner__email", "city", "area")
    inlines = [CourtInline]


@admin.register(Court)
class CourtAdmin(admin.ModelAdmin):
    list_display = ("name", "venue", "court_type", "surface_type", "is_active")
    list_filter = ("court_type", "surface_type", "is_active")
    search_fields = ("name", "venue__name")


@admin.register(CourtSlot)
class CourtSlotAdmin(admin.ModelAdmin):
    list_display = ("court", "date", "start_time", "end_time", "price", "status")
    list_filter = ("status", "date")
    search_fields = ("court__name", "court__venue__name")


@admin.register(VenuePhoto)
class VenuePhotoAdmin(admin.ModelAdmin):
    list_display = ("venue", "category", "uploaded_at")
    list_filter = ("category", "uploaded_at")
    search_fields = ("venue__name", "venue__owner__email")


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = (
        "booking_code",
        "player",
        "court",
        "amount",
        "status",
        "payment_status",
        "refund_status",
        "cancellation_tier",
        "refund_percentage",
        "refund_amount",
        "cancelled_at",
        "created_at",
    )
    list_filter = (
        "status",
        "payment_status",
        "refund_status",
        "cancellation_tier",
        "cancellation_actor_role",
        "created_at",
    )
    search_fields = ("booking_code", "player__full_name", "court__name", "venue__name")


@admin.register(BookingCheckIn)
class BookingCheckInAdmin(admin.ModelAdmin):
    list_display = ("booking", "status", "checked_in_at", "checked_in_by", "scan_count", "last_scanned_at")
    list_filter = ("status", "checked_in_at")
    search_fields = ("booking__booking_code", "booking__venue__name", "booking__player__full_name")


@admin.register(BookingSlot)
class BookingSlotAdmin(admin.ModelAdmin):
    list_display = ("booking", "slot", "price", "created_at")
    search_fields = ("booking__booking_code", "slot__court__name", "slot__court__venue__name")


@admin.register(BookingMessage)
class BookingMessageAdmin(admin.ModelAdmin):
    list_display = ("booking", "message_type", "sender", "created_at")
    list_filter = ("message_type", "created_at")
    search_fields = ("booking__booking_code", "booking__venue__name", "message", "sender__full_name")
