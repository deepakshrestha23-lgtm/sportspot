from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone


class Team(models.Model):
    class SkillLevel(models.TextChoices):
        BEGINNER = "BEGINNER", "Beginner"
        INTERMEDIATE = "INTERMEDIATE", "Intermediate"
        ADVANCED = "ADVANCED", "Advanced"

    name = models.CharField(max_length=100)
    team_photo = models.FileField(
        upload_to="team_photos/",
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png"])],
    )
    description = models.TextField(blank=True)
    location = models.CharField(max_length=120)
    preferred_playing_area = models.CharField(max_length=150)
    preferred_playing_time = models.CharField(max_length=120)
    skill_level = models.CharField(max_length=20, choices=SkillLevel.choices)
    accepts_team_challenges = models.BooleanField(default=True)
    captain = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="captain_teams")
    team_reliability_score = models.PositiveSmallIntegerField(default=100)
    average_rating = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    matches_played_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        if self.captain_id and self.captain.role != "PLAYER":
            raise ValidationError("Only player accounts can captain teams.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    @property
    def active_members_count(self):
        return self.members.filter(status=TeamMember.MemberStatus.ACTIVE).count()

    def __str__(self):
        return self.name


class TeamMember(models.Model):
    class MemberType(models.TextChoices):
        REGISTERED = "REGISTERED", "Registered"
        GUEST = "GUEST", "Guest"

    class TeamRole(models.TextChoices):
        CAPTAIN = "CAPTAIN", "Captain"
        PLAYER = "PLAYER", "Player"
        GUEST = "GUEST", "Guest"

    class CricksalRole(models.TextChoices):
        BATSMAN = "BATSMAN", "Batsman"
        BOWLER = "BOWLER", "Bowler"
        ALL_ROUNDER = "ALL_ROUNDER", "All-rounder"
        WICKETKEEPER = "WICKETKEEPER", "Wicketkeeper"
        NONE = "NONE", "None"

    class MemberStatus(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INVITED = "INVITED", "Invited"
        REJECTED = "REJECTED", "Rejected"
        LEFT = "LEFT", "Left"
        REMOVED = "REMOVED", "Removed"

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="team_memberships",
        blank=True,
        null=True,
    )
    guest_name = models.CharField(max_length=100, blank=True)
    guest_phone = models.CharField(max_length=20, blank=True)
    member_type = models.CharField(max_length=20, choices=MemberType.choices, default=MemberType.REGISTERED)
    role_in_team = models.CharField(max_length=20, choices=TeamRole.choices, default=TeamRole.PLAYER)
    cricksal_role = models.CharField(max_length=20, choices=CricksalRole.choices, default=CricksalRole.NONE)
    status = models.CharField(max_length=20, choices=MemberStatus.choices, default=MemberStatus.ACTIVE)
    joined_at = models.DateTimeField(blank=True, null=True)
    invited_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["joined_at"]

    def clean(self):
        if self.user_id and self.guest_name:
            raise ValidationError("A team member cannot be both a registered user and a guest.")
        if not self.user_id and not self.guest_name:
            raise ValidationError("Guest name is required when no registered user is selected.")
        if self.member_type == self.MemberType.GUEST and self.user_id:
            raise ValidationError("Guest members should not be linked to a registered user.")
        if self.member_type == self.MemberType.REGISTERED and not self.user_id:
            raise ValidationError("Registered team members require a user account.")
        if self.member_type == self.MemberType.GUEST and self.role_in_team != self.TeamRole.GUEST:
            raise ValidationError("Guest members must use the GUEST team role.")
        if self.member_type == self.MemberType.REGISTERED and self.role_in_team == self.TeamRole.GUEST:
            raise ValidationError("Registered members cannot use the GUEST team role.")
        if self.user_id and self.user.role != "PLAYER":
            raise ValidationError("Only player accounts can be registered team members.")

    def save(self, *args, **kwargs):
        if self.status == self.MemberStatus.ACTIVE and not self.joined_at:
            self.joined_at = timezone.now()
        if self.status == self.MemberStatus.INVITED and not self.invited_at:
            self.invited_at = timezone.now()
        self.clean()
        super().save(*args, **kwargs)

    @property
    def display_name(self):
        if self.user_id:
            return self.user.full_name
        return self.guest_name

    def __str__(self):
        return f"{self.display_name} - {self.team.name}"
