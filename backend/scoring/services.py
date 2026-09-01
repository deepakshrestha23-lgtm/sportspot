from collections import defaultdict
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, Max, Q
from django.utils import timezone

from notifications.models import Notification
from notifications.services import create_notification, mark_related_action_state
from team_challenges.models import TeamChallenge, TeamFixture, TeamFixtureParticipant
from teams.models import Team, TeamMember
from venues.models import Booking

from .models import (
    CricketDelivery,
    CricketInnings,
    CricketMatch,
    CricketPlayerPerformance,
    CricketSquadPlayer,
    ScoringMatchRequest,
)


FIELDER_REQUIRED_WICKETS = {
    CricketDelivery.WicketKind.CAUGHT,
    CricketDelivery.WicketKind.RUN_OUT,
    CricketDelivery.WicketKind.STUMPED,
}
BOWLER_WICKETS = {
    CricketDelivery.WicketKind.BOWLED,
    CricketDelivery.WicketKind.CAUGHT,
    CricketDelivery.WicketKind.LBW,
    CricketDelivery.WicketKind.STUMPED,
    CricketDelivery.WicketKind.HIT_WICKET,
}


def _captain_team_for_scoring(actor, team_id, *, lock=False):
    if not actor or not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        raise ValidationError("Only an active team captain can manage SportSpot Scorer matches.")
    queryset = Team.objects
    if lock:
        queryset = queryset.select_for_update()
    team = queryset.filter(
        pk=team_id,
        captain=actor,
        members__user=actor,
        members__member_type=TeamMember.MemberType.REGISTERED,
        members__status=TeamMember.MemberStatus.ACTIVE,
        captain__is_active=True,
    ).first()
    if not team:
        raise ValidationError("Choose a team that you actively captain.")
    return team


def _team_summary(team):
    return {
        "id": team.id,
        "name": team.name,
        "team_photo": team.team_photo.url if team.team_photo else "",
        "location": team.location,
        "skill_level": team.skill_level,
        "captain_name": team.captain.full_name,
        "active_players": team.members.filter(
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).count(),
    }


def get_scorer_teams(actor, *, search=""):
    """Return captain-owned teams and a compact opponent search result."""
    if not actor or not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        return {"my_teams": [], "opponents": []}
    my_teams = Team.objects.filter(
        captain=actor,
        members__user=actor,
        members__member_type=TeamMember.MemberType.REGISTERED,
        members__status=TeamMember.MemberStatus.ACTIVE,
    ).select_related("captain").distinct().order_by("name", "id")
    opponent_queryset = Team.objects.exclude(captain=actor).filter(
        captain__role="PLAYER",
        captain__is_active=True,
        members__user=F("captain"),
        members__member_type=TeamMember.MemberType.REGISTERED,
        members__status=TeamMember.MemberStatus.ACTIVE,
    ).select_related("captain").distinct()
    normalized_search = str(search or "").strip()
    if normalized_search:
        opponent_queryset = opponent_queryset.filter(
            Q(name__icontains=normalized_search)
            | Q(location__icontains=normalized_search)
            | Q(preferred_playing_area__icontains=normalized_search)
        )
    else:
        opponent_queryset = opponent_queryset.none()
    return {
        "my_teams": [_team_summary(team) for team in my_teams],
        "opponents": [_team_summary(team) for team in opponent_queryset.order_by("name", "id")[:12]],
    }


def _request_snapshot(request, actor):
    return {
        "id": request.id,
        "status": request.status,
        "challenger_team": _team_summary(request.challenger_team),
        "challenged_team": _team_summary(request.challenged_team),
        "requested_by_name": request.requested_by.full_name,
        "fixture_id": request.fixture_id,
        "challenge_id": request.fixture.challenge_id if request.fixture_id else None,
        "created_at": request.created_at,
        "responded_at": request.responded_at,
        "can_accept_or_decline": bool(
            request.status == ScoringMatchRequest.Status.PENDING
            and request.challenged_team.captain_id == getattr(actor, "id", None)
        ),
        "can_cancel": bool(
            request.status == ScoringMatchRequest.Status.PENDING
            and request.requested_by_id == getattr(actor, "id", None)
            and request.challenger_team.captain_id == getattr(actor, "id", None)
        ),
    }


def get_scoring_match_requests(actor):
    if not actor or not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        return {"incoming": [], "outgoing": []}
    incoming = ScoringMatchRequest.objects.filter(
        challenged_team__captain=actor,
        challenged_team__members__user=actor,
        challenged_team__members__member_type=TeamMember.MemberType.REGISTERED,
        challenged_team__members__status=TeamMember.MemberStatus.ACTIVE,
    ).select_related("challenger_team", "challenger_team__captain", "challenged_team", "challenged_team__captain", "requested_by", "fixture").order_by("-updated_at", "-id")
    outgoing = ScoringMatchRequest.objects.filter(
        challenger_team__captain=actor,
        challenger_team__members__user=actor,
        challenger_team__members__member_type=TeamMember.MemberType.REGISTERED,
        challenger_team__members__status=TeamMember.MemberStatus.ACTIVE,
    ).select_related("challenger_team", "challenger_team__captain", "challenged_team", "challenged_team__captain", "requested_by", "fixture").order_by("-updated_at", "-id")
    return {
        "incoming": [_request_snapshot(item, actor) for item in incoming[:20]],
        "outgoing": [_request_snapshot(item, actor) for item in outgoing[:20]],
    }


@transaction.atomic
def send_scoring_match_request(*, actor, challenger_team_id, challenged_team_id, client_request_id=""):
    try:
        challenger_team_id = int(challenger_team_id)
        challenged_team_id = int(challenged_team_id)
    except (TypeError, ValueError):
        raise ValidationError("Choose both teams before sending the scoring request.")
    if challenger_team_id == challenged_team_id:
        raise ValidationError("Choose a different opponent team.")
    teams = list(
        Team.objects.select_for_update().select_related("captain").filter(
            pk__in=[challenger_team_id, challenged_team_id]
        ).order_by("id")
    )
    if len(teams) != 2:
        raise ValidationError("One of those teams is no longer available.")
    challenger_team = next(team for team in teams if team.id == challenger_team_id)
    challenged_team = next(team for team in teams if team.id == challenged_team_id)
    _captain_team_for_scoring(actor, challenger_team.id, lock=True)
    if not TeamMember.objects.filter(
        team=challenged_team,
        user=challenged_team.captain,
        member_type=TeamMember.MemberType.REGISTERED,
        status=TeamMember.MemberStatus.ACTIVE,
    ).exists():
        raise ValidationError("That team does not currently have an active captain who can accept a scored match.")
    normalized_client_id = str(client_request_id or "").strip()[:64]
    if normalized_client_id:
        replay = ScoringMatchRequest.objects.filter(requested_by=actor, client_request_id=normalized_client_id).first()
        if replay:
            return replay, False
    if ScoringMatchRequest.objects.filter(
        Q(challenger_team=challenger_team, challenged_team=challenged_team)
        | Q(challenger_team=challenged_team, challenged_team=challenger_team),
        status=ScoringMatchRequest.Status.PENDING,
    ).exists():
        raise ValidationError("There is already a pending scoring request between these teams.")
    request = ScoringMatchRequest.objects.create(
        challenger_team=challenger_team,
        challenged_team=challenged_team,
        requested_by=actor,
        client_request_id=normalized_client_id,
    )
    create_notification(
        recipient=challenged_team.captain,
        actor=actor,
        notification_type=Notification.NotificationType.SCORING_MATCH_REQUEST_RECEIVED,
        title="Scored match request",
        message=f"{challenger_team.name} wants to start a scored match against {challenged_team.name}.",
        priority=Notification.Priority.IMPORTANT,
        action_url="/scorer",
        related_entity_type="scoring_match_request",
        related_entity_id=request.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"request_id": request.id, "challenger_team_id": challenger_team.id, "challenged_team_id": challenged_team.id},
        deduplication_key=f"scoring-match-request:{request.id}:received",
    )
    return request, True


@transaction.atomic
def accept_scoring_match_request(*, request_id, actor):
    locked_request = ScoringMatchRequest.objects.select_for_update().filter(pk=request_id).first()
    if not locked_request:
        raise ScoringMatchRequest.DoesNotExist
    request = ScoringMatchRequest.objects.select_related(
        "challenger_team", "challenger_team__captain", "challenged_team", "challenged_team__captain", "requested_by", "fixture"
    ).get(pk=locked_request.pk)
    _captain_team_for_scoring(actor, request.challenged_team_id, lock=True)
    if request.status == ScoringMatchRequest.Status.ACCEPTED:
        return request, False
    if request.status != ScoringMatchRequest.Status.PENDING:
        raise ValidationError("This scoring match request is no longer awaiting a decision.")
    challenge = TeamChallenge.objects.create(
        challenger_team=request.challenger_team,
        challenged_team=request.challenged_team,
        created_by=request.requested_by,
        challenge_type=TeamChallenge.ChallengeType.DIRECT,
        court_mode=TeamChallenge.CourtMode.PLAN_FIRST,
        status=TeamChallenge.Status.CONFIRMED,
        source=TeamChallenge.Source.INSTANT_SCORER,
        response_deadline=timezone.now() + timedelta(days=1),
        team_pair_key="",
        is_public=False,
    )
    fixture = TeamFixture.objects.create(challenge=challenge, status=TeamFixture.Status.SCHEDULED)
    request.fixture = fixture
    request.status = ScoringMatchRequest.Status.ACCEPTED
    request.responded_by = actor
    request.responded_at = timezone.now()
    request.save(update_fields=["fixture", "status", "responded_by", "responded_at", "updated_at"])
    mark_related_action_state(
        recipient=actor,
        related_entity_type="scoring_match_request",
        related_entity_id=request.id,
        action_status=Notification.ActionStatus.ACCEPTED,
    )
    create_notification(
        recipient=request.requested_by,
        actor=actor,
        notification_type=Notification.NotificationType.SCORING_MATCH_REQUEST_ACCEPTED,
        title="Scored match ready",
        message=f"{request.challenged_team.name} accepted. Confirm squads and start scoring when both teams are ready.",
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/challenge-teams/{challenge.id}/scorer",
        related_entity_type="scoring_match_request",
        related_entity_id=request.id,
        metadata={"request_id": request.id, "fixture_id": fixture.id, "challenge_id": challenge.id},
        deduplication_key=f"scoring-match-request:{request.id}:accepted",
    )
    return request, True


@transaction.atomic
def decline_scoring_match_request(*, request_id, actor):
    request = ScoringMatchRequest.objects.select_for_update().select_related(
        "challenger_team", "challenger_team__captain", "challenged_team", "challenged_team__captain", "requested_by"
    ).filter(pk=request_id).first()
    if not request:
        raise ScoringMatchRequest.DoesNotExist
    _captain_team_for_scoring(actor, request.challenged_team_id, lock=True)
    if request.status != ScoringMatchRequest.Status.PENDING:
        raise ValidationError("This scoring match request is no longer awaiting a decision.")
    request.status = ScoringMatchRequest.Status.DECLINED
    request.responded_by = actor
    request.responded_at = timezone.now()
    request.save(update_fields=["status", "responded_by", "responded_at", "updated_at"])
    mark_related_action_state(
        recipient=actor,
        related_entity_type="scoring_match_request",
        related_entity_id=request.id,
        action_status=Notification.ActionStatus.REJECTED,
    )
    create_notification(
        recipient=request.requested_by,
        actor=actor,
        notification_type=Notification.NotificationType.SCORING_MATCH_REQUEST_DECLINED,
        title="Scored match request declined",
        message=f"{request.challenged_team.name} cannot start a scored match right now.",
        action_url="/scorer",
        related_entity_type="scoring_match_request",
        related_entity_id=request.id,
        metadata={"request_id": request.id},
        deduplication_key=f"scoring-match-request:{request.id}:declined",
    )
    return request


@transaction.atomic
def cancel_scoring_match_request(*, request_id, actor):
    request = ScoringMatchRequest.objects.select_for_update().select_related(
        "challenger_team", "challenger_team__captain", "challenged_team", "challenged_team__captain", "requested_by"
    ).filter(pk=request_id).first()
    if not request:
        raise ScoringMatchRequest.DoesNotExist
    _captain_team_for_scoring(actor, request.challenger_team_id, lock=True)
    if request.requested_by_id != getattr(actor, "id", None):
        raise ValidationError("Only the captain who sent this request can withdraw it.")
    if request.status != ScoringMatchRequest.Status.PENDING:
        raise ValidationError("This scoring match request can no longer be withdrawn.")
    request.status = ScoringMatchRequest.Status.CANCELLED
    request.responded_by = actor
    request.responded_at = timezone.now()
    request.save(update_fields=["status", "responded_by", "responded_at", "updated_at"])
    mark_related_action_state(
        recipient=request.challenged_team.captain,
        related_entity_type="scoring_match_request",
        related_entity_id=request.id,
        action_status=Notification.ActionStatus.CANCELLED,
    )
    return request


def _fixture_for_scoring(fixture_id):
    return TeamFixture.objects.select_for_update(of=("self",)).select_related(
        "challenge",
        "challenge__challenger_team",
        "challenge__challenged_team",
        "challenge__challenger_team__captain",
        "challenge__challenged_team__captain",
    ).get(pk=fixture_id)


def _team_ids(fixture):
    return {fixture.challenge.challenger_team_id, fixture.challenge.challenged_team_id}


def _captain_team(fixture, actor):
    if not actor or not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        return None
    for team in (fixture.challenge.challenger_team, fixture.challenge.challenged_team):
        if team and team.captain_id == actor.id:
            return team
    return None


def _is_fixture_viewer(fixture, actor):
    if _captain_team(fixture, actor):
        return True
    return bool(
        actor
        and getattr(actor, "is_authenticated", False)
        and TeamFixtureParticipant.objects.filter(
            fixture=fixture,
            player=actor,
            status__in=[
                TeamFixtureParticipant.Status.SELECTED,
                TeamFixtureParticipant.Status.ATTENDED,
                TeamFixtureParticipant.Status.ABSENT,
                TeamFixtureParticipant.Status.UNVERIFIED,
            ],
        ).exists()
    )


def _require_fixture_viewer(fixture, actor):
    if not _is_fixture_viewer(fixture, actor):
        raise ValidationError("You are not authorised to view this team match scorecard.")


def _get_match(fixture, *, lock=False):
    queryset = CricketMatch.objects
    if lock:
        queryset = queryset.select_for_update(of=("self",))
    return queryset.select_related(
        "fixture",
        "fixture__challenge",
        "fixture__challenge__challenger_team",
        "fixture__challenge__challenged_team",
        "toss_winner",
        "first_batting_team",
        "second_batting_team",
        "scorer",
    ).filter(fixture=fixture).first()


def get_scoring_permissions(match, actor):
    fixture = match.fixture
    captain_team = _captain_team(fixture, actor)
    is_captain = bool(captain_team)
    # Scorecards created before scorer assignment existed had no scorer saved.
    # Their creator is the sole compatible operator until a captain appoints
    # someone else during setup.
    is_assigned_scorer = bool(
        actor
        and (
            match.scorer_id == getattr(actor, "id", None)
            or (match.scorer_id is None and match.created_by_id == getattr(actor, "id", None))
        )
    )
    can_view = _is_fixture_viewer(fixture, actor)
    return {
        "can_view": can_view,
        "is_captain": is_captain,
        "team_id": captain_team.id if captain_team else None,
        "is_assigned_scorer": is_assigned_scorer,
        # A scorecard has exactly one active scorer. Captains retain setup and
        # transfer authority, but cannot race each other on live ball events.
        "can_score": is_assigned_scorer,
        "can_confirm_squad": bool(is_captain and match.status == CricketMatch.Status.SETUP),
        "can_assign_scorer": bool(is_captain and match.status == CricketMatch.Status.SETUP),
    }


def _require_scorer(match, actor):
    permissions = get_scoring_permissions(match, actor)
    if not permissions["can_score"]:
        raise ValidationError("Only the appointed scorer can operate SportSpot Scorer.")
    return permissions


def _team_confirmation_fields(match, team_id):
    fixture = match.fixture
    if team_id == fixture.challenge.challenger_team_id:
        return "challenger_squad_confirmed_by", "challenger_squad_confirmed_at"
    if team_id == fixture.challenge.challenged_team_id:
        return "challenged_squad_confirmed_by", "challenged_squad_confirmed_at"
    raise ValidationError("This team is not part of the confirmed match.")


def _squad_is_confirmed(match, team_id):
    confirmed_by, _confirmed_at = _team_confirmation_fields(match, team_id)
    return bool(getattr(match, f"{confirmed_by}_id"))


def _require_confirmed_squads(match):
    fixture = match.fixture
    team_ids = _team_ids(fixture)
    if not all(_squad_is_confirmed(match, team_id) for team_id in team_ids):
        raise ValidationError("Each team captain must confirm the players who are taking part before the toss.")
    for team_id in team_ids:
        if CricketSquadPlayer.objects.filter(match=match, team_id=team_id).count() < 2:
            raise ValidationError("Each team needs at least two selected players to start scoring.")


@transaction.atomic
def create_or_update_scorecard(fixture_id, actor, overs_per_innings):
    fixture = _fixture_for_scoring(fixture_id)
    if not _captain_team(fixture, actor):
        raise ValidationError("Only a team captain can set up SportSpot Scorer.")
    if fixture.status not in {TeamFixture.Status.SCHEDULED, TeamFixture.Status.IN_PROGRESS}:
        raise ValidationError("SportSpot Scorer can be set up for a confirmed match before it is completed.")
    is_instant_scorer_match = fixture.challenge.is_instant_scorer_match
    booking_ready = bool(
        fixture.booking_id
        and fixture.challenge.status == TeamChallenge.Status.CONFIRMED
        and fixture.booking.status in {Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED}
        and fixture.booking.payment_status == Booking.PaymentStatus.PAID
    )
    if not is_instant_scorer_match and not booking_ready:
        raise ValidationError("A paid, confirmed court booking is required before scoring can be set up.")
    if fixture.result_confirmed_at:
        raise ValidationError("This match result is already confirmed and cannot be replaced with a scorecard.")
    try:
        overs = int(overs_per_innings)
    except (TypeError, ValueError):
        raise ValidationError("Choose the number of overs for each innings.")
    if overs < 1 or overs > 50:
        raise ValidationError("Choose between 1 and 50 overs per innings.")

    match = _get_match(fixture, lock=True)
    if match:
        if match.status != CricketMatch.Status.SETUP:
            if match.overs_per_innings != overs:
                raise ValidationError("Overs cannot be changed after the toss.")
            return match
        match.overs_per_innings = overs
        match.save(update_fields=["overs_per_innings", "updated_at"])
        return match
    return CricketMatch.objects.create(
        fixture=fixture,
        overs_per_innings=overs,
        scorer=actor,
        created_by=actor,
    )


@transaction.atomic
def confirm_team_squad(fixture_id, actor, player_ids):
    fixture = _fixture_for_scoring(fixture_id)
    acting_team = _captain_team(fixture, actor)
    if not acting_team:
        raise ValidationError("Only your team captain can confirm this match squad.")
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("Set up SportSpot Scorer before confirming players.")
    if match.status != CricketMatch.Status.SETUP or match.toss_winner_id:
        raise ValidationError("Match squads are locked once the toss is recorded.")
    normalized_ids = []
    for value in player_ids or []:
        try:
            player_id = int(value)
        except (TypeError, ValueError):
            continue
        if player_id not in normalized_ids:
            normalized_ids.append(player_id)
    if len(normalized_ids) < 2:
        raise ValidationError("Select at least two players from your team.")
    if fixture.challenge.is_instant_scorer_match:
        active_players = list(
            TeamMember.objects.select_for_update().filter(
                team=acting_team,
                user_id__in=normalized_ids,
                member_type=TeamMember.MemberType.REGISTERED,
                status=TeamMember.MemberStatus.ACTIVE,
            ).select_related("user")
        )
        if len(active_players) != len(normalized_ids):
            raise ValidationError("Choose active registered players from your own team.")
        if TeamFixtureParticipant.objects.filter(
            fixture=fixture,
            player_id__in=normalized_ids,
        ).exclude(team=acting_team).exists():
            raise ValidationError("A player cannot be selected for both teams in the same match.")
        CricketSquadPlayer.objects.filter(match=match, team=acting_team).delete()
        TeamFixtureParticipant.objects.filter(fixture=fixture, team=acting_team).delete()
        member_by_player = {member.user_id: member for member in active_players}
        participants = [
            TeamFixtureParticipant.objects.create(
                fixture=fixture,
                team=acting_team,
                player=member_by_player[player_id].user,
                selected_by=actor,
            )
            for player_id in normalized_ids
        ]
    else:
        participants = list(
            TeamFixtureParticipant.objects.select_for_update().filter(
                fixture=fixture,
                team=acting_team,
                player_id__in=normalized_ids,
                status=TeamFixtureParticipant.Status.SELECTED,
            ).select_related("player")
        )
        if len(participants) != len(normalized_ids):
            raise ValidationError("Only currently selected players from your own fixture lineup can be used.")
        CricketSquadPlayer.objects.filter(match=match, team=acting_team).delete()
    participant_by_player = {participant.player_id: participant for participant in participants}
    rows = []
    for index, player_id in enumerate(normalized_ids, start=1):
        participant = participant_by_player[player_id]
        rows.append(CricketSquadPlayer(
            match=match,
            team=acting_team,
            player=participant.player,
            fixture_participant=participant,
            display_name=participant.player.full_name,
            batting_order=index,
        ))
    CricketSquadPlayer.objects.bulk_create(rows)
    confirmed_by, confirmed_at = _team_confirmation_fields(match, acting_team.id)
    setattr(match, confirmed_by, actor)
    setattr(match, confirmed_at, timezone.now())
    match.save(update_fields=[confirmed_by, confirmed_at, "updated_at"])
    return match


@transaction.atomic
def assign_scorer(fixture_id, actor, scorer_id):
    fixture = _fixture_for_scoring(fixture_id)
    if not _captain_team(fixture, actor):
        raise ValidationError("Only a team captain can appoint a scorer.")
    match = _get_match(fixture, lock=True)
    if not match or match.status != CricketMatch.Status.SETUP:
        raise ValidationError("A scorer can only be appointed before the toss.")
    _require_confirmed_squads(match)
    scorer = get_user_model().objects.filter(pk=scorer_id, role="PLAYER", is_active=True).first()
    if not scorer or not CricketSquadPlayer.objects.filter(match=match, player=scorer).exists():
        raise ValidationError("Choose a player from one of the confirmed match squads.")
    match.scorer = scorer
    match.save(update_fields=["scorer", "updated_at"])
    return match


@transaction.atomic
def record_toss(fixture_id, actor, winner_team_id, decision):
    fixture = _fixture_for_scoring(fixture_id)
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("Set up SportSpot Scorer before recording the toss.")
    _require_scorer(match, actor)
    if match.status != CricketMatch.Status.SETUP:
        raise ValidationError("The toss is locked after the first innings starts.")
    _require_confirmed_squads(match)
    try:
        winner_id = int(winner_team_id)
    except (TypeError, ValueError):
        raise ValidationError("Choose the team that won the toss.")
    if winner_id not in _team_ids(fixture):
        raise ValidationError("Choose one of the teams in this match.")
    normalized_decision = str(decision or "").upper()
    if normalized_decision not in {CricketMatch.TossDecision.BAT, CricketMatch.TossDecision.BOWL}:
        raise ValidationError("Choose whether the toss winner will bat or bowl.")
    other_team_id = next(team_id for team_id in _team_ids(fixture) if team_id != winner_id)
    first_batting_team_id = winner_id if normalized_decision == CricketMatch.TossDecision.BAT else other_team_id
    match.toss_winner_id = winner_id
    match.toss_decision = normalized_decision
    match.first_batting_team_id = first_batting_team_id
    match.second_batting_team_id = other_team_id if first_batting_team_id == winner_id else winner_id
    match.save(update_fields=[
        "toss_winner", "toss_decision", "first_batting_team", "second_batting_team", "updated_at",
    ])
    return match


def _squad_player(match, player_id, team_id, field_label):
    player = CricketSquadPlayer.objects.filter(match=match, pk=player_id, team_id=team_id).first()
    if not player:
        raise ValidationError(f"Choose a confirmed {field_label} from the correct team.")
    return player


@transaction.atomic
def start_innings(fixture_id, actor, striker_id, non_striker_id, bowler_id):
    fixture = _fixture_for_scoring(fixture_id)
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("Set up SportSpot Scorer before starting an innings.")
    _require_scorer(match, actor)
    _require_confirmed_squads(match)
    existing = list(CricketInnings.objects.select_for_update().filter(match=match).order_by("number"))
    if not existing:
        if not match.first_batting_team_id:
            raise ValidationError("Record the toss before starting the first innings.")
        if match.status != CricketMatch.Status.SETUP:
            raise ValidationError("The first innings is not ready to start.")
        number = 1
        batting_team_id = match.first_batting_team_id
        bowling_team_id = match.second_batting_team_id
        target_runs = None
    elif len(existing) == 1:
        first_innings = existing[0]
        if match.status != CricketMatch.Status.INNINGS_BREAK or first_innings.status != CricketInnings.Status.COMPLETED:
            raise ValidationError("Finish the first innings before starting the chase.")
        number = 2
        batting_team_id = match.second_batting_team_id
        bowling_team_id = match.first_batting_team_id
        target_runs = first_innings.total_runs + 1
    else:
        raise ValidationError("Both innings have already been configured.")
    striker = _squad_player(match, striker_id, batting_team_id, "opening batter")
    non_striker = _squad_player(match, non_striker_id, batting_team_id, "opening batter")
    if striker.id == non_striker.id:
        raise ValidationError("Choose two different opening batters.")
    bowler = _squad_player(match, bowler_id, bowling_team_id, "opening bowler")
    innings = CricketInnings.objects.create(
        match=match,
        number=number,
        batting_team_id=batting_team_id,
        bowling_team_id=bowling_team_id,
        target_runs=target_runs,
        opening_striker=striker,
        opening_non_striker=non_striker,
        opening_bowler=bowler,
        current_striker=striker,
        current_non_striker=non_striker,
        current_bowler=bowler,
    )
    match.status = CricketMatch.Status.INNINGS_ONE if number == 1 else CricketMatch.Status.INNINGS_TWO
    match.save(update_fields=["status", "updated_at"])
    if fixture.status == TeamFixture.Status.SCHEDULED:
        fixture.status = TeamFixture.Status.IN_PROGRESS
        fixture.save(update_fields=["status", "updated_at"])
    return innings


def _normalise_delivery_payload(payload):
    try:
        runs_off_bat = int(payload.get("runs_off_bat", 0))
        extra_runs = int(payload.get("extra_runs", 0))
    except (TypeError, ValueError):
        raise ValidationError("Runs must be whole numbers.")
    if runs_off_bat < 0 or runs_off_bat > 6 or extra_runs < 0 or extra_runs > 7:
        raise ValidationError("Enter a valid number of runs for this ball.")
    extra_type = str(payload.get("extra_type") or CricketDelivery.ExtraType.NONE).upper()
    wicket_kind = str(payload.get("wicket_kind") or CricketDelivery.WicketKind.NONE).upper()
    if extra_type not in CricketDelivery.ExtraType.values:
        raise ValidationError("Choose a valid extra type.")
    if wicket_kind not in CricketDelivery.WicketKind.values:
        raise ValidationError("Choose a valid wicket type.")
    if extra_type == CricketDelivery.ExtraType.NONE:
        extra_runs = 0
    elif not extra_runs:
        raise ValidationError("Choose the runs for this extra.")
    if extra_type in {CricketDelivery.ExtraType.WIDE, CricketDelivery.ExtraType.BYE, CricketDelivery.ExtraType.LEG_BYE} and runs_off_bat:
        raise ValidationError("These extras cannot include runs off the bat.")
    return {
        "runs_off_bat": runs_off_bat,
        "extra_type": extra_type,
        "extra_runs": extra_runs,
        "wicket_kind": wicket_kind,
        "dismissed_player_id": payload.get("dismissed_player_id") or None,
        "fielder_id": payload.get("fielder_id") or None,
        "incoming_batsman_id": payload.get("incoming_batsman_id") or None,
    }


def _current_innings(match):
    innings = CricketInnings.objects.select_for_update().filter(
        match=match,
        status=CricketInnings.Status.IN_PROGRESS,
    ).order_by("-number").first()
    if not innings:
        raise ValidationError("There is no active innings to score.")
    if not innings.current_striker_id or not innings.current_non_striker_id or not innings.current_bowler_id:
        raise ValidationError("Choose the next bowler before scoring another ball.")
    return innings


def _dismissed_player_ids(innings):
    return set(
        CricketDelivery.objects.filter(
            innings=innings,
            is_active=True,
        ).exclude(wicket_kind=CricketDelivery.WicketKind.NONE).values_list("dismissed_player_id", flat=True)
    )


def _validate_wicket(innings, values):
    wicket_kind = values["wicket_kind"]
    if wicket_kind == CricketDelivery.WicketKind.NONE:
        if values["dismissed_player_id"] or values["fielder_id"] or values["incoming_batsman_id"]:
            raise ValidationError("Wicket details can only be added to a wicket ball.")
        return None, None, None
    if values["extra_type"] == CricketDelivery.ExtraType.NO_BALL and wicket_kind != CricketDelivery.WicketKind.RUN_OUT:
        raise ValidationError("Only a run out can be recorded from a no ball in this scorer.")
    dismissed_id = values["dismissed_player_id"]
    if dismissed_id not in {innings.current_striker_id, innings.current_non_striker_id}:
        raise ValidationError("Choose the striker or non-striker as the dismissed batter.")
    dismissed = CricketSquadPlayer.objects.filter(
        match=innings.match,
        pk=dismissed_id,
        team_id=innings.batting_team_id,
    ).first()
    if not dismissed:
        raise ValidationError("Choose a valid dismissed batter.")
    fielder = None
    if values["fielder_id"]:
        fielder = CricketSquadPlayer.objects.filter(
            match=innings.match,
            pk=values["fielder_id"],
            team_id=innings.bowling_team_id,
        ).first()
        if not fielder:
            raise ValidationError("Choose a fielder from the bowling team.")
    if wicket_kind in FIELDER_REQUIRED_WICKETS and not fielder:
        raise ValidationError("Choose the relevant fielder for this dismissal.")
    squad_count = CricketSquadPlayer.objects.filter(match=innings.match, team_id=innings.batting_team_id).count()
    wickets_after = innings.wickets + 1
    incoming = None
    if wickets_after < squad_count - 1:
        incoming_id = values["incoming_batsman_id"]
        unavailable = _dismissed_player_ids(innings) | {innings.current_striker_id, innings.current_non_striker_id}
        if not incoming_id:
            raise ValidationError("Choose the next batter before recording this wicket.")
        incoming = CricketSquadPlayer.objects.filter(
            match=innings.match,
            pk=incoming_id,
            team_id=innings.batting_team_id,
        ).exclude(pk__in=unavailable).first()
        if not incoming:
            raise ValidationError("Choose a batter who has not already batted or been dismissed.")
    elif values["incoming_batsman_id"]:
        raise ValidationError("No next batter is needed after the final wicket.")
    return dismissed, fielder, incoming


def _delivery_running_runs(delivery):
    if delivery.extra_type == CricketDelivery.ExtraType.WIDE:
        return max(delivery.extra_runs - 1, 0)
    if delivery.extra_type in {CricketDelivery.ExtraType.BYE, CricketDelivery.ExtraType.LEG_BYE}:
        return delivery.extra_runs
    return delivery.runs_off_bat


def _delivery_total_runs(delivery):
    return delivery.runs_off_bat + delivery.extra_runs


def _delivery_is_legal(delivery):
    return delivery.extra_type not in {CricketDelivery.ExtraType.WIDE, CricketDelivery.ExtraType.NO_BALL}


def _active_deliveries(innings):
    return list(
        CricketDelivery.objects.filter(innings=innings, is_active=True).select_related(
            "striker", "non_striker", "bowler", "dismissed_player", "incoming_batsman"
        ).order_by("sequence", "id")
    )


def _format_overs(legal_balls):
    return f"{legal_balls // 6}.{legal_balls % 6}"


def _result_for_match(match, first, second):
    if second.total_runs >= second.target_runs:
        squad_size = CricketSquadPlayer.objects.filter(match=match, team=second.batting_team).count()
        wickets_remaining = max(squad_size - 1 - second.wickets, 0)
        wicket_label = "wicket" if wickets_remaining == 1 else "wickets"
        return f"{second.batting_team.name} won by {wickets_remaining} {wicket_label}"
    if second.total_runs == first.total_runs:
        return "Match tied"
    margin = first.total_runs - second.total_runs
    run_label = "run" if margin == 1 else "runs"
    return f"{first.batting_team.name} won by {margin} {run_label}"


def _rebuild_player_performances(match):
    """Persist finalized cricket-only stats from the immutable ball log."""
    rows = {
        squad.player_id: {
            "player": squad.player,
            "team": squad.team,
            "runs": 0,
            "balls_faced": 0,
            "fours": 0,
            "sixes": 0,
            "balls_bowled": 0,
            "runs_conceded": 0,
            "wickets": 0,
            "wides": 0,
            "no_balls": 0,
            "catches": 0,
            "run_outs": 0,
            "stumpings": 0,
        }
        for squad in CricketSquadPlayer.objects.filter(match=match).select_related("player", "team")
    }
    deliveries = CricketDelivery.objects.filter(
        innings__match=match,
        is_active=True,
    ).select_related("striker", "bowler", "fielder")
    for delivery in deliveries:
        batter = rows[delivery.striker.player_id]
        bowler = rows[delivery.bowler.player_id]
        batter["runs"] += delivery.runs_off_bat
        if _delivery_is_legal(delivery):
            batter["balls_faced"] += 1
            bowler["balls_bowled"] += 1
        if delivery.runs_off_bat == 4:
            batter["fours"] += 1
        elif delivery.runs_off_bat == 6:
            batter["sixes"] += 1
        if delivery.extra_type == CricketDelivery.ExtraType.WIDE:
            bowler["wides"] += delivery.extra_runs
        elif delivery.extra_type == CricketDelivery.ExtraType.NO_BALL:
            bowler["no_balls"] += delivery.extra_runs
        if delivery.extra_type not in {CricketDelivery.ExtraType.BYE, CricketDelivery.ExtraType.LEG_BYE}:
            bowler["runs_conceded"] += _delivery_total_runs(delivery)
        if delivery.wicket_kind in BOWLER_WICKETS:
            bowler["wickets"] += 1
        if delivery.fielder_id:
            fielder = rows[delivery.fielder.player_id]
            if delivery.wicket_kind == CricketDelivery.WicketKind.CAUGHT:
                fielder["catches"] += 1
            elif delivery.wicket_kind == CricketDelivery.WicketKind.RUN_OUT:
                fielder["run_outs"] += 1
            elif delivery.wicket_kind == CricketDelivery.WicketKind.STUMPED:
                fielder["stumpings"] += 1
    for player_id, values in rows.items():
        CricketPlayerPerformance.objects.update_or_create(
            match=match,
            player_id=player_id,
            defaults=values,
        )


def _finalize_match(match, actor):
    innings = list(match.innings.select_related("batting_team").order_by("number"))
    if len(innings) != 2:
        return
    first, second = innings
    match.status = CricketMatch.Status.COMPLETED
    match.result = _result_for_match(match, first, second)
    match.completed_by = actor
    match.completed_at = timezone.now()
    match.save(update_fields=["status", "result", "completed_by", "completed_at", "updated_at"])
    fixture = match.fixture
    fixture.result = match.result
    fixture.status = TeamFixture.Status.COMPLETED
    fixture.save(update_fields=["result", "status", "updated_at"])
    challenge = fixture.challenge
    if challenge.status == TeamChallenge.Status.CONFIRMED:
        challenge.status = TeamChallenge.Status.COMPLETED
        challenge.save(update_fields=["status", "updated_at"])
    _rebuild_player_performances(match)


def _rebuild_innings(innings, actor):
    """Replay active events to make every correction deterministic and auditable."""
    deliveries = _active_deliveries(innings)
    striker_id = innings.opening_striker_id
    non_striker_id = innings.opening_non_striker_id
    bowler_id = innings.opening_bowler_id
    total_runs = wickets = legal_balls = 0
    wide_runs = no_ball_runs = bye_runs = leg_bye_runs = 0
    partnership_runs = partnership_balls = 0
    last_over_bowler_id = None
    squad_count = CricketSquadPlayer.objects.filter(match=innings.match, team_id=innings.batting_team_id).count()

    for delivery in deliveries:
        if delivery.striker_id != striker_id or delivery.non_striker_id != non_striker_id:
            raise ValidationError("The scorecard history is inconsistent. Use the controlled correction flow for the latest ball.")
        if bowler_id and delivery.bowler_id != bowler_id:
            raise ValidationError("Choose the next bowler before scoring this ball.")
        if not bowler_id and delivery.bowler_id == last_over_bowler_id:
            raise ValidationError("The same bowler cannot bowl consecutive overs.")
        bowler_id = delivery.bowler_id
        total_runs += _delivery_total_runs(delivery)
        partnership_runs += _delivery_total_runs(delivery)
        if delivery.extra_type == CricketDelivery.ExtraType.WIDE:
            wide_runs += delivery.extra_runs
        elif delivery.extra_type == CricketDelivery.ExtraType.NO_BALL:
            no_ball_runs += delivery.extra_runs
        elif delivery.extra_type == CricketDelivery.ExtraType.BYE:
            bye_runs += delivery.extra_runs
        elif delivery.extra_type == CricketDelivery.ExtraType.LEG_BYE:
            leg_bye_runs += delivery.extra_runs
        legal = _delivery_is_legal(delivery)
        if legal:
            legal_balls += 1
            partnership_balls += 1

        next_striker_id, next_non_striker_id = striker_id, non_striker_id
        if _delivery_running_runs(delivery) % 2:
            next_striker_id, next_non_striker_id = next_non_striker_id, next_striker_id
        if delivery.wicket_kind != CricketDelivery.WicketKind.NONE:
            wickets += 1
            if delivery.dismissed_player_id == next_striker_id:
                next_striker_id = delivery.incoming_batsman_id
            elif delivery.dismissed_player_id == next_non_striker_id:
                next_non_striker_id = delivery.incoming_batsman_id
            else:
                raise ValidationError("The dismissed batter must be one of the active batters.")
            partnership_runs = partnership_balls = 0
        over_finished = bool(legal and legal_balls % 6 == 0)
        if over_finished and wickets < squad_count - 1:
            next_striker_id, next_non_striker_id = next_non_striker_id, next_striker_id
            last_over_bowler_id = bowler_id
            bowler_id = None
        striker_id, non_striker_id = next_striker_id, next_non_striker_id

    closing_reason = ""
    if wickets >= squad_count - 1:
        closing_reason = CricketInnings.ClosingReason.ALL_OUT
    elif legal_balls >= innings.match.overs_per_innings * 6:
        closing_reason = CricketInnings.ClosingReason.OVERS_COMPLETE
    elif innings.target_runs and total_runs >= innings.target_runs:
        closing_reason = CricketInnings.ClosingReason.TARGET_REACHED
    is_complete = bool(closing_reason)
    innings.total_runs = total_runs
    innings.wickets = wickets
    innings.legal_balls = legal_balls
    innings.wide_runs = wide_runs
    innings.no_ball_runs = no_ball_runs
    innings.bye_runs = bye_runs
    innings.leg_bye_runs = leg_bye_runs
    innings.status = CricketInnings.Status.COMPLETED if is_complete else CricketInnings.Status.IN_PROGRESS
    innings.closing_reason = closing_reason
    innings.completed_at = timezone.now() if is_complete else None
    innings.current_striker_id = None if is_complete else striker_id
    innings.current_non_striker_id = None if is_complete else non_striker_id
    innings.current_bowler_id = None if is_complete else bowler_id
    innings.save(update_fields=[
        "total_runs", "wickets", "legal_balls", "wide_runs", "no_ball_runs", "bye_runs", "leg_bye_runs",
        "status", "closing_reason", "completed_at", "current_striker", "current_non_striker", "current_bowler", "updated_at",
    ])
    match = innings.match
    if is_complete:
        if innings.number == 1:
            match.status = CricketMatch.Status.INNINGS_BREAK
            match.save(update_fields=["status", "updated_at"])
        else:
            _finalize_match(match, actor)
    return innings


def _reopen_for_correction(match):
    innings = match.innings.select_for_update().filter(status=CricketInnings.Status.COMPLETED).order_by("-number").first()
    if not innings:
        return None
    if match.fixture.result_confirmed_at:
        raise ValidationError("The scorecard cannot be changed after both captains confirm the result.")
    if innings.number == 1 and CricketInnings.objects.filter(match=match, number=2).exists():
        raise ValidationError("The first innings cannot be changed after the chase has started.")
    match.status = CricketMatch.Status.INNINGS_ONE if innings.number == 1 else CricketMatch.Status.INNINGS_TWO
    match.result = ""
    match.completed_by = None
    match.completed_at = None
    match.save(update_fields=["status", "result", "completed_by", "completed_at", "updated_at"])
    CricketPlayerPerformance.objects.filter(match=match).delete()
    fixture = match.fixture
    fixture.result = ""
    fixture.result_submitted_by = None
    fixture.result_submitted_at = None
    fixture.result_confirmed_by = None
    fixture.result_confirmed_at = None
    fixture.save(update_fields=[
        "result", "result_submitted_by", "result_submitted_at", "result_confirmed_by", "result_confirmed_at", "updated_at",
    ])
    innings.status = CricketInnings.Status.IN_PROGRESS
    innings.closing_reason = ""
    innings.completed_at = None
    # A completed innings intentionally clears these fields. Restore the exact
    # pre-delivery state so undo/edit can remove the last auditable event and
    # replay the remaining log inside this transaction.
    last_delivery = CricketDelivery.objects.filter(
        innings=innings,
        is_active=True,
    ).order_by("-sequence", "-id").first()
    innings.current_striker_id = last_delivery.striker_id if last_delivery else innings.opening_striker_id
    innings.current_non_striker_id = last_delivery.non_striker_id if last_delivery else innings.opening_non_striker_id
    innings.current_bowler_id = last_delivery.bowler_id if last_delivery else innings.opening_bowler_id
    innings.save(update_fields=[
        "status", "closing_reason", "completed_at", "current_striker", "current_non_striker", "current_bowler", "updated_at",
    ])
    return innings


def _append_delivery(match, actor, payload, *, supersedes=None):
    innings = _current_innings(match)
    values = _normalise_delivery_payload(payload)
    dismissed, fielder, incoming = _validate_wicket(innings, values)
    sequence = (CricketDelivery.objects.filter(innings=innings).aggregate(maximum=Max("sequence"))["maximum"] or 0) + 1
    delivery = CricketDelivery(
        innings=innings,
        sequence=sequence,
        striker_id=innings.current_striker_id,
        non_striker_id=innings.current_non_striker_id,
        bowler_id=innings.current_bowler_id,
        runs_off_bat=values["runs_off_bat"],
        extra_type=values["extra_type"],
        extra_runs=values["extra_runs"],
        wicket_kind=values["wicket_kind"],
        dismissed_player=dismissed,
        fielder=fielder,
        incoming_batsman=incoming,
        supersedes=supersedes,
        created_by=actor,
    )
    delivery.full_clean()
    delivery.save()
    _rebuild_innings(innings, actor)
    return delivery


@transaction.atomic
def record_delivery(fixture_id, actor, payload):
    fixture = _fixture_for_scoring(fixture_id)
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("Set up SportSpot Scorer before recording a ball.")
    _require_scorer(match, actor)
    if match.status not in {CricketMatch.Status.INNINGS_ONE, CricketMatch.Status.INNINGS_TWO}:
        raise ValidationError("Start an innings before recording a ball.")
    return _append_delivery(match, actor, payload)


@transaction.atomic
def choose_next_bowler(fixture_id, actor, bowler_id):
    fixture = _fixture_for_scoring(fixture_id)
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("This scorecard is not available.")
    _require_scorer(match, actor)
    innings = CricketInnings.objects.select_for_update().filter(
        match=match,
        status=CricketInnings.Status.IN_PROGRESS,
    ).order_by("-number").first()
    if not innings:
        raise ValidationError("There is no active innings to score.")
    if innings.legal_balls == 0 or innings.legal_balls % 6:
        raise ValidationError("Choose a new bowler after a completed over.")
    previous_bowler_id = CricketDelivery.objects.filter(
        innings=innings,
        is_active=True,
        extra_type__in=[
            CricketDelivery.ExtraType.NONE,
            CricketDelivery.ExtraType.BYE,
            CricketDelivery.ExtraType.LEG_BYE,
        ],
    ).order_by("-sequence").values_list("bowler_id", flat=True).first()
    bowler = _squad_player(match, bowler_id, innings.bowling_team_id, "bowler")
    if bowler.id == previous_bowler_id:
        raise ValidationError("Choose a different bowler for the next over.")
    innings.current_bowler = bowler
    innings.save(update_fields=["current_bowler", "updated_at"])
    return innings


@transaction.atomic
def undo_last_delivery(fixture_id, actor):
    fixture = _fixture_for_scoring(fixture_id)
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("This scorecard is not available.")
    _require_scorer(match, actor)
    if match.status in {CricketMatch.Status.INNINGS_BREAK, CricketMatch.Status.COMPLETED}:
        _reopen_for_correction(match)
    innings = _current_innings(match)
    delivery = CricketDelivery.objects.select_for_update().filter(innings=innings, is_active=True).order_by("-sequence", "-id").first()
    if not delivery:
        raise ValidationError("There is no scored ball to undo.")
    delivery.is_active = False
    delivery.voided_at = timezone.now()
    delivery.voided_by = actor
    delivery.save(update_fields=["is_active", "voided_at", "voided_by"])
    _rebuild_innings(innings, actor)
    return delivery


@transaction.atomic
def edit_last_delivery(fixture_id, actor, payload):
    fixture = _fixture_for_scoring(fixture_id)
    match = _get_match(fixture, lock=True)
    if not match:
        raise ValidationError("This scorecard is not available.")
    _require_scorer(match, actor)
    if match.status in {CricketMatch.Status.INNINGS_BREAK, CricketMatch.Status.COMPLETED}:
        _reopen_for_correction(match)
    innings = _current_innings(match)
    original = CricketDelivery.objects.select_for_update().filter(innings=innings, is_active=True).order_by("-sequence", "-id").first()
    if not original:
        raise ValidationError("There is no scored ball to correct.")
    original.is_active = False
    original.voided_at = timezone.now()
    original.voided_by = actor
    original.save(update_fields=["is_active", "voided_at", "voided_by"])
    _rebuild_innings(innings, actor)
    return _append_delivery(match, actor, payload, supersedes=original)


def innings_snapshot(innings):
    deliveries = _active_deliveries(innings)
    batting = []
    wickets = {}
    for delivery in deliveries:
        if delivery.wicket_kind != CricketDelivery.WicketKind.NONE:
            wickets[delivery.dismissed_player_id] = delivery
    for squad_player in CricketSquadPlayer.objects.filter(match=innings.match, team=innings.batting_team).order_by("batting_order", "id"):
        faced = [delivery for delivery in deliveries if delivery.striker_id == squad_player.id]
        runs = sum(delivery.runs_off_bat for delivery in faced)
        balls = sum(1 for delivery in faced if delivery.extra_type != CricketDelivery.ExtraType.WIDE)
        dismissal = wickets.get(squad_player.id)
        dismissal_label = "not out"
        if dismissal:
            kind = dismissal.get_wicket_kind_display()
            dismissal_label = kind
            if dismissal.wicket_kind == CricketDelivery.WicketKind.CAUGHT and dismissal.fielder_id:
                dismissal_label = f"c {dismissal.fielder.display_name} b {dismissal.bowler.display_name}"
            elif dismissal.wicket_kind == CricketDelivery.WicketKind.RUN_OUT and dismissal.fielder_id:
                dismissal_label = f"run out ({dismissal.fielder.display_name})"
            elif dismissal.wicket_kind == CricketDelivery.WicketKind.STUMPED and dismissal.fielder_id:
                dismissal_label = f"st {dismissal.fielder.display_name} b {dismissal.bowler.display_name}"
            elif dismissal.wicket_kind in BOWLER_WICKETS:
                dismissal_label = f"{kind} b {dismissal.bowler.display_name}"
        has_batted = bool(faced or dismissal or squad_player.id in {innings.current_striker_id, innings.current_non_striker_id, innings.opening_striker_id, innings.opening_non_striker_id})
        batting.append({
            "id": squad_player.id,
            "name": squad_player.display_name,
            "runs": runs,
            "balls": balls,
            "fours": sum(1 for delivery in faced if delivery.runs_off_bat == 4),
            "sixes": sum(1 for delivery in faced if delivery.runs_off_bat == 6),
            "strike_rate": round((runs / balls) * 100, 2) if balls else 0,
            "dismissal": dismissal_label if has_batted else "did not bat",
            "is_current": squad_player.id in {innings.current_striker_id, innings.current_non_striker_id},
        })
    bowling = []
    for squad_player in CricketSquadPlayer.objects.filter(match=innings.match, team=innings.bowling_team).order_by("batting_order", "id"):
        bowled = [delivery for delivery in deliveries if delivery.bowler_id == squad_player.id]
        if not bowled:
            continue
        legal_balls = sum(1 for delivery in bowled if _delivery_is_legal(delivery))
        conceded = sum(
            _delivery_total_runs(delivery)
            - (delivery.extra_runs if delivery.extra_type in {CricketDelivery.ExtraType.BYE, CricketDelivery.ExtraType.LEG_BYE} else 0)
            for delivery in bowled
        )
        bowling.append({
            "id": squad_player.id,
            "name": squad_player.display_name,
            "overs": _format_overs(legal_balls),
            "runs": conceded,
            "wickets": sum(1 for delivery in bowled if delivery.wicket_kind in BOWLER_WICKETS),
            "wides": sum(delivery.extra_runs for delivery in bowled if delivery.extra_type == CricketDelivery.ExtraType.WIDE),
            "no_balls": sum(delivery.extra_runs for delivery in bowled if delivery.extra_type == CricketDelivery.ExtraType.NO_BALL),
            "economy": round((conceded * 6) / legal_balls, 2) if legal_balls else 0,
        })
    cumulative = 0
    fall_of_wickets = []
    for delivery in deliveries:
        cumulative += _delivery_total_runs(delivery)
        if delivery.wicket_kind != CricketDelivery.WicketKind.NONE:
            fall_of_wickets.append({
                "wicket": len(fall_of_wickets) + 1,
                "score": cumulative,
                "batter": delivery.dismissed_player.display_name,
                "overs": _format_overs(sum(1 for item in deliveries if item.sequence <= delivery.sequence and _delivery_is_legal(item))),
            })
    last_over = []
    legal_seen = 0
    for delivery in reversed(deliveries):
        last_over.append(delivery)
        if _delivery_is_legal(delivery):
            legal_seen += 1
        if legal_seen >= 6:
            break
    last_over.reverse()
    partnership_runs = partnership_balls = 0
    for delivery in reversed(deliveries):
        if delivery.wicket_kind != CricketDelivery.WicketKind.NONE:
            break
        partnership_runs += _delivery_total_runs(delivery)
        partnership_balls += int(_delivery_is_legal(delivery))
    return {
        "id": innings.id,
        "number": innings.number,
        "status": innings.status,
        "closing_reason": innings.closing_reason,
        "batting_team_id": innings.batting_team_id,
        "batting_team_name": innings.batting_team.name,
        "bowling_team_id": innings.bowling_team_id,
        "bowling_team_name": innings.bowling_team.name,
        "target_runs": innings.target_runs,
        "total_runs": innings.total_runs,
        "wickets": innings.wickets,
        "legal_balls": innings.legal_balls,
        "overs": _format_overs(innings.legal_balls),
        "run_rate": round((innings.total_runs * 6) / innings.legal_balls, 2) if innings.legal_balls else 0,
        "extras": {
            "wides": innings.wide_runs,
            "no_balls": innings.no_ball_runs,
            "byes": innings.bye_runs,
            "leg_byes": innings.leg_bye_runs,
            "total": innings.wide_runs + innings.no_ball_runs + innings.bye_runs + innings.leg_bye_runs,
        },
        "current_striker_id": innings.current_striker_id,
        "current_non_striker_id": innings.current_non_striker_id,
        "current_bowler_id": innings.current_bowler_id,
        "current_striker_name": innings.current_striker.display_name if innings.current_striker_id else "",
        "current_non_striker_name": innings.current_non_striker.display_name if innings.current_non_striker_id else "",
        "current_bowler_name": innings.current_bowler.display_name if innings.current_bowler_id else "",
        "partnership": {"runs": partnership_runs, "balls": partnership_balls},
        "last_over": [delivery_token(delivery) for delivery in last_over],
        "deliveries": [delivery_snapshot(delivery) for delivery in deliveries],
        "batting": batting,
        "bowling": bowling,
        "fall_of_wickets": fall_of_wickets,
    }


def delivery_token(delivery):
    if delivery.wicket_kind != CricketDelivery.WicketKind.NONE:
        return "W"
    if delivery.extra_type == CricketDelivery.ExtraType.WIDE:
        return f"{delivery.extra_runs}wd"
    if delivery.extra_type == CricketDelivery.ExtraType.NO_BALL:
        return f"{delivery.extra_runs + delivery.runs_off_bat}nb"
    if delivery.extra_type == CricketDelivery.ExtraType.BYE:
        return f"{delivery.extra_runs}b"
    if delivery.extra_type == CricketDelivery.ExtraType.LEG_BYE:
        return f"{delivery.extra_runs}lb"
    return str(delivery.runs_off_bat)


def delivery_snapshot(delivery):
    return {
        "id": delivery.id,
        "sequence": delivery.sequence,
        "token": delivery_token(delivery),
        "striker_id": delivery.striker_id,
        "striker_name": delivery.striker.display_name,
        "non_striker_id": delivery.non_striker_id,
        "non_striker_name": delivery.non_striker.display_name,
        "bowler_id": delivery.bowler_id,
        "bowler_name": delivery.bowler.display_name,
        "runs_off_bat": delivery.runs_off_bat,
        "extra_type": delivery.extra_type,
        "extra_runs": delivery.extra_runs,
        "wicket_kind": delivery.wicket_kind,
        "dismissed_player_id": delivery.dismissed_player_id,
        "dismissed_player_name": delivery.dismissed_player.display_name if delivery.dismissed_player_id else "",
        "fielder_id": delivery.fielder_id,
        "fielder_name": delivery.fielder.display_name if delivery.fielder_id else "",
        "incoming_batsman_id": delivery.incoming_batsman_id,
        "is_legal": _delivery_is_legal(delivery),
        "created_at": delivery.created_at,
        "supersedes_id": delivery.supersedes_id,
    }


def scorecard_snapshot(match, actor):
    _require_fixture_viewer(match.fixture, actor)
    squads = defaultdict(list)
    for player in CricketSquadPlayer.objects.filter(match=match).select_related("team").order_by("team_id", "batting_order", "id"):
        squads[player.team_id].append({"id": player.id, "player_id": player.player_id, "name": player.display_name, "batting_order": player.batting_order})
    fixture = match.fixture
    team_rows = []
    for team in [fixture.challenge.challenger_team, fixture.challenge.challenged_team]:
        confirmed_by, confirmed_at = _team_confirmation_fields(match, team.id)
        team_rows.append({
            "id": team.id,
            "name": team.name,
            # FieldFile.url includes MEDIA_URL. Sending the storage name here made
            # live score headers request /team_photos/... instead of /media/team_photos/....
            "team_photo": team.team_photo.url if team.team_photo else "",
            "squad_confirmed": bool(getattr(match, f"{confirmed_by}_id")),
            "squad_confirmed_at": getattr(match, confirmed_at),
            "players": squads[team.id],
        })
    innings = list(
        CricketInnings.objects.filter(match=match).select_related(
            "batting_team", "bowling_team", "current_striker", "current_non_striker", "current_bowler"
        ).order_by("number")
    )
    active = next((item for item in innings if item.status == CricketInnings.Status.IN_PROGRESS), None)
    chase = None
    if active and active.number == 2 and active.target_runs:
        balls_remaining = max(match.overs_per_innings * 6 - active.legal_balls, 0)
        runs_needed = max(active.target_runs - active.total_runs, 0)
        chase = {
            "target": active.target_runs,
            "runs_needed": runs_needed,
            "balls_remaining": balls_remaining,
            "required_run_rate": round((runs_needed * 6) / balls_remaining, 2) if balls_remaining else 0,
        }
    permissions = get_scoring_permissions(match, actor)
    return {
        "id": match.id,
        "fixture_id": fixture.id,
        "challenge_id": fixture.challenge_id,
        "match_source": fixture.challenge.source,
        "status": match.status,
        "overs_per_innings": match.overs_per_innings,
        "toss": {
            "winner_team_id": match.toss_winner_id,
            "winner_team_name": match.toss_winner.name if match.toss_winner_id else "",
            "decision": match.toss_decision,
            "first_batting_team_id": match.first_batting_team_id,
            "second_batting_team_id": match.second_batting_team_id,
        },
        "scorer": {"id": match.scorer_id, "name": match.scorer.full_name if match.scorer_id else ""},
        "teams": team_rows,
        "innings": [innings_snapshot(item) for item in innings],
        "active_innings_id": active.id if active else None,
        "chase": chase,
        "result": match.result,
        "completed_at": match.completed_at,
        "player_performances": [
            {
                "player_id": performance.player_id,
                "team_id": performance.team_id,
                "runs": performance.runs,
                "balls_faced": performance.balls_faced,
                "wickets": performance.wickets,
                "balls_bowled": performance.balls_bowled,
                "runs_conceded": performance.runs_conceded,
            }
            for performance in CricketPlayerPerformance.objects.filter(match=match).order_by("team_id", "player_id")
        ],
        "permissions": permissions,
        "can_start_innings": bool(
            permissions["can_score"]
            and ((not innings and match.toss_winner_id) or (len(innings) == 1 and match.status == CricketMatch.Status.INNINGS_BREAK))
        ),
    }


def get_scorecard_for_fixture(fixture_id, actor):
    fixture = TeamFixture.objects.select_related(
        "challenge", "challenge__challenger_team", "challenge__challenged_team"
    ).filter(pk=fixture_id).first()
    if not fixture:
        raise TeamFixture.DoesNotExist
    _require_fixture_viewer(fixture, actor)
    match = _get_match(fixture)
    return scorecard_snapshot(match, actor) if match else None


def _booking_summary(booking):
    slots = booking.booked_slots
    if not slots:
        start_at = end_at = None
    else:
        from datetime import datetime

        current_timezone = timezone.get_current_timezone()
        start_at = timezone.make_aware(
            datetime.combine(slots[0].date, slots[0].start_time),
            current_timezone,
        ).isoformat()
        end_at = timezone.make_aware(
            datetime.combine(slots[-1].date, slots[-1].end_time),
            current_timezone,
        ).isoformat()
    return {
        "id": booking.id,
        "booking_code": booking.booking_code,
        "venue_name": booking.venue.name,
        "venue_area": booking.venue.area,
        "venue_city": booking.venue.city,
        "court_name": booking.court.name,
        "start_at": start_at,
        "end_at": end_at,
        "amount": str(booking.amount),
        "status": booking.status,
        "payment_status": booking.payment_status,
    }


def get_available_scorecards(actor):
    """List scorer-ready fixtures from booking or instant-captain workflows."""
    if not actor or not getattr(actor, "is_authenticated", False) or getattr(actor, "role", None) != "PLAYER":
        return []

    fixtures = list(
        TeamFixture.objects.filter(
            status__in=[
                TeamFixture.Status.SCHEDULED,
                TeamFixture.Status.IN_PROGRESS,
                TeamFixture.Status.COMPLETED,
            ],
        ).filter(
            Q(challenge__source=TeamChallenge.Source.INSTANT_SCORER)
            | Q(
                challenge__source=TeamChallenge.Source.TEAM_CHALLENGE,
                challenge__status__in=[TeamChallenge.Status.CONFIRMED, TeamChallenge.Status.COMPLETED],
                booking__isnull=False,
                booking__status__in=[Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED],
                booking__payment_status=Booking.PaymentStatus.PAID,
            )
        ).filter(
            Q(challenge__challenger_team__captain=actor)
            | Q(challenge__challenged_team__captain=actor)
            | Q(
                participants__player=actor,
                participants__status__in=[
                    TeamFixtureParticipant.Status.SELECTED,
                    TeamFixtureParticipant.Status.ATTENDED,
                    TeamFixtureParticipant.Status.ABSENT,
                    TeamFixtureParticipant.Status.UNVERIFIED,
                ],
            )
        ).select_related(
            "challenge",
            "challenge__challenger_team",
            "challenge__challenged_team",
            "booking",
            "booking__venue",
            "booking__court",
        ).prefetch_related("booking__slot_items__slot").distinct().order_by("-updated_at", "-id")
    )
    if not fixtures:
        return []

    matches = {
        match.fixture_id: match
        for match in CricketMatch.objects.filter(
            fixture_id__in=[fixture.id for fixture in fixtures],
        ).select_related("scorer")
    }
    rows = []
    for fixture in fixtures:
        match = matches.get(fixture.id)
        captain_team = _captain_team(fixture, actor)
        if match:
            permissions = get_scoring_permissions(match, actor)
        else:
            permissions = {
                "can_view": bool(captain_team),
                "is_captain": bool(captain_team),
                "team_id": captain_team.id if captain_team else None,
                "is_assigned_scorer": False,
                "can_score": False,
                "can_set_up": bool(
                    captain_team
                    and fixture.status in {TeamFixture.Status.SCHEDULED, TeamFixture.Status.IN_PROGRESS}
                ),
            }
        rows.append({
            "fixture_id": fixture.id,
            "challenge_id": fixture.challenge_id,
            "match_source": fixture.challenge.source,
            "status": fixture.status,
            "status_label": fixture.get_status_display(),
            "scorecard_available": bool(match),
            "scorecard_status": match.status if match else None,
            "scorecard_result": match.result if match else fixture.result,
            "can_view": permissions["can_view"],
            "can_score": permissions["can_score"],
            "can_set_up": permissions.get("can_set_up", False),
            "is_captain": permissions["is_captain"],
            "is_assigned_scorer": permissions["is_assigned_scorer"],
            "challenger_team": {
                "id": fixture.challenge.challenger_team_id,
                "name": fixture.challenge.challenger_team.name,
            },
            "challenged_team": {
                "id": fixture.challenge.challenged_team_id,
                "name": fixture.challenge.challenged_team.name,
            },
            "booking": _booking_summary(fixture.booking) if fixture.booking_id else None,
        })
    return rows
