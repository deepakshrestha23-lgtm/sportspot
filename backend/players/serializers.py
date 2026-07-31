from rest_framework import serializers

from .models import PlayerProfile


class PlayerProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    profile_completion_percentage = serializers.IntegerField(read_only=True)
    is_profile_complete = serializers.BooleanField(read_only=True)
    reliability_label = serializers.CharField(read_only=True)

    class Meta:
        model = PlayerProfile
        fields = (
            "id",
            "user",
            "full_name",
            "email",
            "sportspot_id",
            "profile_photo",
            "preferred_sport",
            "skill_level",
            "location",
            "weekly_availability",
            "playing_style",
            "preferred_cricksal_role",
            "preferred_futsal_role",
            "reliability_score",
            "average_rating",
            "no_show_count",
            "late_cancellation_count",
            "completed_matches_count",
            "profile_completion_percentage",
            "is_profile_complete",
            "reliability_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "user",
            "full_name",
            "email",
            "sportspot_id",
            "reliability_score",
            "average_rating",
            "no_show_count",
            "late_cancellation_count",
            "completed_matches_count",
            "profile_completion_percentage",
            "is_profile_complete",
            "reliability_label",
            "created_at",
            "updated_at",
        )

    def validate_profile_photo(self, value):
        if not value:
            return value

        allowed_content_types = {"image/jpeg", "image/png"}
        content_type = getattr(value, "content_type", "")
        max_size = 2 * 1024 * 1024

        if content_type and content_type not in allowed_content_types:
            raise serializers.ValidationError("Profile photo must be a JPG, JPEG, or PNG image.")

        if getattr(value, "size", 0) > max_size:
            raise serializers.ValidationError("Profile photo must be 2MB or smaller.")

        return value

    def validate(self, attrs):
        attrs["preferred_sport"] = PlayerProfile.PreferredSport.CRICKSAL
        cricksal_role = attrs.get("preferred_cricksal_role") or getattr(
            self.instance,
            "preferred_cricksal_role",
            PlayerProfile.CricksalRole.NONE,
        )

        if not cricksal_role:
            attrs["preferred_cricksal_role"] = PlayerProfile.CricksalRole.NONE

        attrs["preferred_futsal_role"] = PlayerProfile.FutsalRole.NONE

        return attrs
