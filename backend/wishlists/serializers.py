from rest_framework import serializers

from venues.models import Court, Venue
from .models import WishlistItem


class WishlistVenueSummarySerializer(serializers.ModelSerializer):
    court_count = serializers.SerializerMethodField()
    minimum_price = serializers.SerializerMethodField()
    primary_image = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = ("id", "name", "area", "city", "address", "facilities", "court_count", "minimum_price", "primary_image")

    def get_court_count(self, venue):
        return venue.courts.filter(is_active=True).count()

    def get_minimum_price(self, venue):
        price = venue.minimum_price
        return str(price) if price is not None else None

    def get_primary_image(self, venue):
        request = self.context.get("request")
        raw_image = ""
        if venue.front_photo:
            raw_image = venue.front_photo.url
        elif venue.court_area_photo:
            raw_image = venue.court_area_photo.url
        elif venue.additional_photo:
            raw_image = venue.additional_photo.url
        elif venue.photos.exists():
            raw_image = venue.photos.first().image.url
        if raw_image and request:
            return request.build_absolute_uri(raw_image)
        return raw_image


class WishlistCourtSummarySerializer(serializers.ModelSerializer):
    venue_name = serializers.CharField(source="venue.name", read_only=True)
    venue_area = serializers.CharField(source="venue.area", read_only=True)
    venue_city = serializers.CharField(source="venue.city", read_only=True)
    lowest_price = serializers.SerializerMethodField()
    primary_image = serializers.SerializerMethodField()

    class Meta:
        model = Court
        fields = ("id", "name", "court_type", "surface_type", "venue", "venue_name", "venue_area", "venue_city", "lowest_price", "primary_image")

    def get_lowest_price(self, court):
        slot = court.slots.order_by("price").first()
        return str(slot.price) if slot else None

    def get_primary_image(self, court):
        request = self.context.get("request")
        raw_image = court.court_photo.url if court.court_photo else ""
        if not raw_image and court.venue.front_photo:
            raw_image = court.venue.front_photo.url
        if raw_image and request:
            return request.build_absolute_uri(raw_image)
        return raw_image


class WishlistItemSerializer(serializers.ModelSerializer):
    venue_detail = WishlistVenueSummarySerializer(source="venue", read_only=True)
    court_detail = WishlistCourtSummarySerializer(source="court", read_only=True)

    class Meta:
        model = WishlistItem
        fields = ("id", "item_type", "venue", "court", "venue_detail", "court_detail", "note", "created_at")
        read_only_fields = fields


class WishlistToggleSerializer(serializers.Serializer):
    item_type = serializers.ChoiceField(choices=WishlistItem.ItemType.choices)
    venue_id = serializers.IntegerField(required=False)
    court_id = serializers.IntegerField(required=False)

    def validate(self, attrs):
        item_type = attrs["item_type"]
        venue_id = attrs.get("venue_id")
        court_id = attrs.get("court_id")
        if item_type == WishlistItem.ItemType.VENUE and not venue_id:
            raise serializers.ValidationError({"venue_id": "Choose a venue to save."})
        if item_type == WishlistItem.ItemType.COURT and not court_id:
            raise serializers.ValidationError({"court_id": "Choose a court to save."})
        if item_type == WishlistItem.ItemType.VENUE and court_id:
            raise serializers.ValidationError("Save either a venue or a court, not both.")
        if item_type == WishlistItem.ItemType.COURT and venue_id:
            raise serializers.ValidationError("Save either a venue or a court, not both.")
        return attrs
