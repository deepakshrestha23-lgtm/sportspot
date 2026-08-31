from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Max
from django.utils import timezone

MIN_RELIABILITY_HISTORY = 5


class PlayerProfile(models.Model):
    class PreferredSport(models.TextChoices):
        CRICKSAL = "CRICKSAL", "Cricksal"
        FUTSAL = "FUTSAL", "Futsal"

    class SkillLevel(models.TextChoices):
        BEGINNER = "BEGINNER", "Beginner"
        INTERMEDIATE = "INTERMEDIATE", "Intermediate"
        ADVANCED = "ADVANCED", "Advanced"

    class CricksalRole(models.TextChoices):
        BATSMAN = "BATSMAN", "Batsman"
        BOWLER = "BOWLER", "Bowler"
        ALL_ROUNDER = "ALL_ROUNDER", "All-rounder"
        WICKETKEEPER = "WICKETKEEPER", "Wicketkeeper"
        NONE = "NONE", "None"

    class FutsalRole(models.TextChoices):
        GOALKEEPER = "GOALKEEPER", "Goalkeeper"
        DEFENDER = "DEFENDER", "Defender"
        WINGER = "WINGER", "Winger"
        STRIKER = "STRIKER", "Striker"
        ANY = "ANY", "Any"
        NONE = "NONE", "None"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="player_profile")
    sportspot_id = models.CharField(max_length=20, unique=True, editable=False)
    profile_photo = models.FileField(
        upload_to="player_profiles/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    preferred_sport = models.CharField(
        max_length=20,
        choices=PreferredSport.choices,
        default=PreferredSport.CRICKSAL,
    )
    skill_level = models.CharField(max_length=20, choices=SkillLevel.choices)
    location = models.CharField(max_length=120)
    weekly_availability = models.TextField(blank=True)
    availability_days = models.JSONField(default=list, blank=True)
    availability_time_periods = models.JSONField(default=list, blank=True)
    playing_style = models.TextField(blank=True)
    bio = models.TextField(blank=True, max_length=500)
    preferred_cricksal_role = models.CharField(
        max_length=20,
        choices=CricksalRole.choices,
        default=CricksalRole.NONE,
    )
    preferred_futsal_role = models.CharField(
        max_length=20,
        choices=FutsalRole.choices,
        default=FutsalRole.NONE,
    )
    reliability_score = models.PositiveSmallIntegerField(default=100)
    average_rating = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    no_show_count = models.PositiveIntegerField(default=0)
    late_cancellation_count = models.PositiveIntegerField(default=0)
    completed_matches_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        if self.user_id and self.user.role != "PLAYER":
            raise ValidationError("Only users with the PLAYER role can have a PlayerProfile.")

    def save(self, *args, **kwargs):
        if not self.sportspot_id:
            self.sportspot_id = self.generate_sportspot_id()
        self.clean()
        super().save(*args, **kwargs)

    @classmethod
    def generate_sportspot_id(cls):
        last_id = cls.objects.aggregate(max_id=Max("id"))["max_id"] or 0
        next_number = 10000 + last_id + 1
        sportspot_id = f"SSP-{next_number}"

        while cls.objects.filter(sportspot_id=sportspot_id).exists():
            next_number += 1
            sportspot_id = f"SSP-{next_number}"

        return sportspot_id

    @property
    def profile_completion_percentage(self):
        required_values = [
            self.preferred_sport,
            self.skill_level,
            self.location,
            self.availability_days or self.weekly_availability,
            self.availability_time_periods or self.weekly_availability,
            self.playing_style,
        ]

        required_values.append(
            self.preferred_cricksal_role
            if self.preferred_cricksal_role != self.CricksalRole.NONE
            else ""
        )

        filled_count = sum(1 for value in required_values if str(value).strip())
        return round((filled_count / len(required_values)) * 100)

    @property
    def is_profile_complete(self):
        return self.profile_completion_percentage == 100

    @property
    def reliability_label(self):
        commitments = self.user.participation_commitments
        accountable_commitments = commitments.filter(
            status__in=[
                "ATTENDED",
                "LATE_CANCELLED",
                "FINALIZED_NO_SHOW",
            ]
        ).count()
        history_count = (
            accountable_commitments
            if commitments.exists()
            else self.completed_matches_count
        )
        if history_count < MIN_RELIABILITY_HISTORY:
            return "Provisional Reliability"
        return f"{self.reliability_score}/100"

    def __str__(self):
        return f"{self.user.full_name} ({self.sportspot_id})"

class ReliabilityEvent(models.Model):
    class EventType(models.TextChoices):
        GAME_COMPLETED_ATTENDED = "GAME_COMPLETED_ATTENDED", "Game Completed - Attended"
        GAME_LATE_CANCELLATION = "GAME_LATE_CANCELLATION", "Game Late Cancellation"
        GAME_NO_SHOW = "GAME_NO_SHOW", "Game No-Show"
        GAME_WITHDRAWAL_ON_TIME = "GAME_WITHDRAWAL_ON_TIME", "Game Withdrawal On Time"
        GAME_CANCELLED_BY_OTHER_PARTY = "GAME_CANCELLED_BY_OTHER_PARTY", "Game Cancelled By Other Party"
        MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT", "Manual Adjustment"

    class Impact(models.TextChoices):
        POSITIVE = "POSITIVE", "Positive"
        NEGATIVE = "NEGATIVE", "Negative"
        NO_IMPACT = "NO_IMPACT", "No Impact"
        NEUTRAL = "NEUTRAL", "Neutral"

    player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reliability_events",
    )
    event_type = models.CharField(max_length=40, choices=EventType.choices)
    impact = models.CharField(max_length=20, choices=Impact.choices, default=Impact.NEUTRAL)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    points_delta = models.SmallIntegerField(default=0)
    related_entity_type = models.CharField(max_length=60, blank=True)
    related_entity_id = models.PositiveIntegerField(blank=True, null=True)
    dedupe_key = models.CharField(max_length=160, unique=True, blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="created_reliability_events",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["player", "-occurred_at"]),
            models.Index(fields=["event_type", "related_entity_type", "related_entity_id"]),
        ]

    def clean(self):
        if self.player_id and self.player.role != "PLAYER":
            raise ValidationError("Only player accounts can have reliability events.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.player.email} - {self.event_type}"


class ParticipationCommitment(models.Model):
    """The auditable attendance lifecycle for one registered player.

    Roster membership and reliability are deliberately separate.  A commitment
    is created only after a registered player has a confirmed game schedule;
    guests, pending requests, waitlisted players, and pre-booking plan-first
    participants never enter this ledger.
    """

    class SourceType(models.TextChoices):
        MATCHMAKING_GAME = "MATCHMAKING_GAME", "Matchmaking game"
        TEAM_FIXTURE = "TEAM_FIXTURE", "Team fixture"

    class Status(models.TextChoices):
        COMMITTED = "COMMITTED", "Committed"
        CANCELLED_EARLY = "CANCELLED_EARLY", "Cancelled early"
        LATE_CANCELLED = "LATE_CANCELLED", "Cancelled late"
        ATTENDANCE_PENDING = "ATTENDANCE_PENDING", "Attendance pending"
        ATTENDED = "ATTENDED", "Attended"
        NO_SHOW_REPORTED = "NO_SHOW_REPORTED", "No-show reported"
        FINALIZED_NO_SHOW = "FINALIZED_NO_SHOW", "Finalized no-show"
        DISPUTED = "DISPUTED", "Disputed"
        UNVERIFIED = "UNVERIFIED", "Attendance unverified"
        EXCUSED = "EXCUSED", "Excused"
        VOID = "VOID", "Voided"

    player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="participation_commitments",
    )
    source_type = models.CharField(max_length=30, choices=SourceType.choices)
    source_id = models.PositiveBigIntegerField()
    source_participant_id = models.PositiveBigIntegerField()
    source_version = models.PositiveSmallIntegerField(default=1)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    late_cutoff_at = models.DateTimeField()
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.COMMITTED)
    attendance_recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="recorded_participation_attendance",
        blank=True,
        null=True,
    )
    attendance_recorded_at = models.DateTimeField(blank=True, null=True)
    review_deadline_at = models.DateTimeField(blank=True, null=True)
    disputed_at = models.DateTimeField(blank=True, null=True)
    dispute_reason = models.CharField(max_length=500, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="resolved_participation_disputes",
        blank=True,
        null=True,
    )
    resolved_at = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["player", "source_type", "source_id", "source_version"],
                name="unique_participation_commitment_version",
            ),
        ]
        indexes = [
            models.Index(fields=["source_type", "source_id", "status"]),
            models.Index(fields=["player", "status", "-start_at"]),
            models.Index(fields=["status", "review_deadline_at"]),
        ]

    def clean(self):
        if self.player_id and self.player.role != "PLAYER":
            raise ValidationError("Only player accounts can have participation commitments.")
        if self.end_at <= self.start_at:
            raise ValidationError("A participation commitment must have a valid time window.")
        if self.late_cutoff_at >= self.start_at:
            raise ValidationError("The late-cancellation cutoff must be before the game starts.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    @property
    def is_resolved(self):
        return self.status in {
            self.Status.CANCELLED_EARLY,
            self.Status.LATE_CANCELLED,
            self.Status.ATTENDED,
            self.Status.FINALIZED_NO_SHOW,
            self.Status.UNVERIFIED,
            self.Status.EXCUSED,
            self.Status.VOID,
        }

    def __str__(self):
        return f"{self.player.email} - {self.source_type} {self.source_id} v{self.source_version}"


class ParticipationAttendanceEvent(models.Model):
    """Immutable audit trail for every attendance decision or resolution."""

    class EventType(models.TextChoices):
        ATTENDANCE_RECORDED = "ATTENDANCE_RECORDED", "Attendance recorded"
        NO_SHOW_REPORTED = "NO_SHOW_REPORTED", "No-show reported"
        ATTENDANCE_DISPUTED = "ATTENDANCE_DISPUTED", "Attendance disputed"
        NO_SHOW_FINALIZED = "NO_SHOW_FINALIZED", "No-show finalized"
        ATTENDANCE_UNVERIFIED = "ATTENDANCE_UNVERIFIED", "Attendance left unverified"
        DISPUTE_RESOLVED = "DISPUTE_RESOLVED", "Attendance dispute resolved"
        COMMITMENT_CANCELLED = "COMMITMENT_CANCELLED", "Commitment cancelled"
        COMMITMENT_VOIDED = "COMMITMENT_VOIDED", "Commitment voided"
        COMMITMENT_EXCUSED = "COMMITMENT_EXCUSED", "Commitment excused"

    commitment = models.ForeignKey(
        ParticipationCommitment,
        on_delete=models.CASCADE,
        related_name="attendance_events",
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="recorded_attendance_events",
        blank=True,
        null=True,
    )
    previous_status = models.CharField(max_length=24, blank=True)
    current_status = models.CharField(max_length=24)
    reason = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["commitment", "created_at"]),
            models.Index(fields=["event_type", "created_at"]),
        ]

    def __str__(self):
        return f"{self.commitment_id} - {self.event_type}"

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise ValidationError("Attendance audit events are immutable.")
        super().save(*args, **kwargs)


class PlayerRating(models.Model):
    ALLOWED_FEEDBACK_TAGS = {
        "PUNCTUAL",
        "RESPECTFUL",
        "TEAM_PLAYER",
        "GOOD_COMMUNICATION",
        "RELIABLE",
        "SPORTSMANLIKE",
    }

    rater = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ratings_given",
    )
    rated_player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ratings_received",
    )
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    feedback_tags = models.JSONField(default=list, blank=True)
    comment = models.TextField(blank=True, max_length=500)
    related_entity_type = models.CharField(max_length=60)
    related_entity_id = models.PositiveIntegerField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["rater", "rated_player", "related_entity_type", "related_entity_id"],
                name="unique_player_rating_per_context",
            )
        ]
        indexes = [
            models.Index(fields=["rated_player", "-created_at"]),
            models.Index(fields=["related_entity_type", "related_entity_id"]),
        ]

    def clean(self):
        if self.rater_id and self.rater.role != "PLAYER":
            raise ValidationError("Only player accounts can submit ratings.")
        if self.rated_player_id and self.rated_player.role != "PLAYER":
            raise ValidationError("Only player accounts can receive ratings.")
        if self.rater_id and self.rated_player_id and self.rater_id == self.rated_player_id:
            raise ValidationError("Players cannot rate themselves.")
        if self.rating < 1 or self.rating > 5:
            raise ValidationError("Rating must be between 1 and 5.")
        if not self.related_entity_type or not self.related_entity_id:
            raise ValidationError("Ratings must be linked to a verified completed game or match.")
        if not isinstance(self.feedback_tags, list):
            raise ValidationError("Feedback tags must be a list.")
        invalid_tags = set(self.feedback_tags) - self.ALLOWED_FEEDBACK_TAGS
        if invalid_tags:
            raise ValidationError("Choose valid feedback tags.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.rated_player.email} rated {self.rating}/5"

class PlayerRatingEligibility(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SUBMITTED = "SUBMITTED", "Submitted"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"

    rater = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="rating_eligibilities",
    )
    rated_player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="rating_requests_received",
    )
    title = models.CharField(max_length=160)
    related_entity_type = models.CharField(max_length=60)
    related_entity_id = models.PositiveIntegerField()
    match_date = models.DateTimeField(blank=True, null=True)
    deadline_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    submitted_rating = models.ForeignKey(
        PlayerRating,
        on_delete=models.SET_NULL,
        related_name="eligibility_records",
        blank=True,
        null=True,
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["rater", "rated_player", "related_entity_type", "related_entity_id"],
                name="unique_rating_eligibility_per_context",
            )
        ]
        indexes = [
            models.Index(fields=["rater", "status", "-created_at"]),
            models.Index(fields=["related_entity_type", "related_entity_id"]),
        ]

    def clean(self):
        if self.rater_id and self.rater.role != "PLAYER":
            raise ValidationError("Only player accounts can receive rating requests.")
        if self.rated_player_id and self.rated_player.role != "PLAYER":
            raise ValidationError("Only player accounts can be rated.")
        if self.rater_id and self.rated_player_id and self.rater_id == self.rated_player_id:
            raise ValidationError("Players cannot rate themselves.")
        if not self.related_entity_type or not self.related_entity_id:
            raise ValidationError("Rating eligibility must be linked to a completed game or match.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.rater.email} -> {self.rated_player.email} ({self.status})"
