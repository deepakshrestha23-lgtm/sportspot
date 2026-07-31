from django.contrib import admin

from .models import WishlistItem


@admin.register(WishlistItem)
class WishlistItemAdmin(admin.ModelAdmin):
    list_display = ("user", "item_type", "venue", "court", "created_at")
    list_filter = ("item_type", "created_at")
    search_fields = ("user__email", "user__full_name", "venue__name", "court__name")
