from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


def booking_code_default():
    return f"SSB-{timezone.now().strftime('%Y%m%d')}-{timezone.now().strftime('%H%M%S%f')[-8:]}"


class Venue(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending"
        NEEDS_CHANGES = "NEEDS_CHANGES", "Needs Changes"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        SUSPENDED = "SUSPENDED", "Suspended"

    class VerificationDocumentType(models.TextChoices):
        BUSINESS_REGISTRATION = "BUSINESS_REGISTRATION", "Business Registration Document"
        PAN_VAT = "PAN_VAT", "PAN/VAT Document"
        RENTAL_LEASE = "RENTAL_LEASE", "Rental/Lease Agreement"
        UTILITY_BILL = "UTILITY_BILL", "Utility Bill"
        PERMISSION_LETTER = "PERMISSION_LETTER", "Permission Letter"

    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="venue")
    name = models.CharField(max_length=150, blank=True)
    description = models.TextField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=80, blank=True)
    area = models.CharField(max_length=100, blank=True)
    map_location = models.URLField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    opening_time = models.TimeField(blank=True, null=True)
    closing_time = models.TimeField(blank=True, null=True)
    facilities = models.JSONField(default=list, blank=True)
    rules = models.TextField(blank=True)
    cancellation_policy = models.TextField(blank=True, max_length=500)
    cancellation_full_refund_hours = models.PositiveSmallIntegerField(
        default=24,
        validators=[MinValueValidator(2), MaxValueValidator(168)],
    )
    cancellation_partial_refund_enabled = models.BooleanField(default=True)
    cancellation_partial_refund_hours = models.PositiveSmallIntegerField(
        default=12,
        validators=[MinValueValidator(1), MaxValueValidator(167)],
    )
    cancellation_partial_refund_percent = models.PositiveSmallIntegerField(
        default=50,
        validators=[MinValueValidator(1), MaxValueValidator(99)],
    )
    cancellation_policy_version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    front_photo = models.FileField(
        upload_to="venues/photos/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    court_area_photo = models.FileField(
        upload_to="venues/photos/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    additional_photo = models.FileField(
        upload_to="venues/photos/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    verification_document = models.FileField(
        upload_to="venues/documents/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png", "pdf"])],
    )
    verification_document_type = models.CharField(
        max_length=30,
        choices=VerificationDocumentType.choices,
        blank=True,
    )
    declaration_accepted = models.BooleanField(default=False)
    admin_review_note = models.TextField(blank=True)
    submitted_at = models.DateTimeField(blank=True, null=True)
    reviewed_at = models.DateTimeField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_venues",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def clean(self):
        if self.owner_id and self.owner.role != "COURT_OWNER":
            raise ValidationError("Only court owner accounts can own venues.")
        if self.opening_time and self.closing_time and self.opening_time >= self.closing_time:
            raise ValidationError("Opening time must be before closing time.")
        if (
            self.cancellation_partial_refund_enabled
            and self.cancellation_partial_refund_hours >= self.cancellation_full_refund_hours
        ):
            raise ValidationError("Partial-refund cutoff must be earlier than the full-refund cutoff.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    @property
    def setup_is_complete(self):
        has_details = all(
            [
                self.name,
                self.address,
                self.city,
                self.area,
                self.contact_phone,
                self.opening_time,
                self.closing_time,
            ]
        )
        has_court = self.courts.exists() if self.pk else False
        has_slots = CourtSlot.objects.filter(court__venue=self).exists() if self.pk else False
        has_outside_photo = bool(self.front_photo) or self.photos.filter(category=VenuePhoto.PhotoCategory.OUTSIDE).exists()
        has_court_area_photo = bool(self.court_area_photo) or self.photos.filter(category=VenuePhoto.PhotoCategory.COURT_AREA).exists()
        has_proof = bool(
            has_outside_photo
            and has_court_area_photo
            and self.verification_document
            and self.verification_document_type
            and self.declaration_accepted
        )
        return has_details and has_court and has_slots and has_proof

    @property
    def minimum_price(self):
        slot = CourtSlot.objects.filter(court__venue=self).order_by("price").first()
        return slot.price if slot else None

    def __str__(self):
        return self.name or f"Venue for {self.owner.email}"


class VenuePhoto(models.Model):
    class PhotoCategory(models.TextChoices):
        OUTSIDE = "OUTSIDE", "Outside / Front"
        COURT_AREA = "COURT_AREA", "Court / Play Area"
        ADDITIONAL = "ADDITIONAL", "Additional"

    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="photos")
    category = models.CharField(max_length=20, choices=PhotoCategory.choices)
    image = models.FileField(
        upload_to="venues/gallery/",
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["category", "-uploaded_at"]

    def __str__(self):
        return f"{self.venue.name} - {self.get_category_display()}"


class Court(models.Model):
    class CourtType(models.TextChoices):
        INDOOR = "INDOOR", "Indoor"
        OUTDOOR = "OUTDOOR", "Outdoor"
        COVERED = "COVERED", "Covered"

    class SurfaceType(models.TextChoices):
        TURF = "TURF", "Turf"
        MAT = "MAT", "Mat"
        CEMENT = "CEMENT", "Cement"
        ARTIFICIAL_TURF = "ARTIFICIAL_TURF", "Artificial Turf"

    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="courts")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    court_type = models.CharField(max_length=20, choices=CourtType.choices)
    surface_type = models.CharField(max_length=30, choices=SurfaceType.choices)
    court_photo = models.FileField(
        upload_to="venues/courts/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} - {self.venue.name}"


class CourtSlot(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "Available"
        RESERVED = "RESERVED", "Reserved"
        BOOKED = "BOOKED", "Booked"
        BLOCKED = "BLOCKED", "Blocked"
        CANCELLED = "CANCELLED", "Cancelled"

    court = models.ForeignKey(Court, on_delete=models.CASCADE, related_name="slots")
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    slot_duration_minutes = models.PositiveSmallIntegerField(default=60)
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)])
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    reserved_until = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "start_time"]
        constraints = [
            models.UniqueConstraint(fields=["court", "date", "start_time", "end_time"], name="unique_court_slot_time")
        ]

    @property
    def display_time(self):
        return f"{self.start_time.strftime('%I:%M %p')} - {self.end_time.strftime('%I:%M %p')}"

    def release_if_expired(self):
        if self.status == self.Status.RESERVED and self.reserved_until and self.reserved_until <= timezone.now():
            self.status = self.Status.AVAILABLE
            self.reserved_until = None
            self.save(update_fields=["status", "reserved_until", "updated_at"])

    def reserve_for_payment(self):
        self.status = self.Status.RESERVED
        self.reserved_until = timezone.now() + timedelta(minutes=10)
        self.save(update_fields=["status", "reserved_until", "updated_at"])

    def __str__(self):
        return f"{self.court.name} {self.date} {self.display_time}"


class Booking(models.Model):
    class BookingStatus(models.TextChoices):
        RESERVED = "RESERVED", "Reserved"
        CONFIRMED = "CONFIRMED", "Confirmed"
        CANCELLED = "CANCELLED", "Cancelled"
        EXPIRED = "EXPIRED", "Expired"
        COMPLETED = "COMPLETED", "Completed"

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        PAID = "PAID", "Paid"
        CANCELLED = "CANCELLED", "Cancelled"
        FAILED = "FAILED", "Failed"
        REFUND_PENDING = "REFUND_PENDING", "Refund Pending"
        REFUNDED = "REFUNDED", "Refunded"
        PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially Refunded"
        NO_REFUND = "NO_REFUND", "No Refund"

    class PaymentProvider(models.TextChoices):
        MOCK = "MOCK", "Mock"
        KHALTI = "KHALTI", "Khalti"

    class RefundStatus(models.TextChoices):
        NOT_REQUIRED = "NOT_REQUIRED", "Not Required"
        PENDING_OWNER_ACTION = "PENDING_OWNER_ACTION", "Pending Owner Action"
        NOT_ELIGIBLE = "NOT_ELIGIBLE", "Not Eligible"
        REJECTED = "REJECTED", "Rejected"
        REFUNDED = "REFUNDED", "Refunded"
        PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially Refunded"

    class CancellationTier(models.TextChoices):
        NOT_APPLICABLE = "NOT_APPLICABLE", "Not Applicable"
        UNPAID_RELEASE = "UNPAID_RELEASE", "Unpaid Reservation Released"
        FULL_REFUND = "FULL_REFUND", "Full Refund"
        PARTIAL_REFUND = "PARTIAL_REFUND", "Partial Refund"
        NO_REFUND = "NO_REFUND", "No Refund"
        OWNER_FULL_REFUND = "OWNER_FULL_REFUND", "Owner Full Refund"
        ADMIN_DECISION = "ADMIN_DECISION", "Admin Decision"

    booking_code = models.CharField(max_length=40, unique=True, default=booking_code_default, editable=False)
    player = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="court_bookings")
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="bookings")
    court = models.ForeignKey(Court, on_delete=models.CASCADE, related_name="bookings")
    slot = models.ForeignKey(CourtSlot, on_delete=models.PROTECT, related_name="bookings")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20, choices=BookingStatus.choices, default=BookingStatus.RESERVED)
    payment_status = models.CharField(max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    payment_provider = models.CharField(max_length=20, choices=PaymentProvider.choices, default=PaymentProvider.MOCK)
    khalti_pidx = models.CharField(max_length=120, blank=True, db_index=True)
    khalti_payment_url = models.URLField(max_length=500, blank=True)
    khalti_transaction_id = models.CharField(max_length=120, blank=True)
    khalti_status = models.CharField(max_length=40, blank=True)
    khalti_response = models.JSONField(default=dict, blank=True)
    refund_status = models.CharField(max_length=30, choices=RefundStatus.choices, default=RefundStatus.NOT_REQUIRED)
    refund_reason = models.TextField(blank=True)
    refund_owner_note = models.TextField(blank=True)
    refund_requested_at = models.DateTimeField(blank=True, null=True)
    refund_reviewed_at = models.DateTimeField(blank=True, null=True)
    refund_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_refund_bookings",
        blank=True,
        null=True,
    )
    reserved_until = models.DateTimeField()
    confirmed_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="cancelled_court_bookings",
        blank=True,
        null=True,
    )
    cancellation_actor_role = models.CharField(max_length=20, blank=True)
    cancellation_reason = models.TextField(blank=True)
    cancellation_slot_action = models.CharField(max_length=20, blank=True)
    cancellation_policy_snapshot = models.JSONField(default=dict, blank=True)
    cancellation_tier = models.CharField(
        max_length=30,
        choices=CancellationTier.choices,
        default=CancellationTier.NOT_APPLICABLE,
    )
    refund_percentage = models.PositiveSmallIntegerField(
        default=0,
        validators=[MaxValueValidator(100)],
    )
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        if self.player_id and self.player.role != "PLAYER":
            raise ValidationError("Only player accounts can make bookings.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def expire_and_release(self):
        from .services import expire_reserved_booking

        expired = expire_reserved_booking(self.id)
        if expired:
            self.refresh_from_db()
        return expired

    def complete_if_finished(self):
        from .services import complete_confirmed_booking

        completed = complete_confirmed_booking(self.id)
        if completed:
            self.refresh_from_db()
        return completed

    @property
    def booked_slots(self):
        slots = [item.slot for item in self.slot_items.select_related("slot").order_by("slot__date", "slot__start_time", "slot__end_time")]
        return slots or [self.slot]

    def __str__(self):
        return self.booking_code


class BookingMessage(models.Model):
    class MessageType(models.TextChoices):
        ENTRY_INSTRUCTIONS = "ENTRY_INSTRUCTIONS", "Entry Instructions"
        MAINTENANCE_NOTICE = "MAINTENANCE_NOTICE", "Maintenance Notice"
        ACCESS_UPDATE = "ACCESS_UPDATE", "Access Instructions Update"
        VENUE_CLOSURE = "VENUE_CLOSURE", "Venue Closure"
        GENERAL = "GENERAL", "Important Booking Message"

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="venue_messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sent_booking_messages",
    )
    message_type = models.CharField(max_length=30, choices=MessageType.choices)
    message = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        if self.booking_id and self.sender_id != self.booking.venue.owner_id:
            raise ValidationError("Only this venue's owner can send booking messages.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.booking.booking_code} - {self.get_message_type_display()}"


class BookingSlot(models.Model):
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="slot_items")
    slot = models.ForeignKey(CourtSlot, on_delete=models.PROTECT, related_name="booking_items")
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["slot__date", "slot__start_time", "slot__end_time"]
        constraints = [
            models.UniqueConstraint(fields=["booking", "slot"], name="unique_booking_slot")
        ]

    def __str__(self):
        return f"{self.booking.booking_code} - {self.slot}"
