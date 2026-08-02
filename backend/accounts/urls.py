from django.urls import path

from .views import (
    AccountDeactivateView,
    AccountSettingsUpdateView,
    ForgotPasswordView,
    LoginView,
    MeView,
    NotificationSettingsUpdateView,
    PasswordChangeView,
    PasswordResetTokenValidationView,
    PlayerSettingsView,
    PrivacySettingsUpdateView,
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
    path("settings/player/", PlayerSettingsView.as_view(), name="auth-player-settings"),
    path("settings/account/", AccountSettingsUpdateView.as_view(), name="auth-settings-account"),
    path("settings/password/", PasswordChangeView.as_view(), name="auth-settings-password"),
    path("settings/notifications/", NotificationSettingsUpdateView.as_view(), name="auth-settings-notifications"),
    path("settings/privacy/", PrivacySettingsUpdateView.as_view(), name="auth-settings-privacy"),
    path("settings/deactivate/", AccountDeactivateView.as_view(), name="auth-settings-deactivate"),
    path("verify-email/", VerifyEmailView.as_view(), name="auth-verify-email"),
    path("verify-email/resend/", ResendEmailVerificationView.as_view(), name="auth-resend-email-verification"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="auth-forgot-password"),
    path("reset-password/validate/", PasswordResetTokenValidationView.as_view(), name="auth-reset-password-validate"),
    path("reset-password/", ResetPasswordView.as_view(), name="auth-reset-password"),
    path("token/refresh/", VerifiedTokenRefreshView.as_view(), name="token-refresh"),
]
