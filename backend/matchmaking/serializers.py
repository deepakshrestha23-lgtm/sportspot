from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from teams.models import Team, TeamMember
from venues.models import Booking
from venues.policies import get_booking_start_at
from venues.reference_data import (
    SPORTSPOT_AREAS_BY_DISTRICT,
    SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG,
    canonical_service_area,
)
from venues.serializers import BookingSerializer

from .models import (
    ACTIVE_PARTICIPANT_STATUSES,
    RECONFIRMATION_PENDING_STATUSES,
    Game,
    GameChatMessage,
    GameParticipant,
    GameRoleRequirement,
    JoinRequest,
    JoinRequestEvent,
)
from players.models import ParticipationCommitment
from players.services import get_attendance_submission_deadline
from sportspot_api.chat import can_edit_chat_message, chat_edit_deadline
from .services import (
    add_initial_participants,
    booking_end_at,
    eligible_bookings_for_user,
    ensure_booking_can_publish_game,
    game_room_access_level,
    next_waitlist_position,
    record_join_request_event,
    role_progress,
    validate_join_request,
    validate_role_plan,
)


class GameChatMessageSerializer(serializers.ModelSerializer):
    sender_id = serializers.IntegerField(source="sender.id", read_only=True, allow_null=True)
    body = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    is_deleted = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    edit_deadline_at = serializers.SerializerMethodField()

    class Meta:
        model = GameChatMessage
        fields = (
            "id",
            "sender_id",
            "sender_name",
            "body",
            "created_at",
            "edited_at",
            "is_deleted",
            "is_mine",
            "can_edit",
            "edit_deadline_at",
        )
        read_only_fields = fields

    def get_is_mine(self, message):
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and message.sender_id == request.user.id)

    def get_is_deleted(self, message):
        return message.deleted_at is not None

    def get_body(self, message):
        return "This message was deleted." if message.deleted_at else message.body

    def get_can_edit(self, message):
        request = self.context.get("request")
        return bool(request and can_edit_chat_message(message, request.user))

    def get_edit_deadline_at(self, message):
        if message.deleted_at:
            return None
        return chat_edit_deadline(message).isoformat()


class GameChatMessageCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=1000)
    client_message_id = serializers.CharField(max_length=64, required=False, allow_blank=True)

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Message cannot be empty.")
        return value

    def validate_client_message_id(self, value):
        return value.strip()


def default_deadline_before(start_at, hours):
    if not start_at:
        return None
    candidate = start_at - timezone.timedelta(hours=hours)
    now_plus_buffer = timezone.now() + timezone.timedelta(minutes=30)
    return candidate if candidate > now_plus_buffer else now_plus_buffer


def default_plan_first_deadlines(start_at):
    now = timezone.now()
    config = SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG
    booking_floor = now + timezone.timedelta(
        minutes=config["minimum_recruitment_to_booking_minutes"] + 15,
    )
    latest_booking = start_at - timezone.timedelta(minutes=config["minimum_booking_lead_minutes"])
    preferred_booking = start_at - timezone.timedelta(minutes=config["recommended_booking_lead_minutes"])
    booking_deadline = min(max(preferred_booking, booking_floor), latest_booking)

    recruitment_floor = now + timezone.timedelta(minutes=15)
    preferred_recruitment = start_at - timezone.timedelta(minutes=config["recommended_recruitment_lead_minutes"])
    recruitment_deadline = min(max(preferred_recruitment, recruitment_floor), booking_deadline - timezone.timedelta(minutes=config["minimum_recruitment_to_booking_minutes"]))
    return recruitment_deadline, booking_deadline


def format_duration_label(minutes):
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{minutes // 60}h {minutes % 60}m" if minutes > 60 else f"{minutes} minutes"


SUPPORTED_PLAN_AREAS = {
    area.casefold()
    for areas in SPORTSPOT_AREAS_BY_DISTRICT.values()
    for area in areas
}
AREA_TO_DISTRICT = {
    area.casefold(): district
    for district, areas in SPORTSPOT_AREAS_BY_DISTRICT.items()
    for area in areas
}


def normalize_plan_first_service_area(attrs, *, required=False):
    """Convert a map-picked code or legacy labels into canonical plan data."""
    provided_code = str(attrs.pop("preferred_area_code", "") or "").strip()
    provided_area = str(attrs.get("preferred_area") or "").strip()
    provided_district = str(attrs.get("preferred_district") or "").strip()
    if not (provided_code or provided_area):
        if required:
            raise serializers.ValidationError({"preferred_area": "Choose a supported SportSpot service area."})
        return attrs
    service_area = canonical_service_area(
        code=provided_code,
        area=provided_area,
        district=provided_district,
    )
    if not service_area:
        raise serializers.ValidationError({"preferred_area": "Choose a supported SportSpot service area."})
    attrs["preferred_area"] = service_area["label"]
    attrs["preferred_district"] = service_area["district"]
    return attrs


class GameRoleRequirementSerializer(serializers.ModelSerializer):
    role_label = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = GameRoleRequirement
        fields = ("id", "role", "role_label", "required_count")


class GameParticipantSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="display_name", read_only=True)
    sportspot_id = serializers.SerializerMethodField()
    skill_level = serializers.SerializerMethodField()
    reliability_label = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    profile_photo = serializers.SerializerMethodField()
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    participant_type_label = serializers.CharField(source="get_participant_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    reconfirmation_required = serializers.SerializerMethodField()
    reconfirmation_kind = serializers.SerializerMethodField()
    attendance = serializers.SerializerMethodField()

    class Meta:
        model = GameParticipant
        fields = (
            "id",
            "user",
            "full_name",
            "guest_name",
            "sportspot_id",
            "skill_level",
            "reliability_label",
            "average_rating",
            "profile_photo",
            "participant_type",
            "participant_type_label",
            "role",
            "role_label",
            "status",
            "status_label",
            "reconfirmation_required",
            "reconfirmation_kind",
            "attendance",
            "joined_at",
        )

    def get_reconfirmation_required(self, participant):
        return participant.status in RECONFIRMATION_PENDING_STATUSES

    def get_reconfirmation_kind(self, participant):
        if participant.status == GameParticipant.Status.RECONFIRM_REQUIRED:
            return "PLAYER_RESPONSE"
        if participant.status == GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED:
            return "HOST_ACKNOWLEDGEMENT"
        return "NONE"

    def get_sportspot_id(self, participant):
        return getattr(getattr(participant.user, "player_profile", None), "sportspot_id", "") if participant.user_id else ""

    def get_skill_level(self, participant):
        return getattr(getattr(participant.user, "player_profile", None), "skill_level", "") if participant.user_id else ""

    def get_reliability_label(self, participant):
        if not participant.user_id:
            return ""
        profile = getattr(participant.user, "player_profile", None)
        return getattr(profile, "reliability_label", "") if profile else ""

    def get_average_rating(self, participant):
        if not participant.user_id:
            return ""
        profile = getattr(participant.user, "player_profile", None)
        return str(getattr(profile, "average_rating", "")) if profile else ""

    def get_profile_photo(self, participant):
        if not participant.user_id:
            return ""
        profile = getattr(participant.user, "player_profile", None)
        if profile and profile.profile_photo:
            return profile.profile_photo.url
        return ""

    def get_attendance(self, participant):
        if not participant.user_id or participant.participant_type == GameParticipant.ParticipantType.GUEST:
            return {"status": "NOT_TRACKED", "review_deadline_at": None, "attendance_submission_deadline_at": None, "can_dispute": False}
        commitment = ParticipationCommitment.objects.filter(
            player_id=participant.user_id,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=participant.game_id,
            source_participant_id=participant.id,
        ).order_by("-source_version", "-id").first()
        if not commitment:
            return {"status": "NOT_CREATED", "review_deadline_at": None, "attendance_submission_deadline_at": None, "can_dispute": False}
        request = self.context.get("request")
        viewer = getattr(request, "user", None)
        return {
            "id": commitment.id,
            "status": commitment.status,
            "review_deadline_at": commitment.review_deadline_at.isoformat() if commitment.review_deadline_at else None,
            "attendance_submission_deadline_at": get_attendance_submission_deadline(commitment).isoformat(),
            "can_dispute": bool(
                viewer
                and viewer.is_authenticated
                and viewer.id == participant.user_id
                and commitment.status == ParticipationCommitment.Status.NO_SHOW_REPORTED
                and (not commitment.review_deadline_at or commitment.review_deadline_at > timezone.now())
            ),
        }


class JoinRequestSerializer(serializers.ModelSerializer):
    player_name = serializers.CharField(source="player.full_name", read_only=True)
    sportspot_id = serializers.SerializerMethodField()
    skill_level = serializers.SerializerMethodField()
    reliability_label = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    requested_role_label = serializers.CharField(source="get_requested_role_display", read_only=True)
    game_title = serializers.CharField(source="game.title", read_only=True)

    class Meta:
        model = JoinRequest
        fields = (
            "id",
            "game",
            "game_title",
            "player",
            "player_name",
            "sportspot_id",
            "skill_level",
            "reliability_label",
            "average_rating",
            "requested_role",
            "requested_role_label",
            "message",
            "attendance_confirmed",
            "status",
            "waitlist_position",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "game", "player", "status", "waitlist_position", "created_at", "updated_at")

    def get_sportspot_id(self, join_request):
        return getattr(getattr(join_request.player, "player_profile", None), "sportspot_id", "")

    def get_skill_level(self, join_request):
        return getattr(getattr(join_request.player, "player_profile", None), "skill_level", "")

    def get_reliability_label(self, join_request):
        profile = getattr(join_request.player, "player_profile", None)
        return getattr(profile, "reliability_label", "") if profile else ""

    def get_average_rating(self, join_request):
        profile = getattr(join_request.player, "player_profile", None)
        return str(getattr(profile, "average_rating", "")) if profile else ""


class GameHostUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=120, required=False)
    description = serializers.CharField(max_length=800, required=False, allow_blank=True)
    host_notes = serializers.CharField(max_length=500, required=False, allow_blank=True)
    reporting_instructions = serializers.CharField(max_length=500, required=False, allow_blank=True)
    equipment_instructions = serializers.CharField(max_length=500, required=False, allow_blank=True)
    game_intensity = serializers.ChoiceField(choices=Game.GameIntensity.choices, required=False)
    min_skill_level = serializers.ChoiceField(choices=Game.SkillLevel.choices, required=False)
    total_capacity = serializers.IntegerField(min_value=2, max_value=30, required=False)
    minimum_players_to_proceed = serializers.IntegerField(min_value=2, max_value=30, required=False)
    waitlist_enabled = serializers.BooleanField(required=False)
    recruitment_deadline = serializers.DateTimeField(required=False)
    proposed_date = serializers.DateField(required=False)
    proposed_start_time = serializers.TimeField(required=False)
    proposed_end_time = serializers.TimeField(required=False)
    preferred_district = serializers.CharField(max_length=50, required=False, allow_blank=True)
    preferred_area = serializers.CharField(max_length=100, required=False, allow_blank=True)
    preferred_area_code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    preferred_venue_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    alternative_details = serializers.CharField(max_length=300, required=False, allow_blank=True)
    booking_deadline = serializers.DateTimeField(required=False)
    role_requirements = GameRoleRequirementSerializer(many=True, required=False)

    def validate(self, attrs):
        if any(field in attrs for field in ("preferred_area_code", "preferred_area")):
            normalize_plan_first_service_area(attrs)
        else:
            attrs.pop("preferred_area_code", None)
        return attrs


class GameSerializer(serializers.ModelSerializer):
    host_name = serializers.CharField(source="host.full_name", read_only=True)
    host_sportspot_id = serializers.SerializerMethodField()
    host_reliability_label = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    team_photo = serializers.SerializerMethodField()
    team_location = serializers.SerializerMethodField()
    team_skill_level = serializers.SerializerMethodField()
    team_members_count = serializers.SerializerMethodField()
    squad_summary = serializers.SerializerMethodField()
    venue_name = serializers.SerializerMethodField()
    venue_area = serializers.SerializerMethodField()
    venue_city = serializers.SerializerMethodField()
    venue_address = serializers.SerializerMethodField()
    venue_latitude = serializers.SerializerMethodField()
    venue_longitude = serializers.SerializerMethodField()
    venue_map_location = serializers.SerializerMethodField()
    court_name = serializers.SerializerMethodField()
    booking_code = serializers.SerializerMethodField()
    booking_amount = serializers.SerializerMethodField()
    booking_status = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    booking_display_time = serializers.SerializerMethodField()
    start_at = serializers.SerializerMethodField()
    end_at = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    preferred_district = serializers.SerializerMethodField()
    preferred_area_code = serializers.SerializerMethodField()
    confirmed_participants_count = serializers.IntegerField(read_only=True)
    provisional_participants_count = serializers.IntegerField(read_only=True)
    occupied_spots_count = serializers.IntegerField(read_only=True)
    available_spots = serializers.IntegerField(read_only=True)
    waitlist_count = serializers.IntegerField(read_only=True)
    reconfirmation_pending_count = serializers.IntegerField(read_only=True)
    guest_confirmation_pending_count = serializers.IntegerField(read_only=True)
    registered_reconfirmation_pending_count = serializers.IntegerField(read_only=True)
    role_requirements = GameRoleRequirementSerializer(many=True, read_only=True)
    role_progress = serializers.SerializerMethodField()
    participants = serializers.SerializerMethodField()
    user_state = serializers.SerializerMethodField()
    is_booking_verified = serializers.BooleanField(read_only=True)
    creation_mode_label = serializers.CharField(source="get_creation_mode_display", read_only=True)
    game_intensity_label = serializers.CharField(source="get_game_intensity_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Game
        fields = (
            "id",
            "game_type",
            "creation_mode",
            "creation_mode_label",
            "game_intensity",
            "game_intensity_label",
            "status",
            "status_label",
            "title",
            "description",
            "host_notes",
            "game_room_note",
            "reporting_instructions",
            "equipment_instructions",
            "host",
            "host_name",
            "host_sportspot_id",
            "host_reliability_label",
            "team",
            "team_name",
            "team_photo",
            "team_location",
            "team_skill_level",
            "team_members_count",
            "squad_summary",
            "booking",
            "booking_code",
            "booking_amount",
            "booking_status",
            "payment_status",
            "venue_name",
            "venue_area",
            "venue_city",
            "venue_address",
            "venue_latitude",
            "venue_longitude",
            "venue_map_location",
            "court_name",
            "booking_display_time",
            "start_at",
            "end_at",
            "date",
            "proposed_date",
            "proposed_start_time",
            "proposed_end_time",
            "preferred_district",
            "preferred_area",
            "preferred_area_code",
            "preferred_venue_name",
            "alternative_details",
            "booking_deadline",
            "booking_attached_at",
            "requires_reconfirmation",
            "is_booking_verified",
            "min_skill_level",
            "total_capacity",
            "minimum_players_to_proceed",
            "waitlist_enabled",
            "recruitment_deadline",
            "is_public",
            "confirmed_participants_count",
            "provisional_participants_count",
            "occupied_spots_count",
            "available_spots",
            "waitlist_count",
            "reconfirmation_pending_count",
            "guest_confirmation_pending_count",
            "registered_reconfirmation_pending_count",
            "role_requirements",
            "role_progress",
            "participants",
            "user_state",
            "published_at",
            "created_at",
            "updated_at",
        )

    def get_host_sportspot_id(self, game):
        return getattr(getattr(game.host, "player_profile", None), "sportspot_id", "")

    def get_host_reliability_label(self, game):
        profile = getattr(game.host, "player_profile", None)
        return getattr(profile, "reliability_label", "") if profile else ""

    def get_preferred_district(self, game):
        return game.preferred_district or AREA_TO_DISTRICT.get((game.preferred_area or "").strip().casefold(), "")

    def get_preferred_area_code(self, game):
        service_area = canonical_service_area(
            area=game.preferred_area,
            district=game.preferred_district,
        )
        return service_area["code"] if service_area else ""

    def get_team_name(self, game):
        return game.team.name if game.team_id else ""

    def get_team_photo(self, game):
        if game.team_id and game.team.team_photo:
            return game.team.team_photo.url
        return ""

    def get_team_location(self, game):
        return game.team.location if game.team_id else ""

    def get_team_skill_level(self, game):
        return game.team.skill_level if game.team_id else ""

    def get_team_members_count(self, game):
        return game.team.active_members_count if game.team_id else 0

    def get_squad_summary(self, game):
        active_participants = list(game.participants.filter(status__in=ACTIVE_PARTICIPANT_STATUSES))
        permanent_roles = {}
        temporary_roles = {}
        for participant in active_participants:
            if participant.participant_type in [GameParticipant.ParticipantType.HOST, GameParticipant.ParticipantType.TEAM_MEMBER]:
                permanent_roles[participant.role] = permanent_roles.get(participant.role, 0) + 1
            if participant.participant_type in [GameParticipant.ParticipantType.TEMPORARY, GameParticipant.ParticipantType.GUEST]:
                temporary_roles[participant.role] = temporary_roles.get(participant.role, 0) + 1
        return {
            "permanent_count": sum(1 for participant in active_participants if participant.participant_type in [GameParticipant.ParticipantType.HOST, GameParticipant.ParticipantType.TEAM_MEMBER]),
            "temporary_count": sum(1 for participant in active_participants if participant.participant_type == GameParticipant.ParticipantType.TEMPORARY),
            "guest_count": sum(1 for participant in active_participants if participant.participant_type == GameParticipant.ParticipantType.GUEST),
            "permanent_roles": permanent_roles,
            "temporary_roles": temporary_roles,
        }

    def get_participants(self, game):
        participants = game.participants.filter(status__in=ACTIVE_PARTICIPANT_STATUSES)
        room_access = self.context.get("room_access")
        if room_access is None:
            request = self.context.get("request")
            user = getattr(request, "user", None)
            if user and user.is_authenticated:
                room_access = game_room_access_level(game, user)
        if room_access in ["PLANNING", "RECONFIRMATION"]:
            return PublicGameParticipantSerializer(participants, many=True, context=self.context).data
        return GameParticipantSerializer(participants, many=True, context=self.context).data

    def get_venue_name(self, game):
        return game.booking.venue.name if game.booking_id else (game.preferred_venue_name or "Court to be booked")

    def get_venue_area(self, game):
        return game.booking.venue.area if game.booking_id else game.preferred_area

    def get_venue_city(self, game):
        return game.booking.venue.city if game.booking_id else game.preferred_district

    def get_venue_address(self, game):
        return game.booking.venue.address if game.booking_id else ""

    def get_venue_latitude(self, game):
        venue = game.booking.venue if game.booking_id else None
        return str(venue.latitude) if venue and venue.location_confirmed and venue.latitude is not None else None

    def get_venue_longitude(self, game):
        venue = game.booking.venue if game.booking_id else None
        return str(venue.longitude) if venue and venue.location_confirmed and venue.longitude is not None else None

    def get_venue_map_location(self, game):
        return game.booking.venue.map_location if game.booking_id else ""

    def get_court_name(self, game):
        return game.booking.court.name if game.booking_id else "Court not booked yet"

    def get_booking_code(self, game):
        return game.booking.booking_code if game.booking_id else ""

    def get_booking_amount(self, game):
        return str(game.booking.amount) if game.booking_id else ""

    def get_booking_status(self, game):
        return game.booking.status if game.booking_id else ""

    def get_payment_status(self, game):
        return game.booking.payment_status if game.booking_id else ""

    def get_booking_display_time(self, game):
        if game.booking_id:
            return BookingSerializer(game.booking).data.get("booking_display_time", "")
        if game.proposed_start_time and game.proposed_end_time:
            return f"{game.proposed_start_time.strftime('%I:%M %p').lstrip('0')} - {game.proposed_end_time.strftime('%I:%M %p').lstrip('0')}"
        return "Time to be confirmed"

    def get_start_at(self, game):
        start_at = game.start_at
        return start_at.isoformat() if start_at else None

    def get_end_at(self, game):
        end_at = game.end_at
        return end_at.isoformat() if end_at else None

    def get_date(self, game):
        if game.booking_id:
            slots = game.booking.booked_slots
            return slots[0].date.isoformat() if slots else ""
        return game.proposed_date.isoformat() if game.proposed_date else ""

    def get_role_progress(self, game):
        return role_progress(game)

    def get_user_state(self, game):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return {
                "is_host": False,
                "is_participant": False,
                "participant_status": "",
                "reconfirmation_status": "",
                "requires_reconfirmation": False,
                "request_status": "",
                "join_request_id": None,
                "room_access": "NONE",
            }
        participation = game.participants.filter(user=user, status__in=ACTIVE_PARTICIPANT_STATUSES).first()
        join_request = game.join_requests.filter(player=user).exclude(status__in=[JoinRequest.Status.REJECTED, JoinRequest.Status.WITHDRAWN, JoinRequest.Status.REMOVED, JoinRequest.Status.EXPIRED]).first()
        return {
            "is_host": game.host_id == user.id,
            "is_participant": bool(participation and participation.status in ACTIVE_PARTICIPANT_STATUSES),
            "participant_status": participation.status if participation else "",
            "requires_reconfirmation": bool(participation and participation.status == GameParticipant.Status.RECONFIRM_REQUIRED),
            "reconfirmation_status": (
                "PENDING" if participation and participation.status == GameParticipant.Status.RECONFIRM_REQUIRED
                else ""
            ),
            "request_status": join_request.status if join_request else "",
            "join_request_id": join_request.id if join_request else None,
            "room_access": game_room_access_level(game, user),
        }


class PublicGameParticipantSerializer(serializers.ModelSerializer):
    """Roster-safe participant data for public discovery and game details."""

    full_name = serializers.CharField(source="display_name", read_only=True)
    profile_photo = serializers.SerializerMethodField()
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    participant_type_label = serializers.CharField(source="get_participant_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = GameParticipant
        fields = (
            "id",
            "full_name",
            "guest_name",
            "profile_photo",
            "participant_type",
            "participant_type_label",
            "role",
            "role_label",
            "status",
            "status_label",
            "joined_at",
        )

    def get_profile_photo(self, participant):
        if not participant.user_id:
            return ""
        profile = getattr(participant.user, "player_profile", None)
        return profile.profile_photo.url if profile and profile.profile_photo else ""


class PublicGameSerializer(GameSerializer):
    """Public game payload without account identifiers or trust details."""

    participants = PublicGameParticipantSerializer(many=True, read_only=True)



class GameCreateSerializer(serializers.Serializer):
    client_request_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    game_type = serializers.ChoiceField(choices=Game.GameType.choices, default=Game.GameType.PICKUP)
    creation_mode = serializers.ChoiceField(choices=Game.CreationMode.choices)
    booking_id = serializers.IntegerField(required=False, allow_null=True)
    team_id = serializers.IntegerField(required=False, allow_null=True)
    title = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=800, required=False, allow_blank=True)
    host_notes = serializers.CharField(max_length=500, required=False, allow_blank=True)
    reporting_instructions = serializers.CharField(max_length=500, required=False, allow_blank=True)
    equipment_instructions = serializers.CharField(max_length=500, required=False, allow_blank=True)
    game_intensity = serializers.ChoiceField(choices=Game.GameIntensity.choices, default=Game.GameIntensity.CASUAL)
    min_skill_level = serializers.ChoiceField(choices=Game.SkillLevel.choices, default=Game.SkillLevel.OPEN)
    total_capacity = serializers.IntegerField(min_value=2, max_value=30, default=12)
    minimum_players_to_proceed = serializers.IntegerField(min_value=2, max_value=30, default=6)
    waitlist_enabled = serializers.BooleanField(default=True)
    recruitment_deadline = serializers.DateTimeField(required=False, allow_null=True)
    proposed_date = serializers.DateField(required=False, allow_null=True)
    proposed_start_time = serializers.TimeField(required=False, allow_null=True)
    proposed_end_time = serializers.TimeField(required=False, allow_null=True)
    preferred_district = serializers.CharField(max_length=50, required=False, allow_blank=True)
    preferred_area = serializers.CharField(max_length=100, required=False, allow_blank=True)
    preferred_area_code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    preferred_venue_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    alternative_details = serializers.CharField(max_length=300, required=False, allow_blank=True)
    booking_deadline = serializers.DateTimeField(required=False, allow_null=True)
    role_requirements = GameRoleRequirementSerializer(many=True, required=False)
    guests = serializers.ListField(child=serializers.DictField(), required=False)
    selected_team_member_ids = serializers.ListField(child=serializers.IntegerField(), required=False)

    def validate(self, attrs):
        request = self.context["request"]
        client_request_id = str(attrs.get("client_request_id") or "").strip()
        if client_request_id:
            existing = Game.objects.filter(host=request.user, client_request_id=client_request_id).first()
            if existing:
                self._idempotent_existing = existing
                return attrs
        game_type = attrs.get("game_type") or Game.GameType.PICKUP
        attrs["game_type"] = game_type
        selected_team_member_ids = attrs.get("selected_team_member_ids") or []
        selected_team_member_ids = [int(item) for item in selected_team_member_ids]
        selected_team_member_count = 0

        if game_type == Game.GameType.FILL_SQUAD:
            team_id = attrs.get("team_id")
            if not team_id:
                raise serializers.ValidationError({"team_id": "Choose the team that needs temporary players."})
            team = Team.objects.prefetch_related("members").filter(id=team_id, captain=request.user).first()
            if not team:
                raise serializers.ValidationError({"team_id": "Only the team captain can create a Fill My Squad listing."})
            attrs["team"] = team
            active_members = TeamMember.objects.filter(
                team=team,
                member_type=TeamMember.MemberType.REGISTERED,
                status=TeamMember.MemberStatus.ACTIVE,
                user__isnull=False,
            )
            valid_member_ids = set(active_members.values_list("id", flat=True))
            invalid_ids = set(selected_team_member_ids) - valid_member_ids
            if invalid_ids:
                raise serializers.ValidationError({"selected_team_member_ids": "Select only active registered members from this team."})
            selected_team_member_count = active_members.filter(id__in=selected_team_member_ids).exclude(user=request.user).count()
            attrs["_selected_team_member_ids"] = selected_team_member_ids
        else:
            attrs["game_type"] = Game.GameType.PICKUP
            attrs["team"] = None
            attrs["_selected_team_member_ids"] = []

        creation_mode = attrs["creation_mode"]
        booking = None
        if creation_mode == Game.CreationMode.BOOKING_FIRST:
            booking_id = attrs.get("booking_id")
            if not booking_id:
                raise serializers.ValidationError({"booking_id": "Choose one of your confirmed bookings."})
            booking = Booking.objects.select_related("venue", "court", "slot", "player").prefetch_related("slot_items__slot").filter(id=booking_id).first()
            if not booking:
                raise serializers.ValidationError({"booking_id": "Choose a valid booking."})
            ensure_booking_can_publish_game(booking, request.user)
            attrs["booking"] = booking
            start_at = get_booking_start_at(booking)
            attrs["recruitment_deadline"] = attrs.get("recruitment_deadline") or default_deadline_before(start_at, 2)
        else:
            proposed_date = attrs.get("proposed_date")
            proposed_start_time = attrs.get("proposed_start_time")
            proposed_end_time = attrs.get("proposed_end_time")
            if not proposed_date or not proposed_start_time or not proposed_end_time:
                raise serializers.ValidationError({"proposed_date": "Choose a proposed date and time."})
            normalize_plan_first_service_area(attrs, required=True)
            if proposed_end_time <= proposed_start_time:
                raise serializers.ValidationError({"proposed_end_time": "The end time must be after the start time."})
            proposed_start = timezone.make_aware(
                timezone.datetime.combine(proposed_date, proposed_start_time),
                timezone.get_current_timezone(),
            )
            now = timezone.now()
            if proposed_start <= now:
                raise serializers.ValidationError({"proposed_date": "Choose a future game time."})
            default_recruitment_deadline, default_booking_deadline = default_plan_first_deadlines(proposed_start)
            attrs["booking_deadline"] = attrs.get("booking_deadline") or default_booking_deadline
            attrs["recruitment_deadline"] = attrs.get("recruitment_deadline") or default_recruitment_deadline
            minimum_plan_lead = timezone.timedelta(minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_plan_lead_minutes"])
            minimum_booking_lead = timezone.timedelta(minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_booking_lead_minutes"])
            minimum_recruitment_buffer = timezone.timedelta(minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_recruitment_to_booking_minutes"])
            if proposed_start <= now + minimum_plan_lead:
                raise serializers.ValidationError({"proposed_date": "Choose a game time with enough time to recruit players and secure a court."})
            if not attrs["booking_deadline"] or attrs["booking_deadline"] <= now:
                raise serializers.ValidationError({"booking_deadline": "Choose a future court-booking deadline."})
            if attrs["booking_deadline"] > proposed_start - minimum_booking_lead:
                lead = format_duration_label(SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_booking_lead_minutes"])
                raise serializers.ValidationError({"booking_deadline": f"Leave at least {lead} between the court-booking deadline and game start."})
            if attrs["recruitment_deadline"] and attrs["recruitment_deadline"] <= now:
                raise serializers.ValidationError({"recruitment_deadline": "Choose a future recruitment deadline."})
            if attrs["recruitment_deadline"] and attrs["recruitment_deadline"] > attrs["booking_deadline"] - minimum_recruitment_buffer:
                buffer = format_duration_label(SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG["minimum_recruitment_to_booking_minutes"])
                raise serializers.ValidationError({"recruitment_deadline": f"Recruitment must close at least {buffer} before the court-booking deadline."})

        occupied_baseline = 1 + selected_team_member_count
        if attrs["total_capacity"] < occupied_baseline:
            raise serializers.ValidationError({"total_capacity": "Capacity must include the host and selected permanent team members."})
        if attrs["minimum_players_to_proceed"] > attrs["total_capacity"]:
            raise serializers.ValidationError({"minimum_players_to_proceed": "Minimum players cannot exceed total capacity."})
        role_requirements = attrs.get("role_requirements") or []
        validate_role_plan(attrs["total_capacity"], role_requirements, occupied_baseline=occupied_baseline)
        deadline = attrs.get("recruitment_deadline")
        if deadline:
            now = timezone.now()
            if deadline <= now:
                raise serializers.ValidationError({"recruitment_deadline": "Choose a future recruitment deadline."})
            start_at = get_booking_start_at(booking) if booking else (
                timezone.make_aware(
                    timezone.datetime.combine(attrs["proposed_date"], attrs["proposed_start_time"]),
                    timezone.get_current_timezone(),
                )
                if attrs.get("proposed_date") and attrs.get("proposed_start_time")
                else None
            )
            if start_at and deadline >= start_at:
                raise serializers.ValidationError({"recruitment_deadline": "Recruitment must close before the game starts."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        request = self.context["request"]
        if getattr(self, "_idempotent_existing", None):
            self.was_idempotent_replay = True
            return self._idempotent_existing
        role_requirements = validated_data.pop("role_requirements", [])
        guests = validated_data.pop("guests", [])
        selected_team_member_ids = validated_data.pop("_selected_team_member_ids", [])
        validated_data.pop("selected_team_member_ids", None)
        validated_data.pop("booking_id", None)
        validated_data.pop("team_id", None)
        validated_data.pop("preferred_area_code", None)
        client_request_id = str(validated_data.get("client_request_id") or "").strip()
        game = Game.objects.create(host=request.user, **validated_data)
        self.was_idempotent_replay = False
        if not role_requirements:
            baseline = 1
            if game.game_type == Game.GameType.FILL_SQUAD:
                baseline += TeamMember.objects.filter(
                    team=game.team,
                    id__in=selected_team_member_ids,
                    member_type=TeamMember.MemberType.REGISTERED,
                    status=TeamMember.MemberStatus.ACTIVE,
                ).exclude(user=request.user).count()
            role_requirements = [{"role": GameRoleRequirement.CricksalRole.ANY, "required_count": max(game.total_capacity - baseline, 0)}]
        for item in role_requirements:
            if int(item.get("required_count") or 0) > 0:
                GameRoleRequirement.objects.create(game=game, **item)
        add_initial_participants(game, request.user, guests=guests, selected_team_member_ids=selected_team_member_ids)
        game.refresh_status()
        from .services import notify_game_published

        notify_game_published(game)
        return game


class JoinRequestCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = JoinRequest
        fields = ("requested_role", "message", "attendance_confirmed")

    def validate_attendance_confirmed(self, value):
        if not value:
            raise serializers.ValidationError("Confirm that you can attend this game before sending a request.")
        return value

    def validate(self, attrs):
        game = self.context["game"]
        player = self.context["request"].user
        validate_join_request(game, player, attrs.get("requested_role"))
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        with transaction.atomic():
            game = Game.objects.select_for_update(of=("self",)).get(pk=self.context["game"].pk)
            player = request.user
            # Validation runs again under the game lock; this is the capacity boundary.
            validate_join_request(game, player, validated_data.get("requested_role"))
            status = JoinRequest.Status.PENDING
            position = None
            if game.status == Game.Status.FULL and game.waitlist_enabled:
                status = JoinRequest.Status.WAITLISTED
                position = next_waitlist_position(game)
            terminal_statuses = [
                JoinRequest.Status.REJECTED,
                JoinRequest.Status.WITHDRAWN,
                JoinRequest.Status.REMOVED,
                JoinRequest.Status.EXPIRED,
            ]
            join_request = JoinRequest.objects.select_for_update().filter(game=game, player=player).first()
            if join_request and join_request.status not in terminal_statuses:
                raise serializers.ValidationError("You already have an active request for this game.")
            if join_request:
                previous_status = join_request.status
                join_request.requested_role = validated_data.get("requested_role", join_request.requested_role)
                join_request.message = validated_data.get("message", "")
                join_request.attendance_confirmed = validated_data.get("attendance_confirmed", False)
                join_request.status = status
                join_request.waitlist_position = position
                join_request.decided_by = None
                join_request.decided_at = None
                join_request.attempt_number += 1
                join_request.save(update_fields=["requested_role", "message", "attendance_confirmed", "status", "waitlist_position", "decided_by", "decided_at", "attempt_number", "updated_at"])
            else:
                previous_status = ""
                join_request = JoinRequest.objects.create(
                    game=game,
                    player=player,
                    status=status,
                    waitlist_position=position,
                    **validated_data,
                )
            record_join_request_event(
                join_request,
                JoinRequestEvent.EventType.WAITLISTED if status == JoinRequest.Status.WAITLISTED else JoinRequestEvent.EventType.SUBMITTED,
                actor=player,
                previous_status=previous_status,
            )
        from .services import notify_join_request_received

        notify_join_request_received(join_request)
        return join_request


class EligibleBookingSerializer(serializers.ModelSerializer):
    venue_name = serializers.CharField(source="venue.name", read_only=True)
    venue_area = serializers.CharField(source="venue.area", read_only=True)
    venue_city = serializers.CharField(source="venue.city", read_only=True)
    court_name = serializers.CharField(source="court.name", read_only=True)
    booking_display_time = serializers.SerializerMethodField()
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
            "booking_display_time",
            "start_at",
            "end_at",
            "amount",
            "status",
            "payment_status",
        )

    def get_booking_display_time(self, booking):
        return BookingSerializer(booking).data.get("booking_display_time", "")

    def get_start_at(self, booking):
        start_at = get_booking_start_at(booking)
        return start_at.isoformat() if start_at else None

    def get_end_at(self, booking):
        end_at = booking_end_at(booking)
        return end_at.isoformat() if end_at else None



