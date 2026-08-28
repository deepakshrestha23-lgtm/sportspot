from datetime import datetime, timedelta

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from matchmaking.services import booking_end_at
from notifications.models import Notification
from notifications.services import mark_related_action_state
from teams.models import Team, TeamMember
from venues.models import Booking
from venues.policies import get_booking_start_at

from .models import (
    ACTIVE_CHALLENGE_STATUSES,
    ChallengeEvent,
    ChallengeProposal,
    OpenChallengeResponse,
    TeamChallenge,
    TeamFixture,
)
from .notifications import (
    notify_challenge_countered,
    notify_challenge_decision,
    notify_challenge_expired,
    notify_challenge_received,
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
        members__status=TeamMember.MemberStatus.ACTIVE,
    ).first()
    if not team:
        raise ValidationError("Only the active team captain can manage team challenges.")
    return team


def _team_captain(team):
    if hasattr(team, "captain"):
        return team.captain
    return Team.objects.select_related("captain").get(pk=team.pk).captain


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
        if not TeamMember.objects.filter(team=challenged_team, user=challenged_team.captain, status=TeamMember.MemberStatus.ACTIVE).exists():
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
            members__user=actor,
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
def select_open_opponent(challenge_id, response_id, actor):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenger_team__captain", "current_proposal").get(pk=challenge_id)
    challenger_team = _captain_team(actor, challenge.challenger_team_id, lock=True)
    if not challenge.is_open_for_opponent_response:
        raise ValidationError("This open challenge cannot select another team now.")
    response = OpenChallengeResponse.objects.select_for_update().select_related("responding_team", "responding_team__captain").filter(
        pk=response_id, challenge=challenge, status=OpenChallengeResponse.Status.PENDING
    ).first()
    if not response:
        raise ValidationError("That team response is no longer available.")
    if not response.responding_team.accepts_team_challenges or not TeamMember.objects.filter(
        team=response.responding_team,
        user_id=response.responding_team.captain_id,
        status=TeamMember.MemberStatus.ACTIVE,
    ).exists():
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
    if challenge.challenger_team and challenge.challenger_team.captain_id == actor.id:
        return challenge.challenger_team
    if challenge.challenged_team and challenge.challenged_team.captain_id == actor.id:
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
    if challenge.status not in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED]:
        raise ValidationError("This challenge is no longer awaiting a decision.")
    if challenge.response_deadline <= _now():
        raise ValidationError("The response deadline for this challenge has passed.")
    if not challenge.challenged_team_id:
        raise ValidationError("Select an opposing team before responding to this challenge.")
    proposal = ChallengeProposal.objects.select_for_update().get(pk=challenge.current_proposal_id)
    if acting_team.pk == challenge.challenger_team_id:
        field = "challenger_decision"
    else:
        field = "challenged_decision"
    if getattr(proposal, field) != ChallengeProposal.Decision.PENDING:
        raise ValidationError("Your team has already responded to this proposal.")
    if action == "DECLINE":
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
    if action != "ACCEPT":
        raise ValidationError("Choose accept or decline.")
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
    if challenge.status not in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED] or challenge.response_deadline <= _now():
        raise ValidationError("This challenge can no longer be countered.")
    if data["court_mode"] != TeamChallenge.CourtMode.PLAN_FIRST:
        raise ValidationError("A booking-first challenge cannot be changed after the court is confirmed.")
    latest = ChallengeProposal.objects.select_for_update().filter(challenge=challenge).order_by("-version").first()
    if not latest:
        raise ValidationError("This challenge has no proposal to update.")
    decision_field = "challenger_decision" if acting_team.pk == challenge.challenger_team_id else "challenged_decision"
    if getattr(latest, decision_field) != ChallengeProposal.Decision.PENDING:
        raise ValidationError("Your team has already responded to this proposal.")
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


@transaction.atomic
def withdraw_challenge(challenge_id, actor):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team").get(pk=challenge_id)
    if challenge.created_by_id != actor.id and challenge.challenger_team.captain_id != actor.id:
        raise ValidationError("Only the challenge creator can withdraw this challenge.")
    if challenge.status not in [TeamChallenge.Status.OPEN, TeamChallenge.Status.COUNTERED]:
        raise ValidationError("This challenge can no longer be withdrawn.")
    if challenge.response_deadline <= _now():
        raise ValidationError("The response deadline for this challenge has passed.")
    challenge.status = TeamChallenge.Status.WITHDRAWN
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    record_event(challenge, ChallengeEvent.EventType.WITHDRAWN, actor=actor, team=challenge.challenger_team)
    _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.CANCELLED)
    opponent = _opponent_captain(challenge, actor)
    if opponent:
        notify_challenge_status(challenge, recipients=[opponent], title="Team challenge withdrawn", message="The challenge creator withdrew this challenge.", actor=actor, key_suffix="withdrawn")
    return challenge


@transaction.atomic
def attach_booking_to_challenge(challenge_id, booking_id, actor):
    # Use the same booking -> challenge lock order as cancellation and
    # maintenance. The challenge is re-checked after the booking is locked.
    booking = validate_challenge_booking(Booking.objects.get(pk=booking_id), actor, lock=True)
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team", "current_proposal").get(pk=challenge_id)
    if challenge.created_by_id != actor.id or challenge.challenger_team.captain_id != actor.id:
        raise ValidationError("Only the challenge creator can confirm its court booking.")
    if challenge.status != TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING or challenge.booking_id:
        raise ValidationError("This challenge is not waiting for a court booking.")
    if challenge.booking_deadline and challenge.booking_deadline <= _now():
        raise ValidationError("The court-booking deadline for this challenge has passed.")
    _validate_plan_booking_matches_proposal(challenge.current_proposal, booking)
    challenge.booking = booking
    challenge.booking_owner = actor
    challenge.status = TeamChallenge.Status.CONFIRMED
    challenge.save(update_fields=["booking", "booking_owner", "status", "updated_at"])
    TeamFixture.objects.update_or_create(challenge=challenge, defaults={"booking": booking, "status": TeamFixture.Status.SCHEDULED})
    record_event(challenge, ChallengeEvent.EventType.BOOKING_CONFIRMED, actor=actor, team=challenge.challenger_team, metadata={"booking_id": booking.id})
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
    TeamFixture.objects.filter(challenge=challenge).update(
        status=TeamFixture.Status.CANCELLED,
        updated_at=now,
    )
    record_event(
        challenge,
        ChallengeEvent.EventType.CANCELLED,
        actor=actor,
        metadata={"reason": reason or "linked_booking_unavailable"},
    )
    _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.CANCELLED)
    if notify:
        notify_challenge_status(
            challenge,
            recipients=_challenge_recipients(challenge),
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


@transaction.atomic
def cancel_challenge(challenge_id, actor):
    challenge = TeamChallenge.objects.select_for_update(of=("self",)).select_related("challenger_team", "challenged_team").get(pk=challenge_id)
    _validate_challenge_action(challenge, actor)
    if challenge.status in [TeamChallenge.Status.CANCELLED, TeamChallenge.Status.COMPLETED, TeamChallenge.Status.DECLINED, TeamChallenge.Status.EXPIRED, TeamChallenge.Status.WITHDRAWN]:
        raise ValidationError("This challenge is already closed.")
    challenge.status = TeamChallenge.Status.CANCELLED
    challenge.is_public = False
    challenge.save(update_fields=["status", "is_public", "updated_at"])
    TeamFixture.objects.filter(challenge=challenge).update(status=TeamFixture.Status.CANCELLED, updated_at=_now())
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


def expire_team_challenges(*, now=None, limit=100, notify=True):
    now = now or _now()
    # Keep confirmed fixtures aligned with booking status and the venue clock
    # whenever the scheduled maintenance pass runs.
    synchronize_confirmed_team_challenges(now=now, limit=limit, notify=notify)
    expired = 0
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
            record_event(challenge, ChallengeEvent.EventType.EXPIRED, metadata={"reason": "booking_deadline"})
            _mark_challenge_actions(challenge, _challenge_recipients(challenge), Notification.ActionStatus.EXPIRED)
            if notify:
                for recipient in _challenge_recipients(challenge):
                    notify_challenge_expired(challenge, recipient=recipient)
            expired += 1
    return expired
