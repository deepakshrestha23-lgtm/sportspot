import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from notifications.email_service import (
    schedule_email_verification_otp,
    schedule_email_verified,
    schedule_password_changed,
    schedule_password_reset,
)

from .models import EmailVerificationOTP, PasswordResetToken, User


OTP_EXPIRY_MINUTES = 10
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
PASSWORD_RESET_EXPIRY_MINUTES = 15
PASSWORD_RESET_COOLDOWN_SECONDS = 60


class SecurityFlowError(Exception):
    def __init__(self, message, code, **details):
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = details


VerificationError = SecurityFlowError


def mask_email(email):
    local_part, _, domain = email.partition("@")
    if len(local_part) <= 2:
        masked_local = local_part[:1] + "*"
    else:
        masked_local = f"{local_part[0]}{'*' * min(len(local_part) - 2, 6)}{local_part[-1]}"
    return f"{masked_local}@{domain}"


def normalize_email(email):
    return User.objects.normalize_email(str(email or "").strip()).lower()


@transaction.atomic
def issue_email_verification_otp(user, *, enforce_cooldown=True, email=None):
    locked_user = User.objects.select_for_update().get(pk=user.pk)
    target_email = normalize_email(email or locked_user.pending_email or locked_user.email)
    is_primary_verification = target_email == normalize_email(locked_user.email)
    is_pending_verification = bool(locked_user.pending_email) and target_email == normalize_email(locked_user.pending_email)

    if is_primary_verification and locked_user.email_verified and not is_pending_verification:
        raise VerificationError("This email address is already verified.", "ALREADY_VERIFIED")
    if not is_primary_verification and not is_pending_verification:
        raise VerificationError("This email address is not pending verification.", "EMAIL_NOT_PENDING")

    latest = locked_user.email_verification_otps.filter(email__iexact=target_email).first()
    if enforce_cooldown and latest:
        elapsed = (timezone.now() - latest.created_at).total_seconds()
        if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
            retry_after = max(1, OTP_RESEND_COOLDOWN_SECONDS - int(elapsed))
            raise VerificationError(
                f"Please wait {retry_after} seconds before requesting another code.",
                "RESEND_COOLDOWN",
                retry_after=retry_after,
            )

    now = timezone.now()
    locked_user.email_verification_otps.filter(
        used_at__isnull=True,
        invalidated_at__isnull=True,
    ).update(invalidated_at=now)

    code = f"{secrets.randbelow(1_000_000):06d}"
    otp = EmailVerificationOTP.objects.create(
        user=locked_user,
        email=target_email,
        code_hash=make_password(code),
        expires_at=now + timedelta(minutes=OTP_EXPIRY_MINUTES),
    )
    schedule_email_verification_otp(locked_user, otp, code)
    return otp


def find_user_for_email_verification(email):
    normalized_email = normalize_email(email)
    return User.objects.select_for_update().filter(
        email__iexact=normalized_email,
        is_active=True,
    ).first() or User.objects.select_for_update().filter(
        pending_email__iexact=normalized_email,
        is_active=True,
    ).first()


def verify_email_otp(email, code):
    pending_error = None
    result = None
    target_email = normalize_email(email)

    with transaction.atomic():
        user = find_user_for_email_verification(target_email)
        if not user:
            pending_error = VerificationError("The verification code is invalid.", "INVALID_OTP")
        elif user.email_verified and normalize_email(user.email) == target_email and not user.pending_email:
            result = (user, False)
        else:
            otp = (
                EmailVerificationOTP.objects.select_for_update()
                .filter(
                    user=user,
                    email__iexact=target_email,
                    used_at__isnull=True,
                    invalidated_at__isnull=True,
                )
                .first()
            )
            if not otp:
                pending_error = VerificationError(
                    "No active verification code was found. Request a new code.",
                    "OTP_NOT_FOUND",
                )
            elif otp.expires_at <= timezone.now():
                otp.invalidated_at = timezone.now()
                otp.save(update_fields=["invalidated_at"])
                pending_error = VerificationError(
                    "This verification code has expired. Request a new code.",
                    "OTP_EXPIRED",
                )
            elif otp.attempts >= OTP_MAX_ATTEMPTS:
                pending_error = VerificationError(
                    "Too many incorrect attempts. Request a new code.",
                    "TOO_MANY_ATTEMPTS",
                )
            elif not check_password(str(code), otp.code_hash):
                otp.attempts += 1
                if otp.attempts >= OTP_MAX_ATTEMPTS:
                    otp.invalidated_at = timezone.now()
                otp.save(update_fields=["attempts", "invalidated_at"])
                remaining = max(0, OTP_MAX_ATTEMPTS - otp.attempts)
                pending_error = VerificationError(
                    (
                        "Too many incorrect attempts. Request a new code."
                        if remaining == 0
                        else f"Incorrect verification code. {remaining} "
                        f"attempt{'s' if remaining != 1 else ''} remaining."
                    ),
                    "TOO_MANY_ATTEMPTS" if remaining == 0 else "INVALID_OTP",
                    attempts_remaining=remaining,
                )
            else:
                now = timezone.now()
                otp.used_at = now
                otp.save(update_fields=["used_at"])
                changed = True
                if user.pending_email and normalize_email(user.pending_email) == target_email:
                    if User.objects.filter(email__iexact=target_email).exclude(pk=user.pk).exists():
                        pending_error = VerificationError("Another SportSpot account already uses this email.", "EMAIL_ALREADY_USED")
                    else:
                        user.email = target_email
                        user.pending_email = None
                        user.pending_email_requested_at = None
                        user.email_verified = True
                        user.email_verified_at = now
                        user.auth_version += 1
                        user.save(update_fields=["email", "pending_email", "pending_email_requested_at", "email_verified", "email_verified_at", "auth_version"])
                else:
                    user.email_verified = True
                    user.email_verified_at = now
                    user.save(update_fields=["email_verified", "email_verified_at"])
                user.email_verification_otps.filter(
                    used_at__isnull=True,
                    invalidated_at__isnull=True,
                ).exclude(pk=otp.pk).update(invalidated_at=now)
                if not pending_error:
                    schedule_email_verified(user)
                    result = (user, changed)

    if pending_error:
        raise pending_error
    return result

def token_digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@transaction.atomic
def request_password_reset(email):
    user = User.objects.select_for_update().filter(
        email__iexact=normalize_email(email),
        is_active=True,
        email_verified=True,
    ).first()
    if not user:
        return None

    latest = user.password_reset_tokens.first()
    if latest:
        elapsed = (timezone.now() - latest.created_at).total_seconds()
        if elapsed < PASSWORD_RESET_COOLDOWN_SECONDS:
            return latest

    now = timezone.now()
    user.password_reset_tokens.filter(
        used_at__isnull=True,
        invalidated_at__isnull=True,
    ).update(invalidated_at=now)

    raw_token = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken.objects.create(
        user=user,
        token_hash=token_digest(raw_token),
        expires_at=now + timedelta(minutes=PASSWORD_RESET_EXPIRY_MINUTES),
    )
    schedule_password_reset(user, reset_token, raw_token)
    return reset_token


def get_valid_password_reset_token(raw_token, *, email=None, lock=False):
    queryset = PasswordResetToken.objects.select_related("user")
    if lock:
        queryset = queryset.select_for_update()
    reset_token = queryset.filter(token_hash=token_digest(str(raw_token or ""))).first()
    email_mismatch = (
        email is not None
        and reset_token is not None
        and normalize_email(email) != normalize_email(reset_token.user.email)
    )
    if (
        not reset_token
        or not reset_token.is_available
        or not reset_token.user.is_active
        or not reset_token.user.email_verified
        or email_mismatch
    ):
        raise SecurityFlowError(
            "This password-reset link is invalid, expired, or has already been used.",
            "INVALID_RESET_TOKEN",
        )
    return reset_token


@transaction.atomic
def reset_password(raw_token, new_password, *, email):
    reset_token = get_valid_password_reset_token(raw_token, email=email, lock=True)

    user = User.objects.select_for_update().get(pk=reset_token.user_id)
    if user.check_password(new_password):
        raise VerificationError("Choose a password you have not just used.", "PASSWORD_UNCHANGED")
    try:
        validate_password(new_password, user=user)
    except ValidationError as error:
        raise VerificationError(error.messages[0], "INVALID_PASSWORD") from error

    now = timezone.now()
    user.set_password(new_password)
    user.auth_version += 1
    user.save(update_fields=["password", "auth_version"])
    reset_token.used_at = now
    reset_token.save(update_fields=["used_at"])
    user.password_reset_tokens.filter(
        used_at__isnull=True,
        invalidated_at__isnull=True,
    ).exclude(pk=reset_token.pk).update(invalidated_at=now)
    schedule_password_changed(user, reset_token)
    return user
