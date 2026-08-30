from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from teams.models import Team
from venues.models import Booking
from venues.policies import get_booking_start_at
from venues.reference_data import SPORTSPOT_AREAS_BY_DISTRICT, SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG


ACTIVE_PARTICIPANT_STATUSES = [
    "CONFIRMED",
    "PROVISIONAL",
    "RECONFIRM_REQUIRED",
    "GUEST_CONFIRMATION_REQUIRED",
]
RECONFIRMATION_PENDING_STATUSES = ["RECONFIRM_REQUIRED", "GUEST_CONFIRMATION_REQUIRED"]
AUTOMATIC_PLAN_FIRST_CANCELLATION_REASON = "The court-booking deadline passed before a court was confirmed."


class Game(models.Model):
    class GameType(models.TextChoices):
        PICKUP = "PICKUP", "Pickup Game"
        FILL_SQUAD = "FILL_SQUAD", "Fill My Squad"

    class CreationMode(models.TextChoices):
        BOOKING_FIRST = "BOOKING_FIRST", "Use Existing Booking"
        PLAN_FIRST = "PLAN_FIRST", "Plan First"

    class GameIntensity(models.TextChoices):
        CASUAL = "CASUAL", "Casual"
        COMPETITIVE = "COMPETITIVE", "Competitive"
        PRACTICE = "PRACTICE", "Practice / Friendly"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        RECRUITING = "RECRUITING", "Open"
        FULL = "FULL", "Full"
        CLOSED = "CLOSED", "Recruitment Closed"
        BOOKING_PENDING = "BOOKING_PENDING", "Court Payment In Progress"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    class RecruitmentClosureReason(models.TextChoices):
        HOST_CLOSED = "HOST_CLOSED", "Closed by Host"
        DEADLINE_PASSED = "DEADLINE_PASSED", "Recruitment Deadline Passed"
        BOOKING_PAYMENT_PENDING = "BOOKING_PAYMENT_PENDING", "Court Payment In Progress"
        BOOKING_PAYMENT_EXPIRED = "BOOKING_PAYMENT_EXPIRED", "Court Payment Was Not Completed"

    class SkillLevel(models.TextChoices):
        BEGINNER = "BEGINNER", "Beginner"
        INTERMEDIATE = "INTERMEDIATE", "Intermediate"
        ADVANCED = "ADVANCED", "Advanced"
        OPEN = "OPEN", "Open to all"

    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hosted_games")
    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="matchmaking_games", blank=True, null=True)
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="fill_squad_games", blank=True, null=True)
    game_type = models.CharField(max_length=20, choices=GameType.choices, default=GameType.PICKUP)
    creation_mode = models.CharField(max_length=20, choices=CreationMode.choices, default=CreationMode.BOOKING_FIRST)
    game_intensity = models.CharField(max_length=20, choices=GameIntensity.choices, default=GameIntensity.CASUAL)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RECRUITING)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True, max_length=800)
    host_notes = models.CharField(max_length=500, blank=True)
    game_room_note = models.CharField(max_length=500, blank=True)
    reporting_instructions = models.CharField(max_length=500, blank=True)
    equipment_instructions = models.CharField(max_length=500, blank=True)
    min_skill_level = models.CharField(max_length=20, choices=SkillLevel.choices, default=SkillLevel.OPEN)
    total_capacity = models.PositiveSmallIntegerField(default=12)
    minimum_players_to_proceed = models.PositiveSmallIntegerField(default=6)
    waitlist_enabled = models.BooleanField(default=True)
    recruitment_deadline = models.DateTimeField(blank=True, null=True)
    proposed_date = models.DateField(blank=True, null=True)
    proposed_start_time = models.TimeField(blank=True, null=True)
    proposed_end_time = models.TimeField(blank=True, null=True)
    preferred_district = models.CharField(max_length=50, blank=True)
    preferred_area = models.CharField(max_length=100, blank=True)
    preferred_venue_name = models.CharField(max_length=120, blank=True)
    alternative_details = models.CharField(max_length=300, blank=True)
    booking_deadline = models.DateTimeField(blank=True, null=True)
    booking_attached_at = models.DateTimeField(blank=True, null=True)
    requires_reconfirmation = models.BooleanField(default=False)
    reconfirmation_requested_at = models.DateTimeField(blank=True, null=True)
    reconfirmation_deadline = models.DateTimeField(blank=True, null=True)
    is_public = models.BooleanField(default=True)
    published_at = models.DateTimeField(default=timezone.now)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    cancellation_reason = models.CharField(max_length=300, blank=True)
    recruitment_closed_reason = models.CharField(
        max_length=40,
        choices=RecruitmentClosureReason.choices,
        blank=True,
    )
    recruitment_closed_at = models.DateTimeField(blank=True, null=True)
    recruitment_closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="closed_game_recruitment",
        blank=True,
        null=True,
    )
    booking_handoff_was_public = models.BooleanField(default=False)
    client_request_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["proposed_date", "proposed_start_time", "booking__slot__date", "booking__slot__start_time", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["booking"],
                condition=Q(booking__isnull=False, status__in=["DRAFT", "RECRUITING", "FULL", "CLOSED", "BOOKING_PENDING", "IN_PROGRESS", "COMPLETED"]),
                name="unique_active_matchmaking_game_per_booking",
            ),
            models.UniqueConstraint(
                fields=["host", "client_request_id"],
                condition=~Q(client_request_id=""),
                name="unique_matchmaking_create_request_per_host",
            ),
        ]
        indexes = [
            models.Index(fields=["game_type", "status"]),
            models.Index(fields=["creation_mode", "status"]),
            models.Index(fields=["host", "status"]),
            models.Index(fields=["proposed_date", "proposed_start_time"]),
        ]

    def clean(self):
        if self.host_id and self.host.role != "PLAYER":
            raise ValidationError("Only player accounts can host games.")
        if self.game_type == self.GameType.PICKUP and self.team_id:
            raise ValidationError("Pickup games should not be linked to a team.")
        if self.game_type == self.GameType.FILL_SQUAD:
            if not self.team_id:
                raise ValidationError("Choose the permanent team that needs temporary players.")
            if self.team.captain_id != self.host_id:
                raise ValidationError("Only the team captain can open a Fill My Squad listing.")
        if self.creation_mode == self.CreationMode.BOOKING_FIRST and not self.booking_id:
            raise ValidationError("Choose a confirmed booking or switch to Plan First.")
        if self.creation_mode == self.CreationMode.PLAN_FIRST:
            if not self.proposed_date or not self.proposed_start_time or not self.proposed_end_time:
                raise ValidationError("Choose a proposed date and time.")
            if self.proposed_end_time <= self.proposed_start_time:
                raise ValidationError("The proposed end time must be after the start time.")
            if not self.preferred_area.strip():
                raise ValidationError("Choose a preferred area.")
            area_key = self.preferred_area.strip().casefold()
            if self.preferred_district.strip():
                district_areas = SPORTSPOT_AREAS_BY_DISTRICT.get(self.preferred_district.strip(), [])
                if area_key not in {area.casefold() for area in district_areas}:
                    raise ValidationError("Choose an area from the selected district.")
            else:
                supported_areas = {
                    area.casefold()
                    for areas in SPORTSPOT_AREAS_BY_DISTRICT.values()
                    for area in areas
                }
                if area_key not in supported_areas:
                    raise ValidationError("Choose an area from the supported SportSpot locations.")
            proposed_start = self.start_at
            if proposed_start and proposed_start <= timezone.now():
                raise ValidationError("Choose a future game time.")
            if not self.booking_deadline:
                raise ValidationError("Choose a court booking deadline.")
            if proposed_start and self.booking_deadline > proposed_start - timezone.timedelta(minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_booking_lead_minutes"]):
                raise ValidationError("Leave at least 1 hour between the court-booking deadline and game start.")
            if self.recruitment_deadline and self.recruitment_deadline > self.booking_deadline - timezone.timedelta(minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_recruitment_to_booking_minutes"]):
                raise ValidationError("Recruitment must close at least 30 minutes before the court-booking deadline.")
        if self.booking_id:
            booking_owner_can_remain_responsible = (
                self.game_type == self.GameType.FILL_SQUAD
                and self.team_id
                and self.team.captain_id == self.host_id
            )
            if self.booking.player_id != self.host_id and not booking_owner_can_remain_responsible:
                raise ValidationError("You can publish games only from your own confirmed booking.")
            if self.booking.status != Booking.BookingStatus.CONFIRMED or self.booking.payment_status != Booking.PaymentStatus.PAID:
                raise ValidationError("Only paid confirmed bookings can be opened for players.")
            booking_start = get_booking_start_at(self.booking)
            if booking_start and booking_start <= timezone.now():
                raise ValidationError("Choose a future booking.")
        if self.recruitment_deadline and self.start_at and self.recruitment_deadline >= self.start_at:
            raise ValidationError("Recruitment must close before the game starts.")
        if self.total_capacity < 2:
            raise ValidationError("A game needs at least two participant spots.")
        if self.minimum_players_to_proceed > self.total_capacity:
            raise ValidationError("Minimum players cannot exceed total capacity.")

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        lifecycle_fields = {
            "status",
            "is_public",
            "updated_at",
            "cancelled_at",
            "cancellation_reason",
            "recruitment_closed_reason",
            "recruitment_closed_at",
            "recruitment_closed_by",
            "booking_handoff_was_public",
            "reconfirmation_requested_at",
            "reconfirmation_deadline",
        }
        if update_fields is not None and set(update_fields).issubset(lifecycle_fields):
            super().save(*args, **kwargs)
            return
        self.clean()
        super().save(*args, **kwargs)

    @property
    def start_at(self):
        if self.booking_id:
            return get_booking_start_at(self.booking)
        if self.proposed_date and self.proposed_start_time:
            return timezone.make_aware(
                timezone.datetime.combine(self.proposed_date, self.proposed_start_time),
                timezone.get_current_timezone(),
            )
        return None

    @property
    def end_at(self):
        if self.booking_id:
            slots = self.booking.booked_slots
            if not slots:
                return None
            return timezone.make_aware(
                timezone.datetime.combine(slots[-1].date, slots[-1].end_time),
                timezone.get_current_timezone(),
            )
        if self.proposed_date and self.proposed_end_time:
            return timezone.make_aware(
                timezone.datetime.combine(self.proposed_date, self.proposed_end_time),
                timezone.get_current_timezone(),
            )
        return None

    @property
    def is_booking_verified(self):
        return bool(self.booking_id)

    @property
    def confirmed_participants_count(self):
        return self.participants.filter(status=GameParticipant.Status.CONFIRMED).count()

    @property
    def provisional_participants_count(self):
        return self.participants.filter(
            status__in=[
                GameParticipant.Status.PROVISIONAL,
                GameParticipant.Status.RECONFIRM_REQUIRED,
                GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED,
            ]
        ).count()

    @property
    def reconfirmation_pending_count(self):
        return self.participants.filter(status__in=RECONFIRMATION_PENDING_STATUSES).count()

    @property
    def guest_confirmation_pending_count(self):
        return self.participants.filter(
            status=GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED,
        ).count()

    @property
    def registered_reconfirmation_pending_count(self):
        return self.participants.filter(
            status=GameParticipant.Status.RECONFIRM_REQUIRED,
        ).count()

    @property
    def occupied_spots_count(self):
        return self.participants.filter(status__in=ACTIVE_PARTICIPANT_STATUSES).count()

    @property
    def waitlist_count(self):
        return self.join_requests.filter(status=JoinRequest.Status.WAITLISTED).count()

    @property
    def available_spots(self):
        return max(self.total_capacity - self.occupied_spots_count, 0)

    def refresh_status(self, save=True, now=None):
        if self.status == self.Status.CANCELLED:
            return self.status
        now = now or timezone.now()
        start_at = self.start_at
        end_at = self.end_at
        has_active_handoff = bool(
            self.creation_mode == self.CreationMode.PLAN_FIRST
            and not self.booking_id
            and self.booking_handoffs.filter(
                status=Booking.BookingStatus.RESERVED,
                payment_status=Booking.PaymentStatus.PENDING,
                reserved_until__gt=now,
            ).exists()
        )
        if end_at and end_at <= now:
            next_status = self.Status.COMPLETED
        elif start_at and start_at <= now:
            next_status = self.Status.IN_PROGRESS
        elif has_active_handoff:
            next_status = self.Status.BOOKING_PENDING
        elif self.creation_mode == self.CreationMode.PLAN_FIRST and not self.booking_id and self.booking_deadline and self.booking_deadline <= now:
            next_status = self.Status.CANCELLED
        elif self.status == self.Status.BOOKING_PENDING:
            next_status = (
                self.Status.RECRUITING
                if self.booking_handoff_was_public
                and (not self.recruitment_deadline or self.recruitment_deadline > now)
                else self.Status.CLOSED
            )
        elif self.status == self.Status.CLOSED and not self.is_public:
            # A host can intentionally stop recruitment before the deadline
            # while keeping the private game and its linked booking intact.
            next_status = self.Status.CLOSED
        elif self.recruitment_deadline and self.recruitment_deadline <= now:
            next_status = self.Status.CLOSED
        elif self.available_spots == 0:
            next_status = self.Status.FULL
        else:
            next_status = self.Status.RECRUITING
        if next_status != self.status:
            previous_status = self.status
            self.status = next_status
            if save:
                update_fields = ["status", "updated_at"]
                if next_status == self.Status.CANCELLED:
                    if not self.cancelled_at:
                        self.cancelled_at = now
                        update_fields.append("cancelled_at")
                    if not self.cancellation_reason:
                        self.cancellation_reason = AUTOMATIC_PLAN_FIRST_CANCELLATION_REASON
                        update_fields.append("cancellation_reason")
                    if previous_status == self.Status.BOOKING_PENDING:
                        self.booking_handoff_was_public = False
                        update_fields.append("booking_handoff_was_public")
                elif next_status == self.Status.BOOKING_PENDING:
                    self.is_public = False
                    self.recruitment_closed_reason = self.RecruitmentClosureReason.BOOKING_PAYMENT_PENDING
                    self.recruitment_closed_at = now
                    update_fields.extend(["is_public", "recruitment_closed_reason", "recruitment_closed_at"])
                elif next_status == self.Status.CLOSED:
                    self.is_public = False
                    if previous_status == self.Status.BOOKING_PENDING:
                        self.recruitment_closed_reason = self.RecruitmentClosureReason.BOOKING_PAYMENT_EXPIRED
                        self.booking_handoff_was_public = False
                    elif not self.recruitment_closed_reason:
                        self.recruitment_closed_reason = self.RecruitmentClosureReason.DEADLINE_PASSED
                    self.recruitment_closed_at = self.recruitment_closed_at or now
                    update_fields.extend([
                        "is_public", "recruitment_closed_reason", "recruitment_closed_at",
                        "booking_handoff_was_public",
                    ])
                elif next_status == self.Status.RECRUITING and previous_status == self.Status.BOOKING_PENDING:
                    self.is_public = True
                    self.recruitment_closed_reason = ""
                    self.recruitment_closed_at = None
                    self.recruitment_closed_by = None
                    self.booking_handoff_was_public = False
                    update_fields.extend([
                        "is_public", "recruitment_closed_reason", "recruitment_closed_at",
                        "recruitment_closed_by", "booking_handoff_was_public",
                    ])
                self.save(update_fields=update_fields)
        return self.status

    def __str__(self):
        return self.title


class GameRoleRequirement(models.Model):
    class CricksalRole(models.TextChoices):
        BATSMAN = "BATSMAN", "Batsman"
        BOWLER = "BOWLER", "Bowler"
        ALL_ROUNDER = "ALL_ROUNDER", "All-rounder"
        WICKETKEEPER = "WICKETKEEPER", "Wicketkeeper"
        ANY = "ANY", "Any role"

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="role_requirements")
    role = models.CharField(max_length=20, choices=CricksalRole.choices)
    required_count = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ["role"]
        constraints = [
            models.UniqueConstraint(fields=["game", "role"], name="unique_game_role_requirement")
        ]

    def __str__(self):
        return f"{self.game_id} - {self.role} x {self.required_count}"


class GameParticipant(models.Model):
    class ParticipantType(models.TextChoices):
        HOST = "HOST", "Host"
        TEAM_MEMBER = "TEAM_MEMBER", "Team Member"
        TEMPORARY = "TEMPORARY", "Player"
        GUEST = "GUEST", "Guest"

    class Status(models.TextChoices):
        CONFIRMED = "CONFIRMED", "Confirmed"
        PROVISIONAL = "PROVISIONAL", "Provisional"
        RECONFIRM_REQUIRED = "RECONFIRM_REQUIRED", "Reconfirmation Required"
        GUEST_CONFIRMATION_REQUIRED = "GUEST_CONFIRMATION_REQUIRED", "Host Confirmation Required"
        DECLINED = "DECLINED", "Declined"
        LEFT = "LEFT", "Left"
        REMOVED = "REMOVED", "Removed"

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_participations", blank=True, null=True)
    guest_name = models.CharField(max_length=100, blank=True)
    participant_type = models.CharField(max_length=20, choices=ParticipantType.choices)
    role = models.CharField(max_length=20, choices=GameRoleRequirement.CricksalRole.choices, default=GameRoleRequirement.CricksalRole.ANY)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.CONFIRMED)
    added_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name="added_game_participants", blank=True, null=True)
    joined_at = models.DateTimeField(default=timezone.now)
    status_changed_at = models.DateTimeField(default=timezone.now)
    status_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="changed_game_participant_statuses",
        blank=True,
        null=True,
    )
    schedule_acknowledged_at = models.DateTimeField(blank=True, null=True)
    schedule_acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="acknowledged_guest_game_schedules",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["joined_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["game", "user"],
                condition=Q(user__isnull=False),
                name="unique_registered_game_participant",
            )
        ]

    def clean(self):
        if self.participant_type == self.ParticipantType.GUEST:
            if self.user_id:
                raise ValidationError("Guest participants are not linked to SportSpot accounts.")
            if not self.guest_name.strip():
                raise ValidationError("Guest name is required.")
        elif not self.user_id:
            raise ValidationError("Registered participants require a player account.")
        if self.user_id and self.user.role != "PLAYER":
            raise ValidationError("Only player accounts can participate in games.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    @property
    def display_name(self):
        return self.guest_name or (self.user.full_name if self.user_id else "")

    def __str__(self):
        return f"{self.display_name} - {self.game.title}"


class JoinRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"
        WAITLISTED = "WAITLISTED", "Waitlisted"
        INVITED = "INVITED", "Invited"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        REMOVED = "REMOVED", "Removed by host"
        EXPIRED = "EXPIRED", "Expired"

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="join_requests")
    player = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_join_requests")
    requested_role = models.CharField(max_length=20, choices=GameRoleRequirement.CricksalRole.choices, default=GameRoleRequirement.CricksalRole.ANY)
    message = models.CharField(max_length=400, blank=True)
    attendance_confirmed = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name="decided_game_join_requests", blank=True, null=True)
    decided_at = models.DateTimeField(blank=True, null=True)
    waitlist_position = models.PositiveSmallIntegerField(blank=True, null=True)
    attempt_number = models.PositiveSmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["game", "player"], name="unique_join_request_per_game_player")
        ]

    def clean(self):
        if self.player_id and self.player.role != "PLAYER":
            raise ValidationError("Only player accounts can request to join games.")
        if self.player_id and self.game_id and self.game.host_id == self.player_id:
            raise ValidationError("The host is already part of this game.")
        if self.status == self.Status.INVITED and not self.decided_by_id:
            raise ValidationError("Game invitations must record the host who sent them.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.player.email} -> {self.game.title}"


class JoinRequestEvent(models.Model):
    class EventType(models.TextChoices):
        SUBMITTED = "SUBMITTED", "Submitted"
        INVITED = "INVITED", "Invited"
        WAITLISTED = "WAITLISTED", "Waitlisted"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        EXPIRED = "EXPIRED", "Expired"
        REMOVED = "REMOVED", "Removed"

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="join_request_events")
    join_request = models.ForeignKey(JoinRequest, on_delete=models.CASCADE, related_name="events")
    player = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_request_events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="performed_game_request_events",
        blank=True,
        null=True,
    )
    event_type = models.CharField(max_length=20, choices=EventType.choices)
    previous_status = models.CharField(max_length=20, blank=True)
    current_status = models.CharField(max_length=20)
    attempt_number = models.PositiveSmallIntegerField(default=1)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.join_request_id} - {self.event_type}"


class GameChatMessage(models.Model):
    """Durable, room-scoped conversation messages for registered players."""

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="chat_messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="game_chat_messages",
        blank=True,
        null=True,
    )
    sender_name = models.CharField(max_length=120)
    body = models.TextField(max_length=1000)
    client_message_id = models.CharField(max_length=64, blank=True)
    edited_at = models.DateTimeField(blank=True, null=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["game", "sender", "client_message_id"],
                condition=Q(client_message_id__gt=""),
                name="unique_game_chat_client_message",
            ),
        ]
        indexes = [
            models.Index(fields=["game", "-created_at", "-id"], name="game_chat_history_idx"),
        ]

    def __str__(self):
        return f"{self.game_id} - {self.sender_name} - {self.created_at.isoformat()}"



