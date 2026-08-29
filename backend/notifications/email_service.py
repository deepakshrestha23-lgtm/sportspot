import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from .models import EmailDelivery


logger = logging.getLogger(__name__)


def frontend_url(path=""):
    return f"{settings.FRONTEND_URL.rstrip('/')}/{str(path).lstrip('/')}"



def email_allowed_for_recipient(recipient, email_type):
    account_email_types = {
        EmailDelivery.EmailType.EMAIL_VERIFICATION_OTP,
        EmailDelivery.EmailType.EMAIL_VERIFIED,
        EmailDelivery.EmailType.PASSWORD_RESET,
        EmailDelivery.EmailType.PASSWORD_CHANGED,
    }
    if email_type in account_email_types:
        return True

    try:
        preferences = recipient.account_settings
    except Exception:
        return True

    if not preferences.email_notifications:
        return False

    preference_map = {
        EmailDelivery.EmailType.TEAM_INVITATION: "notify_team_invitations",
        EmailDelivery.EmailType.BOOKING_CONFIRMED: "notify_booking_updates",
        EmailDelivery.EmailType.BOOKING_PAYMENT_FAILED: "notify_booking_updates",
        EmailDelivery.EmailType.BOOKING_REMINDER: "notify_booking_updates",
        EmailDelivery.EmailType.BOOKING_CANCELLED: "notify_cancellation_refunds",
        EmailDelivery.EmailType.REFUND_PENDING: "notify_cancellation_refunds",
        EmailDelivery.EmailType.REFUND_COMPLETED: "notify_cancellation_refunds",
        EmailDelivery.EmailType.VENUE_MESSAGE: "notify_booking_updates",
    }
    field_name = preference_map.get(email_type)
    if not field_name:
        return True
    return bool(getattr(preferences, field_name, True))

def schedule_transactional_email(**kwargs):
    transaction.on_commit(lambda: send_transactional_email(**kwargs))


def send_transactional_email(
    *,
    recipient,
    email_type,
    subject,
    title,
    preheader,
    message,
    deduplication_key,
    details=None,
    action_label="",
    action_url="",
    security_note="",
    footer_reason="",
    related_entity_type="",
    related_entity_id=None,
    highlight="",
    recipient_email="",
):
    recipient_email = recipient_email or getattr(recipient, "email", "")
    if not recipient or not recipient.is_active or not recipient_email:
        return None
    if not email_allowed_for_recipient(recipient, email_type):
        return None

    delivery, created = EmailDelivery.objects.get_or_create(
        deduplication_key=deduplication_key,
        defaults={
            "recipient": recipient,
            "email_type": email_type,
            "recipient_email": recipient_email,
            "subject": subject,
            "related_entity_type": related_entity_type,
            "related_entity_id": related_entity_id,
        },
    )
    if not created:
        return delivery

    context = {
        "recipient_name": recipient.full_name,
        "subject": subject,
        "title": title,
        "preheader": preheader,
        "message": message,
        "details": details or [],
        "action_label": action_label,
        "action_url": action_url,
        "security_note": security_note or "For your security, never share verification codes, passwords, or payment credentials.",
        "footer_reason": footer_reason or "You received this transactional email because of important activity on your SportSpot account.",
        "highlight": highlight,
        "frontend_url": settings.FRONTEND_URL,
        "current_year": timezone.now().year,
    }

    delivery.attempts = 1
    delivery.save(update_fields=["attempts", "updated_at"])
    try:
        text_body = render_to_string("emails/transactional.txt", context)
        html_body = render_to_string("emails/transactional.html", context)
        email = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient_email],
        )
        email.attach_alternative(html_body, "text/html")
        email.send(fail_silently=False)
    except Exception as error:  # Email must never roll back the originating business event.
        delivery.status = EmailDelivery.Status.FAILED
        delivery.last_error = type(error).__name__[:300]
        delivery.save(update_fields=["status", "last_error", "updated_at"])
        logger.exception(
            "Transactional email delivery failed",
            extra={"delivery_id": delivery.id, "email_type": email_type},
        )
        return delivery

    delivery.status = EmailDelivery.Status.SENT
    delivery.sent_at = timezone.now()
    delivery.last_error = ""
    if settings.EMAIL_BACKEND.endswith(".console.EmailBackend"):
        delivery.status = EmailDelivery.Status.CONSOLE_PREVIEW
        delivery.sent_at = None
    delivery.save(update_fields=["status", "sent_at", "last_error", "updated_at"])
    return delivery


def schedule_email_verification_otp(user, otp, code):
    schedule_transactional_email(
        recipient=user,
        email_type=EmailDelivery.EmailType.EMAIL_VERIFICATION_OTP,
        subject="Verify your SportSpot email",
        title="Verify your email address",
        preheader="Your SportSpot verification code expires in 10 minutes.",
        message="Enter this six-digit code to finish creating your SportSpot account.",
        highlight=code,
        recipient_email=otp.email or user.email,
        details=[
            ("Expires in", "10 minutes"),
            ("Incorrect attempts allowed", "5"),
        ],
        deduplication_key=f"account:{user.id}:verification-otp:{otp.id}",
        security_note="SportSpot staff will never ask you to send this code by email, phone, or message.",
        footer_reason="This code was requested while creating or verifying your SportSpot account.",
        related_entity_type="email_verification_otp",
        related_entity_id=otp.id,
    )


def schedule_email_verified(user):
    schedule_transactional_email(
        recipient=user,
        email_type=EmailDelivery.EmailType.EMAIL_VERIFIED,
        subject="Your SportSpot email is verified",
        title="Email verified successfully",
        preheader="Your SportSpot account is ready for secure sign-in.",
        message="Your email address has been verified. You can now sign in and use the features available for your account role.",
        action_label="Sign in to SportSpot",
        action_url=frontend_url("/login"),
        deduplication_key=f"account:{user.id}:email-verified",
        footer_reason="This confirmation was sent because your SportSpot email verification was completed.",
        related_entity_type="user",
        related_entity_id=user.id,
    )


def schedule_password_reset(user, reset_token, raw_token):
    schedule_transactional_email(
        recipient=user,
        email_type=EmailDelivery.EmailType.PASSWORD_RESET,
        subject="Reset your SportSpot password",
        title="Reset your password",
        preheader="This secure password-reset link expires in 15 minutes.",
        message="We received a request to reset your SportSpot password. Use the button below to choose a new password.",
        action_label="Reset Password",
        action_url=frontend_url(f"/reset-password?token={raw_token}"),
        details=[("Link validity", "15 minutes"), ("Usage", "Single use")],
        deduplication_key=f"account:{user.id}:password-reset:{reset_token.id}",
        security_note="If you did not request this change, ignore this email. Your existing password will continue to work.",
        footer_reason="This email was sent because a password reset was requested for your SportSpot account.",
        related_entity_type="password_reset_token",
        related_entity_id=reset_token.id,
    )


def schedule_password_changed(user, reset_token):
    schedule_transactional_email(
        recipient=user,
        email_type=EmailDelivery.EmailType.PASSWORD_CHANGED,
        subject="Your SportSpot password was changed",
        title="Password changed successfully",
        preheader="Your SportSpot password has been updated and previous sessions were invalidated.",
        message="Your password was changed successfully. For protection, previously issued SportSpot sessions can no longer access your account.",
        action_label="Sign in again",
        action_url=frontend_url("/login"),
        deduplication_key=f"account:{user.id}:password-changed:{reset_token.id}",
        security_note="If you did not make this change, contact SportSpot support immediately.",
        footer_reason="This security confirmation was sent because the password on your SportSpot account changed.",
        related_entity_type="password_reset_token",
        related_entity_id=reset_token.id,
    )


def booking_details(booking):
    slots = booking.booked_slots
    booking_time = (
        f"{slots[0].start_time.strftime('%I:%M %p').lstrip('0')} - {slots[-1].end_time.strftime('%I:%M %p').lstrip('0')}"
        if slots
        else ""
    )
    return [
        ("Booking code", booking.booking_code),
        ("Venue", booking.venue.name),
        ("Court", booking.court.name),
        ("Date", slots[0].date.strftime("%d %b %Y") if slots else ""),
        ("Time", booking_time),
        ("Amount", f"Rs {booking.amount}"),
        ("Booking status", booking.get_status_display()),
    ]


def schedule_booking_confirmed(booking, recipient, *, owner_copy=False):
    schedule_transactional_email(
        recipient=recipient,
        email_type=EmailDelivery.EmailType.BOOKING_CONFIRMED,
        subject=f"Booking confirmed: {booking.booking_code}",
        title="New confirmed booking" if owner_copy else "Your booking is confirmed",
        preheader=f"{booking.court.name} at {booking.venue.name} is confirmed.",
        message=(
            f"{booking.player.full_name} completed payment for this booking."
            if owner_copy
            else "Your payment was successful and all selected court slots are now secured."
        ),
        details=booking_details(booking),
        action_label="View Owner Bookings" if owner_copy else "View Booking Pass",
        action_url=frontend_url(
            "/dashboard/owner/bookings"
            if owner_copy
            else f"/dashboard/player/bookings/{booking.id}"
        ),
        deduplication_key=f"booking:{booking.id}:confirmed-email:{recipient.id}",
        footer_reason="This transactional email confirms an important SportSpot court booking.",
        related_entity_type="booking",
        related_entity_id=booking.id,
    )


def schedule_booking_payment_failed(booking):
    schedule_transactional_email(
        recipient=booking.player,
        email_type=EmailDelivery.EmailType.BOOKING_PAYMENT_FAILED,
        subject=f"Payment failed: {booking.booking_code}",
        title="Booking payment failed",
        preheader="Your reserved court slots were released.",
        message="Payment was not completed, so this reservation expired and its court slots are available again.",
        details=booking_details(booking),
        action_label="Browse Courts",
        action_url=frontend_url("/courts"),
        deduplication_key=f"booking:{booking.id}:payment-failed-email",
        footer_reason="This email was sent because payment for a SportSpot booking did not complete.",
        related_entity_type="booking",
        related_entity_id=booking.id,
    )


def schedule_booking_cancelled(booking, recipient, *, cancelled_by_venue):
    recipient_is_player = recipient.id == booking.player_id
    if cancelled_by_venue:
        title = "Booking cancelled by venue" if recipient_is_player else "Venue cancellation recorded"
        message = (
            "The venue cancelled this booking. Review the cancellation reason and refund status below."
            if recipient_is_player
            else "The venue cancellation was recorded and the player was informed."
        )
    else:
        title = "Your booking was cancelled" if recipient_is_player else "Player cancelled a booking"
        message = (
            "Your cancellation was recorded. Review the final refund status below."
            if recipient_is_player
            else f"{booking.player.full_name} cancelled this booking."
        )
    schedule_transactional_email(
        recipient=recipient,
        email_type=EmailDelivery.EmailType.BOOKING_CANCELLED,
        subject=f"Booking cancelled: {booking.booking_code}",
        title=title,
        preheader=f"Cancellation update for {booking.booking_code}.",
        message=message,
        details=[
            *booking_details(booking),
            ("Cancellation reason", booking.cancellation_reason or "Not provided"),
            ("Refund status", booking.get_refund_status_display()),
            ("Refund amount", f"Rs {booking.refund_amount}"),
        ],
        action_label="View Booking",
        action_url=frontend_url(
            f"/dashboard/player/bookings/{booking.id}"
            if recipient_is_player
            else "/dashboard/owner/bookings"
        ),
        deduplication_key=f"booking:{booking.id}:cancelled-email:{recipient.id}",
        footer_reason="This email was sent because an important SportSpot court booking was cancelled.",
        related_entity_type="booking",
        related_entity_id=booking.id,
    )


def schedule_refund_pending(booking, recipient, *, owner_copy=False):
    schedule_transactional_email(
        recipient=recipient,
        email_type=EmailDelivery.EmailType.REFUND_PENDING,
        subject=f"Refund pending: {booking.booking_code}",
        title="Refund requires processing" if owner_copy else "Your refund is pending",
        preheader=f"Refund update for {booking.booking_code}.",
        message=(
            "SportSpot calculated this refund from the booking policy. Record processing after returning the payment."
            if owner_copy
            else "Your cancellation qualifies for a refund. The venue owner has been asked to process it."
        ),
        details=[
            *booking_details(booking),
            ("Refund percentage", f"{booking.refund_percentage}%"),
            ("Refund amount", f"Rs {booking.refund_amount}"),
        ],
        action_label="Process Refund" if owner_copy else "View Refund Status",
        action_url=frontend_url(
            "/dashboard/owner/refunds"
            if owner_copy
            else f"/dashboard/player/bookings/{booking.id}"
        ),
        deduplication_key=f"booking:{booking.id}:refund-pending-email:{recipient.id}",
        footer_reason="This email was sent because a SportSpot booking entered the refund process.",
        related_entity_type="booking",
        related_entity_id=booking.id,
    )


def schedule_refund_completed(booking):
    schedule_transactional_email(
        recipient=booking.player,
        email_type=EmailDelivery.EmailType.REFUND_COMPLETED,
        subject=f"Refund completed: {booking.booking_code}",
        title="Refund marked as completed",
        preheader=f"The refund for {booking.booking_code} was processed.",
        message="The venue owner recorded the eligible refund as processed.",
        details=[
            *booking_details(booking),
            ("Refund amount", f"Rs {booking.refund_amount}"),
            ("Processing note", booking.refund_owner_note),
        ],
        action_label="View Booking",
        action_url=frontend_url(f"/dashboard/player/bookings/{booking.id}"),
        deduplication_key=f"booking:{booking.id}:refund-completed-email:{booking.refund_status}",
        footer_reason="This email was sent because the refund status of your SportSpot booking changed.",
        related_entity_type="booking",
        related_entity_id=booking.id,
    )


def schedule_venue_submitted(venue):
    schedule_transactional_email(
        recipient=venue.owner,
        email_type=EmailDelivery.EmailType.VENUE_SUBMITTED,
        subject=f"Venue submitted: {venue.name}",
        title="Venue submitted for verification",
        preheader=f"{venue.name} is waiting for SportSpot admin review.",
        message="Your venue submission was received. It remains hidden from players until verification is completed.",
        details=[
            ("Venue", venue.name),
            ("Status", venue.get_status_display()),
            ("Location", f"{venue.area}, {venue.city}"),
        ],
        action_label="View Venue Status",
        action_url=frontend_url("/dashboard/owner"),
        deduplication_key=f"venue:{venue.id}:submitted-email:{venue.submitted_at.isoformat() if venue.submitted_at else venue.updated_at.isoformat()}",
        footer_reason="This email confirms that your SportSpot venue was submitted for verification.",
        related_entity_type="venue",
        related_entity_id=venue.id,
    )


def schedule_venue_status(venue):
    status_messages = {
        "APPROVED": ("Venue approved", "Your venue is approved and can now appear to players."),
        "NEEDS_CHANGES": ("Venue changes required", "Review the admin note, update the submission, and resubmit it."),
        "REJECTED": ("Venue submission rejected", "Review the admin reason before deciding whether to revise your venue."),
        "SUSPENDED": ("Venue suspended", "Your venue is hidden from players. Review the admin note for the reason."),
    }
    title, message = status_messages.get(
        venue.status,
        ("Venue status updated", "The verification status of your venue changed."),
    )
    schedule_transactional_email(
        recipient=venue.owner,
        email_type=EmailDelivery.EmailType.VENUE_STATUS,
        subject=f"{title}: {venue.name}",
        title=title,
        preheader=f"Verification update for {venue.name}.",
        message=message,
        details=[
            ("Venue", venue.name),
            ("Status", venue.get_status_display()),
            ("Admin note", venue.admin_review_note or "No additional note"),
        ],
        action_label="Open Venue Dashboard",
        action_url=frontend_url(
            "/dashboard/owner/venue-setup"
            if venue.status in ["NEEDS_CHANGES", "REJECTED"]
            else "/dashboard/owner"
        ),
        deduplication_key=f"venue:{venue.id}:status-email:{venue.status}:{venue.reviewed_at.isoformat() if venue.reviewed_at else venue.updated_at.isoformat()}",
        footer_reason="This email was sent because the verification status of your SportSpot venue changed.",
        related_entity_type="venue",
        related_entity_id=venue.id,
    )


def schedule_team_invitation(member):
    schedule_transactional_email(
        recipient=member.user,
        email_type=EmailDelivery.EmailType.TEAM_INVITATION,
        subject=f"Team invitation: {member.team.name}",
        title="You have a Cricksal team invitation",
        preheader=f"{member.team.captain.full_name} invited you to {member.team.name}.",
        message="Review the team profile and invitation details before accepting or rejecting.",
        details=[
            ("Team", member.team.name),
            ("Captain", member.team.captain.full_name),
            ("Location", member.team.location),
            ("Invited role", member.get_cricksal_role_display()),
        ],
        action_label="Review Invitation",
        action_url=frontend_url("/dashboard/player/invitations"),
        deduplication_key=f"team-member:{member.id}:invitation-email",
        footer_reason="This email was sent because a SportSpot team captain invited you to a Cricksal team.",
        related_entity_type="team_member",
        related_entity_id=member.id,
    )


def schedule_venue_message(booking_message):
    booking = booking_message.booking
    schedule_transactional_email(
        recipient=booking.player,
        email_type=EmailDelivery.EmailType.VENUE_MESSAGE,
        subject=f"Important message from {booking.venue.name}",
        title=booking_message.get_message_type_display(),
        preheader=f"An important update about booking {booking.booking_code}.",
        message=booking_message.message,
        details=booking_details(booking),
        action_label="View Booking",
        action_url=frontend_url(f"/dashboard/player/bookings/{booking.id}"),
        deduplication_key=f"booking-message:{booking_message.id}:email",
        footer_reason="This email was sent because your venue posted an important update about a valid booking.",
        related_entity_type="booking_message",
        related_entity_id=booking_message.id,
    )


def schedule_booking_reminder(booking):
    schedule_transactional_email(
        recipient=booking.player,
        email_type=EmailDelivery.EmailType.BOOKING_REMINDER,
        subject=f"Upcoming booking reminder: {booking.booking_code}",
        title="Your Cricksal booking is coming up",
        preheader=f"Reminder for your booking at {booking.venue.name}.",
        message="Your confirmed booking starts within the next 24 hours. Please review venue instructions and arrive on time.",
        details=booking_details(booking),
        action_label="View Booking Pass",
        action_url=frontend_url(f"/dashboard/player/bookings/{booking.id}"),
        deduplication_key=f"booking:{booking.id}:reminder-email:24h",
        footer_reason="This reminder was sent for an upcoming confirmed SportSpot booking.",
        related_entity_type="booking",
        related_entity_id=booking.id,
    )
