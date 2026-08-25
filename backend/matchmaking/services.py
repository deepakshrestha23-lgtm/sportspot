from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from notifications.models import Notification
from notifications.services import create_notification, mark_related_action_state
from players.models import PlayerProfile
from teams.models import TeamMember
from venues.models import Booking
from venues.policies import get_booking_start_at

from .models import (
    ACTIVE_PARTICIPANT_STATUSES,
    RECONFIRMATION_PENDING_STATUSES,
    Game,
    GameParticipant,
    GameRoleRequirement,
    JoinRequest,
)


ACTIVE_GAME_STATUSES = [
    Game.Status.DRAFT,
    Game.Status.RECRUITING,
    Game.Status.FULL,
    Game.Status.CLOSED,
    Game.Status.IN_PROGRESS,
    Game.Status.COMPLETED,
]

EXPIRABLE_JOIN_REQUEST_STATUSES = [
    JoinRequest.Status.PENDING,
    JoinRequest.Status.WAITLISTED,
    JoinRequest.Status.INVITED,
]

REQUEST_EXPIRING_GAME_STATUSES = [
    Game.Status.CLOSED,
    Game.Status.CANCELLED,
    Game.Status.IN_PROGRESS,
    Game.Status.COMPLETED,
]


def synchronize_game_lifecycle(game, now=None, expire_requests=False):
    """Apply the current lifecycle rules before reading or mutating a game.

    The maintenance worker remains responsible for bulk cleanup, but request-time
    synchronization keeps user actions correct when the worker is delayed or
    temporarily unavailable.
    """
    now = now or timezone.now()
    # Lifecycle synchronization may update the game and lock join requests.
    # Keep both operations in one transaction so read endpoints can safely
    # repair stale lifecycle data without raising a transaction error.
    with transaction.atomic():
        synchronize_linked_booking_state(game, now=now)
        game.refresh_status(now=now)
        if expire_requests and game_should_expire_open_requests(game, now):
            expire_open_join_requests_for_game(game, now=now)
    return game


def _cancel_game_for_linked_booking(game, actor=None, reason="", now=None):
    """End a game whose confirmed court booking is no longer usable.

    The booking remains the source of truth for payment and refunds. This
    helper only closes the matchmaking lifecycle and preserves its history.
    """
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED]:
        return False
    now = now or timezone.now()
    game.status = Game.Status.CANCELLED
    game.is_public = False
    game.cancelled_at = game.cancelled_at or now
    game.cancellation_reason = reason or "The linked court booking was cancelled."
    game.save(update_fields=["status", "is_public", "cancelled_at", "cancellation_reason", "updated_at"])
    expire_open_join_requests_for_game(game, now=now)
    notify_game_cancelled(game, actor)
    return True


def synchronize_linked_booking_state(game, now=None):
    """Synchronize a linked game when its confirmed booking was cancelled."""
    if not game.booking_id or game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED]:
        return False
    booking = game.booking
    if booking.status not in [Booking.BookingStatus.CANCELLED, Booking.BookingStatus.EXPIRED]:
        return False
    actor = getattr(booking, "cancelled_by", None)
    return _cancel_game_for_linked_booking(
        game,
        actor=actor,
        reason="The linked court booking was cancelled, so this game is no longer available.",
        now=now,
    )


@transaction.atomic
def cancel_games_for_booking(booking, actor=None):
    """Cancel every still-active game linked to a cancelled booking.

    A booking may be linked to at most one active game, but this is written as
    a queryset so legacy data is repaired safely as well.
    """
    now = timezone.now()
    games = list(
        Game.objects.select_for_update()
        .select_related("booking", "host")
        .filter(booking_id=booking.id)
        .exclude(status__in=[Game.Status.CANCELLED, Game.Status.COMPLETED])
    )
    for game in games:
        _cancel_game_for_linked_booking(
            game,
            actor=actor or getattr(booking, "cancelled_by", None),
            reason="The linked court booking was cancelled, so this game is no longer available.",
            now=now,
        )
    return len(games)


@transaction.atomic
def close_game_recruitment(game, actor):
    """Stop discovery and new requests without cancelling the game booking."""
    locked_game = Game.objects.select_for_update().select_related("host", "booking").get(id=game.id)
    if locked_game.host_id != actor.id:
        raise ValidationError("Only the game host can close recruitment.")
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    if locked_game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS]:
        raise ValidationError("Recruitment cannot be changed for this game anymore.")
    if locked_game.status == Game.Status.CLOSED and not locked_game.is_public:
        return locked_game
    locked_game.status = Game.Status.CLOSED
    locked_game.is_public = False
    locked_game.save(update_fields=["status", "is_public", "updated_at"])
    expire_open_join_requests_for_game(locked_game)
    notify_game_recruitment_closed(locked_game, actor)
    return locked_game


@transaction.atomic
def reopen_game_recruitment(game, actor):
    """Reopen discovery only while the original schedule remains safe."""
    locked_game = Game.objects.select_for_update().select_related("host", "booking").get(id=game.id)
    if locked_game.host_id != actor.id:
        raise ValidationError("Only the game host can reopen recruitment.")
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    if locked_game.status != Game.Status.CLOSED:
        raise ValidationError("Only a closed game can reopen recruitment.")
    now = timezone.now()
    if not locked_game.recruitment_deadline or locked_game.recruitment_deadline <= now:
        raise ValidationError("The recruitment deadline has passed. Create a new game if you still need players.")
    if not locked_game.start_at or locked_game.start_at <= now:
        raise ValidationError("This game is too close to its start time to reopen recruitment.")
    if locked_game.creation_mode == Game.CreationMode.PLAN_FIRST and not locked_game.booking_id:
        if locked_game.booking_deadline and locked_game.booking_deadline <= now:
            raise ValidationError("The court-booking deadline has passed. Create a new game plan instead.")
    if locked_game.booking_id:
        ensure_booking_can_publish_game(locked_game.booking, actor, exclude_game_id=locked_game.id)
    locked_game.is_public = True
    locked_game.status = Game.Status.RECRUITING
    locked_game.save(update_fields=["status", "is_public", "updated_at"])
    locked_game.refresh_status()
    notify_game_recruitment_reopened(locked_game, actor)
    return locked_game

STRICT_ROLES = [
    GameRoleRequirement.CricksalRole.BATSMAN,
    GameRoleRequirement.CricksalRole.BOWLER,
    GameRoleRequirement.CricksalRole.ALL_ROUNDER,
    GameRoleRequirement.CricksalRole.WICKETKEEPER,
]

SKILL_ORDER = {"BEGINNER": 1, "INTERMEDIATE": 2, "ADVANCED": 3, "OPEN": 0, "": 0, None: 0}


def ensure_booking_can_publish_game(booking, host, exclude_game_id=None):
    if booking.player_id != host.id:
        raise ValidationError("Choose one of your own confirmed bookings.")
    if booking.status != Booking.BookingStatus.CONFIRMED or booking.payment_status != Booking.PaymentStatus.PAID:
        raise ValidationError("Only paid confirmed bookings can be used for a game.")
    start_at = get_booking_start_at(booking)
    if not start_at or start_at <= timezone.now():
        raise ValidationError("Choose a future booking.")
    linked_games = Game.objects.filter(booking=booking, status__in=ACTIVE_GAME_STATUSES)
    if exclude_game_id:
        linked_games = linked_games.exclude(id=exclude_game_id)
    if linked_games.exists():
        raise ValidationError("This booking is already connected to another active game.")


def eligible_bookings_for_user(user):
    now = timezone.now()
    bookings = (
        Booking.objects.filter(
            player=user,
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
        )
        .select_related("venue", "court", "slot", "player")
        .prefetch_related("slot_items__slot", "matchmaking_games")
        .order_by("slot__date", "slot__start_time")
    )
    eligible = []
    for booking in bookings:
        start_at = get_booking_start_at(booking)
        if not start_at or start_at <= now:
            continue
        if booking.matchmaking_games.filter(status__in=ACTIVE_GAME_STATUSES).exists():
            continue
        eligible.append(booking)
    return eligible


def validate_game_booking_handoff(game, host):
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.host_id != host.id:
        raise ValidationError("Only the host can book a court for this game.")
    if game.creation_mode != Game.CreationMode.PLAN_FIRST:
        raise ValidationError("This game already uses the booking-first flow.")
    if game.booking_id:
        raise ValidationError("This game already has a confirmed court booking.")
    if game.status in [Game.Status.CANCELLED, Game.Status.IN_PROGRESS, Game.Status.COMPLETED]:
        raise ValidationError("This game can no longer be linked to a new booking.")
    if game.booking_deadline and game.booking_deadline <= timezone.now():
        raise ValidationError("The court-booking deadline for this game has passed.")
    if game.start_at and game.start_at <= timezone.now():
        raise ValidationError("This game has already started.")
    if game.occupied_spots_count < game.minimum_players_to_proceed:
        needed = game.minimum_players_to_proceed - game.occupied_spots_count
        raise ValidationError(f"This game needs {needed} more confirmed or provisional player spot{'s' if needed != 1 else ''} before guided court booking.")
    return True


def add_initial_participants(game, host, guests=None, selected_team_member_ids=None):
    initial_status = GameParticipant.Status.CONFIRMED if game.booking_id else GameParticipant.Status.PROVISIONAL
    host_role = get_user_preferred_role(host)
    if game.game_type == Game.GameType.FILL_SQUAD and game.team_id:
        host_membership = TeamMember.objects.filter(team=game.team, user=host, status=TeamMember.MemberStatus.ACTIVE).first()
        if host_membership:
            host_role = team_member_role_to_game_role(host_membership)
    GameParticipant.objects.get_or_create(
        game=game,
        user=host,
        defaults={
            "participant_type": GameParticipant.ParticipantType.HOST,
            "role": host_role,
            "status": initial_status,
            "added_by": host,
        },
    )
    if game.game_type == Game.GameType.FILL_SQUAD and game.team_id:
        selected_ids = {int(item) for item in selected_team_member_ids or [] if str(item).isdigit()}
        members = TeamMember.objects.select_related("user", "user__player_profile").filter(
            team=game.team,
            id__in=selected_ids,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
            user__isnull=False,
        )
        for member in members:
            if member.user_id == host.id:
                continue
            if game.available_spots <= 0:
                break
            GameParticipant.objects.get_or_create(
                game=game,
                user=member.user,
                defaults={
                    "participant_type": GameParticipant.ParticipantType.TEAM_MEMBER,
                    "role": team_member_role_to_game_role(member),
                    "status": initial_status,
                    "added_by": host,
                },
            )
    for guest in guests or []:
        if game.available_spots <= 0:
            break
        name = str(guest.get("name", "")).strip()
        if not name:
            continue
        role = guest.get("role") or GameRoleRequirement.CricksalRole.ANY
        ensure_role_has_space(game, role, include_any=True)
        GameParticipant.objects.create(
            game=game,
            guest_name=name,
            participant_type=GameParticipant.ParticipantType.GUEST,
            role=role,
            status=initial_status,
            added_by=host,
        )


def team_member_role_to_game_role(member):
    role = getattr(member, "cricksal_role", "")
    return role if role and role != "NONE" else GameRoleRequirement.CricksalRole.ANY


def is_active_registered_team_member(game, player):
    return bool(
        game.game_type == Game.GameType.FILL_SQUAD
        and game.team_id
        and TeamMember.objects.filter(
            team_id=game.team_id,
            user=player,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).exists()
    )


def get_user_preferred_role(user):
    try:
        role = user.player_profile.preferred_cricksal_role
    except Exception:
        return GameRoleRequirement.CricksalRole.ANY
    return role if role and role != "NONE" else GameRoleRequirement.CricksalRole.ANY


def get_user_skill_level(user):
    try:
        return user.player_profile.skill_level
    except Exception:
        return ""


def player_meets_skill(game, player):
    if game.min_skill_level == Game.SkillLevel.OPEN:
        return True
    return SKILL_ORDER.get(get_user_skill_level(player), 0) >= SKILL_ORDER.get(game.min_skill_level, 0)


def player_has_overlapping_confirmed_game(player, game):
    start_at = game.start_at
    end_at = game.end_at
    if not start_at or not end_at:
        return False
    games = (
        Game.objects.filter(
            participants__user=player,
            participants__status=GameParticipant.Status.CONFIRMED,
            status__in=[Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED, Game.Status.IN_PROGRESS],
        )
        .exclude(id=game.id)
        .select_related("booking", "booking__slot")
    )
    for other in games:
        other_start = other.start_at
        other_end = other.end_at
        if other_start and other_end and start_at < other_end and end_at > other_start:
            return True
    return False


def role_progress(game):
    progress = []
    requirements = list(game.role_requirements.all())
    for requirement in requirements:
        filled = role_filled_count(game, requirement.role)
        progress.append(
            {
                "role": requirement.role,
                "role_label": requirement.get_role_display(),
                "required_count": requirement.required_count,
                "filled_count": min(filled, requirement.required_count),
                "available_count": max(requirement.required_count - filled, 0),
                "is_filled": filled >= requirement.required_count,
            }
        )
    return progress


def role_filled_count(game, role, exclude_participant_id=None):
    participants = game.participants.filter(
        status__in=ACTIVE_PARTICIPANT_STATUSES,
        participant_type__in=[GameParticipant.ParticipantType.TEMPORARY, GameParticipant.ParticipantType.GUEST],
        role=role,
    )
    if exclude_participant_id:
        participants = participants.exclude(id=exclude_participant_id)
    return participants.count()


def ensure_role_has_space(game, role, include_any=False, exclude_participant_id=None):
    role = role or GameRoleRequirement.CricksalRole.ANY
    if role == GameRoleRequirement.CricksalRole.ANY:
        available_spots = game.available_spots
        if exclude_participant_id:
            available_spots += 1
        if available_spots <= 0:
            raise ValidationError("This game is already full.")
        return
    requirement = game.role_requirements.filter(role=role).first()
    if not requirement:
        if include_any and game.role_requirements.filter(role=GameRoleRequirement.CricksalRole.ANY).exists():
            ensure_role_has_space(game, GameRoleRequirement.CricksalRole.ANY, exclude_participant_id=exclude_participant_id)
            return
        raise ValidationError("This role is not being recruited for this game.")
    if role_filled_count(game, role, exclude_participant_id=exclude_participant_id) >= requirement.required_count:
        raise ValidationError("This role is already filled. Choose another available role.")


def validate_role_plan(total_capacity, role_requirements, occupied_baseline=1):
    total_requested = 0
    seen = set()
    for item in role_requirements or []:
        role = item.get("role")
        count = int(item.get("required_count") or 0)
        if role in seen:
            raise ValidationError("Each role can be added only once.")
        seen.add(role)
        if count < 0:
            raise ValidationError("Role counts cannot be negative.")
        total_requested += count
    available_for_recruitment = max(int(total_capacity) - int(occupied_baseline), 0)
    if total_requested > available_for_recruitment:
        raise ValidationError("Role requirements cannot exceed the temporary player spots available after the selected squad is counted.")


def refresh_reconfirmation_state(game, save=True):
    """Keep the game-level flag derived from its participant responses.

    The participant status is the source of truth.  This prevents a game from
    staying permanently marked as needing confirmation after every affected
    player has responded, and makes guest acknowledgement visible separately.
    """
    pending = game.participants.filter(status__in=RECONFIRMATION_PENDING_STATUSES).exists()
    if game.requires_reconfirmation == pending:
        return pending
    game.requires_reconfirmation = pending
    if save:
        game.save(update_fields=["requires_reconfirmation", "updated_at"])
    return pending


def mark_schedule_reconfirmation_required(game):
    """Mark existing participants after a material schedule/location change.

    Registered players can respond themselves. Offline guests cannot, so their
    record requires an explicit host acknowledgement instead of an impossible
    account action.
    """
    active_non_host = game.participants.filter(
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).exclude(participant_type=GameParticipant.ParticipantType.HOST)
    active_non_host.exclude(
        participant_type=GameParticipant.ParticipantType.GUEST,
    ).update(status=GameParticipant.Status.RECONFIRM_REQUIRED)
    active_non_host.filter(
        participant_type=GameParticipant.ParticipantType.GUEST,
    ).update(status=GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED)
    return refresh_reconfirmation_state(game)


@transaction.atomic
def update_game_host_settings(game_id, actor, changes):
    """Apply host-owned game edits atomically.

    A confirmed booking remains the source of truth for its venue and time. A
    Plan First listing may change its proposal, but active non-host players
    must reconfirm after a material schedule or location change.
    """
    game = (
        Game.objects.select_for_update(of=("self",))
        .select_related("host", "booking", "booking__venue")
        .get(id=game_id)
    )
    if game.host_id != actor.id:
        raise ValidationError("Only the host can edit this game.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS]:
        raise ValidationError("This game can no longer be edited.")

    allowed_fields = {
        "title", "description", "host_notes", "reporting_instructions",
        "equipment_instructions", "game_intensity", "min_skill_level",
        "total_capacity", "minimum_players_to_proceed", "waitlist_enabled",
        "recruitment_deadline", "proposed_date", "proposed_start_time",
        "proposed_end_time", "preferred_district", "preferred_area",
        "preferred_venue_name", "alternative_details", "booking_deadline",
        "role_requirements",
    }
    unknown = set(changes) - allowed_fields
    if unknown:
        raise ValidationError("One or more game fields cannot be edited.")

    if game.booking_id and any(
        field in changes
        for field in {
            "proposed_date", "proposed_start_time", "proposed_end_time",
            "preferred_district", "preferred_area", "preferred_venue_name",
            "booking_deadline",
        }
    ):
        raise ValidationError("The confirmed booking controls this game's venue, date, and time.")

    active_participants = list(
        game.participants.filter(status__in=ACTIVE_PARTICIPANT_STATUSES).order_by("id")
    )
    occupied_count = len(active_participants)
    total_capacity = int(changes.get("total_capacity", game.total_capacity))
    minimum_players = int(changes.get("minimum_players_to_proceed", game.minimum_players_to_proceed))
    if total_capacity < occupied_count:
        raise ValidationError(f"Capacity cannot be lower than the {occupied_count} occupied player spots.")
    if minimum_players > total_capacity:
        raise ValidationError("Minimum players cannot exceed total capacity.")

    role_items = changes.get("role_requirements")
    if role_items is not None:
        role_values = []
        for item in role_items:
            role = item.get("role")
            count = int(item.get("required_count") or 0)
            role_values.append({"role": role, "required_count": count})
        baseline = sum(
            1
            for participant in active_participants
            if participant.participant_type in [
                GameParticipant.ParticipantType.HOST,
                GameParticipant.ParticipantType.TEAM_MEMBER,
            ]
        )
        validate_role_plan(total_capacity, role_values, occupied_baseline=baseline)
        for participant in active_participants:
            if participant.participant_type not in [
                GameParticipant.ParticipantType.TEMPORARY,
                GameParticipant.ParticipantType.GUEST,
            ]:
                continue
            matching = next((item for item in role_values if item["role"] == participant.role), None)
            if not matching or matching["required_count"] < role_filled_count(game, participant.role):
                raise ValidationError("A role requirement cannot be reduced below the players already filling it.")

    previous_start = game.start_at
    previous_end = game.end_at
    previous_area = (game.preferred_area or "").strip().casefold()
    model_changes = {key: value for key, value in changes.items() if key != "role_requirements"}
    for key, value in model_changes.items():
        setattr(game, key, value)
    game.total_capacity = total_capacity
    game.minimum_players_to_proceed = minimum_players

    if game.recruitment_deadline is None:
        raise ValidationError("Every game needs a recruitment deadline.")
    game.full_clean()
    game.save(update_fields=list(model_changes.keys()) + ["total_capacity", "minimum_players_to_proceed", "updated_at"])

    if role_items is not None:
        game.role_requirements.all().delete()
        GameRoleRequirement.objects.bulk_create([
            GameRoleRequirement(game=game, role=item["role"], required_count=int(item["required_count"]))
            for item in role_values
            if int(item["required_count"]) > 0
        ])

    next_start = game.start_at
    next_end = game.end_at
    next_area = (game.preferred_area or "").strip().casefold()
    schedule_changed = bool(
        previous_start != next_start
        or previous_end != next_end
        or previous_area != next_area
    )
    if schedule_changed and not game.booking_id:
        mark_schedule_reconfirmation_required(game)
    else:
        refresh_reconfirmation_state(game)

    game.refresh_status()
    notify_game_updated(game, actor, schedule_changed=schedule_changed)
    return game


@transaction.atomic
def update_game_participant(game_id, participant_id, actor, changes):
    game = Game.objects.select_for_update(of=("self",)).select_related("host").get(id=game_id)
    if game.host_id != actor.id:
        raise ValidationError("Only the host can edit the game roster.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS]:
        raise ValidationError("The roster can no longer be changed.")
    participant = GameParticipant.objects.select_for_update(of=("self",)).select_related("user").filter(
        id=participant_id,
        game=game,
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).first()
    if not participant:
        raise ValidationError("This player is no longer an active participant.")
    if participant.participant_type == GameParticipant.ParticipantType.HOST:
        raise ValidationError("The host cannot be edited from the roster.")

    role = changes.get("role", participant.role) or GameRoleRequirement.CricksalRole.ANY
    if role != participant.role:
        ensure_role_has_space(game, role, include_any=True, exclude_participant_id=participant.id)
    guest_name = changes.get("guest_name", participant.guest_name)
    if participant.participant_type == GameParticipant.ParticipantType.GUEST:
        guest_name = str(guest_name or "").strip()
        if len(guest_name) < 2:
            raise ValidationError("Enter the guest player's name.")
        participant.guest_name = guest_name
    elif "guest_name" in changes:
        raise ValidationError("Only guest player names can be edited.")

    participant.role = role
    participant.save(update_fields=["guest_name", "role"])
    if participant.user_id:
        JoinRequest.objects.filter(
            game=game,
            player=participant.user,
            status=JoinRequest.Status.ACCEPTED,
        ).update(requested_role=role, updated_at=timezone.now())
    return participant


@transaction.atomic
def remove_game_participant(game_id, participant_id, actor):
    game = Game.objects.select_for_update(of=("self",)).select_related("host").get(id=game_id)
    if game.host_id != actor.id:
        raise ValidationError("Only the host can remove players from the roster.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS]:
        raise ValidationError("The roster can no longer be changed.")
    participant = GameParticipant.objects.select_for_update(of=("self",)).select_related("user").filter(
        id=participant_id,
        game=game,
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).first()
    if not participant:
        raise ValidationError("This player is no longer an active participant.")
    if participant.participant_type == GameParticipant.ParticipantType.HOST:
        raise ValidationError("The host cannot leave the roster.")
    participant.status = GameParticipant.Status.REMOVED
    participant.save(update_fields=["status"])
    if participant.user_id:
        JoinRequest.objects.filter(
            game=game,
            player=participant.user,
            status=JoinRequest.Status.ACCEPTED,
        ).update(status=JoinRequest.Status.REMOVED, decided_by=actor, decided_at=timezone.now(), updated_at=timezone.now())
        notify_participant_removed(game, participant, actor)
    resequence_waitlist(game)
    refresh_reconfirmation_state(game)
    game.refresh_status()
    return participant


def validate_join_request(game, player, requested_role=None):
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL]:
        raise ValidationError("This game is not accepting requests right now.")
    if game.recruitment_deadline and game.recruitment_deadline <= timezone.now():
        raise ValidationError("Requests for this game are already closed.")
    if game.start_at and game.start_at <= timezone.now():
        raise ValidationError("This game has already started.")
    if game.participants.filter(user=player, status__in=ACTIVE_PARTICIPANT_STATUSES).exists():
        raise ValidationError("You are already in this game.")
    if is_active_registered_team_member(game, player):
        raise ValidationError("You are already part of this team. Fill My Squad is for temporary outside players.")
    if JoinRequest.objects.filter(game=game, player=player).exclude(status__in=[JoinRequest.Status.WITHDRAWN, JoinRequest.Status.REJECTED, JoinRequest.Status.REMOVED, JoinRequest.Status.EXPIRED]).exists():
        raise ValidationError("You already have an active request for this game.")
    if not player_meets_skill(game, player):
        raise ValidationError("This game is looking for a higher skill level.")
    if player_has_overlapping_confirmed_game(player, game):
        raise ValidationError("You already have another confirmed game at this time.")
    if game.status == Game.Status.FULL:
        if not game.waitlist_enabled:
            raise ValidationError("This game is already full.")
        return
    ensure_role_has_space(game, requested_role or GameRoleRequirement.CricksalRole.ANY)



@transaction.atomic
def add_guest_participant(game_id, actor, guest_name, role):
    game = Game.objects.select_for_update().order_by().get(id=game_id)
    if game.host_id != actor.id:
        raise ValidationError("Only the host can add guest players.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL]:
        raise ValidationError("Guests cannot be added to this game right now.")
    if game.recruitment_deadline and game.recruitment_deadline <= timezone.now():
        raise ValidationError("Recruitment for this game has closed.")
    name = str(guest_name or "").strip()
    if len(name) < 2:
        raise ValidationError("Enter the guest player's name.")
    if game.available_spots <= 0:
        raise ValidationError("This game is already full.")
    selected_role = role or GameRoleRequirement.CricksalRole.ANY
    ensure_role_has_space(game, selected_role, include_any=True)
    participant = GameParticipant.objects.create(
        game=game,
        guest_name=name,
        role=selected_role,
        status=GameParticipant.Status.CONFIRMED if game.booking_id else GameParticipant.Status.PROVISIONAL,
        participant_type=GameParticipant.ParticipantType.GUEST,
        added_by=actor,
    )
    game.refresh_status()
    return participant


@transaction.atomic
def invite_player_to_game(game_id, actor, sportspot_id, requested_role, message=""):
    game = Game.objects.select_for_update().order_by().get(id=game_id)
    if game.host_id != actor.id:
        raise ValidationError("Only the host can invite players to this game.")
    game.refresh_status()
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED]:
        raise ValidationError("Players cannot be invited to this game right now.")
    now = timezone.now()
    if game.recruitment_deadline and game.recruitment_deadline <= now:
        raise ValidationError("Recruitment for this game has closed.")
    if game.start_at and game.start_at <= timezone.now():
        raise ValidationError("This game has already started.")
    lookup_id = str(sportspot_id or "").strip().upper()
    if not lookup_id:
        raise ValidationError("Enter a SportSpot ID.")
    profile = PlayerProfile.objects.select_related("user").filter(sportspot_id=lookup_id, user__role="PLAYER", user__is_active=True).first()
    if not profile:
        raise ValidationError("No registered player found with this SportSpot ID.")
    invited_user = profile.user
    if invited_user.id == actor.id:
        raise ValidationError("You are already the host of this game.")
    if is_active_registered_team_member(game, invited_user):
        raise ValidationError("This player already belongs to the team for this Fill My Squad listing.")
    if game.participants.filter(user=invited_user, status__in=ACTIVE_PARTICIPANT_STATUSES).exists():
        raise ValidationError("This player is already in the game roster.")
    if not player_meets_skill(game, invited_user):
        raise ValidationError("This player does not match the game skill requirement.")
    if player_has_overlapping_confirmed_game(invited_user, game):
        raise ValidationError("This player already has another active game at this time.")

    existing_request = (
        JoinRequest.objects.select_for_update()
        .filter(game=game, player=invited_user)
        .first()
    )
    if existing_request and existing_request.status not in [
        JoinRequest.Status.REJECTED,
        JoinRequest.Status.WITHDRAWN,
        JoinRequest.Status.REMOVED,
        JoinRequest.Status.EXPIRED,
    ]:
        raise ValidationError("This player already has an active request or invitation for this game.")

    selected_role = requested_role or GameRoleRequirement.CricksalRole.ANY
    if game.available_spots <= 0 and not game.waitlist_enabled:
        raise ValidationError("This game is already full.")
    if game.available_spots > 0:
        ensure_role_has_space(game, selected_role, include_any=True)

    join_request, _ = JoinRequest.objects.update_or_create(
        game=game,
        player=invited_user,
        defaults={
            "requested_role": selected_role,
            "message": str(message or "").strip()[:400],
            "attendance_confirmed": False,
            "status": JoinRequest.Status.INVITED,
            "decided_by": actor,
            "decided_at": timezone.now(),
            "waitlist_position": None,
        },
    )
    notify_game_invitation(join_request, actor)
    return join_request


@transaction.atomic
def respond_game_invitation(join_request, player, response):
    # Always lock the game before its request. Expiry, withdrawal and host
    # decisions use the same order, preventing capacity/deadline races.
    game = Game.objects.select_for_update().order_by().select_related("host").get(id=join_request.game_id)
    locked_request = JoinRequest.objects.select_for_update().select_related("game", "player", "game__host").get(id=join_request.id, player=player)
    if locked_request.status != JoinRequest.Status.INVITED:
        raise ValidationError("This invitation can no longer be changed.")

    now = timezone.now()
    if (
        (game.recruitment_deadline and game.recruitment_deadline <= now)
        or (game.start_at and game.start_at <= now)
    ):
        locked_request.status = JoinRequest.Status.EXPIRED
        locked_request.decided_at = now
        locked_request.waitlist_position = None
        locked_request.save(update_fields=["status", "decided_at", "waitlist_position", "updated_at"])
        notify_join_request_expired(locked_request, JoinRequest.Status.INVITED)
        return locked_request

    normalized = str(response or "").upper()
    if normalized == "DECLINE":
        locked_request.status = JoinRequest.Status.REJECTED
        locked_request.decided_at = timezone.now()
        locked_request.save(update_fields=["status", "decided_at", "updated_at"])
        notify_game_invitation_response(locked_request, player, "declined")
        return locked_request
    if normalized != "ACCEPT":
        raise ValidationError("Choose a valid invitation response.")

    game.refresh_status()
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED]:
        raise ValidationError("This game is no longer accepting players.")
    if not player_meets_skill(game, player):
        raise ValidationError("You no longer match the game skill requirement.")
    if player_has_overlapping_confirmed_game(player, game):
        raise ValidationError("You already have another confirmed game at this time.")
    if game.available_spots <= 0:
        if not game.waitlist_enabled:
            raise ValidationError("This game is already full.")
        locked_request.status = JoinRequest.Status.WAITLISTED
        locked_request.waitlist_position = locked_request.waitlist_position or next_waitlist_position(game)
        locked_request.decided_at = timezone.now()
        locked_request.save(update_fields=["status", "waitlist_position", "decided_at", "updated_at"])
        notify_game_invitation_response(locked_request, player, "joined the waitlist for")
        return locked_request

    ensure_role_has_space(game, locked_request.requested_role, include_any=True)
    participant_status = GameParticipant.Status.CONFIRMED if game.booking_id else GameParticipant.Status.PROVISIONAL
    GameParticipant.objects.update_or_create(
        game=game,
        user=player,
        defaults={
            "participant_type": GameParticipant.ParticipantType.TEMPORARY,
            "role": locked_request.requested_role,
            "status": participant_status,
            "added_by": game.host,
        },
    )
    locked_request.status = JoinRequest.Status.ACCEPTED
    locked_request.decided_at = timezone.now()
    locked_request.waitlist_position = None
    locked_request.save(update_fields=["status", "decided_at", "waitlist_position", "updated_at"])
    game.refresh_status()
    notify_game_invitation_response(locked_request, player, "accepted")
    return locked_request
@transaction.atomic
def decide_join_request(join_request, actor, decision):
    # Lock the game first so this decision has the same lock ordering as join,
    # withdrawal and maintenance expiry.
    game = Game.objects.select_for_update().order_by().select_related("host").get(id=join_request.game_id)
    if game.host_id != actor.id:
        raise ValidationError("Only the game host can manage requests.")
    synchronize_game_lifecycle(game, expire_requests=True)
    locked_request = JoinRequest.objects.select_for_update().select_related("game", "player").get(id=join_request.id, game_id=game.id)
    if locked_request.status not in [JoinRequest.Status.PENDING, JoinRequest.Status.WAITLISTED]:
        return locked_request

    normalized = str(decision).upper()
    if normalized in {"ACCEPT", "WAITLIST"} and game.status not in [Game.Status.RECRUITING, Game.Status.FULL]:
        raise ValidationError("This game is no longer accepting players.")
    if normalized == "ACCEPT":
        validate_join_request_decision_acceptance(game, locked_request)
        participant_status = GameParticipant.Status.CONFIRMED if game.booking_id else GameParticipant.Status.PROVISIONAL
        GameParticipant.objects.update_or_create(
            game=game,
            user=locked_request.player,
            defaults={
                "participant_type": GameParticipant.ParticipantType.TEMPORARY,
                "role": locked_request.requested_role,
                "status": participant_status,
                "added_by": actor,
            },
        )
        locked_request.status = JoinRequest.Status.ACCEPTED
        locked_request.waitlist_position = None
        action_status = Notification.ActionStatus.ACCEPTED
        notify_join_request_decision(locked_request, actor, "accepted")
    elif normalized == "REJECT":
        locked_request.status = JoinRequest.Status.REJECTED
        action_status = Notification.ActionStatus.REJECTED
        notify_join_request_decision(locked_request, actor, "declined")
    elif normalized == "WAITLIST":
        locked_request.status = JoinRequest.Status.WAITLISTED
        locked_request.waitlist_position = locked_request.waitlist_position or next_waitlist_position(game)
        action_status = Notification.ActionStatus.PENDING
        notify_join_request_decision(locked_request, actor, "waitlisted")
    else:
        raise ValidationError("Choose a valid request action.")

    locked_request.decided_by = actor
    locked_request.decided_at = timezone.now()
    locked_request.save(update_fields=["status", "decided_by", "decided_at", "waitlist_position", "updated_at"])
    resequence_waitlist(game)
    game.refresh_status()
    mark_related_action_state(
        recipient=actor,
        related_entity_type="game_join_request",
        related_entity_id=locked_request.id,
        action_status=action_status,
    )
    return locked_request


def validate_join_request_decision_acceptance(game, join_request):
    game.refresh_status()
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL]:
        raise ValidationError("This game is not accepting roster changes right now.")
    if game.available_spots <= 0:
        raise ValidationError("This game is already full. Keep the player on the waitlist instead.")
    if is_active_registered_team_member(game, join_request.player):
        raise ValidationError("This player already belongs to the team for this Fill My Squad listing.")
    if player_has_overlapping_confirmed_game(join_request.player, game):
        raise ValidationError("This player already has another confirmed game at this time.")
    if not player_meets_skill(game, join_request.player):
        raise ValidationError("This player no longer matches the skill requirement.")
    ensure_role_has_space(game, join_request.requested_role)


def resequence_waitlist(game):
    """Keep visible waitlist positions contiguous and deterministic."""
    waitlisted = list(
        JoinRequest.objects.select_for_update()
        .filter(game=game, status=JoinRequest.Status.WAITLISTED)
        .order_by("waitlist_position", "created_at", "id")
    )
    now = timezone.now()
    for position, join_request in enumerate(waitlisted, start=1):
        if join_request.waitlist_position != position:
            JoinRequest.objects.filter(pk=join_request.pk).update(
                waitlist_position=position,
                updated_at=now,
            )


def next_waitlist_position(game):
    resequence_waitlist(game)
    return (
        JoinRequest.objects.filter(
            game=game,
            status=JoinRequest.Status.WAITLISTED,
        ).count()
        + 1
    )


@transaction.atomic
def leave_game(game, player):
    locked_game = Game.objects.select_for_update().order_by().get(id=game.id)
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    participant = GameParticipant.objects.select_for_update().filter(
        game=locked_game,
        user=player,
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).first()
    if not participant:
        raise ValidationError("You are not an active participant in this game.")
    if participant.participant_type == GameParticipant.ParticipantType.HOST:
        raise ValidationError("The host must cancel the public game instead of leaving it.")
    if locked_game.start_at and locked_game.start_at <= timezone.now():
        raise ValidationError("This game has already started.")
    participant.status = GameParticipant.Status.LEFT
    participant.save(update_fields=["status"])
    resequence_waitlist(locked_game)
    refresh_reconfirmation_state(locked_game)
    locked_game.refresh_status()
    notify_participant_left(locked_game, player)
    return participant


@transaction.atomic
def attach_booking_to_game(game, booking, actor):
    locked_game = Game.objects.select_for_update().order_by().select_related("host").get(id=game.id)
    if locked_game.host_id != actor.id:
        raise ValidationError("Only the host can attach a booking to this game.")
    validate_game_booking_handoff(locked_game, actor)
    if locked_game.creation_mode != Game.CreationMode.PLAN_FIRST:
        raise ValidationError("This game already uses a confirmed booking.")
    if locked_game.booking_id:
        return locked_game
    ensure_booking_can_publish_game(booking, actor, exclude_game_id=locked_game.id)
    previous_start = locked_game.start_at
    previous_end = locked_game.end_at
    previous_area = (locked_game.preferred_area or "").strip().lower()
    locked_game.booking = booking
    locked_game.booking_attached_at = timezone.now()
    booking_start = get_booking_start_at(booking)
    booking_end = booking_end_at(booking)
    booking_area = (booking.venue.area or booking.venue.city or "").strip().lower()
    material_change = bool(
        (previous_start and booking_start and abs((booking_start - previous_start).total_seconds()) > 900)
        or (previous_end and booking_end and abs((booking_end - previous_end).total_seconds()) > 900)
        or (previous_area and booking_area and previous_area != booking_area)
    )
    locked_game.requires_reconfirmation = False
    locked_game.save(update_fields=["booking", "booking_attached_at", "requires_reconfirmation", "updated_at"])
    participants = locked_game.participants.filter(status__in=ACTIVE_PARTICIPANT_STATUSES)
    if material_change:
        participants.exclude(participant_type=GameParticipant.ParticipantType.HOST).exclude(
            participant_type=GameParticipant.ParticipantType.GUEST,
        ).update(status=GameParticipant.Status.RECONFIRM_REQUIRED)
        participants.filter(
            participant_type=GameParticipant.ParticipantType.GUEST,
        ).update(status=GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED)
        participants.filter(
            participant_type=GameParticipant.ParticipantType.HOST,
        ).update(status=GameParticipant.Status.CONFIRMED)
    else:
        participants.update(status=GameParticipant.Status.CONFIRMED)
    refresh_reconfirmation_state(locked_game)
    locked_game.refresh_status()
    notify_booking_attached(locked_game, material_change)
    return locked_game


@transaction.atomic
def reconfirm_game(game, player, response):
    locked_game = Game.objects.select_for_update().order_by().get(id=game.id)
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    if locked_game.status in [Game.Status.CANCELLED, Game.Status.IN_PROGRESS, Game.Status.COMPLETED]:
        raise ValidationError("This game is no longer accepting reconfirmations.")
    participant = GameParticipant.objects.select_for_update().filter(
        game=locked_game,
        user=player,
        status=GameParticipant.Status.RECONFIRM_REQUIRED,
    ).first()
    if not participant:
        raise ValidationError("No reconfirmation is required for your spot.")
    normalized = str(response).upper()
    if normalized == "RECONFIRM":
        participant.status = GameParticipant.Status.CONFIRMED
    elif normalized == "DECLINE":
        participant.status = GameParticipant.Status.DECLINED
    else:
        raise ValidationError("Choose a valid reconfirmation response.")
    participant.save(update_fields=["status"])
    refresh_reconfirmation_state(locked_game)
    locked_game.refresh_status()
    notify_reconfirmation_response(locked_game, participant, normalized)
    return participant


@transaction.atomic
def confirm_guest_schedule(game_id, participant_id, actor):
    """Record the host's acknowledgement for an offline guest.

    Guests do not have SportSpot accounts and therefore cannot respond to the
    registered-player reconfirmation endpoint. The host explicitly confirms
    that the guest was told about the final booking details.
    """
    locked_game = Game.objects.select_for_update().order_by().select_related("host").get(id=game_id)
    if locked_game.host_id != actor.id:
        raise ValidationError("Only the host can confirm an offline guest's schedule.")
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    if locked_game.status in [Game.Status.CANCELLED, Game.Status.IN_PROGRESS, Game.Status.COMPLETED]:
        raise ValidationError("Guest schedules can no longer be confirmed for this game.")
    participant = GameParticipant.objects.select_for_update().filter(
        id=participant_id,
        game=locked_game,
        participant_type=GameParticipant.ParticipantType.GUEST,
        status=GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED,
    ).first()
    if not participant:
        raise ValidationError("This guest does not need schedule confirmation.")
    participant.status = GameParticipant.Status.CONFIRMED
    participant.save(update_fields=["status"])
    refresh_reconfirmation_state(locked_game)
    locked_game.refresh_status()
    return participant



def game_should_expire_open_requests(game, now=None):
    now = now or timezone.now()
    start_at = game.start_at
    return (
        game.status in REQUEST_EXPIRING_GAME_STATUSES
        or bool(game.recruitment_deadline and game.recruitment_deadline <= now)
        or bool(start_at and start_at <= now)
    )


def expire_open_join_requests_for_game(game, now=None, dry_run=False, notify=True):
    now = now or timezone.now()
    request_queryset = JoinRequest.objects
    if not dry_run:
        request_queryset = request_queryset.select_for_update()
    requests = list(
        request_queryset.select_related("player", "game", "game__host")
        .filter(game=game, status__in=EXPIRABLE_JOIN_REQUEST_STATUSES)
        .order_by("id")
    )
    if dry_run:
        return len(requests)

    for join_request in requests:
        previous_status = join_request.status
        join_request.status = JoinRequest.Status.EXPIRED
        join_request.decided_at = now
        join_request.waitlist_position = None
        join_request.save(update_fields=["status", "decided_at", "waitlist_position", "updated_at"])
        if notify:
            mark_related_action_state(
                recipient=join_request.game.host,
                related_entity_type="game_join_request",
                related_entity_id=join_request.id,
                action_status=Notification.ActionStatus.EXPIRED,
            )
            mark_related_action_state(
                recipient=join_request.player,
                related_entity_type="game_join_request",
                related_entity_id=join_request.id,
                action_status=Notification.ActionStatus.EXPIRED,
            )
            notify_join_request_expired(join_request, previous_status)
    resequence_waitlist(game)
    return len(requests)


def expire_matchmaking_deadlines(now=None, dry_run=False, notify=True, limit=100):
    now = now or timezone.now()
    stats = {
        "games_closed": 0,
        "games_cancelled": 0,
        "games_in_progress": 0,
        "games_completed": 0,
        "requests_expired": 0,
    }
    # Select only records that can actually transition at this instant. The
    # previous implementation selected every open game, which meant a large
    # number of future games could permanently starve older expired games when
    # a scheduler used a bounded batch size.
    local_now = timezone.localtime(now)
    today = local_now.date()
    current_time = local_now.time()
    booking_start_due = (
        Q(booking__slot__date__lt=today)
        | Q(booking__slot__date=today, booking__slot__start_time__lte=current_time)
    )
    proposed_start_due = (
        Q(proposed_date__lt=today)
        | Q(proposed_date=today, proposed_start_time__lte=current_time)
    )
    booking_end_due = (
        Q(booking__slot_items__slot__date__lt=today)
        | Q(booking__slot_items__slot__date=today, booking__slot_items__slot__end_time__lte=current_time)
    )
    proposed_end_due = (
        Q(proposed_date__lt=today)
        | Q(proposed_date=today, proposed_end_time__lte=current_time)
    )
    due_lifecycle = (
        Q(
            booking__status__in=[Booking.BookingStatus.CANCELLED, Booking.BookingStatus.EXPIRED],
            status__in=[Game.Status.DRAFT, Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED, Game.Status.IN_PROGRESS],
        )
        |
        Q(recruitment_deadline__isnull=False, recruitment_deadline__lte=now)
        | Q(
            creation_mode=Game.CreationMode.PLAN_FIRST,
            booking__isnull=True,
            booking_deadline__isnull=False,
            booking_deadline__lte=now,
        )
        | (Q(status__in=[Game.Status.RECRUITING, Game.Status.FULL]) & booking_start_due)
        | (Q(status=Game.Status.IN_PROGRESS) & booking_end_due)
        | (Q(status__in=[Game.Status.RECRUITING, Game.Status.FULL]) & proposed_start_due)
        | (Q(status=Game.Status.IN_PROGRESS) & proposed_end_due)
    )
    stale_requests = Q(
        status__in=[Game.Status.CLOSED, Game.Status.CANCELLED, Game.Status.IN_PROGRESS, Game.Status.COMPLETED],
        join_requests__status__in=EXPIRABLE_JOIN_REQUEST_STATUSES,
    )
    game_ids = list(
        Game.objects.filter(due_lifecycle | stale_requests)
        .distinct()
        .order_by("id")
        .values_list("id", flat=True)[: max(1, int(limit))]
    )

    for game_id in game_ids:
        if dry_run:
            game = Game.objects.select_related("host", "booking", "booking__slot").get(id=game_id)
            previous_status = game.status
            next_status = game.refresh_status(save=False, now=now)
            if previous_status != next_status:
                _increment_lifecycle_stat(stats, next_status)
            if game_should_expire_open_requests(game, now):
                stats["requests_expired"] += expire_open_join_requests_for_game(game, now=now, dry_run=True, notify=notify)
            continue

        with transaction.atomic():
            game = Game.objects.select_for_update().select_related("booking").order_by().get(id=game_id)
            previous_status = game.status
            linked_booking_cancelled = synchronize_linked_booking_state(game, now=now)
            next_status = game.status if linked_booking_cancelled else game.refresh_status(save=True, now=now)
            if previous_status != next_status:
                _increment_lifecycle_stat(stats, next_status)
            if game_should_expire_open_requests(game, now):
                stats["requests_expired"] += expire_open_join_requests_for_game(game, now=now, dry_run=False, notify=notify)
    return stats


def _increment_lifecycle_stat(stats, status):
    if status == Game.Status.CLOSED:
        stats["games_closed"] += 1
    elif status == Game.Status.CANCELLED:
        stats["games_cancelled"] += 1
    elif status == Game.Status.IN_PROGRESS:
        stats["games_in_progress"] += 1
    elif status == Game.Status.COMPLETED:
        stats["games_completed"] += 1


def booking_end_at(booking):
    slots = booking.booked_slots
    if not slots:
        return None
    return timezone.make_aware(
        timezone.datetime.combine(slots[-1].date, slots[-1].end_time),
        timezone.get_current_timezone(),
    )


def notify_join_request_received(join_request):
    game = join_request.game
    label = "joined the waitlist for" if join_request.status == JoinRequest.Status.WAITLISTED else "requested to join"
    return create_notification(
        recipient=game.host,
        actor=join_request.player,
        notification_type=Notification.NotificationType.JOIN_REQUEST_RECEIVED,
        title="New game request",
        message=f"{join_request.player.full_name} {label} {game.title}.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/games/{game.id}",
        related_entity_type="game_join_request",
        related_entity_id=join_request.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"game_id": game.id, "game_title": game.title, "requested_role": join_request.requested_role},
        deduplication_key=f"game-request:{join_request.id}:received",
    )


def notify_join_request_decision(join_request, actor, label):
    notification_type = (
        Notification.NotificationType.JOIN_REQUEST_ACCEPTED
        if label == "accepted"
        else Notification.NotificationType.JOIN_REQUEST_REJECTED
        if label == "declined"
        else Notification.NotificationType.MATCH_UPDATED
    )
    return create_notification(
        recipient=join_request.player,
        actor=actor,
        notification_type=notification_type,
        title="Game request updated",
        message=f"Your request for {join_request.game.title} was {label}.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/find-game/{join_request.game_id}",
        related_entity_type="game_join_request",
        related_entity_id=join_request.id,
        action_status=Notification.ActionStatus.COMPLETED if label == "accepted" else Notification.ActionStatus.REJECTED if label == "declined" else Notification.ActionStatus.PENDING,
        metadata={"game_id": join_request.game_id, "request_status": join_request.status},
        deduplication_key=f"game-request:{join_request.id}:{label}",
    )

def notify_join_request_expired(join_request, previous_status):
    title = "Game request expired"
    if previous_status == JoinRequest.Status.INVITED:
        title = "Game invitation expired"
    elif previous_status == JoinRequest.Status.WAITLISTED:
        title = "Waitlist spot expired"
    return create_notification(
        recipient=join_request.player,
        actor=join_request.game.host,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title=title,
        message=f"{join_request.game.title} is no longer accepting this request.",
        priority=Notification.Priority.NORMAL,
        action_url=f"/find-game/{join_request.game_id}",
        related_entity_type="game_join_request",
        related_entity_id=join_request.id,
        action_required=False,
        action_status=Notification.ActionStatus.EXPIRED,
        metadata={"game_id": join_request.game_id, "request_status": join_request.status, "previous_status": previous_status},
        deduplication_key=f"game-request:{join_request.id}:expired",
    )



def notify_game_invitation(join_request, actor):
    return create_notification(
        recipient=join_request.player,
        actor=actor,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Pickup game invitation",
        message=f"{actor.full_name} invited you to join {join_request.game.title}.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/find-game/{join_request.game_id}",
        related_entity_type="game_join_request",
        related_entity_id=join_request.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"game_id": join_request.game_id, "requested_role": join_request.requested_role},
        deduplication_key=f"game-invite:{join_request.id}:sent",
    )


def notify_game_invitation_response(join_request, actor, label):
    return create_notification(
        recipient=join_request.game.host,
        actor=actor,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Game invitation updated",
        message=f"{actor.full_name} {label} your invitation for {join_request.game.title}.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/games/{join_request.game_id}",
        related_entity_type="game_join_request",
        related_entity_id=join_request.id,
        action_status=Notification.ActionStatus.COMPLETED if label == "accepted" else Notification.ActionStatus.REJECTED if label == "declined" else Notification.ActionStatus.PENDING,
        metadata={"game_id": join_request.game_id, "request_status": join_request.status},
        deduplication_key=f"game-invite:{join_request.id}:{label}",
    )
def notify_game_published(game):
    return create_notification(
        recipient=game.host,
        actor=game.host,
        notification_type=Notification.NotificationType.GAME_ROOM_CREATED,
        title="Pickup game published",
        message=f"{game.title} is now visible in Find Games.",
        priority=Notification.Priority.NORMAL,
        action_url=f"/dashboard/player/games/{game.id}",
        related_entity_type="game",
        related_entity_id=game.id,
        action_status=Notification.ActionStatus.COMPLETED,
        metadata={"game_id": game.id, "booking_id": game.booking_id, "creation_mode": game.creation_mode},
        deduplication_key=f"game:{game.id}:published",
    )


def notify_booking_attached(game, material_change=False):
    User = get_user_model()
    recipients = set(
        game.participants.filter(user__isnull=False, status__in=ACTIVE_PARTICIPANT_STATUSES).values_list("user_id", flat=True)
    )
    for recipient in User.objects.filter(id__in=recipients):
        create_notification(
            recipient=recipient,
            actor=game.host,
            notification_type=Notification.NotificationType.MATCH_UPDATED,
            title="Court booking confirmed",
            message=(
                f"{game.title} now has a verified SportSpot booking. Please reconfirm your spot."
                if material_change and recipient != game.host_id
                else f"{game.title} now has a verified SportSpot booking."
            ),
            priority=Notification.Priority.IMPORTANT,
            action_url=f"/dashboard/player/games/{game.id}/room",
            related_entity_type="game",
            related_entity_id=game.id,
            action_required=material_change and recipient.id != game.host_id,
            action_status=Notification.ActionStatus.PENDING if material_change and recipient.id != game.host_id else Notification.ActionStatus.COMPLETED,
            metadata={"game_id": game.id, "booking_id": game.booking_id, "requires_reconfirmation": material_change},
            deduplication_key=f"game:{game.id}:booking-attached:{recipient.id}",
        )
    if material_change and game.guest_confirmation_pending_count:
        create_notification(
            recipient=game.host,
            actor=game.host,
            notification_type=Notification.NotificationType.MATCH_UPDATED,
            title="Confirm guest schedule",
            message=f"The court time for {game.title} changed. Confirm that each offline guest knows the final booking details.",
            priority=Notification.Priority.IMPORTANT,
            action_url=f"/dashboard/player/games/{game.id}",
            related_entity_type="game",
            related_entity_id=game.id,
            action_required=True,
            action_status=Notification.ActionStatus.PENDING,
            metadata={
                "game_id": game.id,
                "booking_id": game.booking_id,
                "guest_confirmation_required": True,
            },
            deduplication_key=f"game:{game.id}:guest-schedule:{game.booking_id}",
        )


def notify_reconfirmation_response(game, participant, response):
    if not participant.user_id:
        return None
    accepted = response == "RECONFIRM"
    return create_notification(
        recipient=game.host,
        actor=participant.user,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Player confirmed the updated schedule" if accepted else "Player declined the updated schedule",
        message=(
            f"{participant.user.full_name} confirmed the final details for {game.title}."
            if accepted
            else f"{participant.user.full_name} can no longer join {game.title} after the schedule changed."
        ),
        priority=Notification.Priority.NORMAL if accepted else Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/games/{game.id}",
        related_entity_type="game",
        related_entity_id=game.id,
        action_required=not accepted,
        action_status=Notification.ActionStatus.COMPLETED if accepted else Notification.ActionStatus.PENDING,
        metadata={"game_id": game.id, "participant_id": participant.id, "response": response},
        deduplication_key=f"game:{game.id}:reconfirm:{participant.id}:{response}",
    )


def notify_participant_left(game, player):
    return create_notification(
        recipient=game.host,
        actor=player,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Player left your game",
        message=f"{player.full_name} left {game.title}. You can promote a waitlisted player if one is suitable.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/games/{game.id}",
        related_entity_type="game",
        related_entity_id=game.id,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"game_id": game.id, "player_id": player.id},
        deduplication_key=f"game:{game.id}:left:{player.id}",
    )


def notify_participant_removed(game, participant, actor):
    if not participant.user_id:
        return None
    return create_notification(
        recipient=participant.user,
        actor=actor,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Your game participation changed",
        message=f"You are no longer part of {game.title}. The host has reopened your player spot.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/find-game/{game.id}",
        related_entity_type="game",
        related_entity_id=game.id,
        action_status=Notification.ActionStatus.REJECTED,
        metadata={"game_id": game.id, "participant_id": participant.id, "change": "participant_removed"},
        deduplication_key=f"game:{game.id}:participant-removed:{participant.id}",
    )


def notify_game_updated(game, actor, schedule_changed=False):
    recipients = set(
        game.participants.filter(
            user__isnull=False,
            status__in=ACTIVE_PARTICIPANT_STATUSES,
        ).exclude(user_id=actor.id).values_list("user_id", flat=True)
    )
    for recipient in get_user_model().objects.filter(id__in=recipients):
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=Notification.NotificationType.MATCH_UPDATED,
            title="Game details updated",
            message=(
                f"{game.title} has a new schedule or location. Please reconfirm your spot."
                if schedule_changed
                else f"The host updated the details for {game.title}."
            ),
            priority=Notification.Priority.IMPORTANT,
            action_url=f"/dashboard/player/games/{game.id}/room",
            related_entity_type="game",
            related_entity_id=game.id,
            action_required=schedule_changed,
            action_status=Notification.ActionStatus.PENDING if schedule_changed else Notification.ActionStatus.COMPLETED,
            metadata={"game_id": game.id, "schedule_changed": schedule_changed},
            deduplication_key=f"game:{game.id}:updated:{recipient.id}:{game.updated_at.isoformat()}",
        )
    if schedule_changed and game.guest_confirmation_pending_count:
        create_notification(
            recipient=game.host,
            actor=actor,
            notification_type=Notification.NotificationType.MATCH_UPDATED,
            title="Confirm guest schedule",
            message=f"The schedule for {game.title} changed. Confirm that each offline guest knows the updated plan.",
            priority=Notification.Priority.IMPORTANT,
            action_url=f"/dashboard/player/games/{game.id}",
            related_entity_type="game",
            related_entity_id=game.id,
            action_required=True,
            action_status=Notification.ActionStatus.PENDING,
            metadata={"game_id": game.id, "guest_confirmation_required": True},
            deduplication_key=f"game:{game.id}:guest-schedule-edit:{game.updated_at.isoformat()}",
        )


def notify_game_cancelled(game, actor):
    User = get_user_model()
    recipients = set(
        game.participants.filter(user__isnull=False, status__in=ACTIVE_PARTICIPANT_STATUSES).values_list("user_id", flat=True)
    )
    for recipient in User.objects.filter(id__in=recipients):
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=Notification.NotificationType.MATCH_CANCELLED,
            title="Game cancelled",
            message=f"{game.title} has been cancelled. Any linked court booking is handled separately.",
            priority=Notification.Priority.URGENT,
            action_url=f"/find-game/{game.id}",
            related_entity_type="game",
            related_entity_id=game.id,
            action_status=Notification.ActionStatus.CANCELLED,
            metadata={"game_id": game.id, "reason": game.cancellation_reason},
            deduplication_key=f"game:{game.id}:cancelled:{recipient.id}",
        )


def notify_game_recruitment_closed(game, actor):
    recipients = game.participants.filter(
        user__isnull=False,
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).values_list("user_id", flat=True)
    for recipient in get_user_model().objects.filter(id__in=set(recipients)):
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=Notification.NotificationType.MATCH_UPDATED,
            title="Recruitment closed",
            message=f"Recruitment for {game.title} is closed. Your confirmed spot remains unchanged.",
            priority=Notification.Priority.NORMAL,
            action_url=f"/dashboard/player/games/{game.id}/room",
            related_entity_type="game",
            related_entity_id=game.id,
            action_status=Notification.ActionStatus.COMPLETED,
            metadata={"game_id": game.id, "change": "recruitment_closed"},
            deduplication_key=f"game:{game.id}:recruitment-closed:{recipient}",
        )


def notify_game_recruitment_reopened(game, actor):
    recipients = game.participants.filter(
        user__isnull=False,
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).exclude(user_id=actor.id).values_list("user_id", flat=True)
    for recipient in get_user_model().objects.filter(id__in=set(recipients)):
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=Notification.NotificationType.MATCH_UPDATED,
            title="Recruitment reopened",
            message=f"The host reopened recruitment for {game.title}. Your existing spot remains unchanged.",
            priority=Notification.Priority.NORMAL,
            action_url=f"/dashboard/player/games/{game.id}/room",
            related_entity_type="game",
            related_entity_id=game.id,
            action_status=Notification.ActionStatus.COMPLETED,
            metadata={"game_id": game.id, "change": "recruitment_reopened"},
            deduplication_key=f"game:{game.id}:recruitment-reopened:{game.updated_at.isoformat()}:{recipient}",
        )






