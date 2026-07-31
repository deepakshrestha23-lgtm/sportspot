from django.urls import path

from .views import (
    ForgotPasswordView,
    LoginView,
    MeView,
    PasswordResetTokenValidationView,
    RegisterView,
    ResendEmailVerificationView,
    ResetPasswordView,
    VerifiedTokenRefreshView,
    VerifyEmailView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("verify-email/", VerifyEmailView.as_view(), name="auth-verify-email"),
    path("verify-email/resend/", ResendEmailVerificationView.as_view(), name="auth-resend-email-verification"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="auth-forgot-password"),
    path("reset-password/validate/", PasswordResetTokenValidationView.as_view(), name="auth-reset-password-validate"),
    path("reset-password/", ResetPasswordView.as_view(), name="auth-reset-password"),
    path("token/refresh/", VerifiedTokenRefreshView.as_view(), name="token-refresh"),
]
