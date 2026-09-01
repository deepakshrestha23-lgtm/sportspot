from rest_framework import serializers

from .models import CricketDelivery, CricketMatch


class ScoringMatchRequestCreateSerializer(serializers.Serializer):
    challenger_team_id = serializers.IntegerField(min_value=1)
    challenged_team_id = serializers.IntegerField(min_value=1)
    client_request_id = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate(self, attrs):
        if attrs["challenger_team_id"] == attrs["challenged_team_id"]:
            raise serializers.ValidationError("Choose a different opponent team.")
        return attrs


class ScorecardSetupSerializer(serializers.Serializer):
    overs_per_innings = serializers.IntegerField(min_value=1, max_value=50)


class ScorecardSquadSerializer(serializers.Serializer):
    player_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        min_length=2,
        max_length=30,
    )


class ScorerAssignmentSerializer(serializers.Serializer):
    scorer_id = serializers.IntegerField(min_value=1)


class TossSerializer(serializers.Serializer):
    winner_team_id = serializers.IntegerField(min_value=1)
    decision = serializers.ChoiceField(choices=CricketMatch.TossDecision.choices)


class InningsStartSerializer(serializers.Serializer):
    striker_id = serializers.IntegerField(min_value=1)
    non_striker_id = serializers.IntegerField(min_value=1)
    bowler_id = serializers.IntegerField(min_value=1)


class BowlerChangeSerializer(serializers.Serializer):
    bowler_id = serializers.IntegerField(min_value=1)


class DeliverySerializer(serializers.Serializer):
    runs_off_bat = serializers.IntegerField(min_value=0, max_value=6, required=False, default=0)
    extra_type = serializers.ChoiceField(choices=CricketDelivery.ExtraType.choices, required=False, default=CricketDelivery.ExtraType.NONE)
    extra_runs = serializers.IntegerField(min_value=0, max_value=7, required=False, default=0)
    wicket_kind = serializers.ChoiceField(choices=CricketDelivery.WicketKind.choices, required=False, default=CricketDelivery.WicketKind.NONE)
    dismissed_player_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    fielder_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    incoming_batsman_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
