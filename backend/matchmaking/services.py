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

from .models import ACTIVE_PARTICIPANT_STATUSES, Game, GameParticipant, GameRoleRequirement, JoinRequest


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
    game.refresh_status()
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


def role_filled_count(game, role):
    return game.participants.filter(
        status__in=ACTIVE_PARTICIPANT_STATUSES,
        participant_type__in=[GameParticipant.ParticipantType.TEMPORARY, GameParticipant.ParticipantType.GUEST],
        role=role,
    ).count()


def ensure_role_has_space(game, role, include_any=False):
    role = role or GameRoleRequirement.CricksalRole.ANY
    if role == GameRoleRequirement.CricksalRole.ANY:
        if game.available_spots <= 0:
            raise ValidationError("This game is already full.")
        return
    requirement = game.role_requirements.filter(role=role).first()
    if not requirement:
        if include_any and game.role_requirements.filter(role=GameRoleRequirement.CricksalRole.ANY).exists():
            ensure_role_has_space(game, GameRoleRequirement.CricksalRole.ANY)
            return
        raise ValidationError("This role is not being recruited for this game.")
    if role_filled_count(game, role) >= requirement.required_count:
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


def validate_join_request(game, player, requested_role=None):
    game.refresh_status()
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
    if JoinRequest.objects.filter(game=game, player=player).exclude(status__in=[JoinRequest.Status.WITHDRAWN, JoinRequest.Status.REJECTED, JoinRequest.Status.EXPIRED]).exists():
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
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED]:
        raise ValidationError("Guests cannot be added to this game right now.")
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
    locked_request = JoinRequest.objects.select_for_update().select_related("game", "player").get(id=join_request.id, game_id=game.id)
    if game.host_id != actor.id:
        raise ValidationError("Only the game host can manage requests.")
    if locked_request.status not in [JoinRequest.Status.PENDING, JoinRequest.Status.WAITLISTED]:
        return locked_request

    normalized = str(decision).upper()
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
    locked_game.refresh_status()
    notify_participant_left(locked_game, player)
    return participant


@transaction.atomic
def attach_booking_to_game(game, booking, actor):
    locked_game = Game.objects.select_for_update().order_by().select_related("host").get(id=game.id)
    if locked_game.host_id != actor.id:
        raise ValidationError("Only the host can attach a booking to this game.")
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
    locked_game.requires_reconfirmation = material_change
    locked_game.save(update_fields=["booking", "booking_attached_at", "requires_reconfirmation", "updated_at"])
    participants = locked_game.participants.filter(status__in=[GameParticipant.Status.PROVISIONAL, GameParticipant.Status.RECONFIRM_REQUIRED])
    if material_change:
        participants.exclude(participant_type=GameParticipant.ParticipantType.HOST).update(status=GameParticipant.Status.RECONFIRM_REQUIRED)
        participants.filter(participant_type=GameParticipant.ParticipantType.HOST).update(status=GameParticipant.Status.CONFIRMED)
    else:
        participants.update(status=GameParticipant.Status.CONFIRMED)
    locked_game.refresh_status()
    notify_booking_attached(locked_game, material_change)
    return locked_game


@transaction.atomic
def reconfirm_game(game, player, response):
    participant = GameParticipant.objects.select_for_update().filter(
        game=game,
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
    game.refresh_status()
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
            game = Game.objects.select_for_update().order_by().get(id=game_id)
            previous_status = game.status
            next_status = game.refresh_status(save=True, now=now)
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
                if material_change
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






