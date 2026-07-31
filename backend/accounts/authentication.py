from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User


class VerifiedJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if int(validated_token.get("auth_version", 1)) != user.auth_version:
            raise AuthenticationFailed("This session is no longer valid. Please sign in again.")
        if not user.email_verified:
            raise AuthenticationFailed("Verify your email before accessing protected features.")
        return user


class VerifiedTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = RefreshToken(attrs["refresh"])
        user = User.objects.filter(
            pk=refresh.get("user_id"),
            is_active=True,
        ).first()
        if not user:
            raise AuthenticationFailed("This session is no longer valid.")
        if not user.email_verified:
            raise AuthenticationFailed("Verify your email before refreshing this session.")
        if int(refresh.get("auth_version", 1)) != user.auth_version:
            raise AuthenticationFailed("This session is no longer valid. Please sign in again.")
        return super().validate(attrs)
