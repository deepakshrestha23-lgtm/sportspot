from django.contrib import admin

from .models import EmailDelivery, Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "recipient",
        "notification_type",
        "category",
        "priority",
        "is_seen",
        "is_read",
        "action_status",
        "created_at",
    )
    list_filter = ("category", "priority", "notification_type", "is_seen", "is_read", "action_status", "created_at")
    search_fields = ("title", "message", "recipient__full_name", "recipient__email", "actor__full_name")
    readonly_fields = ("created_at", "updated_at", "seen_at", "read_at")


@admin.register(EmailDelivery)
class EmailDeliveryAdmin(admin.ModelAdmin):
    list_display = ("email_type", "recipient_email", "status", "attempts", "sent_at", "created_at")
    list_filter = ("email_type", "status", "created_at")
    search_fields = ("recipient_email", "subject", "deduplication_key")
    readonly_fields = (
        "recipient",
        "email_type",
        "recipient_email",
        "subject",
        "deduplication_key",
        "status",
        "related_entity_type",
        "related_entity_id",
        "attempts",
        "last_error",
        "sent_at",
        "created_at",
        "updated_at",
    )
