import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.mail.backends.base import BaseEmailBackend
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from notifications.models import EmailDelivery

from .models import AccountSettings, EmailVerificationOTP, PasswordResetToken


class FailingEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        raise RuntimeError("Simulated email provider failure")


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS=False,
)
class AccountSecurityFlowTests(APITestCase):
    player_payload = {
        "full_name": "Secure Player",
        "email": "secure-player@example.com",
        "phone": "9800000091",
        "password": "StrongPass123!",
        "role": "PLAYER",
        "preferred_sport": "CRICKSAL",
        "skill_level": "INTERMEDIATE",
        "location": "Kathmandu",
    }

    owner_payload = {
        "full_name": "Secure Owner",
        "email": "secure-owner@example.com",
        "phone": "9800000092",
        "password": "StrongPass123!",
        "role": "COURT_OWNER",
    }

    def register(self, payload=None):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                reverse("auth-register"),
                payload or self.player_payload,
                format="json",
            )

    def extract_otp(self):
        match = re.search(r"\b(\d{6})\b", mail.outbox[-1].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def request_reset_token(self, email):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                reverse("auth-forgot-password"),
                {"email": email},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        match = re.search(r"/reset-password\?token=([^\s]+)", mail.outbox[-1].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_player_and_owner_registration_send_hashed_otp(self):
        player_response = self.register()
        owner_response = self.register(self.owner_payload)

        self.assertEqual(player_response.status_code, 201)
        self.assertEqual(owner_response.status_code, 201)
        self.assertEqual(len(mail.outbox), 2)
        for email in [self.player_payload["email"], self.owner_payload["email"]]:
            user = get_user_model().objects.get(email=email)
            otp = user.email_verification_otps.get()
            self.assertFalse(user.email_verified)
            self.assertNotRegex(otp.code_hash, r"^\d{6}$")
            self.assertNotIn("otp", player_response.data)

    def test_wrong_expired_and_too_many_attempt_states(self):
        self.register()
        issued_otp = self.extract_otp()
        wrong_otp = "000000" if issued_otp != "000000" else "111111"
        for attempt in range(5):
            response = self.client.post(
                reverse("auth-verify-email"),
                {"email": self.player_payload["email"], "otp": wrong_otp},
                format="json",
            )
            self.assertEqual(response.status_code, 400)
        otp = EmailVerificationOTP.objects.get()
        self.assertEqual(otp.attempts, 5)
        self.assertIsNotNone(otp.invalidated_at)

        EmailVerificationOTP.objects.all().delete()
        mail.outbox.clear()
        user = get_user_model().objects.get(email=self.player_payload["email"])
        user.email_verified = False
        user.save(update_fields=["email_verified"])
        from accounts.security import issue_email_verification_otp

        with self.captureOnCommitCallbacks(execute=True):
            expired = issue_email_verification_otp(user, enforce_cooldown=False)
        expired.expires_at = timezone.now() - timedelta(seconds=1)
        expired.save(update_fields=["expires_at"])
        response = self.client.post(
            reverse("auth-verify-email"),
            {"email": user.email, "otp": self.extract_otp()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"][0], "OTP_EXPIRED")

    def test_resend_invalidates_previous_otp(self):
        self.register()
        old_otp_value = self.extract_otp()
        old_otp = EmailVerificationOTP.objects.get()
        EmailVerificationOTP.objects.filter(pk=old_otp.pk).update(
            created_at=timezone.now() - timedelta(seconds=61)
        )

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                reverse("auth-resend-email-verification"),
                {"email": self.player_payload["email"]},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        old_otp.refresh_from_db()
        self.assertIsNotNone(old_otp.invalidated_at)

        old_response = self.client.post(
            reverse("auth-verify-email"),
            {"email": self.player_payload["email"], "otp": old_otp_value},
            format="json",
        )
        self.assertEqual(old_response.status_code, 400)

        new_response = self.client.post(
            reverse("auth-verify-email"),
            {"email": self.player_payload["email"], "otp": self.extract_otp()},
            format="json",
        )
        self.assertEqual(new_response.status_code, 200)

    def test_unverified_user_cannot_login_then_verified_user_can(self):
        self.register()
        login_payload = {
            "email": self.player_payload["email"],
            "password": self.player_payload["password"],
        }
        blocked = self.client.post(reverse("auth-login"), login_payload, format="json")
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.data["code"][0], "EMAIL_NOT_VERIFIED")

        with self.captureOnCommitCallbacks(execute=True):
            verified = self.client.post(
                reverse("auth-verify-email"),
                {"email": self.player_payload["email"], "otp": self.extract_otp()},
                format="json",
            )
        self.assertEqual(verified.status_code, 200)
        login = self.client.post(reverse("auth-login"), login_payload, format="json")
        self.assertEqual(login.status_code, 200)
        self.assertIn("access", login.data)

    def test_forgot_password_is_neutral_and_reset_is_single_use(self):
        user = get_user_model().objects.create_user(
            email="reset@example.com",
            password="OldStrongPass123!",
            full_name="Reset Player",
            phone="9800000093",
            role="PLAYER",
            email_verified=True,
            email_verified_at=timezone.now(),
        )
        unknown = self.client.post(
            reverse("auth-forgot-password"),
            {"email": "missing@example.com"},
            format="json",
        )
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(PasswordResetToken.objects.count(), 0)

        token = self.request_reset_token(user.email)
        reset_payload = {
            "token": token,
            "email": user.email,
            "new_password": "NewStrongPass456!",
            "confirm_password": "NewStrongPass456!",
        }
        with self.captureOnCommitCallbacks(execute=True):
            reset_response = self.client.post(
                reverse("auth-reset-password"),
                reset_payload,
                format="json",
            )
        self.assertEqual(reset_response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("NewStrongPass456!"))
        self.assertEqual(user.auth_version, 2)
        self.assertEqual(PasswordResetToken.objects.get().used_at is not None, True)
        self.assertIn("password was changed", mail.outbox[-1].subject.lower())

        reused = self.client.post(
            reverse("auth-reset-password"),
            reset_payload,
            format="json",
        )
        self.assertEqual(reused.status_code, 400)

    def test_password_reset_token_requires_matching_account_email(self):
        user = get_user_model().objects.create_user(
            email="real-owner@example.com",
            password="OldStrongPass123!",
            full_name="Real Owner",
            phone="9800000095",
            role="PLAYER",
            email_verified=True,
            email_verified_at=timezone.now(),
        )
        token = self.request_reset_token(user.email)

        wrong_email_response = self.client.post(
            reverse("auth-reset-password"),
            {
                "token": token,
                "email": "someone-else@example.com",
                "new_password": "NewStrongPass456!",
                "confirm_password": "NewStrongPass456!",
            },
            format="json",
        )
        self.assertEqual(wrong_email_response.status_code, 400)
        user.refresh_from_db()
        self.assertTrue(user.check_password("OldStrongPass123!"))
        self.assertIsNone(PasswordResetToken.objects.get().used_at)

        with self.captureOnCommitCallbacks(execute=True):
            correct_email_response = self.client.post(
                reverse("auth-reset-password"),
                {
                    "token": token,
                    "email": "REAL-OWNER@EXAMPLE.COM",
                    "new_password": "NewStrongPass456!",
                    "confirm_password": "NewStrongPass456!",
                },
                format="json",
            )
        self.assertEqual(correct_email_response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("NewStrongPass456!"))

    def test_unverified_user_does_not_receive_password_reset_link(self):
        get_user_model().objects.create_user(
            email="unverified@example.com",
            password="OldStrongPass123!",
            full_name="Unverified Player",
            phone="9800000096",
            role="PLAYER",
            email_verified=False,
        )

        response = self.client.post(
            reverse("auth-forgot-password"),
            {"email": "unverified@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS=True)
    def test_demo_mode_rejects_unknown_password_reset_email(self):
        response = self.client.post(
            reverse("auth-forgot-password"),
            {"email": "not-registered@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("No SportSpot account is registered", str(response.data))
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS=True)
    def test_demo_mode_rejects_unverified_password_reset_email(self):
        get_user_model().objects.create_user(
            email="needs-verification@example.com",
            password="OldStrongPass123!",
            full_name="Needs Verification",
            phone="9800000097",
            role="PLAYER",
            email_verified=False,
        )

        response = self.client.post(
            reverse("auth-forgot-password"),
            {"email": "needs-verification@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("has not verified", str(response.data))
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_password_reset_invalidates_previously_issued_jwt(self):
        user = get_user_model().objects.create_user(
            email="session@example.com",
            password="OldStrongPass123!",
            full_name="Session Player",
            phone="9800000094",
            role="PLAYER",
            email_verified=True,
            email_verified_at=timezone.now(),
        )
        login = self.client.post(
            reverse("auth-login"),
            {"email": user.email, "password": "OldStrongPass123!"},
            format="json",
        )
        old_access = login.data["access"]
        token = self.request_reset_token(user.email)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(
                reverse("auth-reset-password"),
                {
                    "token": token,
                    "email": user.email,
                    "new_password": "NewStrongPass456!",
                    "confirm_password": "NewStrongPass456!",
                },
                format="json",
            )

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {old_access}")
        response = self.client.get(reverse("auth-me"))
        self.assertEqual(response.status_code, 401)

    @override_settings(EMAIL_BACKEND="accounts.tests.FailingEmailBackend")
    def test_email_provider_failure_does_not_rollback_registration(self):
        response = self.register()

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            get_user_model().objects.filter(email=self.player_payload["email"]).exists()
        )
        delivery = EmailDelivery.objects.get(
            email_type=EmailDelivery.EmailType.EMAIL_VERIFICATION_OTP
        )
        self.assertEqual(delivery.status, EmailDelivery.Status.FAILED)

@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PlayerSettingsApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="settings-player@example.com",
            password="StrongPass123!",
            full_name="Settings Player",
            phone="9800000101",
            role="PLAYER",
            email_verified=True,
            email_verified_at=timezone.now(),
        )
        self.client.force_authenticate(self.user)

    def test_player_can_load_and_persist_notification_and_privacy_settings(self):
        response = self.client.get(reverse("auth-player-settings"))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["notifications"]["team_invitations"])
        self.assertTrue(response.data["privacy"]["public_profile_visible"])

        notification_response = self.client.patch(
            reverse("auth-settings-notifications"),
            {
                "team_invitations": False,
                "join_requests": True,
                "team_challenges": False,
                "game_updates": True,
                "booking_updates": True,
                "cancellation_refunds": True,
                "rating_reminders": False,
                "email_notifications": False,
            },
            format="json",
        )
        privacy_response = self.client.patch(
            reverse("auth-settings-privacy"),
            {
                "public_profile_visible": True,
                "location_visible": False,
                "reliability_visible": True,
                "rating_visible": False,
                "allow_team_invitations": True,
                "allow_team_challenges": False,
            },
            format="json",
        )

        self.assertEqual(notification_response.status_code, 200)
        self.assertEqual(privacy_response.status_code, 200)
        settings = AccountSettings.objects.get(user=self.user)
        self.assertFalse(settings.notify_team_invitations)
        self.assertFalse(settings.notify_team_challenges)
        self.assertFalse(settings.rating_visible)
        self.assertFalse(settings.location_visible)

        refreshed = self.client.get(reverse("auth-player-settings"))
        self.assertFalse(refreshed.data["notifications"]["team_invitations"])
        self.assertFalse(refreshed.data["notifications"]["email_notifications"])
        self.assertFalse(refreshed.data["privacy"]["location_visible"])

    def test_email_change_requires_new_verification_and_keeps_current_email_active(self):
        old_auth_version = self.user.auth_version
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(
                reverse("auth-settings-account"),
                {
                    "full_name": "Settings Player Updated",
                    "email": "settings-updated@example.com",
                    "phone": "9800000102",
                    "current_password": "StrongPass123!",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["email_verification_required"])
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "settings-player@example.com")
        self.assertEqual(self.user.pending_email, "settings-updated@example.com")
        self.assertTrue(self.user.email_verified)
        self.assertEqual(self.user.auth_version, old_auth_version)
        otp = EmailVerificationOTP.objects.get(user=self.user, invalidated_at__isnull=True)
        self.assertEqual(otp.email, "settings-updated@example.com")
        self.assertEqual(mail.outbox[-1].to, ["settings-updated@example.com"])
    def test_pending_email_verification_replaces_primary_email_after_otp(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(
                reverse("auth-settings-account"),
                {
                    "full_name": "Settings Player",
                    "email": "settings-final@example.com",
                    "phone": "9800000101",
                    "current_password": "StrongPass123!",
                },
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        otp_value_match = re.search(r"\b(\d{6})\b", mail.outbox[-1].body)
        self.assertIsNotNone(otp_value_match)

        verify_response = self.client.post(
            reverse("auth-verify-email"),
            {"email": "settings-final@example.com", "otp": otp_value_match.group(1)},
            format="json",
        )

        self.assertEqual(verify_response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "settings-final@example.com")
        self.assertIsNone(self.user.pending_email)
        self.assertTrue(self.user.email_verified)
        self.assertEqual(self.user.auth_version, 2)

    def test_password_change_and_deactivation_require_current_password(self):
        wrong_password = self.client.post(
            reverse("auth-settings-password"),
            {
                "current_password": "wrong-password",
                "new_password": "NewSettingsPass456!",
                "confirm_password": "NewSettingsPass456!",
            },
            format="json",
        )
        self.assertEqual(wrong_password.status_code, 400)

        password_response = self.client.post(
            reverse("auth-settings-password"),
            {
                "current_password": "StrongPass123!",
                "new_password": "NewSettingsPass456!",
                "confirm_password": "NewSettingsPass456!",
            },
            format="json",
        )
        self.assertEqual(password_response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewSettingsPass456!"))

        deactivate_response = self.client.post(
            reverse("auth-settings-deactivate"),
            {"password": "NewSettingsPass456!"},
            format="json",
        )
        self.assertEqual(deactivate_response.status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class OwnerSettingsApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="settings-owner@example.com",
            password="StrongPass123!",
            full_name="Settings Owner",
            phone="9800000111",
            role="COURT_OWNER",
            email_verified=True,
            email_verified_at=timezone.now(),
        )
        self.client.force_authenticate(self.user)

    def test_owner_can_load_account_and_owner_notifications(self):
        response = self.client.get(reverse("auth-owner-settings"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["account"]["role"], "COURT_OWNER")
        self.assertEqual(
            set(response.data["notifications"]),
            {"booking_updates", "cancellation_refunds", "email_notifications"},
        )
        self.assertNotIn("privacy", response.data)

    def test_owner_can_update_account_and_relevant_notification_preferences(self):
        account_response = self.client.patch(
            reverse("auth-settings-account"),
            {
                "full_name": "Updated Owner",
                "email": "settings-owner@example.com",
                "phone": "9800000112",
            },
            format="json",
        )
        notification_response = self.client.patch(
            reverse("auth-owner-settings-notifications"),
            {
                "booking_updates": False,
                "cancellation_refunds": True,
                "email_notifications": False,
            },
            format="json",
        )

        self.assertEqual(account_response.status_code, 200)
        self.assertEqual(notification_response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.full_name, "Updated Owner")
        self.assertEqual(self.user.phone, "9800000112")
        settings = AccountSettings.objects.get(user=self.user)
        self.assertFalse(settings.notify_booking_updates)
        self.assertFalse(settings.email_notifications)

    def test_owner_can_change_password_through_shared_security_flow(self):
        response = self.client.post(
            reverse("auth-settings-password"),
            {
                "current_password": "StrongPass123!",
                "new_password": "NewOwnerPass456!",
                "confirm_password": "NewOwnerPass456!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewOwnerPass456!"))

    def test_player_cannot_read_owner_settings_contract(self):
        player = get_user_model().objects.create_user(
            email="settings-player-owner-route@example.com",
            password="StrongPass123!",
            full_name="Settings Player",
            phone="9800000113",
            role="PLAYER",
            email_verified=True,
            email_verified_at=timezone.now(),
        )
        self.client.force_authenticate(player)

        response = self.client.get(reverse("auth-owner-settings"))

        self.assertEqual(response.status_code, 403)


class AdminPasswordSettingsApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser(
            email="settings-admin@example.com",
            password="StrongPass123!",
            full_name="Settings Admin",
            phone="9800000199",
        )
        self.client.force_authenticate(self.user)

    def test_admin_can_change_password_and_previous_auth_version_is_invalidated(self):
        old_auth_version = self.user.auth_version
        response = self.client.post(
            reverse("auth-settings-password"),
            {
                "current_password": "StrongPass123!",
                "new_password": "NewAdminPass456!",
                "confirm_password": "NewAdminPass456!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewAdminPass456!"))
        self.assertEqual(self.user.auth_version, old_auth_version + 1)
