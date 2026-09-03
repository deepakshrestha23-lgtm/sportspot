from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("players", "0009_alter_participationcommitment_status_and_more")]

    operations = [
        migrations.AddField(model_name="playerprofile", name="latitude", field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True, validators=[MinValueValidator(Decimal("-90")), MaxValueValidator(Decimal("90"))])),
        migrations.AddField(model_name="playerprofile", name="location_confirmed", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="playerprofile", name="location_source", field=models.CharField(blank=True, choices=[("GEOCODED", "Place search"), ("MANUAL_PIN", "Map pin"), ("DEVICE_LOCATION", "Device location"), ("LEGACY_DISTRICT", "District only")], max_length=20)),
        migrations.AddField(model_name="playerprofile", name="location_updated_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="playerprofile", name="longitude", field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True, validators=[MinValueValidator(Decimal("-180")), MaxValueValidator(Decimal("180"))])),
        migrations.AddField(model_name="playerprofile", name="preferred_area", field=models.CharField(blank=True, max_length=120)),
        migrations.AddField(model_name="playerprofile", name="travel_radius_km", field=models.PositiveSmallIntegerField(default=10, validators=[MinValueValidator(1), MaxValueValidator(50)])),
    ]
