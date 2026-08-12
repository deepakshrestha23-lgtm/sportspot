from django.contrib import admin

from .models import Game, GameParticipant, GameRoleRequirement, JoinRequest


class GameRoleRequirementInline(admin.TabularInline):
    model = GameRoleRequirement
    extra = 0


class GameParticipantInline(admin.TabularInline):
    model = GameParticipant
    extra = 0


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("title", "creation_mode", "game_intensity", "status", "host", "booking", "proposed_date", "published_at")
    list_filter = ("game_type", "creation_mode", "game_intensity", "status", "is_public")
    search_fields = ("title", "host__email", "host__full_name", "booking__booking_code", "booking__venue__name", "preferred_area")
    readonly_fields = ("published_at", "created_at", "updated_at", "booking_attached_at")
    inlines = [GameRoleRequirementInline, GameParticipantInline]


@admin.register(JoinRequest)
class JoinRequestAdmin(admin.ModelAdmin):
    list_display = ("game", "player", "requested_role", "status", "waitlist_position", "created_at")
    list_filter = ("status", "requested_role")
    search_fields = ("game__title", "player__email", "player__full_name")
