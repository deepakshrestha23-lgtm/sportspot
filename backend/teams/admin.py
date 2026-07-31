from django.contrib import admin

from .models import Team, TeamMember


class TeamMemberInline(admin.TabularInline):
    model = TeamMember
    extra = 0
    readonly_fields = ("joined_at",)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("name", "location", "skill_level", "captain", "team_reliability_score", "matches_played_count", "created_at")
    list_filter = ("skill_level", "location")
    search_fields = ("name", "captain__full_name", "captain__email", "location")
    readonly_fields = ("team_reliability_score", "average_rating", "matches_played_count", "created_at", "updated_at")
    inlines = [TeamMemberInline]


@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ("display_name", "team", "member_type", "role_in_team", "cricksal_role", "status", "joined_at", "invited_at")
    list_filter = ("member_type", "role_in_team", "cricksal_role", "status")
    search_fields = ("team__name", "user__full_name", "user__email", "guest_name", "guest_phone")
    readonly_fields = ("joined_at", "invited_at")
