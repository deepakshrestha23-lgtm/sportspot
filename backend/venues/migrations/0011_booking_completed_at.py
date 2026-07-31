from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("venues", "0010_booking_cancellation_policy_snapshot_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
