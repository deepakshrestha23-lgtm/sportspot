from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from players.models import PlayerProfile
from .models import User
from .security import (
    SecurityFlowError,
    get_valid_password_reset_token,
    issue_email_verification_otp,
    mask_email,
    normalize_email,
    request_password_reset,
    reset_password,
    verify_email_otp,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "full_name",
            "email",
            "phone",
            "role",
            "email_verified",
            "email_verified_at",
            "is_active",
            "is_staff",
            "date_joined",
        )
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    preferred_sport = serializers.CharField(required=False, write_only=True, allow_blank=True)
    skill_level = serializers.CharField(required=False, write_only=True, allow_blank=True)
    location = serializers.CharField(required=False, write_only=True, allow_blank=True)

    class Meta:
        model = User
        fields = (
            "id",
            "full_name",
            "email",
            "phone",
            "password",
            "role",
            "preferred_sport",
            "skill_level",
            "location",
        )
        read_only_fields = ("id",)

    def validate_role(self, value):
        allowed_roles = {User.Role.PLAYER, User.Role.COURT_OWNER}
        if value not in allowed_roles:
            raise serializers.ValidationError("Public registration only supports PLAYER or COURT_OWNER.")
        return value

    def validate_email(self, value):
        email = normalize_email(value)
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.messages) from error
        return value

    def normalize_preferred_sport(self, value):
        return PlayerProfile.PreferredSport.CRICKSAL

    def normalize_skill_level(self, value):
        skill_map = {
            "BEGINNER": PlayerProfile.SkillLevel.BEGINNER,
            "INTERMEDIATE": PlayerProfile.SkillLevel.INTERMEDIATE,
            "AMATEUR": PlayerProfile.SkillLevel.INTERMEDIATE,
            "ADVANCED": PlayerProfile.SkillLevel.ADVANCED,
            "PRO": PlayerProfile.SkillLevel.ADVANCED,
        }
        normalized = skill_map.get(str(value).strip().upper())
        if not normalized:
            raise serializers.ValidationError("Skill level must be BEGINNER, INTERMEDIATE, or ADVANCED.")
        return normalized

    def validate(self, attrs):
        role = attrs.get("role")

        if role == User.Role.PLAYER:
            errors = {}
            if not str(attrs.get("skill_level", "")).strip():
                errors["skill_level"] = "Skill level is required for player registration."
            if not str(attrs.get("location", "")).strip():
                errors["location"] = "Location is required for player registration."

            if errors:
                raise serializers.ValidationError(errors)

            attrs["preferred_sport"] = self.normalize_preferred_sport(attrs.get("preferred_sport"))
            attrs["skill_level"] = self.normalize_skill_level(attrs["skill_level"])
            attrs["location"] = str(attrs["location"]).strip()

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        preferred_sport = validated_data.pop("preferred_sport", "")
        skill_level = validated_data.pop("skill_level", "")
        location = validated_data.pop("location", "")
        password = validated_data.pop("password")
        user = User.objects.create_user(
            password=password,
            email_verified=False,
            email_verified_at=None,
            **validated_data,
        )

        if user.role == User.Role.PLAYER:
            PlayerProfile.objects.create(
                user=user,
                preferred_sport=preferred_sport,
                skill_level=skill_level,
                location=location,
                reliability_score=100,
                average_rating=0,
                completed_matches_count=0,
                no_show_count=0,
                late_cancellation_count=0,
            )

        issue_email_verification_otp(user, enforce_cooldown=False)
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        email = normalize_email(attrs.get("email"))
        password = attrs.get("password")
        user = authenticate(request=self.context.get("request"), username=email, password=password)

        if not user:
            raise serializers.ValidationError("Invalid email or password.")
        if not user.is_active:
            raise serializers.ValidationError("This account is inactive.")
        if not user.email_verified:
            raise serializers.ValidationError(
                {
                    "detail": "Verify your email before signing in.",
                    "code": "EMAIL_NOT_VERIFIED",
                    "masked_email": mask_email(user.email),
                }
            )

        refresh = RefreshToken.for_user(user)
        refresh["auth_version"] = user.auth_version
        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "user": UserSerializer(user).data,
        }


class VerifyEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()
    otp = serializers.RegexField(
        regex=r"^\d{6}$",
        error_messages={"invalid": "Enter the 6-digit verification code."},
    )

    def validate(self, attrs):
        try:
            user, changed = verify_email_otp(attrs["email"], attrs["otp"])
        except SecurityFlowError as error:
            raise serializers.ValidationError(
                {"detail": error.message, "code": error.code, **error.extra}
            ) from error
        attrs["user"] = user
        attrs["changed"] = changed
        return attrs


class ResendEmailVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate(self, attrs):
        user = User.objects.filter(
            email__iexact=normalize_email(attrs["email"]),
            is_active=True,
        ).first()
        if not user:
            attrs["user"] = None
            return attrs
        if user.email_verified:
            attrs["user"] = user
            return attrs
        try:
            issue_email_verification_otp(user, enforce_cooldown=True)
        except SecurityFlowError as error:
            raise serializers.ValidationError(
                {"detail": error.message, "code": error.code, **error.extra}
            ) from error
        attrs["user"] = user
        return attrs


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        email = normalize_email(value)
        if settings.ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS:
            user = User.objects.filter(email__iexact=email, is_active=True).first()
            if not user:
                raise serializers.ValidationError("No SportSpot account is registered with this email.")
            if not user.email_verified:
                raise serializers.ValidationError("This account has not verified its email yet. Verify your email first.")
        return email

    def save(self):
        request_password_reset(self.validated_data["email"])


class PasswordResetTokenValidationSerializer(serializers.Serializer):
    token = serializers.CharField(trim_whitespace=False)
    email = serializers.EmailField(required=False)

    def validate(self, attrs):
        try:
            get_valid_password_reset_token(attrs["token"], email=attrs.get("email"))
        except SecurityFlowError as error:
            raise serializers.ValidationError(
                {"detail": error.message, "code": error.code}
            ) from error
        return attrs


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField(trim_whitespace=False)
    email = serializers.EmailField()
    new_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    confirm_password = serializers.CharField(write_only=True, min_length=8, max_length=128)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError(
                {"confirm_password": "Passwords do not match."}
            )
        return attrs

    def save(self):
        try:
            return reset_password(
                self.validated_data["token"],
                self.validated_data["new_password"],
                email=self.validated_data["email"],
            )
        except SecurityFlowError as error:
            raise serializers.ValidationError(
                {"detail": error.message, "code": error.code}
            ) from error
