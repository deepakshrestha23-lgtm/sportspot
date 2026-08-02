import json

from rest_framework import serializers

from .models import PlayerProfile


class PlayerProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    profile_completion_percentage = serializers.IntegerField(read_only=True)
    is_profile_complete = serializers.BooleanField(read_only=True)
    reliability_label = serializers.CharField(read_only=True)
    remove_profile_photo = serializers.BooleanField(write_only=True, required=False, default=False)

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
            "availability_days",
            "availability_time_periods",
            "playing_style",
            "bio",
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
            "remove_profile_photo",
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

        valid_days = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
        valid_periods = {"MORNING", "AFTERNOON", "EVENING", "FLEXIBLE"}

        if "availability_days" in attrs:
            attrs["availability_days"] = normalize_choice_list(attrs.get("availability_days"), valid_days, "Choose valid availability days.")

        if "availability_time_periods" in attrs:
            attrs["availability_time_periods"] = normalize_choice_list(
                attrs.get("availability_time_periods"),
                valid_periods,
                "Choose valid availability times.",
            )

        if attrs.get("bio") and len(attrs["bio"].strip()) > 500:
            raise serializers.ValidationError({"bio": "Bio must be 500 characters or fewer."})

        if "availability_days" in attrs or "availability_time_periods" in attrs:
            current_days = attrs.get("availability_days", getattr(self.instance, "availability_days", []))
            current_periods = attrs.get("availability_time_periods", getattr(self.instance, "availability_time_periods", []))
            attrs["weekly_availability"] = format_weekly_availability(current_days, current_periods)

        return attrs

    def create(self, validated_data):
        validated_data.pop("remove_profile_photo", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        remove_photo = validated_data.pop("remove_profile_photo", False)
        if remove_photo and instance.profile_photo:
            instance.profile_photo.delete(save=False)
            instance.profile_photo = ""
        return super().update(instance, validated_data)


def normalize_choice_list(value, valid_values, error_message):
    if value in (None, ""):
        return []

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise serializers.ValidationError(error_message) from exc

    if not isinstance(value, list) or any(item not in valid_values for item in value):
        raise serializers.ValidationError(error_message)

    return list(dict.fromkeys(value))


def format_weekly_availability(days, periods):
    day_labels = {
        "MON": "Mon",
        "TUE": "Tue",
        "WED": "Wed",
        "THU": "Thu",
        "FRI": "Fri",
        "SAT": "Sat",
        "SUN": "Sun",
    }
    period_labels = {
        "MORNING": "Morning",
        "AFTERNOON": "Afternoon",
        "EVENING": "Evening",
        "FLEXIBLE": "Flexible time",
    }
    day_text = ", ".join(day_labels.get(day, day) for day in days or [])
    period_text = ", ".join(period_labels.get(period, period) for period in periods or [])
    if day_text and period_text:
        return f"{day_text} - {period_text}"
    return day_text or period_text or ""
