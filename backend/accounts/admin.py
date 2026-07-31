from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import EmailVerificationOTP, PasswordResetToken, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    model = User
    list_display = ("email", "full_name", "phone", "role", "email_verified", "is_active", "is_staff")
    list_filter = ("role", "email_verified", "is_active", "is_staff")
    ordering = ("email",)
    search_fields = ("email", "full_name", "phone")

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal information", {"fields": ("full_name", "phone", "role", "email_verified", "email_verified_at")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Security", {"fields": ("auth_version",)}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "full_name",
                    "phone",
                    "role",
                    "password1",
                    "password2",
                    "is_staff",
                    "is_superuser",
                    "email_verified",
                ),
            },
        ),
    )


@admin.register(EmailVerificationOTP)
class EmailVerificationOTPAdmin(admin.ModelAdmin):
    list_display = ("user", "attempts", "expires_at", "used_at", "invalidated_at", "created_at")
    list_filter = ("used_at", "invalidated_at", "created_at")
    search_fields = ("user__email",)
    readonly_fields = ("code_hash",)


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "expires_at", "used_at", "invalidated_at", "created_at")
    list_filter = ("used_at", "invalidated_at", "created_at")
    search_fields = ("user__email",)
    readonly_fields = ("token_hash",)
