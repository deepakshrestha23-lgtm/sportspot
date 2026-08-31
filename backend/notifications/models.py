from django.conf import settings
from django.db import models


class Notification(models.Model):
    class NotificationType(models.TextChoices):
        TEAM_INVITATION_RECEIVED = "TEAM_INVITATION_RECEIVED", "Team Invitation Received"
        TEAM_INVITATION_ACCEPTED = "TEAM_INVITATION_ACCEPTED", "Team Invitation Accepted"
        TEAM_INVITATION_REJECTED = "TEAM_INVITATION_REJECTED", "Team Invitation Rejected"
        TEAM_MEMBER_JOINED = "TEAM_MEMBER_JOINED", "Team Member Joined"
        TEAM_MEMBER_REMOVED = "TEAM_MEMBER_REMOVED", "Team Member Removed"
        JOIN_REQUEST_RECEIVED = "JOIN_REQUEST_RECEIVED", "Join Request Received"
        JOIN_REQUEST_ACCEPTED = "JOIN_REQUEST_ACCEPTED", "Join Request Accepted"
        JOIN_REQUEST_REJECTED = "JOIN_REQUEST_REJECTED", "Join Request Rejected"
        CHALLENGE_RECEIVED = "CHALLENGE_RECEIVED", "Challenge Received"
        CHALLENGE_ACCEPTED = "CHALLENGE_ACCEPTED", "Challenge Accepted"
        CHALLENGE_REJECTED = "CHALLENGE_REJECTED", "Challenge Rejected"
        CHALLENGE_COUNTERED = "CHALLENGE_COUNTERED", "Challenge Countered"
        CHALLENGE_EXPIRED = "CHALLENGE_EXPIRED", "Challenge Expired"
        MATCH_SCHEDULED = "MATCH_SCHEDULED", "Match Scheduled"
        MATCH_UPDATED = "MATCH_UPDATED", "Match Updated"
        MATCH_CANCELLED = "MATCH_CANCELLED", "Match Cancelled"
        MATCH_REMINDER = "MATCH_REMINDER", "Match Reminder"
        GAME_ROOM_CREATED = "GAME_ROOM_CREATED", "Game Room Created"
        GAME_ROOM_UPDATED = "GAME_ROOM_UPDATED", "Game Room Updated"
        CHAT_MESSAGE_RECEIVED = "CHAT_MESSAGE_RECEIVED", "Chat Message Received"
        RATING_REQUIRED = "RATING_REQUIRED", "Rating Required"
        VENUE_SUBMITTED = "VENUE_SUBMITTED", "Venue Submitted"
        VENUE_APPROVED = "VENUE_APPROVED", "Venue Approved"
        VENUE_NEEDS_CHANGES = "VENUE_NEEDS_CHANGES", "Venue Needs Changes"
        VENUE_REJECTED = "VENUE_REJECTED", "Venue Rejected"
        VENUE_SUSPENDED = "VENUE_SUSPENDED", "Venue Suspended"
        VENUE_MESSAGE = "VENUE_MESSAGE", "Venue Message"
        BOOKING_RESERVED = "BOOKING_RESERVED", "Booking Reserved"
        BOOKING_CONFIRMED = "BOOKING_CONFIRMED", "Booking Confirmed"
        BOOKING_PAYMENT_FAILED = "BOOKING_PAYMENT_FAILED", "Booking Payment Failed"
        BOOKING_CANCELLED_BY_PLAYER = "BOOKING_CANCELLED_BY_PLAYER", "Booking Cancelled By Player"
        BOOKING_CANCELLED_BY_OWNER = "BOOKING_CANCELLED_BY_OWNER", "Booking Cancelled By Owner"
        BOOKING_REMINDER = "BOOKING_REMINDER", "Booking Reminder"
        BOOKING_COMPLETED = "BOOKING_COMPLETED", "Booking Completed"
        BOOKING_CHECKED_IN = "BOOKING_CHECKED_IN", "Booking Checked In"
        REFUND_PENDING = "REFUND_PENDING", "Refund Pending"
        REFUND_APPROVED = "REFUND_APPROVED", "Refund Approved"
        REFUND_REJECTED = "REFUND_REJECTED", "Refund Rejected"
        REFUND_COMPLETED = "REFUND_COMPLETED", "Refund Completed"
        DISPUTE_CREATED = "DISPUTE_CREATED", "Dispute Created"
        DISPUTE_UPDATED = "DISPUTE_UPDATED", "Dispute Updated"
        DISPUTE_RESOLVED = "DISPUTE_RESOLVED", "Dispute Resolved"
        SYSTEM_ANNOUNCEMENT = "SYSTEM_ANNOUNCEMENT", "System Announcement"

        # Kept so existing rows remain readable after the notification redesign.
        TEAM_INVITATION = "TEAM_INVITATION", "Legacy Team Invitation"
        INVITATION_ACCEPTED = "INVITATION_ACCEPTED", "Legacy Invitation Accepted"
        INVITATION_REJECTED = "INVITATION_REJECTED", "Legacy Invitation Rejected"
        BOOKING_CANCELLED = "BOOKING_CANCELLED", "Legacy Booking Cancelled"
        REFUND_REQUESTED = "REFUND_REQUESTED", "Legacy Refund Requested"
        REFUND_UPDATED = "REFUND_UPDATED", "Legacy Refund Updated"

    class Category(models.TextChoices):
        TEAMS = "TEAMS", "Teams"
        CHALLENGES = "CHALLENGES", "Challenges"
        MATCHES = "MATCHES", "Matches"
        BOOKINGS = "BOOKINGS", "Bookings"
        SYSTEM = "SYSTEM", "System"

    class Priority(models.TextChoices):
        NORMAL = "NORMAL", "Normal"
        IMPORTANT = "IMPORTANT", "Important"
        URGENT = "URGENT", "Urgent"

    class ActionStatus(models.TextChoices):
        NONE = "NONE", "No Action"
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"
        EXPIRED = "EXPIRED", "Expired"
        COMPLETED = "COMPLETED", "Completed"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="sent_notifications",
        blank=True,
        null=True,
    )
    notification_type = models.CharField(max_length=40, choices=NotificationType.choices)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.SYSTEM)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.NORMAL)
    title = models.CharField(max_length=120)
    message = models.TextField()
    action_url = models.CharField(max_length=255, blank=True)
    related_entity_type = models.CharField(max_length=50, blank=True)
    related_entity_id = models.PositiveBigIntegerField(blank=True, null=True)
    action_required = models.BooleanField(default=False)
    action_status = models.CharField(max_length=20, choices=ActionStatus.choices, default=ActionStatus.NONE)
    is_seen = models.BooleanField(default=False)
    seen_at = models.DateTimeField(blank=True, null=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    deduplication_key = models.CharField(max_length=255, blank=True, null=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient", "is_seen", "-created_at"], name="notif_recipient_seen_idx"),
            models.Index(fields=["recipient", "category", "-created_at"], name="notif_recipient_cat_idx"),
        ]

    def __str__(self):
        return f"{self.recipient.email} - {self.title}"


class EmailDelivery(models.Model):
    class EmailType(models.TextChoices):
        EMAIL_VERIFICATION_OTP = "EMAIL_VERIFICATION_OTP", "Email Verification OTP"
        EMAIL_VERIFIED = "EMAIL_VERIFIED", "Email Verified"
        PASSWORD_RESET = "PASSWORD_RESET", "Password Reset"
        PASSWORD_CHANGED = "PASSWORD_CHANGED", "Password Changed"
        TEAM_INVITATION = "TEAM_INVITATION", "Team Invitation"
        BOOKING_CONFIRMED = "BOOKING_CONFIRMED", "Booking Confirmed"
        BOOKING_PAYMENT_FAILED = "BOOKING_PAYMENT_FAILED", "Booking Payment Failed"
        BOOKING_CANCELLED = "BOOKING_CANCELLED", "Booking Cancelled"
        BOOKING_REMINDER = "BOOKING_REMINDER", "Booking Reminder"
        REFUND_PENDING = "REFUND_PENDING", "Refund Pending"
        REFUND_COMPLETED = "REFUND_COMPLETED", "Refund Completed"
        VENUE_SUBMITTED = "VENUE_SUBMITTED", "Venue Submitted"
        VENUE_STATUS = "VENUE_STATUS", "Venue Status"
        VENUE_MESSAGE = "VENUE_MESSAGE", "Venue Message"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        CONSOLE_PREVIEW = "CONSOLE_PREVIEW", "Console Preview"
        FAILED = "FAILED", "Failed"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_deliveries",
    )
    email_type = models.CharField(max_length=40, choices=EmailType.choices)
    recipient_email = models.EmailField()
    subject = models.CharField(max_length=180)
    deduplication_key = models.CharField(max_length=255, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    related_entity_type = models.CharField(max_length=50, blank=True)
    related_entity_id = models.PositiveBigIntegerField(blank=True, null=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=300, blank=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient", "-created_at"], name="email_recipient_created_idx"),
            models.Index(fields=["email_type", "status"], name="email_type_status_idx"),
        ]

    def __str__(self):
        return f"{self.email_type} to {self.recipient_email}"
