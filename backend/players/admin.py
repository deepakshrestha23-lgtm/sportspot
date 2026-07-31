from django.contrib import admin

from .models import PlayerProfile


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
