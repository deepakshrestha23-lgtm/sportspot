from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from team_challenges.models import TeamFixture, TeamFixtureParticipant
from teams.models import Team


class ScoringMatchRequest(models.Model):
    """A private, captain-to-captain request to start an unscheduled scorecard."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        DECLINED = "DECLINED", "Declined"
        CANCELLED = "CANCELLED", "Cancelled"

    challenger_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="sent_scoring_match_requests")
    challenged_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="received_scoring_match_requests")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requested_scoring_matches",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    fixture = models.OneToOneField(
        TeamFixture,
        on_delete=models.PROTECT,
        related_name="instant_scoring_request",
        blank=True,
        null=True,
    )
    client_request_id = models.CharField(max_length=64, blank=True)
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="responded_scoring_match_requests",
        blank=True,
        null=True,
    )
    responded_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["challenger_team", "challenged_team"],
                condition=Q(status="PENDING"),
                name="unique_pending_scoring_request_direction",
            ),
            models.UniqueConstraint(
                fields=["requested_by", "client_request_id"],
                condition=Q(client_request_id__gt=""),
                name="unique_scoring_request_client_id",
            ),
        ]
        indexes = [
            models.Index(fields=["challenged_team", "status", "-created_at"]),
            models.Index(fields=["challenger_team", "status", "-created_at"]),
        ]

    def clean(self):
        if self.challenger_team_id == self.challenged_team_id:
            raise ValidationError("Choose a different opponent team.")
        if self.requested_by_id and self.requested_by.role != "PLAYER":
            raise ValidationError("Only player accounts can request a scored match.")
        if self.status == self.Status.ACCEPTED and not self.fixture_id:
            raise ValidationError("An accepted scoring request must create a match fixture.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


class CricketMatch(models.Model):
    """The durable scorer session for one confirmed SportSpot team fixture."""

    class Status(models.TextChoices):
        SETUP = "SETUP", "Lineups and toss"
        INNINGS_ONE = "INNINGS_ONE", "First innings"
        INNINGS_BREAK = "INNINGS_BREAK", "Innings break"
        INNINGS_TWO = "INNINGS_TWO", "Second innings"
        COMPLETED = "COMPLETED", "Completed"

    class TossDecision(models.TextChoices):
        BAT = "BAT", "Bat"
        BOWL = "BOWL", "Bowl"

    fixture = models.OneToOneField(
        TeamFixture,
        on_delete=models.PROTECT,
        related_name="cricket_match",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SETUP)
    overs_per_innings = models.PositiveSmallIntegerField(
        default=6,
        validators=[MinValueValidator(1), MaxValueValidator(50)],
    )
    toss_winner = models.ForeignKey(
        Team,
        on_delete=models.PROTECT,
        related_name="won_cricket_tosses",
        blank=True,
        null=True,
    )
    toss_decision = models.CharField(max_length=8, choices=TossDecision.choices, blank=True)
    first_batting_team = models.ForeignKey(
        Team,
        on_delete=models.PROTECT,
        related_name="first_batting_cricket_matches",
        blank=True,
        null=True,
    )
    second_batting_team = models.ForeignKey(
        Team,
        on_delete=models.PROTECT,
        related_name="second_batting_cricket_matches",
        blank=True,
        null=True,
    )
    scorer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="assigned_cricket_matches",
        blank=True,
        null=True,
    )
    challenger_squad_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="confirmed_challenger_cricket_squads",
        blank=True,
        null=True,
    )
    challenger_squad_confirmed_at = models.DateTimeField(blank=True, null=True)
    challenged_squad_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="confirmed_challenged_cricket_squads",
        blank=True,
        null=True,
    )
    challenged_squad_confirmed_at = models.DateTimeField(blank=True, null=True)
    result = models.CharField(max_length=200, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="completed_cricket_matches",
        blank=True,
        null=True,
    )
    completed_at = models.DateTimeField(blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_cricket_matches",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def clean(self):
        if not self.fixture_id:
            return
        team_ids = {
            self.fixture.challenge.challenger_team_id,
            self.fixture.challenge.challenged_team_id,
        }
        for field in ("toss_winner_id", "first_batting_team_id", "second_batting_team_id"):
            value = getattr(self, field)
            if value and value not in team_ids:
                raise ValidationError("Cricket match teams must belong to the confirmed fixture.")
        if self.first_batting_team_id and self.second_batting_team_id == self.first_batting_team_id:
            raise ValidationError("The same team cannot bat in both innings.")
        if bool(self.toss_winner_id) != bool(self.toss_decision):
            raise ValidationError("Record both the toss winner and the toss decision together.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Cricket scorecard for fixture {self.fixture_id}"


class CricketPlayerPerformance(models.Model):
    """Finalized cricket statistics for one actual participant in one scorecard.

    These records are intentionally separate from peer ratings and reliability.
    """

    match = models.ForeignKey(CricketMatch, on_delete=models.CASCADE, related_name="player_performances")
    player = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="cricket_performances")
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="cricket_player_performances")
    runs = models.PositiveSmallIntegerField(default=0)
    balls_faced = models.PositiveSmallIntegerField(default=0)
    fours = models.PositiveSmallIntegerField(default=0)
    sixes = models.PositiveSmallIntegerField(default=0)
    balls_bowled = models.PositiveSmallIntegerField(default=0)
    runs_conceded = models.PositiveSmallIntegerField(default=0)
    wickets = models.PositiveSmallIntegerField(default=0)
    wides = models.PositiveSmallIntegerField(default=0)
    no_balls = models.PositiveSmallIntegerField(default=0)
    catches = models.PositiveSmallIntegerField(default=0)
    run_outs = models.PositiveSmallIntegerField(default=0)
    stumpings = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-match__completed_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["match", "player"], name="unique_cricket_performance_per_match")]
        indexes = [models.Index(fields=["player", "-updated_at"]), models.Index(fields=["team", "-updated_at"])]

    def clean(self):
        if self.player_id and self.player.role != "PLAYER":
            raise ValidationError("Only player accounts can have cricket performances.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)


class CricketSquadPlayer(models.Model):
    """A frozen, match-only lineup snapshot; it never changes permanent teams."""

    match = models.ForeignKey(CricketMatch, on_delete=models.CASCADE, related_name="squad_players")
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="cricket_squad_players")
    player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cricket_squad_appearances",
    )
    fixture_participant = models.OneToOneField(
        TeamFixtureParticipant,
        on_delete=models.PROTECT,
        related_name="cricket_squad_entry",
    )
    display_name = models.CharField(max_length=120)
    batting_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["team_id", "batting_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["match", "player"], name="unique_cricket_match_squad_player"),
            models.UniqueConstraint(fields=["match", "team", "batting_order"], name="unique_cricket_team_batting_order"),
        ]

    def clean(self):
        if self.fixture_participant_id:
            participant = self.fixture_participant
            if participant.fixture_id != self.match.fixture_id:
                raise ValidationError("Select players from this fixture only.")
            if participant.team_id != self.team_id or participant.player_id != self.player_id:
                raise ValidationError("The selected player does not match the fixture lineup.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.display_name} in cricket match {self.match_id}"


class CricketInnings(models.Model):
    class Status(models.TextChoices):
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"

    class ClosingReason(models.TextChoices):
        ALL_OUT = "ALL_OUT", "All out"
        OVERS_COMPLETE = "OVERS_COMPLETE", "Overs complete"
        TARGET_REACHED = "TARGET_REACHED", "Target reached"

    match = models.ForeignKey(CricketMatch, on_delete=models.CASCADE, related_name="innings")
    number = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(2)])
    batting_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="cricket_batting_innings")
    bowling_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="cricket_bowling_innings")
    target_runs = models.PositiveSmallIntegerField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    closing_reason = models.CharField(max_length=20, choices=ClosingReason.choices, blank=True)
    opening_striker = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="opened_as_striker",
    )
    opening_non_striker = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="opened_as_non_striker",
    )
    opening_bowler = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="opened_bowling",
    )
    current_striker = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="currently_striking",
        blank=True,
        null=True,
    )
    current_non_striker = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="currently_non_striking",
        blank=True,
        null=True,
    )
    current_bowler = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="currently_bowling",
        blank=True,
        null=True,
    )
    total_runs = models.PositiveSmallIntegerField(default=0)
    wickets = models.PositiveSmallIntegerField(default=0)
    legal_balls = models.PositiveSmallIntegerField(default=0)
    wide_runs = models.PositiveSmallIntegerField(default=0)
    no_ball_runs = models.PositiveSmallIntegerField(default=0)
    bye_runs = models.PositiveSmallIntegerField(default=0)
    leg_bye_runs = models.PositiveSmallIntegerField(default=0)
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["number"]
        constraints = [models.UniqueConstraint(fields=["match", "number"], name="unique_cricket_match_innings_number")]

    def clean(self):
        if self.batting_team_id == self.bowling_team_id:
            raise ValidationError("Batting and bowling teams must be different.")
        if self.number == 2 and not self.target_runs:
            raise ValidationError("The second innings needs a target.")
        if self.opening_striker_id == self.opening_non_striker_id:
            raise ValidationError("Choose two different opening batters.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.match_id} innings {self.number}"


class CricketDelivery(models.Model):
    class ExtraType(models.TextChoices):
        NONE = "NONE", "No extra"
        WIDE = "WIDE", "Wide"
        NO_BALL = "NO_BALL", "No ball"
        BYE = "BYE", "Bye"
        LEG_BYE = "LEG_BYE", "Leg bye"

    class WicketKind(models.TextChoices):
        NONE = "NONE", "No wicket"
        BOWLED = "BOWLED", "Bowled"
        CAUGHT = "CAUGHT", "Caught"
        LBW = "LBW", "LBW"
        RUN_OUT = "RUN_OUT", "Run out"
        STUMPED = "STUMPED", "Stumped"
        HIT_WICKET = "HIT_WICKET", "Hit wicket"

    innings = models.ForeignKey(CricketInnings, on_delete=models.CASCADE, related_name="deliveries")
    sequence = models.PositiveIntegerField()
    striker = models.ForeignKey(CricketSquadPlayer, on_delete=models.PROTECT, related_name="faced_cricket_deliveries")
    non_striker = models.ForeignKey(CricketSquadPlayer, on_delete=models.PROTECT, related_name="non_striker_cricket_deliveries")
    bowler = models.ForeignKey(CricketSquadPlayer, on_delete=models.PROTECT, related_name="bowled_cricket_deliveries")
    runs_off_bat = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(6)])
    extra_type = models.CharField(max_length=12, choices=ExtraType.choices, default=ExtraType.NONE)
    extra_runs = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(7)])
    wicket_kind = models.CharField(max_length=16, choices=WicketKind.choices, default=WicketKind.NONE)
    dismissed_player = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="cricket_dismissals",
        blank=True,
        null=True,
    )
    fielder = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="cricket_fielding_events",
        blank=True,
        null=True,
    )
    incoming_batsman = models.ForeignKey(
        CricketSquadPlayer,
        on_delete=models.PROTECT,
        related_name="entered_cricket_innings",
        blank=True,
        null=True,
    )
    is_active = models.BooleanField(default=True)
    voided_at = models.DateTimeField(blank=True, null=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="voided_cricket_deliveries",
        blank=True,
        null=True,
    )
    supersedes = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="revisions",
        blank=True,
        null=True,
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="recorded_cricket_deliveries")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence", "id"]
        constraints = [models.UniqueConstraint(fields=["innings", "sequence"], name="unique_cricket_innings_delivery_sequence")]
        indexes = [models.Index(fields=["innings", "is_active", "sequence"])]

    @property
    def is_legal(self):
        return self.extra_type not in {self.ExtraType.WIDE, self.ExtraType.NO_BALL}

    def clean(self):
        if self.striker_id == self.non_striker_id:
            raise ValidationError("A delivery needs two different batters.")
        if self.extra_type == self.ExtraType.NONE and self.extra_runs:
            raise ValidationError("A normal delivery cannot include extra runs.")
        if self.extra_type in {self.ExtraType.WIDE, self.ExtraType.NO_BALL, self.ExtraType.BYE, self.ExtraType.LEG_BYE} and not self.extra_runs:
            raise ValidationError("Record the runs for this extra.")
        if self.extra_type in {self.ExtraType.WIDE, self.ExtraType.BYE, self.ExtraType.LEG_BYE} and self.runs_off_bat:
            raise ValidationError("Only a no ball can include both bat runs and extras in this scorer.")
        if self.wicket_kind == self.WicketKind.NONE:
            if self.dismissed_player_id or self.fielder_id or self.incoming_batsman_id:
                raise ValidationError("Wicket details require a wicket type.")
        elif not self.dismissed_player_id:
            raise ValidationError("Choose the dismissed batter.")

    def __str__(self):
        return f"{self.innings_id} delivery {self.sequence}"
