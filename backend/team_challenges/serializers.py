from rest_framework import serializers
from django.utils import timezone

from teams.models import Team, TeamMember
from venues.models import Booking
from venues.reference_data import SPORTSPOT_AREAS_BY_DISTRICT, SPORTSPOT_DISTRICTS

from .models import (
    ChallengeProposal,
    OpenChallengeResponse,
    TeamChallenge,
    TeamFixture,
    TeamFixtureParticipant,
)


CHALLENGE_INTENSITY_CHOICES = (
    ("CASUAL", "Casual"),
    ("COMPETITIVE", "Competitive"),
    ("PRACTICE", "Practice"),
)


CHALLENGE_SORT_CHOICES = (
    ("recommended", "Recommended"),
    ("date_asc", "Earliest match"),
    ("deadline_asc", "Response deadline"),
    ("updated_desc", "Recently updated"),
    ("name_asc", "Team name"),
)

class TeamChallengeFilterSerializer(serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=100)
    district = serializers.CharField(required=False, allow_blank=True, max_length=50)
    area = serializers.CharField(required=False, allow_blank=True, max_length=100)
    skill_level = serializers.ChoiceField(required=False, choices=Team.SkillLevel.choices)
    intensity = serializers.ChoiceField(required=False, choices=CHALLENGE_INTENSITY_CHOICES)
    court_mode = serializers.ChoiceField(required=False, choices=TeamChallenge.CourtMode.choices)
    players_per_side = serializers.IntegerField(required=False, min_value=2, max_value=30)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    scope = serializers.ChoiceField(
        required=False,
        choices=(
            ("all", "All"),
            ("sent", "Sent"),
            ("received", "Received"),
            ("open", "Open"),
            ("closed", "Closed"),
        ),
    )
    status = serializers.ChoiceField(required=False, choices=TeamChallenge.Status.choices)
    sort = serializers.ChoiceField(required=False, choices=CHALLENGE_SORT_CHOICES)

    def validate(self, attrs):
        district = attrs.get("district", "").strip()
        area = attrs.get("area", "").strip()
        if district and district.casefold() not in {item.casefold() for item in SPORTSPOT_DISTRICTS}:
            raise serializers.ValidationError({"district": "Choose a supported district."})
        if area:
            if not district:
                raise serializers.ValidationError({"area": "Choose a district before choosing an area."})
            canonical_district = next(item for item in SPORTSPOT_DISTRICTS if item.casefold() == district.casefold())
            if area.casefold() not in {item.casefold() for item in SPORTSPOT_AREAS_BY_DISTRICT.get(canonical_district, [])}:
                raise serializers.ValidationError({"area": "Choose an area within the selected district."})
            attrs["district"] = canonical_district
            attrs["area"] = next(item for item in SPORTSPOT_AREAS_BY_DISTRICT[canonical_district] if item.casefold() == area.casefold())
        elif district:
            attrs["district"] = next(item for item in SPORTSPOT_DISTRICTS if item.casefold() == district.casefold())
        if attrs.get("date_from") and attrs.get("date_to") and attrs["date_from"] > attrs["date_to"]:
            raise serializers.ValidationError({"date_to": "The end date must be on or after the start date."})
        return attrs


def is_active_registered_captain(team, user):
    return bool(
        team
        and team.captain_id == getattr(user, "id", None)
        and getattr(user, "role", None) == "PLAYER"
        and getattr(user, "is_active", False)
        and TeamMember.objects.filter(
            team=team,
            user=user,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).exists()
    )


class ChallengeTeamSummarySerializer(serializers.ModelSerializer):
    captain_name = serializers.CharField(source="captain.full_name", read_only=True)
    members_count = serializers.SerializerMethodField()
    team_photo = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = (
            "id",
            "name",
            "team_photo",
            "description",
            "location",
            "preferred_playing_area",
            "preferred_playing_time",
            "skill_level",
            "accepts_team_challenges",
            "captain_name",
            "members_count",
            "created_at",
        )

    def get_team_photo(self, team):
        return team.team_photo.url if team.team_photo else ""

    def get_members_count(self, team):
        annotated_count = getattr(team, "active_members_total", None)
        if annotated_count is not None:
            return annotated_count
        return team.members.filter(status="ACTIVE").count()


class ChallengeBookingSummarySerializer(serializers.ModelSerializer):
    venue_name = serializers.CharField(source="venue.name", read_only=True)
    venue_area = serializers.CharField(source="venue.area", read_only=True)
    venue_city = serializers.CharField(source="venue.city", read_only=True)
    court_name = serializers.CharField(source="court.name", read_only=True)
    start_at = serializers.SerializerMethodField()
    end_at = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = (
            "id",
            "booking_code",
            "venue_name",
            "venue_area",
            "venue_city",
            "court_name",
            "start_at",
            "end_at",
            "amount",
            "status",
            "payment_status",
        )

    def get_start_at(self, booking):
        slots = booking.booked_slots
        if not slots:
            return None
        from datetime import datetime
        from django.utils import timezone

        return timezone.make_aware(
            datetime.combine(slots[0].date, slots[0].start_time),
            timezone.get_current_timezone(),
        ).isoformat()

    def get_end_at(self, booking):
        slots = booking.booked_slots
        if not slots:
            return None
        from datetime import datetime
        from django.utils import timezone

        return timezone.make_aware(
            datetime.combine(slots[-1].date, slots[-1].end_time),
            timezone.get_current_timezone(),
        ).isoformat()


class ChallengeProposalSerializer(serializers.ModelSerializer):
    created_by_team_name = serializers.CharField(source="created_by_team.name", read_only=True)
    booking_summary = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = ChallengeProposal
        fields = (
            "id",
            "version",
            "created_by_team",
            "created_by_team_name",
            "court_mode",
            "booking_summary",
            "proposed_date",
            "proposed_start_time",
            "proposed_end_time",
            "preferred_district",
            "preferred_area",
            "preferred_venue_name",
            "players_per_side",
            "intensity",
            "message",
            "response_deadline",
            "booking_deadline",
            "challenger_decision",
            "challenged_decision",
            "created_at",
            "is_current",
        )

    def get_booking_summary(self, proposal):
        if not proposal.booking_id:
            return None
        return ChallengeBookingSummarySerializer(proposal.booking, context=self.context).data

    def get_is_current(self, proposal):
        challenge = getattr(proposal, "challenge", None)
        return bool(challenge and challenge.current_proposal_id == proposal.id)


class OpenChallengeResponseSerializer(serializers.ModelSerializer):
    responding_team = ChallengeTeamSummarySerializer(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = OpenChallengeResponse
        fields = (
            "id",
            "responding_team",
            "message",
            "status",
            "status_label",
            "created_at",
            "updated_at",
        )


class TeamFixtureSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    room_state = serializers.SerializerMethodField()
    room_access = serializers.SerializerMethodField()
    booking_summary = serializers.SerializerMethodField()
    participants = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = TeamFixture
        fields = (
            "id", "status", "status_label", "room_state", "room_access", "booking_summary", "result",
            "result_submitted_at", "result_confirmed_at", "participants",
            "permissions", "created_at", "updated_at",
        )

    def _actor_access(self, fixture):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False, False
        challenge = fixture.challenge
        is_captain = any(
            team and is_active_registered_captain(team, user)
            for team in [challenge.challenger_team, challenge.challenged_team]
        )
        is_participant = TeamFixtureParticipant.objects.filter(
            fixture=fixture,
            player=user,
            status__in=[
                TeamFixtureParticipant.Status.SELECTED,
                TeamFixtureParticipant.Status.ATTENDED,
                TeamFixtureParticipant.Status.ABSENT,
            ],
        ).exists()
        return is_captain, is_participant

    def get_room_state(self, fixture):
        if fixture.status == TeamFixture.Status.AWAITING_COURT:
            return "PLANNING"
        if fixture.status == TeamFixture.Status.RECONFIRMATION_REQUIRED:
            return "RECONFIRMATION"
        if fixture.status == TeamFixture.Status.SCHEDULED:
            return "CONFIRMED"
        if fixture.status == TeamFixture.Status.IN_PROGRESS:
            return "IN_PROGRESS"
        return "READ_ONLY"

    def get_room_access(self, fixture):
        is_captain, is_participant = self._actor_access(fixture)
        if not is_captain and not is_participant:
            return "NONE"
        return self.get_room_state(fixture)

    def get_booking_summary(self, fixture):
        if not fixture.booking_id or self.get_room_access(fixture) == "NONE":
            return None
        return ChallengeBookingSummarySerializer(fixture.booking, context=self.context).data

    def get_participants(self, fixture):
        if self.get_room_access(fixture) == "NONE":
            return []
        return TeamFixtureParticipantSerializer(
            fixture.participants.select_related("player", "team").all(),
            many=True,
            context=self.context,
        ).data

    def get_permissions(self, fixture):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return {
                "is_captain": False,
                "team_id": None,
                "can_manage_lineup": False,
                "can_record_attendance": False,
                "can_submit_result": False,
                "can_confirm_result": False,
            }
        challenge = fixture.challenge
        managed_team = next(
            (
                team
                for team in [challenge.challenger_team, challenge.challenged_team]
                if team and is_active_registered_captain(team, user)
            ),
            None,
        )
        if not managed_team:
            return {
                "is_captain": False,
                "team_id": None,
                "can_manage_lineup": False,
                "can_record_attendance": False,
                "can_submit_result": False,
                "can_confirm_result": False,
            }
        start_at = None
        if fixture.booking_id:
            booking = fixture.booking
            slots = list(booking.booked_slots)
            if slots:
                from datetime import datetime

                start_at = timezone.make_aware(
                    datetime.combine(slots[0].date, slots[0].start_time),
                    timezone.get_current_timezone(),
                )
        is_scheduled_before_start = fixture.status == TeamFixture.Status.SCHEDULED and (
            start_at is None or start_at > timezone.now()
        )
        is_completed = fixture.status == TeamFixture.Status.COMPLETED
        return {
            "is_captain": True,
            "team_id": managed_team.id,
            "can_manage_lineup": is_scheduled_before_start,
            "can_record_attendance": is_completed,
            "can_submit_result": bool(
                is_completed
                and not fixture.result_confirmed_at
                and (
                    not fixture.result
                    or fixture.result_submitted_by_id == user.id
                )
            ),
            "can_confirm_result": bool(
                is_completed
                and fixture.result
                and fixture.result_submitted_by_id
                and fixture.result_submitted_by_id != user.id
                and not fixture.result_confirmed_at
            ),
        }


class FixtureEligiblePlayerSerializer(serializers.ModelSerializer):
    player_id = serializers.IntegerField(source="user_id", read_only=True)
    player_name = serializers.CharField(source="user.full_name", read_only=True)
    sportspot_id = serializers.SerializerMethodField()
    skill_level = serializers.SerializerMethodField()

    class Meta:
        model = TeamMember
        fields = ("player_id", "player_name", "sportspot_id", "skill_level", "cricksal_role")

    def get_sportspot_id(self, member):
        profile = getattr(member.user, "player_profile", None)
        return profile.sportspot_id if profile else ""

    def get_skill_level(self, member):
        profile = getattr(member.user, "player_profile", None)
        return profile.skill_level if profile else ""


class TeamFixtureParticipantSerializer(serializers.ModelSerializer):
    player_name = serializers.CharField(source="player.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    sportspot_id = serializers.SerializerMethodField()

    class Meta:
        model = TeamFixtureParticipant
        fields = (
            "id", "team", "team_name", "player", "player_name", "sportspot_id",
            "status", "status_label", "attendance_recorded_at", "created_at",
        )

    def get_sportspot_id(self, participant):
        profile = getattr(participant.player, "player_profile", None)
        return profile.sportspot_id if profile else ""


class TeamChallengeSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    challenger_team = ChallengeTeamSummarySerializer(read_only=True)
    challenged_team = ChallengeTeamSummarySerializer(read_only=True)
    current_proposal = ChallengeProposalSerializer(read_only=True)
    booking_summary = serializers.SerializerMethodField()
    fixture = TeamFixtureSerializer(read_only=True)
    open_response_count = serializers.SerializerMethodField()
    open_responses = serializers.SerializerMethodField()
    my_open_response = serializers.SerializerMethodField()
    is_open_for_response = serializers.BooleanField(read_only=True)
    is_open_for_opponent_response = serializers.BooleanField(read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = TeamChallenge
        fields = (
            "id",
            "challenge_type",
            "court_mode",
            "status",
            "status_label",
            "is_public",
            "is_open_for_response",
            "is_open_for_opponent_response",
            "response_deadline",
            "booking_deadline",
            "reconfirmation_requested_at",
            "reconfirmation_deadline",
            "challenger_team",
            "challenged_team",
            "current_proposal",
            "booking_summary",
            "fixture",
            "open_response_count",
            "open_responses",
            "my_open_response",
            "permissions",
            "created_at",
            "updated_at",
        )

    def get_booking_summary(self, challenge):
        if not challenge.booking_id:
            return None
        return ChallengeBookingSummarySerializer(challenge.booking, context=self.context).data

    def get_open_response_count(self, challenge):
        annotated = getattr(challenge, "open_response_count", None)
        if annotated is not None:
            return annotated
        return challenge.open_responses.filter(status=OpenChallengeResponse.Status.PENDING).count()

    def get_open_responses(self, challenge):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return []
        if not challenge.challenger_team_id:
            return []
        if not is_active_registered_captain(challenge.challenger_team, user):
            return []
        return OpenChallengeResponseSerializer(
            challenge.open_responses.all(),
            many=True,
            context=self.context,
        ).data

    def get_my_open_response(self, challenge):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        response = challenge.open_responses.filter(responding_by=user).select_related(
            "responding_team",
            "responding_team__captain",
        ).first()
        return OpenChallengeResponseSerializer(response, context=self.context).data if response else None

    def get_permissions(self, challenge):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return {
                "is_captain": False,
                "is_challenger": False,
                "is_challenged": False,
                "can_respond": False,
                "can_accept": False,
                "can_counter": False,
                "can_withdraw": False,
                "can_cancel": False,
                "can_select_opponent": False,
                "can_attach_booking": False,
                "can_withdraw_response": False,
                "can_reconfirm": False,
                "can_reschedule": False,
                "can_view_room": False,
            }
        is_challenger = bool(
            challenge.challenger_team_id
            and is_active_registered_captain(challenge.challenger_team, user)
        )
        is_challenged = bool(
            challenge.challenged_team_id
            and is_active_registered_captain(challenge.challenged_team, user)
        )
        is_captain = bool(is_challenger or is_challenged)
        proposal = challenge.current_proposal
        has_pending_decision = bool(
            proposal
            and (
                (is_challenger and proposal.challenger_decision == ChallengeProposal.Decision.PENDING)
                or (is_challenged and proposal.challenged_decision == ChallengeProposal.Decision.PENDING)
            )
        )
        can_decide = is_captain and has_pending_decision and challenge.status in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED] and challenge.is_open_for_response and bool(challenge.challenged_team_id)
        can_respond = bool(
            challenge.is_open_for_opponent_response
            and not is_challenger
            and Team.objects.filter(
                captain=user,
                accepts_team_challenges=True,
                captain__role="PLAYER",
                captain__is_active=True,
                members__user=user,
                members__member_type=TeamMember.MemberType.REGISTERED,
                members__status=TeamMember.MemberStatus.ACTIVE,
            ).exists()
        )
        my_response = challenge.open_responses.filter(responding_by=user).first()
        can_withdraw_response = bool(
            my_response
            and my_response.status == OpenChallengeResponse.Status.PENDING
            and challenge.is_open_for_opponent_response
            and is_active_registered_captain(my_response.responding_team, user)
        )
        can_reconfirm = bool(
            is_captain
            and challenge.status == TeamChallenge.Status.RECONFIRMATION_REQUIRED
            and challenge.reconfirmation_deadline
            and challenge.reconfirmation_deadline > timezone.now()
            and proposal
            and (
                (is_challenger and proposal.challenger_decision == ChallengeProposal.Decision.PENDING)
                or (is_challenged and proposal.challenged_decision == ChallengeProposal.Decision.PENDING)
            )
        )
        can_counter = bool(
            is_captain
            and challenge.court_mode == TeamChallenge.CourtMode.PLAN_FIRST
            and challenge.status in [
                TeamChallenge.Status.OPEN,
                TeamChallenge.Status.COUNTERED,
                TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING,
            ]
        )
        can_reschedule = bool(
            is_captain
            and challenge.status == TeamChallenge.Status.CONFIRMED
            and challenge.booking_id
        )
        fixture = getattr(challenge, "fixture", None)
        can_view_room = bool(
            fixture
            and fixture.status in [
                TeamFixture.Status.AWAITING_COURT,
                TeamFixture.Status.SCHEDULED,
                TeamFixture.Status.IN_PROGRESS,
                TeamFixture.Status.COMPLETED,
                TeamFixture.Status.CANCELLED,
                TeamFixture.Status.RECONFIRMATION_REQUIRED,
            ]
            and (
                is_captain
                or TeamFixtureParticipant.objects.filter(
                    fixture=fixture,
                    player=user,
                    status__in=[
                        TeamFixtureParticipant.Status.SELECTED,
                        TeamFixtureParticipant.Status.ATTENDED,
                        TeamFixtureParticipant.Status.ABSENT,
                    ],
                ).exists()
            )
        )
        return {
            "is_captain": is_captain,
            "is_challenger": bool(is_challenger),
            "is_challenged": bool(is_challenged),
            "can_respond": can_respond,
            "can_accept": can_decide,
            "can_counter": can_counter,
            "can_withdraw": bool(is_challenger and challenge.is_open_for_response),
            "can_cancel": bool(is_captain and challenge.status in [
                TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING,
                TeamChallenge.Status.RECONFIRMATION_REQUIRED,
                TeamChallenge.Status.CONFIRMED,
            ]),
            "can_select_opponent": bool(is_challenger and challenge.is_open_for_opponent_response),
            "can_attach_booking": bool(is_captain and challenge.status == TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING and not challenge.booking_id),
            "can_withdraw_response": can_withdraw_response,
            "can_reconfirm": can_reconfirm,
            "can_reschedule": can_reschedule,
            "can_view_room": can_view_room,
        }


class TeamChallengeCreateSerializer(serializers.Serializer):
    challenge_type = serializers.ChoiceField(choices=TeamChallenge.ChallengeType.choices)
    challenger_team = serializers.PrimaryKeyRelatedField(queryset=Team.objects.all())
    challenged_team = serializers.PrimaryKeyRelatedField(queryset=Team.objects.all(), required=False, allow_null=True)
    court_mode = serializers.ChoiceField(choices=TeamChallenge.CourtMode.choices)
    booking = serializers.PrimaryKeyRelatedField(queryset=Booking.objects.all(), required=False, allow_null=True)
    proposed_date = serializers.DateField(required=False, allow_null=True)
    proposed_start_time = serializers.TimeField(required=False, allow_null=True)
    proposed_end_time = serializers.TimeField(required=False, allow_null=True)
    preferred_district = serializers.CharField(required=False, allow_blank=True, max_length=50)
    preferred_area = serializers.CharField(required=False, allow_blank=True, max_length=100)
    preferred_venue_name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    players_per_side = serializers.IntegerField(min_value=2, max_value=30, default=6)
    intensity = serializers.ChoiceField(choices=[("CASUAL", "Casual"), ("COMPETITIVE", "Competitive"), ("PRACTICE", "Practice")], default="CASUAL")
    message = serializers.CharField(required=False, allow_blank=True, max_length=500)
    response_deadline = serializers.DateTimeField()
    booking_deadline = serializers.DateTimeField(required=False, allow_null=True)
    client_request_id = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate(self, attrs):
        challenge_type = attrs.get("challenge_type")
        court_mode = attrs.get("court_mode")
        if challenge_type == TeamChallenge.ChallengeType.DIRECT and not attrs.get("challenged_team"):
            raise serializers.ValidationError({"challenged_team": "Choose the team you want to challenge."})
        if challenge_type == TeamChallenge.ChallengeType.OPEN and attrs.get("challenged_team"):
            raise serializers.ValidationError({"challenged_team": "Open challenges do not select an opponent yet."})
        if court_mode == TeamChallenge.CourtMode.BOOKING_FIRST and not attrs.get("booking"):
            raise serializers.ValidationError({"booking": "Choose a confirmed booking."})
        if court_mode == TeamChallenge.CourtMode.PLAN_FIRST:
            missing = [field for field in ("proposed_date", "proposed_start_time", "proposed_end_time") if not attrs.get(field)]
            if missing:
                raise serializers.ValidationError({field: "This field is required for a planned challenge." for field in missing})
            if not attrs.get("booking_deadline"):
                raise serializers.ValidationError({"booking_deadline": "Choose a court-booking deadline."})
        elif attrs.get("booking_deadline"):
            raise serializers.ValidationError({"booking_deadline": "A booking deadline is only used for a planned challenge."})
        if attrs.get("proposed_start_time") and attrs.get("proposed_end_time") and attrs["proposed_end_time"] <= attrs["proposed_start_time"]:
            raise serializers.ValidationError({"proposed_end_time": "End time must be after start time."})
        return attrs


class ChallengeDecisionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=[("ACCEPT", "Accept"), ("DECLINE", "Decline")])


class ChallengeCounterSerializer(serializers.Serializer):
    court_mode = serializers.ChoiceField(choices=[(TeamChallenge.CourtMode.PLAN_FIRST, "Plan first")], default=TeamChallenge.CourtMode.PLAN_FIRST)
    proposed_date = serializers.DateField()
    proposed_start_time = serializers.TimeField()
    proposed_end_time = serializers.TimeField()
    preferred_district = serializers.CharField(required=False, allow_blank=True, max_length=50)
    preferred_area = serializers.CharField(required=False, allow_blank=True, max_length=100)
    preferred_venue_name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    players_per_side = serializers.IntegerField(min_value=2, max_value=30, default=6)
    intensity = serializers.ChoiceField(choices=[("CASUAL", "Casual"), ("COMPETITIVE", "Competitive"), ("PRACTICE", "Practice")], default="CASUAL")
    message = serializers.CharField(required=False, allow_blank=True, max_length=500)
    response_deadline = serializers.DateTimeField()
    booking_deadline = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs["proposed_end_time"] <= attrs["proposed_start_time"]:
            raise serializers.ValidationError({"proposed_end_time": "End time must be after start time."})
        if not attrs.get("booking_deadline"):
            raise serializers.ValidationError({"booking_deadline": "Choose a court-booking deadline."})
        return attrs


class OpenChallengeResponseCreateSerializer(serializers.Serializer):
    team_id = serializers.PrimaryKeyRelatedField(source="team", queryset=Team.objects.all())
    message = serializers.CharField(required=False, allow_blank=True, max_length=500)


class OpenOpponentSelectionSerializer(serializers.Serializer):
    response_id = serializers.IntegerField(min_value=1)


class ChallengeBookingAttachSerializer(serializers.Serializer):
    booking_id = serializers.PrimaryKeyRelatedField(source="booking", queryset=Booking.objects.all())


class ChallengeReconfirmationSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=[("ACCEPT", "Accept"), ("DECLINE", "Decline")])


class ChallengeRescheduleSerializer(serializers.Serializer):
    booking_id = serializers.PrimaryKeyRelatedField(source="booking", queryset=Booking.objects.all())
    response_deadline = serializers.DateTimeField()
    players_per_side = serializers.IntegerField(min_value=2, max_value=30, required=False)
    intensity = serializers.ChoiceField(
        choices=[("CASUAL", "Casual"), ("COMPETITIVE", "Competitive"), ("PRACTICE", "Practice")],
        required=False,
    )
    message = serializers.CharField(required=False, allow_blank=True, max_length=500)


class OpenChallengeResponseWithdrawSerializer(serializers.Serializer):
    response_id = serializers.IntegerField(min_value=1)


class FixtureParticipantCreateSerializer(serializers.Serializer):
    player_id = serializers.IntegerField(min_value=1)


class FixtureAttendanceSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[("ATTENDED", "Attended"), ("ABSENT", "Absent")])


class FixtureResultSerializer(serializers.Serializer):
    result = serializers.CharField(min_length=2, max_length=200)
