from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework.views import APIView

from .authentication import VerifiedTokenRefreshSerializer
from .security import OTP_EXPIRY_MINUTES, OTP_RESEND_COOLDOWN_SECONDS, mask_email
from .serializers import (
    AccountDeactivateSerializer,
    AccountUpdateSerializer,
    ForgotPasswordSerializer,
    LoginSerializer,
    NotificationSettingsSerializer,
    PasswordChangeSerializer,
    PasswordResetTokenValidationSerializer,
    PlayerSettingsSerializer,
    PrivacySettingsSerializer,
    RegisterSerializer,
    ResendEmailVerificationSerializer,
    ResetPasswordSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                "user": UserSerializer(user).data,
                "verification_required": True,
                "masked_email": mask_email(user.email),
                "expires_in": OTP_EXPIRY_MINUTES * 60,
                "resend_available_in": OTP_RESEND_COOLDOWN_SECONDS,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data, status=status.HTTP_200_OK)




class PlayerSettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.role != "PLAYER":
            return Response({"detail": "This settings page is available for player accounts."}, status=status.HTTP_403_FORBIDDEN)
        return Response(PlayerSettingsSerializer(request.user).data, status=status.HTTP_200_OK)


class AccountSettingsUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request):
        if request.user.role != "PLAYER":
            return Response({"detail": "Only player accounts can update player settings."}, status=status.HTTP_403_FORBIDDEN)
        serializer = AccountUpdateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user, email_changed = serializer.save()
        return Response(
            {
                "detail": "Your account settings have been updated.",
                "email_verification_required": email_changed,
                "masked_email": mask_email(user.pending_email) if email_changed and user.pending_email else "",
                "pending_email": user.pending_email or "",
                "expires_in": OTP_EXPIRY_MINUTES * 60 if email_changed else 0,
                "resend_available_in": OTP_RESEND_COOLDOWN_SECONDS if email_changed else 0,
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class PasswordChangeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your password has been changed."}, status=status.HTTP_200_OK)


class NotificationSettingsUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request):
        if request.user.role != "PLAYER":
            return Response({"detail": "Only player accounts can update player settings."}, status=status.HTTP_403_FORBIDDEN)
        serializer = NotificationSettingsSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your notification preferences have been saved."}, status=status.HTTP_200_OK)


class PrivacySettingsUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request):
        if request.user.role != "PLAYER":
            return Response({"detail": "Only player accounts can update player settings."}, status=status.HTTP_403_FORBIDDEN)
        serializer = PrivacySettingsSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your privacy settings have been saved."}, status=status.HTTP_200_OK)


class AccountDeactivateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if request.user.role != "PLAYER":
            return Response({"detail": "Only player accounts can deactivate this way."}, status=status.HTTP_403_FORBIDDEN)
        serializer = AccountDeactivateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your account has been deactivated."}, status=status.HTTP_200_OK)


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            {
                "detail": (
                    "Email verified successfully."
                    if serializer.validated_data["changed"]
                    else "Email was already verified."
                ),
                "user": UserSerializer(serializer.validated_data["user"]).data,
            }
        )


class ResendEmailVerificationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ResendEmailVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            {
                "detail": "If verification is required, a new code has been sent.",
                "expires_in": OTP_EXPIRY_MINUTES * 60,
                "resend_available_in": OTP_RESEND_COOLDOWN_SECONDS,
            }
        )


class ForgotPasswordView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {
                "detail": "If an account exists with this email, password-reset instructions have been sent."
            }
        )


class PasswordResetTokenValidationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetTokenValidationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({"valid": True})


class ResetPasswordView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {"detail": "Password changed successfully. Sign in with your new password."}
        )


class VerifiedTokenRefreshView(TokenRefreshView):
    serializer_class = VerifiedTokenRefreshSerializer
