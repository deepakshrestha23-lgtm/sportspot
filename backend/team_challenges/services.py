from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from matchmaking.services import booking_end_at
from notifications.models import Notification
from notifications.services import create_notification, mark_related_action_state, notify_chat_message
from players.models import ParticipationCommitment
from players.services import (
    create_participation_commitment,
    create_rating_eligibility,
    dispute_commitment,
    record_commitment_attendance,
    resolve_commitment_dispute,
)
from teams.models import Team, TeamMember
from venues.models import Booking
from venues.policies import get_booking_start_at
from venues.reference_data import SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG

from .models import (
    ACTIVE_CHALLENGE_STATUSES,
    ChallengeEvent,
    ChallengeProposal,
    OpenChallengeResponse,
    TeamChallenge,
    TeamFixture,
    TeamFixtureParticipant,
)
from .notifications import (
    notify_challenge_countered,
    notify_challenge_decision,
    notify_challenge_expired,
    notify_challenge_received,
    notify_challenge_reconfirmation_expired,
    notify_challenge_reconfirmation_required,
    notify_open_challenge_not_selected,
    notify_open_challenge_response,
    notify_opponent_selected,
    notify_challenge_status,
)


def _now():
    return timezone.now()


def team_pair_key(first_team_id, second_team_id):
    if not first_team_id or not second_team_id or first_team_id == second_team_id:
        return ""
    return ":".join(str(value) for value in sorted([first_team_id, second_team_id]))


def _captain_team(user, team_id, *, lock=False):
    team_id = getattr(team_id, "pk", team_id)
    queryset = Team.objects
    if lock:
        queryset = queryset.select_for_update()
    team = queryset.filter(
        pk=team_id,
        captain=user,
        members__user=user,
        members__member_type=TeamMember.MemberType.REGISTERED,
        members__status=TeamMember.MemberStatus.ACTIVE,
        captain__role="PLAYER",
        captain__is_active=True,
    ).first()
    if not team:
        raise ValidationError("Only the active team captain can manage team challenges.")
    return team


def _team_captain(team):
    if hasattr(team, "captain"):
        return team.captain
    return Team.objects.select_related("captain").get(pk=team.pk).captain


def _active_registered_captain(team):
    """Return the captain only while their team membership is still valid."""
    if not team or not team.captain_id:
        return None
    membership = TeamMember.objects.select_related("user").filter(
        team_id=team.pk,
        user_id=team.captain_id,
        member_type=TeamMember.MemberType.REGISTERED,
        status=TeamMember.MemberStatus.ACTIVE,
        user__role="PLAYER",
        user__is_active=True,
    ).first()
    return membership.user if membership else None


def notify_fixture_chat_message(message):
    """Notify captains and selected players who can access a team-match room."""
    fixture = TeamFixture.objects.select_related(
        "challenge__challenger_team",
        "challenge__challenged_team",
    ).get(pk=message.fixture_id)
    recipient_ids = set(
        TeamFixtureParticipant.objects.filter(
            fixture_id=fixture.id,
            status__in=[
                TeamFixtureParticipant.Status.SELECTED,
                TeamFixtureParticipant.Status.ATTENDED,
                TeamFixtureParticipant.Status.ABSENT,
            ],
        ).values_list("player_id", flat=True)
    )
    for team in [fixture.challenge.challenger_team, fixture.challenge.challenged_team]:
        captain = _active_registered_captain(team)
        if captain:
            recipient_ids.add(captain.id)

    team_names = [
        team.name
        for team in [fixture.challenge.challenger_team, fixture.challenge.challenged_team]
        if team
    ]
    room_name = " vs ".join(team_names) or "team match"
    preview = message.body if len(message.body) <= 180 else f"{message.body[:177].rstrip()}..."
    recipients = get_user_model().objects.filter(id__in=recipient_ids, is_active=True).order_by()
    return notify_chat_message(
        recipients=recipients,
        actor=message.sender,
        title=f"New message in {room_name}"[:120],
        message=f"{message.sender_name}: {preview}",
        action_url=f"/challenge-teams/{fixture.challenge_id}/room",
        related_entity_type="fixture_chat_message",
        related_entity_id=message.id,
        metadata={"fixture_id": fixture.id, "challenge_id": fixture.challenge_id, "chat_message_id": message.id, "room_kind": "fixture"},
        deduplication_prefix=f"fixture-chat-message:{message.id}",
    )


def _validate_future_window(response_deadline, booking_deadline=None, game_start=None):
    now = _now()
    if not response_deadline or response_deadline <= now:
        raise ValidationError("Choose a future response deadline.")
    if game_start and response_deadline >= game_start:
        raise ValidationError("The response deadline must be before the game starts.")
    if booking_deadline and booking_deadline <= response_deadline:
        raise ValidationError("The court-booking deadline must be after the response deadline.")
    if game_start and game_start <= now:
        raise ValidationError("Choose a future game time.")
    if booking_deadline and game_start and booking_deadline >= game_start:
        raise ValidationError("The court-booking deadline must be before the game starts.")


def _aware_datetime(date_value, time_value):
    if not date_value or not time_value:
        return None
    return timezone.make_aware(
        datetime.combine(date_value, time_value),
        timezone.get_current_timezone(),
    )


def _booking_fields(booking):
    start_at = get_booking_start_at(booking)
    end_at = booking_end_at(booking)
    slots = booking.booked_slots
    first_slot = slots[0] if slots else None
    return {
        "booking": booking,
        "proposed_date": first_slot.date if first_slot else None,
        "proposed_start_time": first_slot.start_time if first_slot else None,
        "proposed_end_time": slots[-1].end_time if slots else None,
        "game_start": start_at,
        "game_end": end_at,
        "preferred_district": booking.venue.city,
        "preferred_area": booking.venue.area,
        "preferred_venue_name": booking.venue.name,
    }


def validate_challenge_booking(booking, actor, *, lock=False):
    if lock:
        booking = Booking.objects.select_for_update().select_related("venue", "court", "player").get(pk=booking.pk)
    if booking.player_id != actor.id:
        raise ValidationError("Choose one of your own bookings.")
    if booking.status != Booking.BookingStatus.CONFIRMED or booking.payment_status != Booking.PaymentStatus.PAID:
        raise ValidationError("Only paid confirmed bookings can be used for a team challenge.")
    start_at = get_booking_start_at(booking)
    if not start_at or start_at <= _now():
        raise ValidationError("Choose a future booking.")
    if booking.team_challenges.filter(status__in=ACTIVE_CHALLENGE_STATUSES).exists():
        raise ValidationError("This booking is already connected to an active team challenge.")
    if hasattr(booking, "team_fixture"):
        raise ValidationError("This booking is already attached to a scheduled match.")
    return booking


def validate_replacement_booking(booking, challenge, actor, *, lock=False):
    """Validate a new paid booking supplied by either participating captain."""
    _validate_challenge_action(challenge, actor)
    if lock:
        booking = (
            Booking.objects.select_for_update()
            .select_related("venue", "court", "player")
            .prefetch_related("slot_items__slot")
            .get(pk=booking.pk)
        )
    captain_ids = {
        team.captain_id
        for team in [challenge.challenger_team, challenge.challenged_team]
        if team and team.captain_id
    }
    if booking.player_id not in captain_ids:
        raise ValidationError("The replacement booking must belong to one of the team captains.")
    if booking.status != Booking.BookingStatus.CONFIRMED or booking.payment_status != Booking.PaymentStatus.PAID:
        raise ValidationError("Only a paid confirmed booking can be used for this team match.")
    start_at = get_booking_start_at(booking)
    if not start_at or start_at <= _now():
        raise ValidationError("Choose a future court booking.")
    if challenge.booking_id and booking.id == challenge.booking_id:
        raise ValidationError("Choose a different booking for the schedule change.")
    if booking.team_challenges.filter(status__in=ACTIVE_CHALLENGE_STATUSES).exclude(pk=challenge.pk).exists():
        raise ValidationError("This booking is already connected to another active team challenge.")
    if hasattr(booking, "team_fixture") and booking.team_fixture.challenge_id != challenge.id:
        raise ValidationError("This booking is already attached to another scheduled match.")
    if not booking.booked_slots:
        raise ValidationError("Choose a booking with usable court time.")
    return booking


def _validate_linked_booking(booking, *, lock=False, now=None):
    """Validate a booking already linked to a challenge without re-running ownership checks."""
    if lock:
        booking = (
            Booking.objects.select_for_update()
            .select_related("venue", "court", "player")
            .prefetch_related("slot_items__slot")
            .get(pk=booking.pk)
        )
    if booking.status != Booking.BookingStatus.CONFIRMED or booking.payment_status != Booking.PaymentStatus.PAID:
        raise ValidationError("The linked court booking is no longer confirmed and paid.")
    start_at = get_booking_start_at(booking)
    if not start_at or start_at <= (now or _now()):
        raise ValidationError("The linked court booking is no longer in the future.")
    if not booking.booked_slots:
        raise ValidationError("The linked court booking has no usable court time.")
    return booking


def _validate_plan_booking_matches_proposal(proposal, booking):
    """Keep the agreed Plan First schedule authoritative at booking handoff."""
    if not proposal or proposal.court_mode != TeamChallenge.CourtMode.PLAN_FIRST:
        return
    fields = _booking_fields(booking)
    mismatches = []
    if fields["proposed_date"] != proposal.proposed_date:
        mismatches.append("date")
    if fields["proposed_start_time"] != proposal.proposed_start_time:
        mismatches.append("start time")
    if fields["proposed_end_time"] != proposal.proposed_end_time:
        mismatches.append("end time")
    if proposal.preferred_district and fields["preferred_district"].casefold() != proposal.preferred_district.casefold():
        mismatches.append("district")
    if proposal.preferred_area and fields["preferred_area"].casefold() != proposal.preferred_area.casefold():
        mismatches.append("area")
    if proposal.preferred_venue_name and fields["preferred_venue_name"].casefold() != proposal.preferred_venue_name.casefold():
        mismatches.append("venue")
    if mismatches:
        joined = ", ".join(mismatches)
        raise ValidationError(
            f"Choose a confirmed booking that matches the agreed {joined}. "
            "If the schedule must change, send a new proposal for both captains to accept."
        )


def record_event(challenge, event_type, *, actor=None, team=None, proposal=None, metadata=None):
    return ChallengeEvent.objects.create(
        challenge=challenge,
        actor=actor,
        team=team,
        proposal=proposal,
        event_type=event_type,
        metadata=metadata or {},
    )


def _opponent_captain(challenge, actor=None):
    teams = [challenge.challenger_team, challenge.challenged_team]
    for team in teams:
        if team and (not actor or team.captain_id != actor.id):
            return _team_captain(team)
    return None


def _mark_challenge_actions(challenge, recipients, action_status):
    """Resolve older actionable notifications after a lifecycle decision."""
    for recipient in recipients:
        if recipient:
            mark_related_action_state(
                recipient=recipient,
                related_entity_type="team_challenge",
                related_entity_id=challenge.id,
                action_status=action_status,
            )


def _active_pair_exists(pair_key, *, exclude_id=None):
    if not pair_key:
        return False
    queryset = TeamChallenge.objects.filter(team_pair_key=pair_key, status__in=ACTIVE_CHALLENGE_STATUSES)
    if exclude_id:
        queryset = queryset.exclude(pk=exclude_id)
    return queryset.exists()


def _proposal_from_data(challenge, created_by_team, data, version, *, booking=None, decisions=None):
    decisions = decisions or {}
    proposal = ChallengeProposal(
        challenge=challenge,
        version=version,
        created_by_team=created_by_team,
        court_mode=data["court_mode"],
        booking=booking,
        proposed_date=data.get("proposed_date"),
        proposed_start_time=data.get("proposed_start_time"),
        proposed_end_time=data.get("proposed_end_time"),
        preferred_district=(data.get("preferred_district") or "").strip(),
        preferred_area=(data.get("preferred_area") or "").strip(),
        preferred_venue_name=(data.get("preferred_venue_name") or "").strip(),
        players_per_side=data.get("players_per_side", 6),
        intensity=data.get("intensity", "CASUAL"),
        message=(data.get("message") or "").strip(),
        response_deadline=data["response_deadline"],
        booking_deadline=data.get("booking_deadline"),
        challenger_decision=decisions.get("challenger", ChallengeProposal.Decision.PENDING),
        challenged_decision=decisions.get("challenged", ChallengeProposal.Decision.PENDING),
    )
    proposal.full_clean()
    proposal.save()
    return proposal


@transaction.atomic
def create_challenge(data, actor):
    challenger_team = _captain_team(actor, data["challenger_team"], lock=True)
    client_request_id = (data.get("client_request_id") or "").strip()
    if client_request_id:
        replay = TeamChallenge.objects.filter(created_by=actor, client_request_id=client_request_id).first()
        if replay:
            replay._idempotent_replay = True
            return replay
    challenged_team = None
    challenge_type = data["challenge_type"]
    if challenge_type == TeamChallenge.ChallengeType.DIRECT:
        challenged_team_id = getattr(data.get("challenged_team"), "pk", data.get("challenged_team"))
        challenged_team = Team.objects.select_for_update().filter(pk=challenged_team_id).first()
        if not challenged_team:
            raise ValidationError("Choose the team you want to challenge.")
        if challenged_team.pk == challenger_team.pk:
            raise ValidationError("A team cannot challenge itself.")
        if not challenged_team.accepts_team_challenges:
            raise ValidationError("This team is not accepting new challenges right now.")
        if not _active_registered_captain(challenged_team):
            raise ValidationError("The selected team is not currently active.")

    booking = None
    data = dict(data)
    data["response_deadline"] = data["response_deadline"]
    game_start = _aware_datetime(data.get("proposed_date"), data.get("proposed_start_time"))
    if data["court_mode"] == TeamChallenge.CourtMode.BOOKING_FIRST:
        booking = validate_challenge_booking(data.get("booking"), actor, lock=True)
        data.update(_booking_fields(booking))
        game_start = data["game_start"]
        data["booking_deadline"] = None
    _validate_future_window(data["response_deadline"], data.get("booking_deadline"), game_start)

    pair_key = team_pair_key(challenger_team.pk, challenged_team.pk if challenged_team else None)
    if _active_pair_exists(pair_key):
        raise ValidationError("There is already an active challenge between these teams.")

    challenge = TeamChallenge.objects.create(
        challenger_team=challenger_team,
        challenged_team=challenged_team,
        created_by=actor,
        challenge_type=challenge_type,
        court_mode=data["court_mode"],
        booking=booking,
        booking_owner=actor if booking else None,
        team_pair_key=pair_key,
        response_deadline=data["response_deadline"],
        booking_deadline=data.get("booking_deadline"),
        is_public=challenge_type == TeamChallenge.ChallengeType.OPEN,
        client_request_id=client_request_id,
    )
    decisions = {"challenger": ChallengeProposal.Decision.ACCEPTED}
    proposal = _proposal_from_data(challenge, challenger_team, data, 1, booking=booking, decisions=decisions)
    challenge.current_proposal = proposal
    challenge.save(update_fields=["current_proposal", "updated_at"])
    record_event(challenge, ChallengeEvent.EventType.CREATED, actor=actor, team=challenger_team, proposal=proposal)
    if challenged_team:
        notify_challenge_received(challenge, recipient=_team_captain(challenged_team), actor=actor)
    return challenge


@transaction.atomic
def respond_to_open_challenge(challenge_id, actor, message="", team_id=None):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenger_team__captain").get(pk=challenge_id)
    if not challenge.is_open_for_opponent_response:
        raise ValidationError("This open challenge is no longer accepting responses.")
    team = None
    if team_id:
        team = _captain_team(actor, team_id, lock=True)
        if not team.accepts_team_challenges:
            raise ValidationError("This team is not accepting new challenges right now.")
    if not team:
        team = Team.objects.filter(
            captain=actor,
            accepts_team_challenges=True,
            captain__role="PLAYER",
            captain__is_active=True,
            members__user=actor,
            members__member_type=TeamMember.MemberType.REGISTERED,
            members__status=TeamMember.MemberStatus.ACTIVE,
        ).order_by("id").first()
    if not team:
        raise ValidationError("You need to captain an active team to respond to a challenge.")
    if team.pk == challenge.challenger_team_id:
        raise ValidationError("Your team cannot respond to its own challenge.")
    if _active_pair_exists(team_pair_key(team.pk, challenge.challenger_team_id)):
        raise ValidationError("There is already an active challenge between these teams.")
    response, created = OpenChallengeResponse.objects.get_or_create(
        challenge=challenge,
        responding_team=team,
        defaults={"responding_by": actor, "message": (message or "").strip()},
    )
    if not created:
        if response.status == OpenChallengeResponse.Status.PENDING:
            new_message = (message or "").strip()
            if response.message != new_message:
                response.message = new_message
                response.save(update_fields=["message", "updated_at"])
            # A retried request is idempotent: do not create another event or
            # notify the host again for the same team response.
            response._idempotent_replay = True
        else:
            raise ValidationError("Your team has already responded to this challenge.")
    if getattr(response, "_idempotent_replay", False):
        return response
    record_event(challenge, ChallengeEvent.EventType.RESPONSE_RECEIVED, actor=actor, team=team, metadata={"response_id": response.id})
    notify_open_challenge_response(
        challenge,
        recipient=_team_captain(challenge.challenger_team),
        responding_team=team,
        response_id=response.id,
        actor=actor,
    )
    return response


@transaction.atomic
def withdraw_open_challenge_response(challenge_id, response_id, actor):
    """Let a responding captain withdraw before the challenger selects a team."""
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
        "challenger_team", "challenged_team"
    ).get(pk=challenge_id)
    response = OpenChallengeResponse.objects.select_for_update().select_related(
        "responding_team", "responding_team__captain"
    ).filter(pk=response_id, challenge=challenge).first()
    if not response:
        raise ValidationError("That team response is no longer available.")
    current_captain = _active_registered_captain(response.responding_team)
    if not current_captain or current_captain.id != actor.id:
        raise ValidationError("Only the responding team captain can withdraw this response.")
    if response.status == OpenChallengeResponse.Status.WITHDRAWN:
        response._idempotent_replay = True
        return response
    if response.status != OpenChallengeResponse.Status.PENDING:
        raise ValidationError("This response can no longer be withdrawn.")
    if not challenge.is_open_for_opponent_response:
        raise ValidationError("This open challenge is no longer accepting response changes.")
    response.status = OpenChallengeResponse.Status.WITHDRAWN
    response.save(update_fields=["status", "updated_at"])
    record_event(
        challenge,
        ChallengeEvent.EventType.WITHDRAWN,
        actor=actor,
        team=response.responding_team,
        metadata={"response_id": response.id, "response_withdrawn": True},
    )
    _mark_challenge_actions(challenge, [actor], Notification.ActionStatus.CANCELLED)
    notify_challenge_status(
        challenge,
        recipients=[_team_captain(challenge.challenger_team)],
        title="Team response withdrawn",
        message=f"{response.responding_team.name} withdrew its response to your open challenge.",
        actor=actor,
        key_suffix=f"response-withdrawn-{response.id}",
        notification_type=Notification.NotificationType.CHALLENGE_REJECTED,
    )
    return response


@transaction.atomic
def select_open_opponent(challenge_id, response_id, actor):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenger_team__captain", "current_proposal").get(pk=challenge_id)
    challenger_team = _captain_team(actor, challenge.challenger_team_id, lock=True)
    response = OpenChallengeResponse.objects.select_for_update().select_related("responding_team", "responding_team__captain").filter(
        pk=response_id, challenge=challenge
    ).first()
    if not response:
        raise ValidationError("That team response is no longer available.")
    # A retried selection can arrive after the first transaction has already
    # closed the public listing. Return the same result instead of presenting
    # a successful action as a false failure.
    if (
        response.status == OpenChallengeResponse.Status.SELECTED
        and challenge.challenged_team_id == response.responding_team_id
    ):
        challenge._idempotent_replay = True
        return challenge
    if not challenge.is_open_for_opponent_response:
        raise ValidationError("This open challenge cannot select another team now.")
    if response.status != OpenChallengeResponse.Status.PENDING:
        raise ValidationError("That team response is no longer available.")
    if not response.responding_team.accepts_team_challenges or not _active_registered_captain(response.responding_team):
        raise ValidationError("That team is no longer available for team challenges.")
    pair_key = team_pair_key(challenger_team.pk, response.responding_team_id)
    if _active_pair_exists(pair_key, exclude_id=challenge.id):
        raise ValidationError("There is already an active challenge between these teams.")
    challenge.challenged_team = response.responding_team
    challenge.team_pair_key = pair_key
    challenge.is_public = False
    challenge.save(update_fields=["challenged_team", "team_pair_key", "is_public", "updated_at"])
    response.status = OpenChallengeResponse.Status.SELECTED
    response.save(update_fields=["status", "updated_at"])
    other_responses = list(
        OpenChallengeResponse.objects.select_related("responding_team", "responding_team__captain").filter(
            challenge=challenge,
            status=OpenChallengeResponse.Status.PENDING,
        ).exclude(pk=response.pk)
    )
    OpenChallengeResponse.objects.filter(pk__in=[item.pk for item in other_responses]).update(
        status=OpenChallengeResponse.Status.NOT_SELECTED,
        updated_at=_now(),
    )
    record_event(challenge, ChallengeEvent.EventType.OPPONENT_SELECTED, actor=actor, team=challenger_team, metadata={"response_id": response.id})
    _mark_challenge_actions(challenge, [actor], Notification.ActionStatus.COMPLETED)
    notify_opponent_selected(challenge, recipient=_team_captain(response.responding_team), actor=actor)
    for other_response in other_responses:
        notify_open_challenge_not_selected(
            challenge,
            recipient=_team_captain(other_response.responding_team),
            actor=actor,
        )
    return challenge


def _validate_challenge_action(challenge, actor):
    if challenge.challenger_team and _active_registered_captain(challenge.challenger_team) and challenge.challenger_team.captain_id == actor.id:
        return challenge.challenger_team
    if challenge.challenged_team and _active_registered_captain(challenge.challenged_team) and challenge.challenged_team.captain_id == actor.id:
        return challenge.challenged_team
    raise ValidationError("Only a team captain can manage this challenge.")


@transaction.atomic
def decide_challenge(challenge_id, actor, action):
    # Booking cancellation and maintenance synchronize the booking and
    # challenge together. Lock the booking first whenever this challenge is
    # already linked to one so all cross-module paths share one lock order.
    challenge_hint = TeamChallenge.objects.select_related("current_proposal").get(pk=challenge_id)
    linked_booking_id = challenge_hint.booking_id or getattr(challenge_hint.current_proposal, "booking_id", None)
    if linked_booking_id:
        Booking.objects.select_for_update().filter(pk=linked_booking_id).first()
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
        "challenger_team", "challenger_team__captain", "challenged_team", "challenged_team__captain", "current_proposal"
    ).get(pk=challenge_id)
    acting_team = _validate_challenge_action(challenge, actor)
    proposal = ChallengeProposal.objects.select_for_update().get(pk=challenge.current_proposal_id)
    if acting_team.pk == challenge.challenger_team_id:
        field = "challenger_decision"
    else:
        field = "challenged_decision"
    normalized_action = str(action or "").upper()
    target = {
        "ACCEPT": ChallengeProposal.Decision.ACCEPTED,
        "DECLINE": ChallengeProposal.Decision.DECLINED,
    }.get(normalized_action)
    if not target:
        raise ValidationError("Choose accept or decline.")
    if challenge.status not in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED]:
        if getattr(proposal, field) == target:
            challenge._idempotent_replay = True
            return challenge
        raise ValidationError("This challenge is no longer awaiting a decision.")
    if challenge.response_deadline <= _now():
        raise ValidationError("The response deadline for this challenge has passed.")
    if not challenge.challenged_team_id:
        raise ValidationError("Select an opposing team before responding to this challenge.")
    if getattr(proposal, field) != ChallengeProposal.Decision.PENDING:
        if getattr(proposal, field) == target:
            challenge._idempotent_replay = True
            return challenge
        raise ValidationError("Your team has already responded to this proposal.")
    if normalized_action == "DECLINE":
        setattr(proposal, field, ChallengeProposal.Decision.DECLINED)
        proposal.save(update_fields=[field])
        challenge.status = TeamChallenge.Status.DECLINED
        challenge.is_public = False
        challenge.save(update_fields=["status", "is_public", "updated_at"])
        record_event(challenge, ChallengeEvent.EventType.DECLINED, actor=actor, team=acting_team, proposal=proposal)
        _mark_challenge_actions(challenge, [actor], Notification.ActionStatus.REJECTED)
        opponent = _opponent_captain(challenge, actor)
        if opponent:
            notify_challenge_decision(challenge, recipient=opponent, accepted=False, actor=actor)
        return challenge
    setattr(proposal, field, ChallengeProposal.Decision.ACCEPTED)
    proposal.save(update_fields=[field])
    record_event(challenge, ChallengeEvent.EventType.ACCEPTED, actor=actor, team=acting_team, proposal=proposal)
    _mark_challenge_actions(challenge, [actor], Notification.ActionStatus.COMPLETED)
    both_accepted = (
        proposal.challenger_decision == ChallengeProposal.Decision.ACCEPTED
        and proposal.challenged_decision == ChallengeProposal.Decision.ACCEPTED
    )
    opponent = _opponent_captain(challenge, actor)
    if opponent and not both_accepted:
        notify_challenge_decision(challenge, recipient=opponent, accepted=True, actor=actor)
    if both_accepted:
        if challenge.booking_id or proposal.booking_id:
            linked_booking = challenge.booking or proposal.booking
            if not linked_booking:
                raise ValidationError("The linked court booking could not be found.")
            _validate_linked_booking(linked_booking, lock=True)
            challenge.status = TeamChallenge.Status.CONFIRMED
            challenge.is_public = False
            challenge.save(update_fields=["status", "is_public", "updated_at"])
            TeamFixture.objects.update_or_create(
                challenge=challenge,
                defaults={"booking": challenge.booking or proposal.booking, "status": TeamFixture.Status.SCHEDULED},
            )
            notify_challenge_status(
                challenge,
                recipients=_challenge_recipients(challenge),
                title="Team match confirmed",
                message="Both teams accepted the proposal and the confirmed court booking is scheduled.",
                actor=actor,
                key_suffix="match-confirmed",
            )
            _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.COMPLETED)
        else:
            challenge.status = TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING
            challenge.is_public = False
            challenge.save(update_fields=["status", "is_public", "updated_at"])
            TeamFixture.objects.update_or_create(challenge=challenge, defaults={"status": TeamFixture.Status.AWAITING_COURT})
            recipients = [_team_captain(challenge.challenger_team), _team_captain(challenge.challenged_team)]
            notify_challenge_status(
                challenge,
                recipients=recipients,
                title="Court booking required",
                message="Both teams accepted the challenge. Choose and confirm a SportSpot court before the booking deadline.",
                actor=actor,
                key_suffix="booking-required",
            )
    else:
        challenge.save(update_fields=["updated_at"])
    return challenge


@transaction.atomic
def counter_challenge(challenge_id, actor, data):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
        "challenger_team", "challenged_team", "current_proposal"
    ).get(pk=challenge_id)
    acting_team = _validate_challenge_action(challenge, actor)
    now = _now()
    if challenge.status not in [
        TeamChallenge.Status.OPEN,
        TeamChallenge.Status.COUNTERED,
        TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING,
    ]:
        raise ValidationError("This challenge can no longer be changed.")
    if challenge.status in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED] and challenge.response_deadline <= now:
        raise ValidationError("The response deadline for this challenge has passed.")
    if challenge.status == TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING and (
        not challenge.booking_deadline or challenge.booking_deadline <= now
    ):
        raise ValidationError("The court-booking deadline for this challenge has passed.")
    if data["court_mode"] != TeamChallenge.CourtMode.PLAN_FIRST:
        raise ValidationError("A booking-first challenge cannot be changed after the court is confirmed.")
    latest = ChallengeProposal.objects.select_for_update().filter(challenge=challenge).order_by("-version").first()
    if not latest:
        raise ValidationError("This challenge has no proposal to update.")
    decision_field = "challenger_decision" if acting_team.pk == challenge.challenger_team_id else "challenged_decision"
    if getattr(latest, decision_field) not in [
        ChallengeProposal.Decision.PENDING,
        ChallengeProposal.Decision.ACCEPTED,
    ]:
        raise ValidationError("This challenge proposal can no longer be changed by your team.")
    merged = {
        "court_mode": TeamChallenge.CourtMode.PLAN_FIRST,
        "proposed_date": data.get("proposed_date", latest.proposed_date),
        "proposed_start_time": data.get("proposed_start_time", latest.proposed_start_time),
        "proposed_end_time": data.get("proposed_end_time", latest.proposed_end_time),
        "preferred_district": data.get("preferred_district", latest.preferred_district),
        "preferred_area": data.get("preferred_area", latest.preferred_area),
        "preferred_venue_name": data.get("preferred_venue_name", latest.preferred_venue_name),
        "players_per_side": data.get("players_per_side", latest.players_per_side),
        "intensity": data.get("intensity", latest.intensity),
        "message": data.get("message", latest.message),
        "response_deadline": data["response_deadline"],
        "booking_deadline": data.get("booking_deadline", latest.booking_deadline),
    }
    game_start = _aware_datetime(merged["proposed_date"], merged["proposed_start_time"])
    _validate_future_window(merged["response_deadline"], merged["booking_deadline"], game_start)
    decisions = {"challenger": ChallengeProposal.Decision.PENDING, "challenged": ChallengeProposal.Decision.PENDING}
    decisions["challenger" if acting_team.pk == challenge.challenger_team_id else "challenged"] = ChallengeProposal.Decision.ACCEPTED
    proposal = _proposal_from_data(challenge, acting_team, merged, latest.version + 1, decisions=decisions)
    challenge.current_proposal = proposal
    challenge.status = TeamChallenge.Status.COUNTERED
    challenge.response_deadline = merged["response_deadline"]
    challenge.booking_deadline = merged["booking_deadline"]
    challenge.save(update_fields=["current_proposal", "status", "response_deadline", "booking_deadline", "updated_at"])
    record_event(challenge, ChallengeEvent.EventType.COUNTERED, actor=actor, team=acting_team, proposal=proposal)
    opponent = _opponent_captain(challenge, actor)
    if opponent:
        notify_challenge_countered(challenge, recipient=opponent, actor=actor)
    return challenge


def _challenge_reconfirmation_deadline(start_at, requested_at):
    safe_deadline = start_at - timezone.timedelta(
        minutes=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG.get(
            "minimum_reconfirmation_notice_minutes", 30
        )
    )
    capped_deadline = requested_at + timezone.timedelta(
        hours=SPORTSPOT_MATCHMAKING_DEADLINE_CONFIG.get(
            "maximum_reconfirmation_response_hours", 24
        )
    )
    return min(safe_deadline, capped_deadline)


@transaction.atomic
def reschedule_challenge(challenge_id, actor, data):
    """Create a new proposal version for a confirmed team match.

    A booking-first reschedule must use a new paid booking. The replacement
    booking can belong to either participating captain, which avoids making
    the challenged team depend on the initiating captain for every future
    schedule change. The original booking is never cancelled here.
    """
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
        "challenger_team", "challenged_team", "current_proposal"
    ).get(pk=challenge_id)
    acting_team = _validate_challenge_action(challenge, actor)
    if challenge.status != TeamChallenge.Status.CONFIRMED:
        raise ValidationError("Only a confirmed team match can be rescheduled.")
    booking = data.get("booking")
    if not booking:
        raise ValidationError("Choose a new confirmed court booking for the schedule change.")
    replacement = validate_replacement_booking(booking, challenge, actor, lock=True)
    previous_booking_id = challenge.booking_id
    proposal_data = _booking_fields(replacement)
    proposal_data.update(
        {
            "court_mode": TeamChallenge.CourtMode.BOOKING_FIRST,
            "response_deadline": data["response_deadline"],
            "booking_deadline": None,
            "players_per_side": data.get("players_per_side", challenge.current_proposal.players_per_side),
            "intensity": data.get("intensity", challenge.current_proposal.intensity),
            "message": data.get("message", ""),
        }
    )
    start_at = proposal_data["game_start"]
    if not start_at or start_at <= _now():
        raise ValidationError("Choose a future court booking.")
    _validate_future_window(proposal_data["response_deadline"], None, start_at)
    deadline = _challenge_reconfirmation_deadline(start_at, _now())
    if proposal_data["response_deadline"] > deadline:
        raise ValidationError("Both teams must have time to confirm the new schedule before the match starts.")
    latest = challenge.current_proposal
    proposal = _proposal_from_data(
        challenge,
        acting_team,
        proposal_data,
        latest.version + 1,
        booking=replacement,
    )
    challenge.current_proposal = proposal
    challenge.booking = replacement
    challenge.booking_owner = replacement.player
    challenge.status = TeamChallenge.Status.RECONFIRMATION_REQUIRED
    challenge.response_deadline = proposal_data["response_deadline"]
    challenge.booking_deadline = None
    challenge.reconfirmation_requested_at = _now()
    challenge.reconfirmation_deadline = proposal_data["response_deadline"]
    challenge.is_public = False
    challenge.save(update_fields=[
        "current_proposal", "booking", "booking_owner", "status", "response_deadline",
        "booking_deadline", "reconfirmation_requested_at", "reconfirmation_deadline",
        "is_public", "updated_at",
    ])
    TeamFixture.objects.update_or_create(
        challenge=challenge,
        defaults={"booking": replacement, "status": TeamFixture.Status.RECONFIRMATION_REQUIRED},
    )
    fixture = TeamFixture.objects.get(challenge=challenge)
    for participant in fixture.participants.filter(status=TeamFixtureParticipant.Status.SELECTED).select_related("player", "fixture"):
        ensure_fixture_participation_commitment(participant, created_by=actor)
    record_event(
        challenge,
        ChallengeEvent.EventType.RECONFIRMATION_REQUIRED,
        actor=actor,
        team=acting_team,
        proposal=proposal,
        metadata={"previous_booking_id": previous_booking_id, "replacement_booking_id": replacement.id},
    )
    recipients = _challenge_recipients(challenge)
    for recipient in recipients:
        notify_challenge_reconfirmation_required(challenge, recipient=recipient, actor=actor)
    return challenge


def _expire_challenge_reconfirmation_locked(challenge, *, now=None, notify=True):
    if challenge.status != TeamChallenge.Status.RECONFIRMATION_REQUIRED:
        return False
    now = now or _now()
    challenge.status = TeamChallenge.Status.EXPIRED
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    TeamFixture.objects.filter(challenge=challenge).update(
        status=TeamFixture.Status.CANCELLED,
        updated_at=now,
    )
    fixture_id = TeamFixture.objects.filter(challenge=challenge).values_list("id", flat=True).first()
    if fixture_id:
        void_fixture_participation_commitments(fixture_id, actor=None, reason="challenge_reconfirmation_expired")
    record_event(
        challenge,
        ChallengeEvent.EventType.EXPIRED,
        metadata={"reason": "reconfirmation_deadline"},
    )
    recipients = _challenge_recipients(challenge)
    _mark_challenge_actions(challenge, recipients, Notification.ActionStatus.EXPIRED)
    if notify:
        for recipient in recipients:
            notify_challenge_reconfirmation_expired(challenge, recipient=recipient)
    return True


@transaction.atomic
def reconfirm_challenge(challenge_id, actor, action):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
        "challenger_team", "challenged_team", "current_proposal"
    ).get(pk=challenge_id)
    acting_team = _validate_challenge_action(challenge, actor)
    if challenge.status != TeamChallenge.Status.RECONFIRMATION_REQUIRED:
        raise ValidationError("This team match does not need schedule confirmation.")
    now = _now()
    if challenge.reconfirmation_deadline and challenge.reconfirmation_deadline <= now:
        _expire_challenge_reconfirmation_locked(challenge, now=now)
        raise ValidationError("The schedule confirmation deadline has passed. This team match is no longer scheduled.")
    proposal = ChallengeProposal.objects.select_for_update().get(pk=challenge.current_proposal_id)
    field = "challenger_decision" if acting_team.pk == challenge.challenger_team_id else "challenged_decision"
    normalized = str(action or "").upper()
    if normalized not in {"ACCEPT", "DECLINE"}:
        raise ValidationError("Choose whether your team can play the updated schedule.")
    target = ChallengeProposal.Decision.ACCEPTED if normalized == "ACCEPT" else ChallengeProposal.Decision.DECLINED
    if getattr(proposal, field) == target:
        challenge._idempotent_replay = True
        return challenge
    if getattr(proposal, field) != ChallengeProposal.Decision.PENDING:
        raise ValidationError("Your team has already responded to this schedule.")
    setattr(proposal, field, target)
    proposal.save(update_fields=[field])
    if normalized == "DECLINE":
        challenge.status = TeamChallenge.Status.DECLINED
        challenge.is_public = False
        challenge.save(update_fields=["status", "is_public", "updated_at"])
        TeamFixture.objects.filter(challenge=challenge).update(status=TeamFixture.Status.CANCELLED, updated_at=now)
        fixture_id = TeamFixture.objects.filter(challenge=challenge).values_list("id", flat=True).first()
        if fixture_id:
            void_fixture_participation_commitments(fixture_id, actor=actor, reason="schedule_change_declined")
        record_event(challenge, ChallengeEvent.EventType.DECLINED, actor=actor, team=acting_team, proposal=proposal)
        _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.REJECTED)
        notify_challenge_status(
            challenge,
            recipients=_challenge_recipients(challenge),
            title="Team match schedule declined",
            message="The updated team match schedule was declined, so the match is no longer scheduled.",
            actor=actor,
            key_suffix=f"reconfirmation-declined-{proposal.id}",
            notification_type=Notification.NotificationType.CHALLENGE_REJECTED,
            action_status=Notification.ActionStatus.REJECTED,
        )
        return challenge
    record_event(challenge, ChallengeEvent.EventType.ACCEPTED, actor=actor, team=acting_team, proposal=proposal, metadata={"reconfirmation": True})
    if proposal.challenger_decision == ChallengeProposal.Decision.ACCEPTED and proposal.challenged_decision == ChallengeProposal.Decision.ACCEPTED:
        challenge.status = TeamChallenge.Status.CONFIRMED
        challenge.reconfirmation_requested_at = None
        challenge.reconfirmation_deadline = None
        challenge.save(update_fields=["status", "reconfirmation_requested_at", "reconfirmation_deadline", "updated_at"])
        TeamFixture.objects.filter(challenge=challenge).update(status=TeamFixture.Status.SCHEDULED, updated_at=now)
        notify_challenge_status(
            challenge,
            recipients=_challenge_recipients(challenge),
            title="Team match schedule confirmed",
            message="Both teams confirmed the updated team match schedule.",
            actor=actor,
            key_suffix=f"reconfirmation-complete-{proposal.id}",
            notification_type=Notification.NotificationType.CHALLENGE_ACCEPTED,
            action_status=Notification.ActionStatus.COMPLETED,
        )
    else:
        challenge.save(update_fields=["updated_at"])
        opponent = _opponent_captain(challenge, actor)
        if opponent:
            notify_challenge_status(
                challenge,
                recipients=[opponent],
                title="Your team must confirm the updated schedule",
                message="The other team accepted the schedule change. Please confirm your team’s availability.",
                actor=actor,
                key_suffix=f"reconfirmation-awaiting-{proposal.id}",
                notification_type=Notification.NotificationType.MATCH_UPDATED,
                action_required=True,
                action_status=Notification.ActionStatus.PENDING,
            )
    return challenge


@transaction.atomic
def withdraw_challenge(challenge_id, actor):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team").get(pk=challenge_id)
    acting_team = _validate_challenge_action(challenge, actor)
    if acting_team.pk != challenge.challenger_team_id:
        raise ValidationError("Only the challenging team captain can withdraw this challenge.")
    if challenge.status == TeamChallenge.Status.WITHDRAWN:
        challenge._idempotent_replay = True
        return challenge
    if challenge.status not in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED]:
        raise ValidationError("This challenge can no longer be withdrawn.")
    if challenge.response_deadline <= _now():
        raise ValidationError("The response deadline for this challenge has passed.")
    challenge.status = TeamChallenge.Status.WITHDRAWN
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    record_event(challenge, ChallengeEvent.EventType.WITHDRAWN, actor=actor, team=acting_team)
    _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.CANCELLED)
    opponent = _opponent_captain(challenge, actor)
    if opponent:
        notify_challenge_status(challenge, recipients=[opponent], title="Team challenge withdrawn", message="The challenge creator withdrew this challenge.", actor=actor, key_suffix="withdrawn")
    return challenge


@transaction.atomic
def attach_booking_to_challenge(challenge_id, booking_id, actor):
    # Use the same booking -> challenge lock order as cancellation and
    # maintenance. The challenge is re-checked after the booking is locked.
    challenge_hint = TeamChallenge.objects.select_related(
        "challenger_team", "challenged_team", "current_proposal"
    ).get(pk=challenge_id)
    _validate_challenge_action(challenge_hint, actor)
    booking = (
        Booking.objects.select_for_update()
        .select_related("venue", "court", "player")
        .prefetch_related("slot_items__slot")
        .get(pk=booking_id)
    )
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
        "challenger_team", "challenged_team", "current_proposal"
    ).get(pk=challenge_id)
    acting_team = _validate_challenge_action(challenge, actor)
    if challenge.status == TeamChallenge.Status.CONFIRMED and challenge.booking_id == booking.id:
        _validate_linked_booking(booking)
        challenge._idempotent_replay = True
        return challenge
    if challenge.status != TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING or challenge.booking_id:
        raise ValidationError("This challenge is not waiting for a court booking.")
    if challenge.booking_deadline and challenge.booking_deadline <= _now():
        raise ValidationError("The court-booking deadline for this challenge has passed.")
    validate_replacement_booking(booking, challenge, actor)
    _validate_plan_booking_matches_proposal(challenge.current_proposal, booking)
    challenge.booking = booking
    challenge.booking_owner = actor
    challenge.status = TeamChallenge.Status.CONFIRMED
    challenge.save(update_fields=["booking", "booking_owner", "status", "updated_at"])
    fixture, _created = TeamFixture.objects.update_or_create(challenge=challenge, defaults={"booking": booking, "status": TeamFixture.Status.SCHEDULED})
    for participant in fixture.participants.filter(status=TeamFixtureParticipant.Status.SELECTED).select_related("player", "fixture"):
        ensure_fixture_participation_commitment(participant, created_by=actor)
    record_event(challenge, ChallengeEvent.EventType.BOOKING_CONFIRMED, actor=actor, team=acting_team, metadata={"booking_id": booking.id})
    recipients = [_team_captain(challenge.challenger_team), _team_captain(challenge.challenged_team)]
    _mark_challenge_actions(challenge, recipients, Notification.ActionStatus.COMPLETED)
    notify_challenge_status(challenge, recipients=recipients, title="Team match confirmed", message="The court booking is confirmed and the team match is scheduled.", actor=actor, key_suffix="booking-confirmed")
    return challenge


def _close_challenge_for_booking_locked(challenge, *, actor=None, reason="", now=None, notify=True):
    """Close a challenge whose linked booking is no longer usable.

    This only changes the challenge lifecycle. Booking cancellation and refund
    handling remain owned by the booking service.
    """
    if challenge.status not in ACTIVE_CHALLENGE_STATUSES:
        return False
    now = now or _now()
    challenge.status = TeamChallenge.Status.CANCELLED
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    recipients = _challenge_recipients_with_respondents(challenge)
    TeamFixture.objects.filter(challenge=challenge).update(
        status=TeamFixture.Status.CANCELLED,
        updated_at=now,
    )
    fixture_id = TeamFixture.objects.filter(challenge=challenge).values_list("id", flat=True).first()
    if fixture_id:
        void_fixture_participation_commitments(fixture_id, actor=actor, reason=reason or "linked_booking_unavailable")
    record_event(
        challenge,
        ChallengeEvent.EventType.CANCELLED,
        actor=actor,
        metadata={"reason": reason or "linked_booking_unavailable"},
    )
    _mark_challenge_actions(challenge, recipients, Notification.ActionStatus.CANCELLED)
    if notify:
        notify_challenge_status(
            challenge,
            recipients=recipients,
            title="Team match cancelled",
            message=reason or "The linked court booking is no longer available, so this team match is no longer scheduled.",
            actor=actor,
            key_suffix="booking-unavailable",
        )
    return True


def synchronize_confirmed_team_challenges(*, now=None, limit=100, notify=True):
    """Synchronize scheduled team matches with their booking and clock.

    This is safe to run from the maintenance command and from request-time
    reads. The database remains authoritative; the frontend only displays the
    result of this synchronization.
    """
    now = now or _now()
    challenge_ids = list(
        TeamChallenge.objects.filter(
            status=TeamChallenge.Status.CONFIRMED,
            booking__isnull=False,
        ).order_by("id").values_list("id", flat=True)[:limit]
    )
    changed = 0
    for challenge_id in challenge_ids:
        with transaction.atomic():
            # Keep this order aligned with BookingCancelView and
            # cancel_challenges_for_booking to avoid cross-service deadlocks.
            booking_hint = TeamChallenge.objects.filter(pk=challenge_id).values("booking_id").first()
            if not booking_hint or not booking_hint["booking_id"]:
                continue
            booking = (
                Booking.objects.select_for_update()
                .select_related("player", "venue", "court", "slot")
                .prefetch_related("slot_items__slot")
                .filter(pk=booking_hint["booking_id"])
                .first()
            )
            if not booking:
                continue
            challenge = (
                TeamChallenge.objects.select_for_update(of=("self",))
                .select_related("challenger_team", "challenged_team")
                .filter(pk=challenge_id, status=TeamChallenge.Status.CONFIRMED)
                .first()
            )
            if not challenge or not challenge.booking_id or challenge.booking_id != booking.id:
                continue
            if booking.status in [Booking.BookingStatus.CANCELLED, Booking.BookingStatus.EXPIRED] or booking.payment_status != Booking.PaymentStatus.PAID:
                if _close_challenge_for_booking_locked(
                    challenge,
                    actor=getattr(booking, "cancelled_by", None),
                    reason="The linked court booking is no longer available, so this team match is no longer scheduled.",
                    now=now,
                    notify=notify,
                ):
                    changed += 1
                continue
            start_at = get_booking_start_at(booking)
            end_at = booking_end_at(booking)
            if not start_at or not end_at:
                continue
            if end_at <= now:
                challenge.status = TeamChallenge.Status.COMPLETED
                challenge.save(update_fields=["status", "updated_at"])
                TeamFixture.objects.update_or_create(
                    challenge=challenge,
                    defaults={"booking": booking, "status": TeamFixture.Status.COMPLETED},
                )
                if notify:
                    notify_challenge_status(
                        challenge,
                        recipients=_challenge_recipients(challenge),
                        title="Team match completed",
                        message="Your scheduled team match has finished. You can review the match details in your challenges.",
                        actor=None,
                        key_suffix="match-completed",
                        notification_type=Notification.NotificationType.MATCH_UPDATED,
                        action_status=Notification.ActionStatus.COMPLETED,
                    )
                changed += 1
                continue

            fixture = TeamFixture.objects.select_for_update().filter(challenge=challenge).first()
            if start_at <= now:
                if not fixture or fixture.status != TeamFixture.Status.IN_PROGRESS:
                    TeamFixture.objects.update_or_create(
                        challenge=challenge,
                        defaults={"booking": booking, "status": TeamFixture.Status.IN_PROGRESS},
                    )
                    changed += 1
            elif not fixture or fixture.status != TeamFixture.Status.SCHEDULED:
                TeamFixture.objects.update_or_create(
                    challenge=challenge,
                    defaults={"booking": booking, "status": TeamFixture.Status.SCHEDULED},
                )
                changed += 1
    return changed


def _fixture_for_update(fixture_id):
    fixture = TeamFixture.objects.select_for_update(of=("self",)).select_related(
        "challenge",
        "challenge__challenger_team",
        "challenge__challenged_team",
        "booking",
    ).get(pk=fixture_id)
    start_at, end_at = _fixture_start_end(fixture) if fixture.booking_id else (None, None)
    now = _now()
    if end_at and end_at <= now and fixture.status in [TeamFixture.Status.SCHEDULED, TeamFixture.Status.IN_PROGRESS]:
        fixture.status = TeamFixture.Status.COMPLETED
        fixture.save(update_fields=["status", "updated_at"])
        if fixture.challenge.status == TeamChallenge.Status.CONFIRMED:
            fixture.challenge.status = TeamChallenge.Status.COMPLETED
            fixture.challenge.save(update_fields=["status", "updated_at"])
    elif start_at and start_at <= now and fixture.status == TeamFixture.Status.SCHEDULED:
        fixture.status = TeamFixture.Status.IN_PROGRESS
        fixture.save(update_fields=["status", "updated_at"])
    return fixture


def _fixture_start_end(fixture):
    if not fixture.booking_id:
        return None, None
    return get_booking_start_at(fixture.booking), booking_end_at(fixture.booking)


@transaction.atomic
def get_challenge_fixture_room(challenge_id, actor):
    """Return the private coordination surface for an authorised participant."""
    fixture_id = TeamFixture.objects.filter(challenge_id=challenge_id).values_list("id", flat=True).first()
    if not fixture_id:
        raise TeamFixture.DoesNotExist
    fixture = _fixture_for_update(fixture_id)
    if not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        raise ValidationError("Only authorised match participants can open this Game Room.")
    is_captain = any(
        _active_registered_captain(team) and team.captain_id == actor.id
        for team in [fixture.challenge.challenger_team, fixture.challenge.challenged_team]
        if team
    )
    is_participant = TeamFixtureParticipant.objects.filter(
        fixture=fixture,
        player=actor,
        status__in=[
            TeamFixtureParticipant.Status.SELECTED,
            TeamFixtureParticipant.Status.ATTENDED,
            TeamFixtureParticipant.Status.ABSENT,
        ],
    ).exists()
    if not is_captain and not is_participant:
        raise ValidationError("You are not a participant in this Game Room.")
    return TeamFixture.objects.select_related(
        "challenge",
        "challenge__challenger_team",
        "challenge__challenged_team",
        "challenge__current_proposal",
        "booking",
        "booking__venue",
        "booking__court",
    ).prefetch_related(
        "booking__slot_items__slot",
        "participants__player",
        "participants__team",
    ).get(pk=fixture.pk)


def team_fixture_chat_access_level(fixture_id, actor):
    """Return the same access state as the private fixture room for chat."""
    fixture = (
        TeamFixture.objects.select_related(
            "challenge__challenger_team",
            "challenge__challenged_team",
        )
        .filter(pk=fixture_id)
        .first()
    )
    if not fixture:
        return "NOT_FOUND"
    if not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        return "NONE"

    challenge = fixture.challenge
    is_captain = any(
        _active_registered_captain(team) and team.captain_id == actor.id
        for team in [challenge.challenger_team, challenge.challenged_team]
        if team
    )
    is_participant = TeamFixtureParticipant.objects.filter(
        fixture=fixture,
        player=actor,
        status__in=[
            TeamFixtureParticipant.Status.SELECTED,
            TeamFixtureParticipant.Status.ATTENDED,
            TeamFixtureParticipant.Status.ABSENT,
        ],
    ).exists()
    if not is_captain and not is_participant:
        return "NONE"

    if fixture.status == TeamFixture.Status.AWAITING_COURT:
        return "PLANNING"
    if fixture.status == TeamFixture.Status.RECONFIRMATION_REQUIRED:
        return "RECONFIRMATION"
    if fixture.status == TeamFixture.Status.SCHEDULED:
        return "CONFIRMED"
    if fixture.status == TeamFixture.Status.IN_PROGRESS:
        return "IN_PROGRESS"
    return "READ_ONLY"


@transaction.atomic
def add_fixture_participant(fixture_id, actor, player_id):
    fixture = _fixture_for_update(fixture_id)
    acting_team = _validate_challenge_action(fixture.challenge, actor)
    if fixture.challenge.status != TeamChallenge.Status.CONFIRMED or fixture.status != TeamFixture.Status.SCHEDULED:
        raise ValidationError("Players can only be selected before this confirmed match starts.")
    start_at, _end_at = _fixture_start_end(fixture)
    if not start_at or start_at <= _now():
        raise ValidationError("The team lineup can no longer be changed.")
    player = get_user_model().objects.filter(pk=player_id, role="PLAYER", is_active=True).first()
    if not player:
        raise ValidationError("Choose an active player account.")
    if not TeamMember.objects.filter(
        team=acting_team,
        user=player,
        member_type=TeamMember.MemberType.REGISTERED,
        status=TeamMember.MemberStatus.ACTIVE,
    ).exists():
        raise ValidationError("Choose a registered member of your team.")
    if TeamFixtureParticipant.objects.filter(fixture=fixture, player=player).exists():
        raise ValidationError("That player is already listed for this match.")
    participant = TeamFixtureParticipant(
        fixture=fixture,
        team=acting_team,
        player=player,
        selected_by=actor,
    )
    participant.full_clean()
    participant.save()
    ensure_fixture_participation_commitment(participant, created_by=actor)
    return participant


def ensure_fixture_participation_commitment(participant, *, created_by=None):
    """Create the shared commitment for a selected player in a booked fixture."""
    if not participant or not participant.player_id or not participant.fixture_id:
        return None, False
    fixture = participant.fixture
    start_at, end_at = _fixture_start_end(fixture)
    if not fixture.booking_id or not start_at or not end_at:
        return None, False
    return create_participation_commitment(
        player=participant.player,
        source_type=ParticipationCommitment.SourceType.TEAM_FIXTURE,
        source_id=fixture.id,
        source_participant_id=participant.id,
        start_at=start_at,
        end_at=end_at,
        metadata={
            "fixture_id": fixture.id,
            "participant_id": participant.id,
            "team_id": participant.team_id,
            "challenge_id": fixture.challenge_id,
        },
        created_by=created_by,
    )


def void_fixture_participation_commitments(fixture_id, *, actor=None, reason=""):
    """Void scheduled fixture commitments when the match ends outside a player’s control."""
    from players.services import void_participation_commitment

    commitments = list(
        ParticipationCommitment.objects.filter(
            source_type=ParticipationCommitment.SourceType.TEAM_FIXTURE,
            source_id=fixture_id,
        ).values_list("id", flat=True)
    )
    changed = 0
    for commitment_id in commitments:
        _commitment, was_changed = void_participation_commitment(
            source_type=ParticipationCommitment.SourceType.TEAM_FIXTURE,
            source_id=fixture_id,
            commitment_id=commitment_id,
            actor=actor,
            reason=reason or "fixture_cancelled",
        )
        changed += int(was_changed)
    return changed


@transaction.atomic
def eligible_fixture_players(fixture_id, actor):
    """Return active registered members the acting captain may add to a lineup."""
    fixture = _fixture_for_update(fixture_id)
    acting_team = _validate_challenge_action(fixture.challenge, actor)
    if fixture.challenge.status != TeamChallenge.Status.CONFIRMED or fixture.status != TeamFixture.Status.SCHEDULED:
        raise ValidationError("The lineup can only be prepared before this match starts.")
    start_at, _end_at = _fixture_start_end(fixture)
    if start_at and start_at <= _now():
        raise ValidationError("The team lineup can no longer be changed.")
    selected_player_ids = TeamFixtureParticipant.objects.filter(
        fixture=fixture,
        status__in=[TeamFixtureParticipant.Status.SELECTED],
    ).values("player_id")
    return list(
        TeamMember.objects.filter(
            team=acting_team,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
            user__role="PLAYER",
            user__is_active=True,
        )
        .exclude(user_id__in=selected_player_ids)
        .select_related("user", "user__player_profile")
        .order_by("user__full_name", "user_id")
    )


@transaction.atomic
def remove_fixture_participant(fixture_id, participant_id, actor):
    fixture = _fixture_for_update(fixture_id)
    acting_team = _validate_challenge_action(fixture.challenge, actor)
    start_at, _end_at = _fixture_start_end(fixture)
    if fixture.status != TeamFixture.Status.SCHEDULED or (start_at and start_at <= _now()):
        raise ValidationError("The team lineup can no longer be changed.")
    participant = TeamFixtureParticipant.objects.select_for_update().filter(
        pk=participant_id,
        fixture=fixture,
        team=acting_team,
    ).first()
    if not participant:
        raise ValidationError("That lineup player was not found for your team.")
    if participant.status == TeamFixtureParticipant.Status.WITHDRAWN:
        participant._idempotent_replay = True
        return participant
    from players.services import void_participation_commitment

    void_participation_commitment(
        source_type=ParticipationCommitment.SourceType.TEAM_FIXTURE,
        source_id=fixture.id,
        player_id=participant.player_id,
        actor=actor,
        reason="The team captain removed the player from the lineup before the match.",
    )
    participant.status = TeamFixtureParticipant.Status.WITHDRAWN
    participant.save(update_fields=["status", "updated_at"])
    return participant


@transaction.atomic
def record_fixture_attendance(fixture_id, participant_id, actor, attendance_status):
    fixture = _fixture_for_update(fixture_id)
    participant = TeamFixtureParticipant.objects.select_for_update().select_related(
        "player", "team", "fixture"
    ).filter(pk=participant_id, fixture=fixture).first()
    if not participant:
        raise ValidationError("That player is not listed for this match.")
    acting_team = _validate_challenge_action(fixture.challenge, actor)
    if participant.team_id != acting_team.id:
        raise ValidationError("Only your team captain can record this player’s attendance.")
    if fixture.status != TeamFixture.Status.COMPLETED:
        raise ValidationError("Attendance can be recorded after the match is completed.")
    normalized = str(attendance_status or "").upper()
    if normalized not in {
        TeamFixtureParticipant.Status.ATTENDED,
        TeamFixtureParticipant.Status.ABSENT,
    }:
        raise ValidationError("Choose attended or absent.")
    if participant.status != TeamFixtureParticipant.Status.SELECTED:
        if participant.status == normalized:
            commitment, _created = ensure_fixture_participation_commitment(participant, created_by=actor)
            if commitment:
                record_commitment_attendance(
                    commitment_id=commitment.id,
                    actor=actor,
                    attended=normalized == TeamFixtureParticipant.Status.ATTENDED,
                )
            participant._idempotent_replay = True
            return participant
        raise ValidationError("Attendance for this player has already been recorded.")
    participant.status = normalized
    participant.attendance_recorded_by = actor
    participant.attendance_recorded_at = _now()
    participant.save(update_fields=["status", "attendance_recorded_by", "attendance_recorded_at", "updated_at"])
    commitment, _created = ensure_fixture_participation_commitment(participant, created_by=actor)
    if not commitment:
        raise ValidationError("This player does not have a confirmed fixture commitment.")
    record_commitment_attendance(
        commitment_id=commitment.id,
        actor=actor,
        attended=normalized == TeamFixtureParticipant.Status.ATTENDED,
    )
    return participant


@transaction.atomic
def dispute_fixture_attendance(fixture_id, participant_id, player, reason):
    participant = TeamFixtureParticipant.objects.filter(
        fixture_id=fixture_id,
        id=participant_id,
        player=player,
    ).first()
    if not participant:
        raise ValidationError("You do not have an attendance record for this match.")
    commitment = ParticipationCommitment.objects.filter(
        player=player,
        source_type=ParticipationCommitment.SourceType.TEAM_FIXTURE,
        source_id=fixture_id,
        source_participant_id=participant.id,
    ).order_by("-source_version", "-id").first()
    if not commitment:
        raise ValidationError("This match does not have a reviewable attendance record.")
    return dispute_commitment(commitment_id=commitment.id, player=player, reason=reason)


@transaction.atomic
def resolve_fixture_attendance_dispute(fixture_id, participant_id, actor, outcome):
    """Resolve a staff-reviewed fixture attendance dispute and resync dependants."""
    fixture = TeamFixture.objects.select_for_update().get(pk=fixture_id)
    participant = TeamFixtureParticipant.objects.select_for_update().filter(
        fixture=fixture,
        pk=participant_id,
    ).first()
    if not participant:
        raise ValidationError("That player is not listed for this match.")
    commitment = ParticipationCommitment.objects.filter(
        player_id=participant.player_id,
        source_type=ParticipationCommitment.SourceType.TEAM_FIXTURE,
        source_id=fixture.id,
        source_participant_id=participant.id,
    ).order_by("-source_version", "-id").first()
    if not commitment:
        raise ValidationError("This match does not have an open attendance dispute.")
    resolved = resolve_commitment_dispute(commitment_id=commitment.id, actor=actor, outcome=outcome)
    normalized = str(outcome or "").upper()
    if normalized == "ATTENDED":
        participant.status = TeamFixtureParticipant.Status.ATTENDED
        participant.attendance_recorded_by = actor
        participant.attendance_recorded_at = resolved.resolved_at
        participant.save(update_fields=["status", "attendance_recorded_by", "attendance_recorded_at"])
        if fixture.result_confirmed_at:
            _create_fixture_rating_eligibilities(fixture)
    elif normalized in {"NO_SHOW", "EXCUSED"}:
        participant.status = TeamFixtureParticipant.Status.ABSENT
        participant.save(update_fields=["status"])
    return resolved


@transaction.atomic
def submit_fixture_result(fixture_id, actor, result):
    fixture = _fixture_for_update(fixture_id)
    _validate_challenge_action(fixture.challenge, actor)
    if fixture.status != TeamFixture.Status.COMPLETED:
        raise ValidationError("The match result can be submitted after the match is completed.")
    normalized = str(result or "").strip()
    if len(normalized) < 2:
        raise ValidationError("Enter the match result before submitting it.")
    if fixture.result == normalized and fixture.result_submitted_by_id == actor.id:
        fixture._idempotent_replay = True
        return fixture
    if fixture.result_confirmed_at:
        raise ValidationError("This match result has already been confirmed.")
    if fixture.result and fixture.result_submitted_by_id != actor.id:
        raise ValidationError(
            "The other team captain has submitted a result. Confirm it or ask them to update it."
        )
    fixture.result = normalized[:200]
    fixture.result_submitted_by = actor
    fixture.result_submitted_at = _now()
    fixture.result_confirmed_by = None
    fixture.result_confirmed_at = None
    fixture.save(update_fields=[
        "result", "result_submitted_by", "result_submitted_at",
        "result_confirmed_by", "result_confirmed_at", "updated_at",
    ])
    return fixture


@transaction.atomic
def confirm_fixture_result(fixture_id, actor):
    fixture = _fixture_for_update(fixture_id)
    acting_team = _validate_challenge_action(fixture.challenge, actor)
    if fixture.status != TeamFixture.Status.COMPLETED or not fixture.result:
        raise ValidationError("There is no completed result ready for confirmation.")
    if fixture.result_confirmed_at:
        fixture._idempotent_replay = True
        return fixture
    if not fixture.result_submitted_by_id:
        raise ValidationError("One captain must submit the result first.")
    if fixture.result_submitted_by_id == actor.id:
        raise ValidationError("The other team captain must confirm this result.")
    if fixture.participants.filter(status=TeamFixtureParticipant.Status.SELECTED).exists():
        raise ValidationError("Record each listed player’s attendance before confirming the result.")
    fixture.result_confirmed_by = actor
    fixture.result_confirmed_at = _now()
    fixture.save(update_fields=["result_confirmed_by", "result_confirmed_at", "updated_at"])
    _create_fixture_rating_eligibilities(fixture)
    return fixture


def _create_fixture_rating_eligibilities(fixture):
    participants = list(
        fixture.participants.filter(status=TeamFixtureParticipant.Status.ATTENDED)
        .select_related("player")
    )
    match_date, _end_at = _fixture_start_end(fixture)
    deadline = _now() + timedelta(days=7)
    title = f"Feedback for team match #{fixture.id}"
    for rater in participants:
        for rated in participants:
            if rater.player_id == rated.player_id:
                continue
            eligibility, created = create_rating_eligibility(
                rater=rater.player,
                rated_player=rated.player,
                title=title,
                related_entity_type="team_fixture",
                related_entity_id=fixture.id,
                match_date=match_date,
                deadline_at=deadline,
                metadata={"fixture_id": fixture.id},
            )
            if created:
                create_notification(
                    recipient=rater.player,
                    actor=None,
                    notification_type=Notification.NotificationType.RATING_REQUIRED,
                    title="Share feedback on your team match",
                    message="Your completed team match is ready for verified player feedback.",
                    action_url="/dashboard/player/ratings",
                    related_entity_type="team_fixture",
                    related_entity_id=fixture.id,
                    action_required=True,
                    action_status=Notification.ActionStatus.PENDING,
                    metadata={"eligibility_id": eligibility.id, "rated_player_id": rated.player_id},
                    deduplication_key=f"team-fixture:{fixture.id}:rating:{rater.player_id}:{rated.player_id}",
                )


@transaction.atomic
def cancel_challenge(challenge_id, actor):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team").get(pk=challenge_id)
    _validate_challenge_action(challenge, actor)
    if challenge.status == TeamChallenge.Status.CANCELLED:
        challenge._idempotent_replay = True
        return challenge
    if challenge.status in [TeamChallenge.Status.CANCELLED, TeamChallenge.Status.COMPLETED, TeamChallenge.Status.DECLINED, TeamChallenge.Status.EXPIRED, TeamChallenge.Status.WITHDRAWN]:
        raise ValidationError("This challenge is already closed.")
    challenge.status = TeamChallenge.Status.CANCELLED
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    TeamFixture.objects.filter(challenge=challenge).update(status=TeamFixture.Status.CANCELLED, updated_at=_now())
    fixture_id = TeamFixture.objects.filter(challenge=challenge).values_list("id", flat=True).first()
    if fixture_id:
        void_fixture_participation_commitments(fixture_id, actor=actor, reason="challenge_cancelled")
    record_event(challenge, ChallengeEvent.EventType.CANCELLED, actor=actor)
    _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.CANCELLED)
    other = _opponent_captain(challenge, actor)
    if other:
        notify_challenge_status(challenge, recipients=[other], title="Team challenge cancelled", message="This team challenge has been cancelled. Any separate court booking remains managed through bookings.", actor=actor, key_suffix="cancelled")
    return challenge


@transaction.atomic
def cancel_challenges_for_booking(booking, actor=None, notify=True):
    """Close active team challenges when their confirmed booking is cancelled.

    Booking cancellation remains responsible for slot release and refunds. This
    helper only synchronizes the separate challenge and fixture lifecycles.
    """
    # Re-locking is harmless when the booking endpoint already owns this row,
    # and makes direct service calls follow the same booking -> challenge order.
    locked_booking = Booking.objects.select_for_update().filter(pk=booking.id).first()
    if not locked_booking:
        return 0
    challenge_ids = list(
        TeamChallenge.objects.filter(
            booking_id=locked_booking.id,
            status__in=ACTIVE_CHALLENGE_STATUSES,
        ).values_list("id", flat=True)
    )
    cancelled = 0
    for challenge_id in challenge_ids:
        challenge = (
            TeamChallenge.objects.select_for_update(of=("self",))
            .select_related("challenger_team", "challenged_team")
            .filter(pk=challenge_id)
            .first()
        )
        if not challenge or challenge.status not in ACTIVE_CHALLENGE_STATUSES:
            continue
        if _close_challenge_for_booking_locked(
            challenge,
            actor=actor,
            reason="The linked court booking was cancelled, so this team match is no longer scheduled.",
            now=_now(),
            notify=notify,
        ):
            cancelled += 1
    return cancelled


def _challenge_recipients(challenge):
    recipients = []
    seen_ids = set()
    for team in [challenge.challenger_team, challenge.challenged_team]:
        if not team:
            continue
        captain = _team_captain(team)
        if captain and captain.id not in seen_ids:
            recipients.append(captain)
            seen_ids.add(captain.id)
    return recipients


def _challenge_recipients_with_respondents(challenge):
    recipients = _challenge_recipients(challenge)
    respondent_ids = challenge.open_responses.filter(
        status__in=[OpenChallengeResponse.Status.PENDING, OpenChallengeResponse.Status.SELECTED]
    ).values_list("responding_by_id", flat=True)
    existing_ids = {recipient.id for recipient in recipients}
    for respondent in get_user_model().objects.filter(id__in=respondent_ids, is_active=True):
        if respondent.id not in existing_ids:
            recipients.append(respondent)
            existing_ids.add(respondent.id)
    return recipients


def _close_challenge_for_captain_continuity_locked(challenge, *, invalid_team_ids, now=None, notify=True):
    """Close an unmanaged challenge without touching a separately-owned booking."""
    if challenge.status not in ACTIVE_CHALLENGE_STATUSES:
        return False
    now = now or _now()
    challenge.status = TeamChallenge.Status.CANCELLED
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    recipients = _challenge_recipients_with_respondents(challenge)
    TeamFixture.objects.filter(challenge=challenge).update(
        status=TeamFixture.Status.CANCELLED,
        updated_at=now,
    )
    fixture_id = TeamFixture.objects.filter(challenge=challenge).values_list("id", flat=True).first()
    if fixture_id:
        void_fixture_participation_commitments(fixture_id, actor=None, reason="team_captain_unavailable")
    OpenChallengeResponse.objects.filter(
        challenge=challenge,
        status=OpenChallengeResponse.Status.PENDING,
    ).update(
        status=OpenChallengeResponse.Status.NOT_SELECTED,
        updated_at=now,
    )
    record_event(
        challenge,
        ChallengeEvent.EventType.CANCELLED,
        metadata={
            "reason": "team_captain_unavailable",
            "team_ids": [int(team_id) for team_id in invalid_team_ids],
        },
    )
    _mark_challenge_actions(challenge, recipients, Notification.ActionStatus.CANCELLED)
    if notify:
        notify_challenge_status(
            challenge,
            recipients=recipients,
            title="Team challenge closed",
            message="This team challenge was closed because a participating team no longer has an active captain to manage it. Any separate court booking remains managed through bookings.",
            key_suffix="captain-unavailable",
            notification_type=Notification.NotificationType.MATCH_CANCELLED,
            action_status=Notification.ActionStatus.CANCELLED,
        )
    return True


def synchronize_team_challenge_captains(*, now=None, limit=100, notify=True):
    """Keep active challenges manageable after captain or account changes."""
    now = now or _now()
    challenge_ids = list(
        TeamChallenge.objects.filter(status__in=ACTIVE_CHALLENGE_STATUSES)
        .order_by("id")
        .values_list("id", flat=True)[:limit]
    )
    changed = 0
    for challenge_id in challenge_ids:
        with transaction.atomic():
            challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
                "challenger_team", "challenged_team"
            ).filter(pk=challenge_id).first()
            if not challenge or challenge.status not in ACTIVE_CHALLENGE_STATUSES:
                continue
            invalid_team_ids = []
            if not _active_registered_captain(challenge.challenger_team):
                invalid_team_ids.append(challenge.challenger_team_id)
            if challenge.challenged_team_id and not _active_registered_captain(challenge.challenged_team):
                invalid_team_ids.append(challenge.challenged_team_id)
            if invalid_team_ids and _close_challenge_for_captain_continuity_locked(
                challenge,
                invalid_team_ids=invalid_team_ids,
                now=now,
                notify=notify,
            ):
                changed += 1
    return changed


def expire_team_challenges(*, now=None, limit=100, notify=True):
    now = now or _now()
    continuity_changes = synchronize_team_challenge_captains(now=now, limit=limit, notify=notify)
    # Keep confirmed fixtures aligned with booking status and the venue clock
    # whenever the scheduled maintenance pass runs.
    synchronize_confirmed_team_challenges(now=now, limit=limit, notify=notify)
    expired = continuity_changes
    reconfirmation_ids = list(
        TeamChallenge.objects.filter(
            status=TeamChallenge.Status.RECONFIRMATION_REQUIRED,
            reconfirmation_deadline__isnull=False,
            reconfirmation_deadline__lte=now,
        ).values_list("id", flat=True)[:limit]
    )
    for challenge_id in reconfirmation_ids:
        with transaction.atomic():
            challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related(
                "challenger_team", "challenged_team"
            ).filter(pk=challenge_id).first()
            if not challenge or challenge.status != TeamChallenge.Status.RECONFIRMATION_REQUIRED or not challenge.reconfirmation_deadline or challenge.reconfirmation_deadline > now:
                continue
            if _expire_challenge_reconfirmation_locked(challenge, now=now, notify=notify):
                expired += 1

    response_ids = list(
        TeamChallenge.objects.filter(
            status__in=[TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED],
            response_deadline__lte=now,
        ).values_list("id", flat=True)[:limit]
    )
    for challenge_id in response_ids:
        with transaction.atomic():
            challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team").filter(pk=challenge_id).first()
            if not challenge or challenge.status not in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED] or challenge.response_deadline > now:
                continue
            challenge.status = TeamChallenge.Status.EXPIRED
            challenge.is_public = False
            challenge.save(update_fields=["status", "is_public", "updated_at"])
            record_event(challenge, ChallengeEvent.EventType.EXPIRED, metadata={"reason": "response_deadline"})
            _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.EXPIRED)
            if notify:
                for recipient in _challenge_recipients(challenge):
                    notify_challenge_expired(challenge, recipient=recipient)
            expired += 1

    booking_ids = list(
        TeamChallenge.objects.filter(
            status=TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING,
            booking_deadline__isnull=False,
            booking_deadline__lte=now,
        ).values_list("id", flat=True)[:limit]
    )
    for challenge_id in booking_ids:
        with transaction.atomic():
            challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team").filter(pk=challenge_id).first()
            if not challenge or challenge.status != TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING or not challenge.booking_deadline or challenge.booking_deadline > now:
                continue
            challenge.status = TeamChallenge.Status.EXPIRED
            challenge.is_public = False
            challenge.save(update_fields=["status", "is_public", "updated_at"])
            TeamFixture.objects.filter(challenge=challenge).update(status=TeamFixture.Status.CANCELLED, updated_at=now)
            fixture_id = TeamFixture.objects.filter(challenge=challenge).values_list("id", flat=True).first()
            if fixture_id:
                void_fixture_participation_commitments(fixture_id, actor=None, reason="booking_deadline_expired")
            record_event(challenge, ChallengeEvent.EventType.EXPIRED, metadata={"reason": "booking_deadline"})
            _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.EXPIRED)
            if notify:
                for recipient in _challenge_recipients(challenge):
                    notify_challenge_expired(challenge, recipient=recipient)
            expired += 1
    return expired
