from django.conf import settings
from django.core import mail
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.core.exceptions import ValidationError


class Command(BaseCommand):
    help = "Send a real delivery test using the configured email backend."

    def add_arguments(self, parser):
        parser.add_argument("--to", required=True, help="Inbox that should receive the test email.")

    def handle(self, *args, **options):
        recipient = options["to"].strip().lower()
        try:
            validate_email(recipient)
        except ValidationError as error:
            raise CommandError("Enter a valid recipient email address.") from error

        if settings.EMAIL_BACKEND.endswith(".console.EmailBackend"):
            raise CommandError(
                "Email is still in console-preview mode. Configure SMTP before testing delivery."
            )
        if not settings.EMAIL_HOST or not settings.EMAIL_HOST_USER or not settings.EMAIL_HOST_PASSWORD:
            raise CommandError(
                "SMTP configuration is incomplete. EMAIL_HOST, EMAIL_HOST_USER, and "
                "EMAIL_HOST_PASSWORD are required."
            )

        connection = mail.get_connection(fail_silently=False)
        message = mail.EmailMultiAlternatives(
            subject="SportSpot email delivery test",
            body=(
                "SportSpot SMTP is configured correctly.\n\n"
                "Verification codes, password reset links, and important booking emails "
                "can now be delivered to real inboxes."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient],
            connection=connection,
        )
        message.attach_alternative(
            """
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px">
              <div style="font-weight:800;color:#15803d;font-size:22px">SportSpot</div>
              <h1 style="color:#0f172a">Email delivery is working</h1>
              <p style="color:#475569;line-height:1.6">
                SportSpot SMTP is configured correctly. Verification codes, password
                reset links, and important booking emails can now reach real inboxes.
              </p>
            </div>
            """,
            "text/html",
        )

        try:
            sent_count = message.send()
        except Exception as error:
            raise CommandError(
                f"SMTP delivery failed ({type(error).__name__}). Check the Gmail address, "
                "App Password, internet connection, and 2-Step Verification."
            ) from error

        if sent_count != 1:
            raise CommandError("The SMTP provider did not accept the test email.")

        self.stdout.write(
            self.style.SUCCESS(
                f"SMTP accepted the SportSpot test email for {recipient}. Check Inbox and Spam."
            )
        )
