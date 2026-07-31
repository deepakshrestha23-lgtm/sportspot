from rest_framework import serializers

from players.models import PlayerProfile
from .models import Team, TeamMember


class TeamMemberSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    display_name = serializers.CharField(read_only=True)
    is_guest = serializers.SerializerMethodField()
    sportspot_id = serializers.SerializerMethodField()
    skill_level = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    profile_photo = serializers.SerializerMethodField()
    weekly_availability = serializers.SerializerMethodField()
    playing_style = serializers.SerializerMethodField()
    reliability_score = serializers.SerializerMethodField()
    reliability_label = serializers.SerializerMethodField()
    completed_matches_count = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()

    class Meta:
        model = TeamMember
        fields = (
            "id",
            "user",
            "full_name",
            "display_name",
            "is_guest",
            "sportspot_id",
            "skill_level",
            "location",
            "profile_photo",
            "weekly_availability",
            "playing_style",
            "reliability_score",
            "reliability_label",
            "completed_matches_count",
            "average_rating",
            "guest_name",
            "guest_phone",
            "member_type",
            "role_in_team",
            "cricksal_role",
            "status",
            "joined_at",
            "invited_at",
        )
        read_only_fields = (
            "id",
            "user",
            "full_name",
            "display_name",
            "is_guest",
            "sportspot_id",
            "skill_level",
            "location",
            "profile_photo",
            "weekly_availability",
            "playing_style",
            "reliability_score",
            "reliability_label",
            "completed_matches_count",
            "average_rating",
            "status",
            "joined_at",
            "invited_at",
        )

    def get_is_guest(self, member):
        return member.user_id is None

    def get_profile(self, member):
        if not member.user_id:
            return None
        try:
            return member.user.player_profile
        except PlayerProfile.DoesNotExist:
            return None

    def get_sportspot_id(self, member):
        profile = self.get_profile(member)
        return profile.sportspot_id if profile else ""

    def get_skill_level(self, member):
        profile = self.get_profile(member)
        return profile.skill_level if profile else ""

    def get_location(self, member):
        profile = self.get_profile(member)
        return profile.location if profile else ""

    def get_profile_photo(self, member):
        profile = self.get_profile(member)
        if profile and profile.profile_photo:
            return profile.profile_photo.url
        return ""

    def get_weekly_availability(self, member):
        profile = self.get_profile(member)
        return profile.weekly_availability if profile else ""

    def get_playing_style(self, member):
        profile = self.get_profile(member)
        return profile.playing_style if profile else ""

    def get_reliability_score(self, member):
        profile = self.get_profile(member)
        return profile.reliability_score if profile else 0

    def get_reliability_label(self, member):
        profile = self.get_profile(member)
        if not profile:
            return ""
        if profile.completed_matches_count < 3:
            return "New Player"
        return f"Reliable Player - {profile.reliability_score}/100"

    def get_completed_matches_count(self, member):
        profile = self.get_profile(member)
        return profile.completed_matches_count if profile else 0

    def get_average_rating(self, member):
        profile = self.get_profile(member)
        return str(profile.average_rating) if profile else "0.00"


class TeamSerializer(serializers.ModelSerializer):
    captain_name = serializers.CharField(source="captain.full_name", read_only=True)
    members_count = serializers.IntegerField(source="active_members_count", read_only=True)
    is_captain = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = (
            "id",
            "name",
            "team_photo",
            "description",
            "location",
            "preferred_playing_area",
            "preferred_playing_time",
            "skill_level",
            "captain",
            "captain_name",
            "members_count",
            "is_captain",
            "team_reliability_score",
            "average_rating",
            "matches_played_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "captain",
            "captain_name",
            "members_count",
            "is_captain",
            "team_reliability_score",
            "average_rating",
            "matches_played_count",
            "created_at",
            "updated_at",
        )

    def get_is_captain(self, team):
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and team.captain_id == request.user.id)

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError("Team name must be at least 3 characters.")
        return value

    def validate_team_photo(self, value):
        if not value:
            return value

        allowed_content_types = {"image/jpeg", "image/png"}
        content_type = getattr(value, "content_type", "")
        max_size = 2 * 1024 * 1024

        if content_type and content_type not in allowed_content_types:
            raise serializers.ValidationError("Team photo must be a JPG, JPEG, or PNG image.")

        if getattr(value, "size", 0) > max_size:
            raise serializers.ValidationError("Team photo must be 2MB or smaller.")

        return value

    def validate(self, attrs):
        for field in ("location", "preferred_playing_area", "preferred_playing_time"):
            if field in attrs:
                attrs[field] = str(attrs[field]).strip()
                if not attrs[field]:
                    raise serializers.ValidationError({field: "This field is required."})
        return attrs


class TeamDetailSerializer(TeamSerializer):
    members = serializers.SerializerMethodField()

    class Meta(TeamSerializer.Meta):
        fields = TeamSerializer.Meta.fields + ("members",)

    def get_members(self, team):
        members = team.members.exclude(status__in=[TeamMember.MemberStatus.REMOVED, TeamMember.MemberStatus.REJECTED]).select_related(
            "user",
            "user__player_profile",
        )
        return TeamMemberSerializer(members, many=True).data


class GuestMemberCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamMember
        fields = ("guest_name", "guest_phone", "cricksal_role")

    def validate_guest_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Guest name must be at least 2 characters.")
        return value

    def validate_guest_phone(self, value):
        return value.strip()


class PlayerLookupSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    reliability_label = serializers.SerializerMethodField()

    class Meta:
        model = PlayerProfile
        fields = (
            "user_id",
            "full_name",
            "sportspot_id",
            "skill_level",
            "location",
            "preferred_cricksal_role",
            "reliability_score",
            "completed_matches_count",
            "average_rating",
            "profile_photo",
            "reliability_label",
        )

    def get_reliability_label(self, profile):
        if profile.completed_matches_count < 3:
            return "New Player"
        return f"Reliable Player - {profile.reliability_score}/100"


class RegisteredPlayerInviteSerializer(serializers.Serializer):
    sportspot_id = serializers.CharField(max_length=20)
    cricksal_role = serializers.ChoiceField(choices=TeamMember.CricksalRole.choices)

    def validate_sportspot_id(self, value):
        return value.strip().upper()


class InvitationSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    team_description = serializers.CharField(source="team.description", read_only=True)
    team_location = serializers.CharField(source="team.location", read_only=True)
    team_preferred_playing_area = serializers.CharField(source="team.preferred_playing_area", read_only=True)
    team_preferred_playing_time = serializers.CharField(source="team.preferred_playing_time", read_only=True)
    team_skill_level = serializers.CharField(source="team.skill_level", read_only=True)
    captain_name = serializers.CharField(source="team.captain.full_name", read_only=True)
    team_photo = serializers.FileField(source="team.team_photo", read_only=True)
    team_members_count = serializers.IntegerField(source="team.active_members_count", read_only=True)
    team_reliability_score = serializers.IntegerField(source="team.team_reliability_score", read_only=True)
    team_average_rating = serializers.DecimalField(source="team.average_rating", max_digits=3, decimal_places=2, read_only=True)
    team_matches_played_count = serializers.IntegerField(source="team.matches_played_count", read_only=True)
    team_created_at = serializers.DateTimeField(source="team.created_at", read_only=True)

    class Meta:
        model = TeamMember
        fields = (
            "id",
            "team",
            "team_name",
            "team_description",
            "team_location",
            "team_preferred_playing_area",
            "team_preferred_playing_time",
            "team_skill_level",
            "team_photo",
            "team_members_count",
            "team_reliability_score",
            "team_average_rating",
            "team_matches_played_count",
            "team_created_at",
            "captain_name",
            "cricksal_role",
            "status",
            "invited_at",
        )
