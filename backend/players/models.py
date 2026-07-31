from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models
from django.db.models import Max


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
    playing_style = models.TextField(blank=True)
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
            self.weekly_availability,
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
        if self.completed_matches_count < 3:
            return "Provisional Reliability"
        return f"{self.reliability_score}/100"

    def __str__(self):
        return f"{self.user.full_name} ({self.sportspot_id})"
