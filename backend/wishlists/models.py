from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from accounts.models import User
from venues.models import Court, Venue


class WishlistItem(models.Model):
    class ItemType(models.TextChoices):
        VENUE = "VENUE", "Venue"
        COURT = "COURT", "Court"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wishlist_items")
    item_type = models.CharField(max_length=20, choices=ItemType.choices)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="wishlist_items", blank=True, null=True)
    court = models.ForeignKey(Court, on_delete=models.CASCADE, related_name="wishlist_items", blank=True, null=True)
    note = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "venue"], condition=Q(item_type="VENUE"), name="unique_player_wishlist_venue"),
            models.UniqueConstraint(fields=["user", "court"], condition=Q(item_type="COURT"), name="unique_player_wishlist_court"),
        ]

    def clean(self):
        if self.user_id and self.user.role != User.Role.PLAYER:
            raise ValidationError("Only player accounts can use wishlist.")
        if self.item_type == self.ItemType.VENUE:
            if not self.venue_id or self.court_id:
                raise ValidationError("A venue wishlist item must reference one venue only.")
        elif self.item_type == self.ItemType.COURT:
            if not self.court_id or self.venue_id:
                raise ValidationError("A court wishlist item must reference one court only.")
        else:
            raise ValidationError("Choose a valid wishlist item type.")

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        target = self.venue or self.court
        return f"{self.user.email} saved {target}"
