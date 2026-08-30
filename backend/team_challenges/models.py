from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from teams.models import Team, TeamMember
from venues.models import Booking
from venues.reference_data import SPORTSPOT_AREAS_BY_DISTRICT, SPORTSPOT_DISTRICTS


ACTIVE_CHALLENGE_STATUSES = (
    "OPEN",
    "COUNTERED",
    "ACCEPTED_AWAITING_BOOKING",
    "RECONFIRMATION_REQUIRED",
    "CONFIRMED",
)


class TeamChallenge(models.Model):
    class ChallengeType(models.TextChoices):
        DIRECT = "DIRECT", "Direct challenge"
        OPEN = "OPEN", "Open challenge"

    class CourtMode(models.TextChoices):
        PLAN_FIRST = "PLAN_FIRST", "Plan first"
        BOOKING_FIRST = "BOOKING_FIRST", "Confirmed booking"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Awaiting response"
        COUNTERED = "COUNTERED", "Counter-proposal received"
        ACCEPTED_AWAITING_BOOKING = "ACCEPTED_AWAITING_BOOKING", "Court booking required"
        RECONFIRMATION_REQUIRED = "RECONFIRMATION_REQUIRED", "Schedule change requested"
        CONFIRMED = "CONFIRMED", "Match confirmed"
        DECLINED = "DECLINED", "Declined"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"
        COMPLETED = "COMPLETED", "Completed"

    class Decision(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        DECLINED = "DECLINED", "Declined"

    challenger_team = models.ForeignKey(
        Team,
        on_delete=models.PROTECT,
        related_name="sent_team_challenges",
    )
    challenged_team = models.ForeignKey(
        Team,
        on_delete=models.PROTECT,
        related_name="received_team_challenges",
        blank=True,
        null=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_team_challenges",
    )
    challenge_type = models.CharField(max_length=12, choices=ChallengeType.choices, default=ChallengeType.DIRECT)
    court_mode = models.CharField(max_length=20, choices=CourtMode.choices, default=CourtMode.PLAN_FIRST)
    booking = models.ForeignKey(
        Booking,
        on_delete=models.PROTECT,
        related_name="team_challenges",
        blank=True,
        null=True,
    )
    booking_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="team_challenge_bookings",
        blank=True,
        null=True,
    )
    team_pair_key = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=35, choices=Status.choices, default=Status.OPEN)
    current_proposal = models.ForeignKey(
        "ChallengeProposal",
        on_delete=models.PROTECT,
        related_name="current_for_challenges",
        blank=True,
        null=True,
    )
    response_deadline = models.DateTimeField()
    booking_deadline = models.DateTimeField(blank=True, null=True)
    reconfirmation_requested_at = models.DateTimeField(blank=True, null=True)
    reconfirmation_deadline = models.DateTimeField(blank=True, null=True)
    is_public = models.BooleanField(default=False)
    client_request_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["team_pair_key"],
                condition=Q(team_pair_key__gt="", status__in=ACTIVE_CHALLENGE_STATUSES),
                name="unique_active_team_challenge_pair",
            ),
            models.UniqueConstraint(
                fields=["created_by", "client_request_id"],
                condition=~Q(client_request_id=""),
                name="unique_team_challenge_create_request",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "response_deadline"]),
            models.Index(fields=["challenger_team", "status"]),
            models.Index(fields=["challenged_team", "status"]),
            models.Index(fields=["is_public", "status"]),
        ]

    def clean(self):
        if self.challenger_team_id and self.challenged_team_id == self.challenger_team_id:
            raise ValidationError("A team cannot challenge itself.")
        if self.challenge_type == self.ChallengeType.DIRECT and not self.challenged_team_id:
            raise ValidationError("Choose an opposing team for a direct challenge.")
        if self.court_mode == self.CourtMode.BOOKING_FIRST and not self.booking_id:
            raise ValidationError("Choose a confirmed booking for a booking-first challenge.")
        if self.court_mode == self.CourtMode.PLAN_FIRST and self.booking_id:
            raise ValidationError("A plan-first challenge cannot use a confirmed booking.")
        if self.response_deadline and self.response_deadline <= timezone.now():
            raise ValidationError("Choose a future response deadline.")
        if self.booking_deadline and self.response_deadline >= self.booking_deadline:
            raise ValidationError("The court-booking deadline must be after the response deadline.")

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        lifecycle_fields = {
            "challenged_team",
            "team_pair_key",
            "booking",
            "booking_owner",
            "current_proposal",
            "status",
            "response_deadline",
            "booking_deadline",
            "reconfirmation_requested_at",
            "reconfirmation_deadline",
            "is_public",
            "updated_at",
        }
        if not update_fields or not set(update_fields).issubset(lifecycle_fields):
            self.clean()
        super().save(*args, **kwargs)

    @property
    def is_open_for_response(self):
        return self.status in {self.Status.OPEN, self.Status.COUNTERED} and self.response_deadline > timezone.now()

    @property
    def is_open_for_opponent_response(self):
        """Whether an open challenge can still receive a new team response."""
        return bool(
            self.challenge_type == self.ChallengeType.OPEN
            and self.is_public
            and self.challenged_team_id is None
            and self.status == self.Status.OPEN
            and self.response_deadline > timezone.now()
        )

    def __str__(self):
        opponent = self.challenged_team.name if self.challenged_team_id else "Open opponent search"
        return f"{self.challenger_team.name} vs {opponent}"


class ChallengeProposal(models.Model):
    class Decision(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        DECLINED = "DECLINED", "Declined"

    challenge = models.ForeignKey(TeamChallenge, on_delete=models.CASCADE, related_name="proposals")
    version = models.PositiveIntegerField()
    created_by_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="challenge_proposals")
    court_mode = models.CharField(max_length=20, choices=TeamChallenge.CourtMode.choices)
    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="challenge_proposals", blank=True, null=True)
    proposed_date = models.DateField(blank=True, null=True)
    proposed_start_time = models.TimeField(blank=True, null=True)
    proposed_end_time = models.TimeField(blank=True, null=True)
    preferred_district = models.CharField(max_length=50, blank=True)
    preferred_area = models.CharField(max_length=100, blank=True)
    preferred_venue_name = models.CharField(max_length=120, blank=True)
    players_per_side = models.PositiveSmallIntegerField(default=6)
    intensity = models.CharField(max_length=20, default="CASUAL")
    message = models.CharField(max_length=500, blank=True)
    response_deadline = models.DateTimeField()
    booking_deadline = models.DateTimeField(blank=True, null=True)
    challenger_decision = models.CharField(max_length=12, choices=Decision.choices, default=Decision.PENDING)
    challenged_decision = models.CharField(max_length=12, choices=Decision.choices, default=Decision.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["challenge", "version"], name="unique_challenge_proposal_version"),
        ]

    def clean(self):
        if self.proposed_start_time and self.proposed_end_time and self.proposed_end_time <= self.proposed_start_time:
            raise ValidationError("The proposed end time must be after the start time.")
        if self.court_mode == TeamChallenge.CourtMode.BOOKING_FIRST and not self.booking_id:
            raise ValidationError("A confirmed booking is required for this proposal.")
        if self.court_mode == TeamChallenge.CourtMode.PLAN_FIRST and self.booking_id:
            raise ValidationError("A plan-first proposal cannot use a confirmed booking.")
        if self.court_mode == TeamChallenge.CourtMode.PLAN_FIRST:
            if not self.proposed_date or not self.proposed_start_time or not self.proposed_end_time:
                raise ValidationError("A planned challenge needs a date and start and end times.")
            if self.preferred_district not in SPORTSPOT_DISTRICTS:
                raise ValidationError("Choose a supported district for the planned challenge.")
            if self.preferred_area not in SPORTSPOT_AREAS_BY_DISTRICT.get(self.preferred_district, []):
                raise ValidationError("Choose an area within the selected district.")
        if self.response_deadline <= timezone.now():
            raise ValidationError("Choose a future response deadline.")
        if self.booking_deadline and self.response_deadline >= self.booking_deadline:
            raise ValidationError("The court-booking deadline must be after the response deadline.")
        if self.players_per_side < 2 or self.players_per_side > 30:
            raise ValidationError("Players per side must be between 2 and 30.")

    def __str__(self):
        return f"{self.challenge_id} proposal {self.version}"


class OpenChallengeResponse(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Interested"
        SELECTED = "SELECTED", "Selected"
        NOT_SELECTED = "NOT_SELECTED", "Not selected"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"

    challenge = models.ForeignKey(TeamChallenge, on_delete=models.CASCADE, related_name="open_responses")
    responding_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="open_challenge_responses")
    responding_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="open_challenge_responses")
    message = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["challenge", "responding_team"], name="unique_open_challenge_team_response"),
        ]


class ChallengeEvent(models.Model):
    class EventType(models.TextChoices):
        CREATED = "CREATED", "Created"
        RESPONSE_RECEIVED = "RESPONSE_RECEIVED", "Response received"
        OPPONENT_SELECTED = "OPPONENT_SELECTED", "Opponent selected"
        COUNTERED = "COUNTERED", "Countered"
        ACCEPTED = "ACCEPTED", "Accepted"
        DECLINED = "DECLINED", "Declined"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        EXPIRED = "EXPIRED", "Expired"
        BOOKING_REQUIRED = "BOOKING_REQUIRED", "Booking required"
        BOOKING_CONFIRMED = "BOOKING_CONFIRMED", "Booking confirmed"
        RECONFIRMATION_REQUIRED = "RECONFIRMATION_REQUIRED", "Reconfirmation required"
        CANCELLED = "CANCELLED", "Cancelled"

    challenge = models.ForeignKey(TeamChallenge, on_delete=models.CASCADE, related_name="events")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True, related_name="team_challenge_events")
    team = models.ForeignKey(Team, on_delete=models.SET_NULL, blank=True, null=True, related_name="challenge_events")
    proposal = models.ForeignKey(ChallengeProposal, on_delete=models.SET_NULL, blank=True, null=True, related_name="events")
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class TeamFixture(models.Model):
    class Status(models.TextChoices):
        AWAITING_COURT = "AWAITING_COURT", "Court booking required"
        SCHEDULED = "SCHEDULED", "Scheduled"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        RECONFIRMATION_REQUIRED = "RECONFIRMATION_REQUIRED", "Schedule change requested"

    challenge = models.OneToOneField(TeamChallenge, on_delete=models.PROTECT, related_name="fixture")
    booking = models.OneToOneField(Booking, on_delete=models.PROTECT, related_name="team_fixture", blank=True, null=True)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.AWAITING_COURT)
    result = models.CharField(max_length=200, blank=True)
    result_submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="submitted_team_fixture_results",
        blank=True,
        null=True,
    )
    result_submitted_at = models.DateTimeField(blank=True, null=True)
    result_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="confirmed_team_fixture_results",
        blank=True,
        null=True,
    )
    result_confirmed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Fixture for challenge {self.challenge_id}"


class TeamFixtureChatMessage(models.Model):
    """Durable, private conversation messages for one team fixture."""

    fixture = models.ForeignKey(TeamFixture, on_delete=models.CASCADE, related_name="chat_messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="team_fixture_chat_messages",
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
                fields=["fixture", "sender", "client_message_id"],
                condition=Q(client_message_id__gt=""),
                name="unique_fixture_chat_client_message",
            ),
        ]
        indexes = [
            models.Index(fields=["fixture", "-created_at", "-id"], name="fixture_chat_history_idx"),
        ]

    def __str__(self):
        return f"{self.fixture_id} - {self.sender_name} - {self.created_at.isoformat()}"


class TeamFixtureParticipant(models.Model):
    class Status(models.TextChoices):
        SELECTED = "SELECTED", "Selected"
        ATTENDED = "ATTENDED", "Attended"
        ABSENT = "ABSENT", "Absent"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"

    fixture = models.ForeignKey(TeamFixture, on_delete=models.CASCADE, related_name="participants")
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="fixture_participants")
    player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="team_fixture_participations",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SELECTED)
    selected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="selected_team_fixture_players",
    )
    attendance_recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="recorded_team_fixture_attendance",
        blank=True,
        null=True,
    )
    attendance_recorded_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["team_id", "created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["fixture", "player"], name="unique_fixture_player"),
        ]

    def clean(self):
        if self.player_id and self.player.role != "PLAYER":
            raise ValidationError("Only player accounts can be selected for a team fixture.")
        challenge = self.fixture.challenge if self.fixture_id else None
        if not challenge or self.team_id not in {challenge.challenger_team_id, challenge.challenged_team_id}:
            raise ValidationError("Select a player from one of the teams in this match.")
        if not TeamMember.objects.filter(
            team_id=self.team_id,
            user_id=self.player_id,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).exists():
            raise ValidationError("The selected player is not an active member of that team.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)
