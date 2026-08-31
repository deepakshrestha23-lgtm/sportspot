from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from notifications.models import Notification
from notifications.services import create_notification, mark_related_action_state, notify_chat_message
from players.models import PlayerProfile
from teams.models import Team, TeamMember
from venues.models import Booking
from venues.policies import get_booking_start_at
from venues.reference_data import SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG

from .models import (
    ACTIVE_PARTICIPANT_STATUSES,
    AUTOMATIC_PLAN_FIRST_CANCELLATION_REASON,
    RECONFIRMATION_PENDING_STATUSES,
    Game,
    GameParticipant,
    GameRoleRequirement,
    JoinRequest,
    JoinRequestEvent,
)


ACTIVE_GAME_STATUSES = [
    Game.Status.DRAFT,
    Game.Status.RECRUITING,
    Game.Status.FULL,
    Game.Status.CLOSED,
    Game.Status.BOOKING_PENDING,
    Game.Status.IN_PROGRESS,
    Game.Status.COMPLETED,
]

EXPIRABLE_JOIN_REQUEST_STATUSES = [
    JoinRequest.Status.PENDING,
    JoinRequest.Status.WAITLISTED,
    JoinRequest.Status.INVITED,
]

REQUEST_EXPIRING_GAME_STATUSES = [
    Game.Status.BOOKING_PENDING,
    Game.Status.CLOSED,
    Game.Status.CANCELLED,
    Game.Status.IN_PROGRESS,
    Game.Status.COMPLETED,
]


def record_join_request_event(join_request, event_type, *, actor=None, previous_status="", metadata=None):
    """Keep an immutable lifecycle trail when a player reuses a request row."""
    return JoinRequestEvent.objects.create(
        game_id=join_request.game_id,
        join_request=join_request,
        player_id=join_request.player_id,
        actor=actor,
        event_type=event_type,
        previous_status=previous_status,
        current_status=join_request.status,
        attempt_number=join_request.attempt_number,
        metadata=metadata or {},
    )


def set_participant_status(participant, status, *, actor=None, acknowledge_schedule=False):
    """Apply roster transitions consistently and retain who made the change."""
    participant.status = status
    participant.status_changed_at = timezone.now()
    participant.status_changed_by = actor
    update_fields = ["status", "status_changed_at", "status_changed_by"]
    if acknowledge_schedule:
        participant.schedule_acknowledged_at = timezone.now()
        participant.schedule_acknowledged_by = actor
        update_fields.extend(["schedule_acknowledged_at", "schedule_acknowledged_by"])
    participant.save(update_fields=update_fields)
    return participant


def ensure_game_participation_commitment(participant, *, created_by=None):
    """Create a reliability commitment only for a confirmed registered player."""
    if (
        not participant
        or not participant.user_id
        or participant.participant_type == GameParticipant.ParticipantType.GUEST
        or participant.status != GameParticipant.Status.CONFIRMED
        or not participant.game_id
    ):
        return None, False
    game = participant.game
    if not game.booking_id or not game.start_at or not game.end_at:
        return None, False
    from players.services import create_participation_commitment

    return create_participation_commitment(
        player=participant.user,
        source_type="MATCHMAKING_GAME",
        source_id=game.id,
        source_participant_id=participant.id,
        start_at=game.start_at,
        end_at=game.end_at,
        metadata={
            "game_id": game.id,
            "participant_id": participant.id,
            "participant_type": participant.participant_type,
        },
        created_by=created_by,
    )


def ensure_game_participation_commitments(game, *, created_by=None):
    if not game.booking_id:
        return 0
    participants = game.participants.filter(
        status=GameParticipant.Status.CONFIRMED,
        user__isnull=False,
    ).exclude(participant_type=GameParticipant.ParticipantType.GUEST).select_related("user", "game")
    created = 0
    for participant in participants:
        _commitment, was_created = ensure_game_participation_commitment(participant, created_by=created_by)
        created += int(was_created)
    return created


def void_game_participation_commitments(game, *, actor=None, reason=""):
    from players.models import ParticipationCommitment
    from players.services import void_participation_commitment

    player_ids = list(
        ParticipationCommitment.objects.filter(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=game.id,
            status__in=[
                ParticipationCommitment.Status.COMMITTED,
                ParticipationCommitment.Status.ATTENDANCE_PENDING,
                ParticipationCommitment.Status.NO_SHOW_REPORTED,
                ParticipationCommitment.Status.DISPUTED,
            ],
        ).values_list("player_id", flat=True)
    )
    count = 0
    for player_id in player_ids:
        _commitment, changed = void_participation_commitment(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=game.id,
            player_id=player_id,
            actor=actor,
            reason=reason or "game_cancelled",
        )
        count += int(changed)
    return count


@transaction.atomic
def record_game_attendance(game_id, participant_id, actor, attendance_status):
    """Record registered-player attendance for a completed Pickup/Fill game."""
    from players.services import record_commitment_attendance

    game = Game.objects.select_for_update(of=("self",)).select_related("host", "booking").get(id=game_id)
    synchronize_and_require_game_host(game, actor, "Only the game host can record attendance.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status != Game.Status.COMPLETED:
        raise ValidationError("Attendance can be recorded after the game is completed.")
    participant = GameParticipant.objects.select_for_update().select_related("user", "game").filter(
        id=participant_id,
        game=game,
        user__isnull=False,
        participant_type__in=[
            GameParticipant.ParticipantType.HOST,
            GameParticipant.ParticipantType.TEAM_MEMBER,
            GameParticipant.ParticipantType.TEMPORARY,
        ],
        status=GameParticipant.Status.CONFIRMED,
    ).first()
    if not participant:
        raise ValidationError("Choose a registered player from this completed game.")
    normalized = str(attendance_status or "").upper()
    if normalized not in {"ATTENDED", "ABSENT"}:
        raise ValidationError("Choose attended or absent.")
    commitment, _created = ensure_game_participation_commitment(participant, created_by=actor)
    if not commitment:
        raise ValidationError("This player does not have a confirmed game commitment.")
    return record_commitment_attendance(
        commitment_id=commitment.id,
        actor=actor,
        attended=normalized == "ATTENDED",
    )


@transaction.atomic
def maybe_create_game_rating_eligibilities(game_id):
    """Unlock peer feedback only after every current registered spot is resolved."""
    from players.models import ParticipationCommitment
    from players.services import (
        ATTENDANCE_RESOLVED_STATUSES,
        create_rating_eligibilities_for_players,
    )

    game = Game.objects.select_related("booking").filter(
        pk=game_id,
        status=Game.Status.COMPLETED,
    ).first()
    if not game:
        return 0
    ensure_game_participation_commitments(game)
    participants = list(
        game.participants.filter(
            status=GameParticipant.Status.CONFIRMED,
            user__isnull=False,
        ).exclude(
            participant_type=GameParticipant.ParticipantType.GUEST,
        ).select_related("user")
    )
    if not participants:
        return 0

    commitments = list(
        ParticipationCommitment.objects.filter(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=game.id,
            source_participant_id__in=[participant.id for participant in participants],
        ).order_by("source_participant_id", "-source_version", "-id")
    )
    latest_by_participant = {}
    for commitment in commitments:
        latest_by_participant.setdefault(commitment.source_participant_id, commitment)
    current_commitments = [latest_by_participant.get(participant.id) for participant in participants]
    if any(commitment is None for commitment in current_commitments):
        return 0
    if any(commitment.status not in ATTENDANCE_RESOLVED_STATUSES for commitment in current_commitments):
        return 0
    attendees = [commitment.player for commitment in current_commitments if commitment.status == ParticipationCommitment.Status.ATTENDED]
    return create_rating_eligibilities_for_players(
        players=attendees,
        title=f"Feedback for {game.title}",
        related_entity_type="matchmaking_game",
        related_entity_id=game.id,
        match_date=game.start_at,
        metadata={"game_id": game.id, "game_type": game.game_type},
    )


@transaction.atomic
def dispute_game_attendance(game_id, participant_id, player, reason):
    from players.models import ParticipationCommitment
    from players.services import dispute_commitment

    participant = GameParticipant.objects.filter(
        id=participant_id,
        game_id=game_id,
        user=player,
    ).first()
    if not participant:
        raise ValidationError("You do not have an attendance record for this game.")
    commitment = ParticipationCommitment.objects.filter(
        player=player,
        source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
        source_id=game_id,
        source_participant_id=participant.id,
    ).order_by("-source_version", "-id").first()
    if not commitment:
        raise ValidationError("This game does not have a reviewable attendance record.")
    return dispute_commitment(commitment_id=commitment.id, player=player, reason=reason)


def game_room_access_level(game, user):
    """Return the least-privileged room a user may open for the game.

    A room is a coordination record, not a booking gate.  It exists while a
    game is being planned, remains available for schedule reconfirmation, and
    becomes read-only after cancellation or completion.  The terminal state
    is intentionally calculated *after* membership so a former applicant or
    an unrelated player can never use a historical room to discover private
    roster data.
    """
    if not getattr(user, "is_authenticated", False):
        return "NONE"

    is_host = game.host_id == user.id
    participant = None if is_host else game.participants.filter(
        user=user,
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).first()
    if not is_host and not participant:
        return "NONE"

    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED]:
        return "READ_ONLY"
    if game.requires_reconfirmation or (
        participant and participant.status in RECONFIRMATION_PENDING_STATUSES
    ):
        return "RECONFIRMATION"
    if is_host:
        return "CONFIRMED" if game.booking_id else "PLANNING"
    if game.booking_id and participant.status == GameParticipant.Status.CONFIRMED:
        return "CONFIRMED"
    return "PLANNING"


def synchronize_game_host_continuity(game, *, notify=True):
    """Keep a Fill My Squad host aligned with the team's current captain.

    A game cannot be left publicly manageable by a former captain. When a team
    captain changes, responsibility follows the team. If there is no valid
    active captain, the listing is closed while its booking and history remain
    separate and intact.
    """
    if (
        not game.team_id
        or game.game_type != Game.GameType.FILL_SQUAD
        or game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS]
    ):
        return False

    team = (
        Team.objects.select_related("captain")
        .filter(pk=game.team_id)
        .first()
    )
    captain = getattr(team, "captain", None) if team else None
    captain_is_valid = bool(
        captain
        and captain.role == "PLAYER"
        and captain.is_active
        and TeamMember.objects.filter(
            team_id=team.id,
            user_id=captain.id,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).exists()
    )

    if captain_is_valid and game.host_id == captain.id:
        return False

    old_host = get_user_model().objects.filter(pk=game.host_id).first()
    now = timezone.now()
    if captain_is_valid:
        old_host_participant = GameParticipant.objects.select_for_update().filter(
            game=game,
            user_id=game.host_id,
            participant_type=GameParticipant.ParticipantType.HOST,
            status__in=ACTIVE_PARTICIPANT_STATUSES,
        ).first()
        if old_host_participant:
            old_host_is_still_member = TeamMember.objects.filter(
                team_id=team.id,
                user_id=game.host_id,
                member_type=TeamMember.MemberType.REGISTERED,
                status=TeamMember.MemberStatus.ACTIVE,
            ).exists()
            old_host_participant.participant_type = (
                GameParticipant.ParticipantType.TEAM_MEMBER
                if old_host_is_still_member
                else GameParticipant.ParticipantType.HOST
            )
            if not old_host_is_still_member:
                old_host_participant.status = GameParticipant.Status.REMOVED
                old_host_participant.status_changed_at = now
                old_host_participant.status_changed_by = captain
                old_host_participant.save(update_fields=[
                    "participant_type", "status", "status_changed_at",
                    "status_changed_by",
                ])
            else:
                old_host_participant.save(update_fields=["participant_type"])
        game.host_id = captain.id
        game.host = captain
        game.save(update_fields=["host", "updated_at"])
        if notify:
            notify_game_host_transferred(game, old_host=old_host, new_host=captain)
        return True

    game.status = Game.Status.CANCELLED
    game.is_public = False
    game.cancelled_at = game.cancelled_at or now
    game.cancellation_reason = (
        "This game was closed because the team no longer has an active captain to manage it."
    )
    game.recruitment_closed_at = game.recruitment_closed_at or now
    game.save(update_fields=[
        "status", "is_public", "cancelled_at", "cancellation_reason",
        "recruitment_closed_at", "updated_at",
    ])
    expire_open_join_requests_for_game(game, now=now)
    if notify:
        notify_game_cancelled(game, old_host, booking_cancelled=False)
    return True


def synchronize_and_require_game_host(game, actor, message):
    """Synchronize team-host ownership before authorizing a host action."""
    synchronize_game_host_continuity(game)
    if game.host_id != actor.id:
        raise ValidationError(message)
    return game


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
        synchronize_game_host_continuity(game)
        synchronize_linked_booking_state(game, now=now)
        game.refresh_status(now=now)
        expire_pending_reconfirmations(game, now=now)
        if expire_requests and game_should_expire_open_requests(game, now):
            expire_open_join_requests_for_game(game, now=now)
    return game


def _cancel_game_for_linked_booking(game, actor=None, reason="", now=None, notify=True):
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
    game.booking_handoff_was_public = False
    game.save(update_fields=[
        "status", "is_public", "cancelled_at", "cancellation_reason",
        "booking_handoff_was_public", "updated_at",
    ])
    void_game_participation_commitments(game, actor=actor, reason=reason or "linked_booking_unavailable")
    expire_open_join_requests_for_game(game, now=now)
    if notify:
        notify_game_cancelled(game, actor, booking_cancelled=True)
    return True


def synchronize_linked_booking_state(game, now=None, notify=True):
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
        notify=notify,
    )


@transaction.atomic
def cancel_games_for_booking(booking, actor=None):
    """Cancel every still-active game linked to a cancelled booking.

    A booking may be linked to at most one active game, but this is written as
    a queryset so legacy data is repaired safely as well.
    """
    now = timezone.now()
    games = list(
        Game.objects.select_for_update(of=("self",))
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
            notify=True,
        )
    return len(games)


@transaction.atomic
def close_game_recruitment(game, actor):
    """Stop discovery and new requests without cancelling the game booking."""
    locked_game = Game.objects.select_for_update(of=("self",)).select_related("host", "booking").get(id=game.id)
    synchronize_and_require_game_host(locked_game, actor, "Only the game host can close recruitment.")
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    if locked_game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS, Game.Status.BOOKING_PENDING]:
        raise ValidationError("Recruitment cannot be changed for this game anymore.")
    if locked_game.status == Game.Status.CLOSED and not locked_game.is_public:
        return locked_game
    locked_game.status = Game.Status.CLOSED
    locked_game.is_public = False
    locked_game.recruitment_closed_reason = Game.RecruitmentClosureReason.HOST_CLOSED
    locked_game.recruitment_closed_at = timezone.now()
    locked_game.recruitment_closed_by = actor
    locked_game.save(update_fields=[
        "status", "is_public", "recruitment_closed_reason", "recruitment_closed_at",
        "recruitment_closed_by", "updated_at",
    ])
    expire_open_join_requests_for_game(locked_game)
    notify_game_recruitment_closed(locked_game, actor)
    return locked_game


@transaction.atomic
def reopen_game_recruitment(game, actor):
    """Reopen discovery only while the original schedule remains safe."""
    locked_game = Game.objects.select_for_update(of=("self",)).select_related("host", "booking").get(id=game.id)
    synchronize_and_require_game_host(locked_game, actor, "Only the game host can reopen recruitment.")
    synchronize_game_lifecycle(locked_game, expire_requests=True)
    if locked_game.status != Game.Status.CLOSED:
        raise ValidationError("Only a closed game can reopen recruitment.")
    if locked_game.recruitment_closed_reason != Game.RecruitmentClosureReason.HOST_CLOSED:
        raise ValidationError("Only recruitment closed by the host can be reopened.")
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
    locked_game.recruitment_closed_reason = ""
    locked_game.recruitment_closed_at = None
    locked_game.recruitment_closed_by = None
    locked_game.save(update_fields=[
        "status", "is_public", "recruitment_closed_reason", "recruitment_closed_at",
        "recruitment_closed_by", "updated_at",
    ])
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
    # A paid booking can only anchor one active player game, team challenge,
    # or confirmed fixture. Keep this catalogue authoritative for every
    # booking handoff flow instead of relying on each frontend to filter it.
    from team_challenges.models import ACTIVE_CHALLENGE_STATUSES

    now = timezone.now()
    bookings = (
        Booking.objects.filter(
            player=user,
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
        )
        .exclude(matchmaking_games__status__in=ACTIVE_GAME_STATUSES)
        .exclude(team_challenges__status__in=ACTIVE_CHALLENGE_STATUSES)
        .exclude(team_fixture__isnull=False)
        .select_related("venue", "court", "slot", "player")
        .prefetch_related("slot_items__slot", "matchmaking_games")
        .distinct()
        .order_by("slot__date", "slot__start_time")
    )
    eligible = []
    for booking in bookings:
        start_at = get_booking_start_at(booking)
        if not start_at or start_at <= now:
            continue
        eligible.append(booking)
    return eligible


def validate_game_booking_handoff(game, host):
    synchronize_and_require_game_host(game, host, "Only the host can book a court for this game.")
    synchronize_game_lifecycle(game, expire_requests=True)
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


@transaction.atomic
def mark_game_booking_payment_pending(game_id, booking_id, actor):
    """Temporarily close a Plan First listing while its court payment is held.

    The reservation deadline is deliberately separate from the game booking
    deadline. A payment started before the deadline is allowed to finish, but
    no new players can join while the host decides the court.
    """
    game = Game.objects.select_for_update(of=("self",)).get(id=game_id)
    booking = Booking.objects.select_for_update().get(id=booking_id)
    synchronize_and_require_game_host(game, actor, "Only the host can start court payment for this game.")
    if booking.player_id != actor.id:
        raise ValidationError("The court reservation must belong to the game host.")
    if booking.matchmaking_game_id != game.id:
        raise ValidationError("This reservation is not connected to this game plan.")
    if booking.status != Booking.BookingStatus.RESERVED or booking.payment_status != Booking.PaymentStatus.PENDING:
        raise ValidationError("This court reservation is no longer waiting for payment.")
    if game.status in [Game.Status.CANCELLED, Game.Status.IN_PROGRESS, Game.Status.COMPLETED]:
        raise ValidationError("This game can no longer be linked to a new booking.")
    game.booking_handoff_was_public = game.is_public
    game.status = Game.Status.BOOKING_PENDING
    game.is_public = False
    game.recruitment_closed_reason = Game.RecruitmentClosureReason.BOOKING_PAYMENT_PENDING
    game.recruitment_closed_at = timezone.now()
    game.recruitment_closed_by = actor
    game.save(update_fields=[
        "booking_handoff_was_public", "status", "is_public", "recruitment_closed_reason",
        "recruitment_closed_at", "recruitment_closed_by", "updated_at",
    ])
    return game


@transaction.atomic
def restore_game_after_booking_handoff_expiry(booking, now=None):
    """Restore a Plan First listing after an unpaid court reservation expires."""
    now = now or timezone.now()
    if not booking.matchmaking_game_id:
        return None
    game = Game.objects.select_for_update(of=("self",)).filter(id=booking.matchmaking_game_id).first()
    if not game or game.booking_id or game.status != Game.Status.BOOKING_PENDING:
        return game
    if game.booking_deadline and game.booking_deadline <= now:
        game.status = Game.Status.CANCELLED
        game.is_public = False
        game.cancelled_at = now
        game.cancellation_reason = AUTOMATIC_PLAN_FIRST_CANCELLATION_REASON
        game.booking_handoff_was_public = False
        game.save(update_fields=[
            "status", "is_public", "cancelled_at", "cancellation_reason",
            "booking_handoff_was_public", "updated_at",
        ])
        expire_open_join_requests_for_game(game, now=now)
        notify_game_cancelled(game, game.host, booking_cancelled=False)
        return game
    if game.booking_handoff_was_public and (not game.recruitment_deadline or game.recruitment_deadline > now):
        game.status = Game.Status.RECRUITING
        game.is_public = True
        game.recruitment_closed_reason = ""
        game.recruitment_closed_at = None
        game.recruitment_closed_by = None
        game.booking_handoff_was_public = False
        game.save(update_fields=[
            "status", "is_public", "recruitment_closed_reason", "recruitment_closed_at",
            "recruitment_closed_by", "booking_handoff_was_public", "updated_at",
        ])
        return game

    game.status = Game.Status.CLOSED
    game.is_public = False
    game.recruitment_closed_reason = Game.RecruitmentClosureReason.BOOKING_PAYMENT_EXPIRED
    game.recruitment_closed_at = now
    game.booking_handoff_was_public = False
    game.save(update_fields=[
        "status", "is_public", "recruitment_closed_reason", "recruitment_closed_at",
        "booking_handoff_was_public", "updated_at",
    ])
    return game


def add_initial_participants(game, host, guests=None, selected_team_member_ids=None):
    initial_status = GameParticipant.Status.CONFIRMED if game.booking_id else GameParticipant.Status.PROVISIONAL
    host_role = get_user_preferred_role(host)
    if game.game_type == Game.GameType.FILL_SQUAD and game.team_id:
        host_membership = TeamMember.objects.filter(
            team=game.team,
            user=host,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).first()
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
    # Booking-first games create accountable commitments at publication time.
    # Plan-first participants remain provisional and enter the ledger only after
    # the host attaches a paid confirmed booking.
    ensure_game_participation_commitments(game, created_by=host)


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


def _slot_window(slot):
    current_timezone = timezone.get_current_timezone()
    start_at = timezone.make_aware(
        timezone.datetime.combine(slot.date, slot.start_time),
        current_timezone,
    )
    end_at = timezone.make_aware(
        timezone.datetime.combine(slot.date, slot.end_time),
        current_timezone,
    )
    return start_at, end_at


def player_has_overlapping_commitment(
    player,
    start_at,
    end_at,
    *,
    exclude_game_id=None,
    exclude_booking_id=None,
    now=None,
):
    """Return whether a player already has a real schedule commitment.

    Matchmaking participants, team fixtures, participation commitments, and
    court bookings are separate records, so each supported source is checked
    before a player is offered or accepted into another activity. A confirmed
    paid booking, a still-held unpaid reservation, or an active commitment is
    treated as unavailable until its backend lifecycle releases it.
    """
    if not start_at or not end_at:
        return False
    now = now or timezone.now()
    games = Game.objects.filter(
        participants__user=player,
        participants__status__in=ACTIVE_PARTICIPANT_STATUSES,
        status__in=[
            Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED,
            Game.Status.BOOKING_PENDING, Game.Status.IN_PROGRESS,
        ],
    ).select_related("booking", "booking__slot")
    if exclude_game_id:
        games = games.exclude(pk=exclude_game_id)
    for other in games:
        other_start = other.start_at
        other_end = other.end_at
        if other_start and other_end and start_at < other_end and end_at > other_start:
            return True

    # The ledger is the common source for confirmed registered players across
    # Pickup Games, Fill My Squad, and Team Challenge fixtures. Exclude the
    # current matchmaking game so lifecycle refreshes can safely revalidate it.
    from players.models import ParticipationCommitment

    commitments = ParticipationCommitment.objects.filter(
        player=player,
        status__in=[
            ParticipationCommitment.Status.COMMITTED,
            ParticipationCommitment.Status.ATTENDANCE_PENDING,
            ParticipationCommitment.Status.NO_SHOW_REPORTED,
            ParticipationCommitment.Status.DISPUTED,
        ],
        end_at__gt=now,
    )
    if exclude_game_id:
        commitments = commitments.exclude(
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=exclude_game_id,
        )
    if commitments.filter(start_at__lt=end_at).exists():
        return True

    bookings = Booking.objects.filter(player=player).filter(
        Q(
            status=Booking.BookingStatus.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
        )
        | Q(
            status=Booking.BookingStatus.RESERVED,
            payment_status=Booking.PaymentStatus.PENDING,
            reserved_until__gt=now,
        )
    ).prefetch_related("slot_items__slot", "slot")
    if exclude_booking_id:
        bookings = bookings.exclude(pk=exclude_booking_id)
    for booking in bookings:
        seen_slot_ids = set()
        for slot in booking.booked_slots:
            if slot.pk in seen_slot_ids:
                continue
            seen_slot_ids.add(slot.pk)
            booking_start, booking_end = _slot_window(slot)
            if start_at < booking_end and end_at > booking_start:
                return True

    # Team fixtures are a separate domain from Pickup Games, but a selected
    # lineup is still a real player commitment. Import lazily to avoid the
    # matchmaking <-> team-challenge service import cycle.
    from team_challenges.models import TeamFixture, TeamFixtureParticipant

    fixture_participants = (
        TeamFixtureParticipant.objects.filter(
            player=player,
            status=TeamFixtureParticipant.Status.SELECTED,
            fixture__status__in=[
                TeamFixture.Status.SCHEDULED,
                TeamFixture.Status.RECONFIRMATION_REQUIRED,
            ],
            fixture__booking__isnull=False,
        )
        .select_related("fixture__booking")
        .prefetch_related("fixture__booking__slot_items__slot", "fixture__booking__slot")
    )
    for fixture_participant in fixture_participants:
        fixture_booking = fixture_participant.fixture.booking
        for slot in fixture_booking.booked_slots:
            fixture_start, fixture_end = _slot_window(slot)
            if start_at < fixture_end and end_at > fixture_start:
                return True
    return False


def player_has_overlapping_confirmed_game(player, game):
    """Backward-compatible wrapper for callers using the old service name."""
    return player_has_overlapping_commitment(
        player,
        game.start_at,
        game.end_at,
        exclude_game_id=game.id,
    )


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
    update_fields = []
    if pending:
        if not game.reconfirmation_requested_at:
            game.reconfirmation_requested_at = timezone.now()
            update_fields.append("reconfirmation_requested_at")
        if not game.reconfirmation_deadline:
            game.reconfirmation_deadline = _reconfirmation_deadline(game, game.reconfirmation_requested_at)
            update_fields.append("reconfirmation_deadline")
    else:
        if game.reconfirmation_requested_at is not None:
            game.reconfirmation_requested_at = None
            update_fields.append("reconfirmation_requested_at")
        if game.reconfirmation_deadline is not None:
            game.reconfirmation_deadline = None
            update_fields.append("reconfirmation_deadline")
    if game.requires_reconfirmation != pending:
        game.requires_reconfirmation = pending
        update_fields.append("requires_reconfirmation")
    if save and update_fields:
        game.save(update_fields=[*update_fields, "updated_at"])
    return pending


def _reconfirmation_deadline(game, requested_at=None):
    requested_at = requested_at or timezone.now()
    max_response_window = timezone.timedelta(
        hours=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG.get(
            "maximum_reconfirmation_response_hours", 24
        )
    )
    start_at = game.start_at
    safe_deadline = (
        start_at
        - timezone.timedelta(
            minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG.get(
                "minimum_reconfirmation_notice_minutes", 30
            )
        )
        if start_at
        else requested_at + max_response_window
    )
    return min(safe_deadline, requested_at + max_response_window)


def mark_schedule_reconfirmation_required(game, actor=None):
    """Mark existing participants after a material schedule/location change.

    Registered players can respond themselves. Offline guests cannot, so their
    record requires an explicit host acknowledgement instead of an impossible
    account action.
    """
    active_non_host = game.participants.filter(
        status__in=ACTIVE_PARTICIPANT_STATUSES,
    ).exclude(participant_type=GameParticipant.ParticipantType.HOST)
    now = timezone.now()
    active_non_host.exclude(
        participant_type=GameParticipant.ParticipantType.GUEST,
    ).update(
        status=GameParticipant.Status.RECONFIRM_REQUIRED,
        status_changed_at=now,
        status_changed_by=actor,
        schedule_acknowledged_at=None,
        schedule_acknowledged_by=None,
    )
    active_non_host.filter(
        participant_type=GameParticipant.ParticipantType.GUEST,
    ).update(
        status=GameParticipant.Status.GUEST_CONFIRMATION_REQUIRED,
        status_changed_at=now,
        status_changed_by=actor,
        schedule_acknowledged_at=None,
        schedule_acknowledged_by=None,
    )
    return refresh_reconfirmation_state(game)


def expire_pending_reconfirmations(game, now=None, *, notify=True):
    """Close unresolved participant commitments after their response window.

    A changed schedule is not considered accepted just because a participant
    stayed silent. Removing the unresolved spot preserves the confirmed
    booking, reopens capacity, and lets the host deliberately use the
    existing waitlist or invite flow.
    """
    now = now or timezone.now()
    if not game.reconfirmation_deadline or game.reconfirmation_deadline > now:
        return 0
    pending = list(
        game.participants.select_for_update().filter(
            status__in=RECONFIRMATION_PENDING_STATUSES,
        ).select_related("user")
    )
    if not pending:
        refresh_reconfirmation_state(game)
        return 0
    for participant in pending:
        from players.models import ParticipationCommitment
        from players.services import excuse_participation_commitment

        commitment = ParticipationCommitment.objects.filter(
            player_id=participant.user_id,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=game.id,
            status=ParticipationCommitment.Status.COMMITTED,
        ).order_by("-source_version", "-id").first()
        if commitment:
            excuse_participation_commitment(
                commitment_id=commitment.id,
                actor=game.host,
                reason="The player did not reconfirm the changed schedule before the deadline.",
            )
        set_participant_status(participant, GameParticipant.Status.REMOVED, actor=game.host)
        if participant.user_id:
            requests = JoinRequest.objects.select_for_update().filter(
                game=game,
                player_id=participant.user_id,
                status=JoinRequest.Status.ACCEPTED,
            )
            for join_request in requests:
                previous_status = join_request.status
                join_request.status = JoinRequest.Status.REMOVED
                join_request.decided_by = game.host
                join_request.decided_at = now
                join_request.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
                record_join_request_event(
                    join_request,
                    JoinRequestEvent.EventType.REMOVED,
                    actor=game.host,
                    previous_status=previous_status,
                    metadata={"reason": "reconfirmation_deadline"},
                )
            if notify:
                notify_participant_removed(game, participant, game.host)
    resequence_waitlist(game)
    refresh_reconfirmation_state(game)
    game.refresh_status()
    if game.status in [Game.Status.RECRUITING, Game.Status.FULL]:
        notify_waitlist_spot_available(game, game.host)
    if notify:
        notify_reconfirmation_expired(game, len(pending))
    return len(pending)


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
    synchronize_and_require_game_host(game, actor, "Only the host can edit this game.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS, Game.Status.BOOKING_PENDING]:
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
    previous_district = (game.preferred_district or "").strip().casefold()
    previous_venue = (game.preferred_venue_name or "").strip().casefold()
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
    next_district = (game.preferred_district or "").strip().casefold()
    next_venue = (game.preferred_venue_name or "").strip().casefold()
    schedule_changed = bool(
        previous_start != next_start
        or previous_end != next_end
        or previous_area != next_area
        or previous_district != next_district
        or previous_venue != next_venue
    )
    if schedule_changed and not game.booking_id:
        mark_schedule_reconfirmation_required(game, actor=actor)
    else:
        refresh_reconfirmation_state(game)

    game.refresh_status()
    notify_game_updated(game, actor, schedule_changed=schedule_changed)
    return game


@transaction.atomic
def update_game_participant(game_id, participant_id, actor, changes):
    game = Game.objects.select_for_update(of=("self",)).select_related("host").get(id=game_id)
    synchronize_and_require_game_host(game, actor, "Only the host can edit the game roster.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS, Game.Status.BOOKING_PENDING]:
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
    synchronize_and_require_game_host(game, actor, "Only the host can remove players from the roster.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status in [Game.Status.CANCELLED, Game.Status.COMPLETED, Game.Status.IN_PROGRESS, Game.Status.BOOKING_PENDING]:
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
    set_participant_status(participant, GameParticipant.Status.REMOVED, actor=actor)
    if participant.user_id:
        removed_requests = JoinRequest.objects.filter(
            game=game,
            player=participant.user,
            status=JoinRequest.Status.ACCEPTED,
        )
        for join_request in removed_requests.select_for_update():
            previous_status = join_request.status
            join_request.status = JoinRequest.Status.REMOVED
            join_request.decided_by = actor
            join_request.decided_at = timezone.now()
            join_request.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
            record_join_request_event(
                join_request,
                JoinRequestEvent.EventType.REMOVED,
                actor=actor,
                previous_status=previous_status,
            )
        notify_participant_removed(game, participant, actor)
    resequence_waitlist(game)
    notify_waitlist_spot_available(game, actor)
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
    game = Game.objects.select_for_update(of=("self",)).order_by().get(id=game_id)
    synchronize_and_require_game_host(game, actor, "Only the host can add guest players.")
    synchronize_game_lifecycle(game, expire_requests=True)
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED]:
        raise ValidationError("Guests cannot be added to this game right now.")
    if game.status != Game.Status.CLOSED and game.recruitment_deadline and game.recruitment_deadline <= timezone.now():
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
    game = Game.objects.select_for_update(of=("self",)).order_by().get(id=game_id)
    synchronize_and_require_game_host(game, actor, "Only the host can invite players to this game.")
    game.refresh_status()
    if game.status not in [Game.Status.RECRUITING, Game.Status.FULL]:
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

    previous_status = existing_request.status if existing_request else ""
    if existing_request:
        existing_request.requested_role = selected_role
        existing_request.message = str(message or "").strip()[:400]
        existing_request.attendance_confirmed = False
        existing_request.status = JoinRequest.Status.INVITED
        existing_request.decided_by = actor
        existing_request.decided_at = timezone.now()
        existing_request.waitlist_position = None
        existing_request.attempt_number += 1
        existing_request.save(update_fields=[
            "requested_role", "message", "attendance_confirmed", "status", "decided_by",
            "decided_at", "waitlist_position", "attempt_number", "updated_at",
        ])
        join_request = existing_request
    else:
        join_request = JoinRequest.objects.create(
            game=game,
            player=invited_user,
            requested_role=selected_role,
            message=str(message or "").strip()[:400],
            attendance_confirmed=False,
            status=JoinRequest.Status.INVITED,
            decided_by=actor,
            decided_at=timezone.now(),
        )
    record_join_request_event(
        join_request,
        JoinRequestEvent.EventType.INVITED,
        actor=actor,
        previous_status=previous_status,
    )
    notify_game_invitation(join_request, actor)
    return join_request


@transaction.atomic
def invite_temporary_participant_to_team(game_id, participant_id, actor):
    """Offer permanent membership only after a completed Fill My Squad game.

    The participant's temporary game role is a convenient default, but the
    existing Team invitation workflow remains the source of truth for joining
    the permanent team.
    """
    game = (
        Game.objects.select_for_update(of=("self",))
        .select_related("team", "host")
        .get(id=game_id)
    )
    if game.game_type != Game.GameType.FILL_SQUAD or not game.team_id:
        raise ValidationError("Permanent team invitations are available only for Fill My Squad games.")
    current_captain = _active_registered_captain(game.team)
    if not current_captain or current_captain.id != actor.id:
        raise ValidationError("Only the current team captain can send a permanent team invitation.")
    if game.status != Game.Status.COMPLETED:
        raise ValidationError("A permanent team invitation can be sent after the game is completed.")
    participant = GameParticipant.objects.select_for_update().select_related("user").filter(
        id=participant_id,
        game=game,
        participant_type=GameParticipant.ParticipantType.TEMPORARY,
        user__isnull=False,
        status=GameParticipant.Status.CONFIRMED,
    ).first()
    if not participant:
        raise ValidationError("Choose a confirmed temporary player from this completed game.")
    from teams.models import TeamMember
    from teams.services import invite_registered_player_to_team

    team_role = participant.role
    if team_role == GameRoleRequirement.CricksalRole.ANY:
        team_role = TeamMember.CricksalRole.NONE
    return invite_registered_player_to_team(
        team=game.team,
        actor=actor,
        player=participant.user,
        cricksal_role=team_role,
    )


@transaction.atomic
def respond_game_invitation(join_request, player, response):
    # Always lock the game before its request. Expiry, withdrawal and host
    # decisions use the same order, preventing capacity/deadline races.
    game = Game.objects.select_for_update(of=("self",)).order_by().select_related("host").get(id=join_request.game_id)
    locked_request = JoinRequest.objects.select_for_update().select_related("game", "player", "game__host").get(id=join_request.id, player=player)
    if locked_request.status != JoinRequest.Status.INVITED:
        raise ValidationError("This invitation can no longer be changed.")

    now = timezone.now()
    if (
        (game.status != Game.Status.CLOSED and game.recruitment_deadline and game.recruitment_deadline <= now)
        or (game.start_at and game.start_at <= now)
    ):
        previous_status = locked_request.status
        locked_request.status = JoinRequest.Status.EXPIRED
        locked_request.decided_at = now
        locked_request.waitlist_position = None
        locked_request.save(update_fields=["status", "decided_at", "waitlist_position", "updated_at"])
        record_join_request_event(
            locked_request,
            JoinRequestEvent.EventType.EXPIRED,
            actor=player,
            previous_status=previous_status,
        )
        notify_join_request_expired(locked_request, JoinRequest.Status.INVITED)
        return locked_request

    normalized = str(response or "").upper()
    if normalized == "DECLINE":
        previous_status = locked_request.status
        locked_request.status = JoinRequest.Status.REJECTED
        locked_request.decided_at = timezone.now()
        locked_request.save(update_fields=["status", "decided_at", "updated_at"])
        record_join_request_event(
            locked_request,
            JoinRequestEvent.EventType.REJECTED,
            actor=player,
            previous_status=previous_status,
        )
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
        previous_status = locked_request.status
        locked_request.status = JoinRequest.Status.WAITLISTED
        locked_request.waitlist_position = locked_request.waitlist_position or next_waitlist_position(game)
        locked_request.decided_at = timezone.now()
        locked_request.save(update_fields=["status", "waitlist_position", "decided_at", "updated_at"])
        record_join_request_event(
            locked_request,
            JoinRequestEvent.EventType.WAITLISTED,
            actor=player,
            previous_status=previous_status,
        )
        notify_game_invitation_response(locked_request, player, "joined the waitlist for")
        return locked_request

    ensure_role_has_space(game, locked_request.requested_role, include_any=True)
    participant_status = GameParticipant.Status.CONFIRMED if game.booking_id else GameParticipant.Status.PROVISIONAL
    participant, _ = GameParticipant.objects.update_or_create(
        game=game,
        user=player,
        defaults={
            "participant_type": GameParticipant.ParticipantType.TEMPORARY,
            "role": locked_request.requested_role,
            "status": participant_status,
            "added_by": game.host,
        },
    )
    participant.status_changed_at = timezone.now()
    participant.status_changed_by = player
    participant.save(update_fields=["status_changed_at", "status_changed_by"])
    ensure_game_participation_commitment(participant, created_by=player)
    previous_status = locked_request.status
    locked_request.status = JoinRequest.Status.ACCEPTED
    locked_request.decided_at = timezone.now()
    locked_request.waitlist_position = None
    locked_request.save(update_fields=["status", "decided_at", "waitlist_position", "updated_at"])
    record_join_request_event(
        locked_request,
        JoinRequestEvent.EventType.ACCEPTED,
        actor=player,
        previous_status=previous_status,
    )
    game.refresh_status()
    notify_game_invitation_response(locked_request, player, "accepted")
    return locked_request
@transaction.atomic
def decide_join_request(join_request, actor, decision):
    # Lock the game first so this decision has the same lock ordering as join,
    # withdrawal and maintenance expiry.
    game = Game.objects.select_for_update(of=("self",)).order_by().select_related("host").get(id=join_request.game_id)
    synchronize_and_require_game_host(game, actor, "Only the game host can manage requests.")
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
        participant, _ = GameParticipant.objects.update_or_create(
            game=game,
            user=locked_request.player,
            defaults={
                "participant_type": GameParticipant.ParticipantType.TEMPORARY,
                "role": locked_request.requested_role,
                "status": participant_status,
                "added_by": actor,
            },
        )
        participant.status_changed_at = timezone.now()
        participant.status_changed_by = actor
        participant.save(update_fields=["status_changed_at", "status_changed_by"])
        ensure_game_participation_commitment(participant, created_by=actor)
        previous_status = locked_request.status
        locked_request.status = JoinRequest.Status.ACCEPTED
        locked_request.waitlist_position = None
        action_status = Notification.ActionStatus.ACCEPTED
        notify_join_request_decision(locked_request, actor, "accepted")
        event_type = JoinRequestEvent.EventType.ACCEPTED
    elif normalized == "REJECT":
        previous_status = locked_request.status
        locked_request.status = JoinRequest.Status.REJECTED
        action_status = Notification.ActionStatus.REJECTED
        notify_join_request_decision(locked_request, actor, "declined")
        event_type = JoinRequestEvent.EventType.REJECTED
    elif normalized == "WAITLIST":
        previous_status = locked_request.status
        locked_request.status = JoinRequest.Status.WAITLISTED
        locked_request.waitlist_position = locked_request.waitlist_position or next_waitlist_position(game)
        action_status = Notification.ActionStatus.PENDING
        notify_join_request_decision(locked_request, actor, "waitlisted")
        event_type = JoinRequestEvent.EventType.WAITLISTED
    else:
        raise ValidationError("Choose a valid request action.")

    locked_request.decided_by = actor
    locked_request.decided_at = timezone.now()
    locked_request.save(update_fields=["status", "decided_by", "decided_at", "waitlist_position", "updated_at"])
    record_join_request_event(
        locked_request,
        event_type,
        actor=actor,
        previous_status=previous_status,
    )
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
    locked_game = Game.objects.select_for_update(of=("self",)).order_by().get(id=game.id)
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
    from players.services import cancel_participation_commitment

    cancel_participation_commitment(
        source_type="MATCHMAKING_GAME",
        source_id=locked_game.id,
        player=player,
        actor=player,
        reason="Player left the game.",
    )
    set_participant_status(participant, GameParticipant.Status.LEFT, actor=player)
    accepted_request = JoinRequest.objects.select_for_update().filter(
        game=locked_game,
        player=player,
        status=JoinRequest.Status.ACCEPTED,
    ).first()
    if accepted_request:
        previous_status = accepted_request.status
        accepted_request.status = JoinRequest.Status.WITHDRAWN
        accepted_request.decided_by = player
        accepted_request.decided_at = timezone.now()
        accepted_request.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        record_join_request_event(
            accepted_request,
            JoinRequestEvent.EventType.WITHDRAWN,
            actor=player,
            previous_status=previous_status,
        )
    resequence_waitlist(locked_game)
    refresh_reconfirmation_state(locked_game)
    locked_game.refresh_status()
    notify_participant_left(locked_game, player)
    notify_waitlist_spot_available(locked_game, player)
    return participant


@transaction.atomic
def attach_booking_to_game(game, booking, actor, *, from_payment_handoff=False):
    locked_game = Game.objects.select_for_update(of=("self",)).order_by().select_related("host").get(id=game.id)
    synchronize_and_require_game_host(locked_game, actor, "Only the host can attach a booking to this game.")
    if locked_game.booking_id:
        if locked_game.booking_id == booking.id:
            return locked_game
        raise ValidationError("This game already has a confirmed court booking.")
    if from_payment_handoff:
        if (
            locked_game.creation_mode != Game.CreationMode.PLAN_FIRST
            or locked_game.status not in [Game.Status.BOOKING_PENDING, Game.Status.RECRUITING, Game.Status.FULL, Game.Status.CLOSED]
            or booking.matchmaking_game_id != locked_game.id
        ):
            raise ValidationError("This court payment can no longer be attached to the game plan.")
    else:
        validate_game_booking_handoff(locked_game, actor)
    if locked_game.creation_mode != Game.CreationMode.PLAN_FIRST:
        raise ValidationError("This game already uses a confirmed booking.")
    ensure_booking_can_publish_game(booking, actor, exclude_game_id=locked_game.id)
    previous_start = locked_game.start_at
    previous_end = locked_game.end_at
    previous_area = (locked_game.preferred_area or "").strip().lower()
    previous_district = (locked_game.preferred_district or "").strip().lower()
    previous_venue = (locked_game.preferred_venue_name or "").strip().casefold()
    locked_game.booking = booking
    locked_game.booking_attached_at = timezone.now()
    booking_start = get_booking_start_at(booking)
    booking_end = booking_end_at(booking)
    booking_area = (booking.venue.area or booking.venue.city or "").strip().lower()
    booking_district = (booking.venue.city or "").strip().lower()
    booking_venue = (booking.venue.name or "").strip().casefold()
    material_change = bool(
        (previous_start and booking_start and abs((booking_start - previous_start).total_seconds()) > 900)
        or (previous_end and booking_end and abs((booking_end - previous_end).total_seconds()) > 900)
        or (previous_area and booking_area and previous_area != booking_area)
        or (previous_district and booking_district and previous_district != booking_district)
        or (previous_venue and previous_venue != booking_venue)
    )
    locked_game.requires_reconfirmation = False
    should_reopen = bool(
        (locked_game.is_public or locked_game.booking_handoff_was_public)
        and (not locked_game.recruitment_deadline or locked_game.recruitment_deadline > timezone.now())
    )
    locked_game.status = Game.Status.RECRUITING if should_reopen else Game.Status.CLOSED
    locked_game.is_public = should_reopen
    locked_game.recruitment_closed_reason = (
        ""
        if should_reopen
        else (
            Game.RecruitmentClosureReason.DEADLINE_PASSED
            if locked_game.recruitment_deadline and locked_game.recruitment_deadline <= timezone.now()
            else Game.RecruitmentClosureReason.HOST_CLOSED
        )
    )
    locked_game.recruitment_closed_at = None if should_reopen else (locked_game.recruitment_closed_at or timezone.now())
    locked_game.recruitment_closed_by = None if should_reopen else (locked_game.recruitment_closed_by or actor)
    locked_game.booking_handoff_was_public = False
    locked_game.save(update_fields=[
        "booking", "booking_attached_at", "requires_reconfirmation", "status", "is_public",
        "recruitment_closed_reason", "recruitment_closed_at", "recruitment_closed_by",
        "booking_handoff_was_public", "updated_at",
    ])
    participants = locked_game.participants.filter(status__in=ACTIVE_PARTICIPANT_STATUSES)
    if material_change:
        mark_schedule_reconfirmation_required(locked_game, actor=actor)
        participants.filter(
            participant_type=GameParticipant.ParticipantType.HOST,
        ).update(
            status=GameParticipant.Status.CONFIRMED,
            status_changed_at=timezone.now(),
            status_changed_by=actor,
        )
    else:
        participants.update(
            status=GameParticipant.Status.CONFIRMED,
            status_changed_at=timezone.now(),
            status_changed_by=actor,
        )
    ensure_game_participation_commitments(locked_game, created_by=actor)
    refresh_reconfirmation_state(locked_game)
    locked_game.refresh_status()
    notify_booking_attached(locked_game, material_change)
    return locked_game


@transaction.atomic
def reconfirm_game(game, player, response):
    locked_game = Game.objects.select_for_update(of=("self",)).order_by().get(id=game.id)
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
        participant_status = GameParticipant.Status.CONFIRMED
    elif normalized == "DECLINE":
        participant_status = GameParticipant.Status.DECLINED
    else:
        raise ValidationError("Choose a valid reconfirmation response.")
    set_participant_status(participant, participant_status, actor=player, acknowledge_schedule=True)
    from players.models import ParticipationCommitment
    if normalized == "RECONFIRM":
        ensure_game_participation_commitment(participant, created_by=player)
    else:
        commitment = ParticipationCommitment.objects.filter(
            player=player,
            source_type=ParticipationCommitment.SourceType.MATCHMAKING_GAME,
            source_id=locked_game.id,
            status=ParticipationCommitment.Status.COMMITTED,
        ).order_by("-source_version", "-id").first()
        if commitment:
            from players.services import excuse_participation_commitment

            excuse_participation_commitment(
                commitment_id=commitment.id,
                actor=player,
                reason="The player declined the proposed schedule change.",
            )
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
    locked_game = Game.objects.select_for_update(of=("self",)).order_by().select_related("host").get(id=game_id)
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
    set_participant_status(
        participant,
        GameParticipant.Status.CONFIRMED,
        actor=actor,
        acknowledge_schedule=True,
    )
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
        record_join_request_event(
            join_request,
            JoinRequestEvent.EventType.EXPIRED,
            actor=game.host,
            previous_status=previous_status,
            metadata={"expired_by": "lifecycle"},
        )
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
    batch_limit = max(1, int(limit))
    game_ids = list(
        Game.objects.filter(due_lifecycle | stale_requests)
        .distinct()
        .order_by("id")
        .values_list("id", flat=True)[:batch_limit]
    )
    # A team captain can change while a future Fill My Squad listing is not
    # otherwise due for a lifecycle transition. Include a bounded continuity
    # pass so ownership follows the team without waiting for a page request.
    continuity_game_ids = list(Game.objects.filter(
        game_type=Game.GameType.FILL_SQUAD,
        status__in=[
            Game.Status.DRAFT,
            Game.Status.RECRUITING,
            Game.Status.FULL,
            Game.Status.CLOSED,
            Game.Status.BOOKING_PENDING,
        ],
    ).exclude(id__in=game_ids).order_by("id").values_list("id", flat=True)[:batch_limit])
    # Keep the deadline batch bounded while still giving host-continuity work
    # its own fair slice. Otherwise a large queue of due games can starve
    # future Fill My Squad listings indefinitely.
    game_ids = [*game_ids, *continuity_game_ids]

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
            game = Game.objects.select_for_update(of=("self",)).select_related("booking").order_by().get(id=game_id)
            previous_status = game.status
            synchronize_game_host_continuity(game)
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
        deduplication_key=f"game-request:{join_request.id}:attempt:{join_request.attempt_number}:received",
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
        deduplication_key=f"game-request:{join_request.id}:attempt:{join_request.attempt_number}:{label}",
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
        deduplication_key=f"game-request:{join_request.id}:attempt:{join_request.attempt_number}:expired",
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
        deduplication_key=f"game-invite:{join_request.id}:attempt:{join_request.attempt_number}:sent",
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
        deduplication_key=f"game-invite:{join_request.id}:attempt:{join_request.attempt_number}:{label}",
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
                if material_change and recipient.id != game.host_id
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


def notify_game_chat_message(message):
    """Notify every registered player who can currently open this game room."""
    game = Game.objects.only("id", "title", "host_id").get(pk=message.game_id)
    recipient_ids = set(
        GameParticipant.objects.filter(
            game_id=game.id,
            user__isnull=False,
            status__in=ACTIVE_PARTICIPANT_STATUSES,
        ).values_list("user_id", flat=True)
    )
    recipient_ids.add(game.host_id)
    preview = message.body if len(message.body) <= 180 else f"{message.body[:177].rstrip()}..."
    recipients = get_user_model().objects.filter(id__in=recipient_ids, is_active=True).order_by()
    return notify_chat_message(
        recipients=recipients,
        actor=message.sender,
        title=f"New message in {game.title}"[:120],
        message=f"{message.sender_name}: {preview}",
        action_url=f"/dashboard/player/games/{game.id}/room",
        related_entity_type="game_chat_message",
        related_entity_id=message.id,
        metadata={"game_id": game.id, "chat_message_id": message.id, "room_kind": "game"},
        deduplication_prefix=f"game-chat-message:{message.id}",
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


def notify_waitlist_spot_available(game, actor):
    """Let waitlisted players know a host can now make a deliberate choice.

    This does not promise promotion. The host must still re-check availability,
    skill, role and conflicts before accepting anyone from the waitlist.
    """
    if game.available_spots <= 0:
        return []
    requests = JoinRequest.objects.filter(
        game=game,
        status=JoinRequest.Status.WAITLISTED,
    ).select_related("player")
    notifications = []
    for join_request in requests:
        notifications.append(
            create_notification(
                recipient=join_request.player,
                actor=actor,
                notification_type=Notification.NotificationType.MATCH_UPDATED,
                title="A player spot is available",
                message=f"A spot opened in {game.title}. The host will review the waitlist before promoting anyone.",
                priority=Notification.Priority.NORMAL,
                action_url=f"/find-game/{game.id}",
                related_entity_type="game_join_request",
                related_entity_id=join_request.id,
                action_status=Notification.ActionStatus.PENDING,
                metadata={"game_id": game.id, "waitlist_position": join_request.waitlist_position},
                deduplication_key=f"game:{game.id}:waitlist-spot:{join_request.id}:{game.updated_at.isoformat()}",
            )
        )
    return notifications


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


def notify_game_host_transferred(game, *, old_host=None, new_host=None):
    """Explain a team-captain handoff to the people affected by it."""
    if not new_host:
        return []
    recipients = [new_host]
    if old_host and old_host.id != new_host.id:
        recipients.append(old_host)
    notifications = []
    for recipient in recipients:
        is_new_host = recipient.id == new_host.id
        notifications.append(
            create_notification(
                recipient=recipient,
                actor=old_host if is_new_host else new_host,
                notification_type=Notification.NotificationType.MATCH_UPDATED,
                title="Game host updated",
                message=(
                    f"You are now responsible for managing {game.title} as the team captain."
                    if is_new_host
                    else f"{new_host.full_name} is now responsible for managing {game.title} as the team captain."
                ),
                priority=Notification.Priority.IMPORTANT,
                action_url=f"/dashboard/player/games/{game.id}",
                related_entity_type="game",
                related_entity_id=game.id,
                action_status=Notification.ActionStatus.COMPLETED,
                metadata={"game_id": game.id, "new_host_id": new_host.id},
                deduplication_key=f"game:{game.id}:host-transferred:{new_host.id}:{recipient.id}",
            )
        )
    return notifications


def notify_reconfirmation_expired(game, removed_count):
    return create_notification(
        recipient=game.host,
        actor=game.host,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Updated game schedule needs attention",
        message=(
            f"{removed_count} participant{'s' if removed_count != 1 else ''} did not confirm the updated details in time. "
            "Their spot is open again for you to fill."
        ),
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/games/{game.id}",
        related_entity_type="game",
        related_entity_id=game.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"game_id": game.id, "removed_count": removed_count, "reason": "reconfirmation_deadline"},
        deduplication_key=f"game:{game.id}:reconfirmation-expired:{game.reconfirmation_deadline.isoformat() if game.reconfirmation_deadline else 'none'}",
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


def notify_game_cancelled(game, actor, booking_cancelled=False):
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
            message=(
                f"{game.title} has been cancelled because its linked court booking is no longer available."
                if booking_cancelled
                else f"{game.title} has been cancelled. Any linked court booking remains separate."
            ),
            priority=Notification.Priority.URGENT,
            action_url=(f"/dashboard/player/bookings/{game.booking_id}" if booking_cancelled and game.booking_id else f"/find-game/{game.id}"),
            related_entity_type="game",
            related_entity_id=game.id,
            action_status=Notification.ActionStatus.CANCELLED,
            metadata={"game_id": game.id, "booking_id": game.booking_id, "reason": game.cancellation_reason, "booking_cancelled": booking_cancelled},
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






