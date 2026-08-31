from django.contrib import admin

from .models import (
    ParticipationAttendanceEvent,
    ParticipationCommitment,
    PlayerProfile,
    PlayerRating,
    PlayerRatingEligibility,
    ReliabilityEvent,
)


@admin.register(PlayerProfile)
class PlayerProfileAdmin(admin.ModelAdmin):
    list_display = (
        "sportspot_id",
        "user",
        "preferred_sport",
        "skill_level",
        "location",
        "reliability_score",
        "completed_matches_count",
        "created_at",
    )
    list_filter = ("preferred_sport", "skill_level", "location")
    search_fields = ("sportspot_id", "user__full_name", "user__email", "location")
    readonly_fields = (
        "sportspot_id",
        "reliability_score",
        "average_rating",
        "no_show_count",
        "late_cancellation_count",
        "completed_matches_count",
        "created_at",
        "updated_at",
    )

@admin.register(ReliabilityEvent)
class ReliabilityEventAdmin(admin.ModelAdmin):
    list_display = (
        "player",
        "event_type",
        "impact",
        "points_delta",
        "related_entity_type",
        "related_entity_id",
        "occurred_at",
    )
    list_filter = ("event_type", "impact", "related_entity_type", "occurred_at")
    search_fields = ("player__full_name", "player__email", "title", "description", "dedupe_key")
    readonly_fields = ("created_at",)


@admin.register(ParticipationCommitment)
class ParticipationCommitmentAdmin(admin.ModelAdmin):
    list_display = (
        "player",
        "source_type",
        "source_id",
        "source_version",
        "status",
        "start_at",
        "review_deadline_at",
    )
    list_filter = ("source_type", "status", "start_at", "review_deadline_at")
    search_fields = ("player__full_name", "player__email", "dispute_reason")
    readonly_fields = ("created_at", "updated_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ParticipationAttendanceEvent)
class ParticipationAttendanceEventAdmin(admin.ModelAdmin):
    list_display = (
        "commitment",
        "event_type",
        "previous_status",
        "current_status",
        "actor",
        "created_at",
    )
    list_filter = ("event_type", "current_status", "created_at")
    search_fields = ("commitment__player__full_name", "commitment__player__email", "reason")
    readonly_fields = (
        "commitment",
        "event_type",
        "previous_status",
        "current_status",
        "actor",
        "reason",
        "metadata",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

@admin.register(PlayerRating)
class PlayerRatingAdmin(admin.ModelAdmin):
    list_display = (
        "rated_player",
        "rater",
        "rating",
        "related_entity_type",
        "related_entity_id",
        "created_at",
    )
    list_filter = ("rating", "related_entity_type", "created_at")
    search_fields = ("rated_player__full_name", "rated_player__email", "rater__full_name", "rater__email", "comment")
    readonly_fields = ("created_at", "updated_at")

@admin.register(PlayerRatingEligibility)
class PlayerRatingEligibilityAdmin(admin.ModelAdmin):
    list_display = (
        "rater",
        "rated_player",
        "title",
        "status",
        "related_entity_type",
        "related_entity_id",
        "deadline_at",
        "created_at",
    )
    list_filter = ("status", "related_entity_type", "created_at", "deadline_at")
    search_fields = ("rater__full_name", "rater__email", "rated_player__full_name", "rated_player__email", "title")
    readonly_fields = ("created_at", "updated_at")
