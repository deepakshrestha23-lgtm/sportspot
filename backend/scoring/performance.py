"""Read-only cricket career data derived from finalized scorecards."""

from datetime import timedelta

from django.utils import timezone

from .models import CricketDelivery, CricketInnings, CricketMatch, CricketPlayerPerformance


RECENT_DAYS = 90


def _format_role(value):
    return (value or "").replace("_", " ").title()


def _ratio(numerator, denominator):
    if not denominator:
        return None
    return round(numerator / denominator, 2)


def _rate_per_hundred(numerator, denominator):
    if not denominator:
        return None
    return round((numerator * 100) / denominator, 2)


def _match_context(performance, batting_matches, dismissed_matches, bowling_matches):
    match = performance.match
    fixture = match.fixture
    challenge = fixture.challenge
    opponent = (
        challenge.challenged_team
        if performance.team_id == challenge.challenger_team_id
        else challenge.challenger_team
    )
    batted = match.id in batting_matches
    bowled = match.id in bowling_matches
    dismissed = match.id in dismissed_matches
    return {
        "match_id": match.id,
        "fixture_id": fixture.id,
        "challenge_id": challenge.id,
        "source": challenge.source,
        "completed_at": match.completed_at,
        "team": {"id": performance.team_id, "name": performance.team.name},
        "opponent": {"id": opponent.id, "name": opponent.name},
        "result": match.result or fixture.result,
        "batting": {
            "played": batted,
            "runs": performance.runs,
            "balls": performance.balls_faced,
            "fours": performance.fours,
            "sixes": performance.sixes,
            "dismissed": dismissed if batted else False,
            "not_out": batted and not dismissed,
        },
        "bowling": {
            "bowled": bowled,
            "legal_balls": performance.balls_bowled,
            "runs_conceded": performance.runs_conceded,
            "wickets": performance.wickets,
            "wides": performance.wides,
            "no_balls": performance.no_balls,
        },
        "fielding": {
            "catches": performance.catches,
            "run_outs": performance.run_outs,
            "stumpings": performance.stumpings,
        },
    }


def get_player_cricket_performance(player, *, team_id=None, period="ALL", page=1, page_size=10):
    """Return a player's own scorer-backed cricket record.

    Nothing is persisted here. Corrections remove the finalized performance rows
    until a scorecard is finalized again, keeping this read model aligned with the
    scorer's audit trail.
    """

    performances = CricketPlayerPerformance.objects.filter(
        player=player,
        match__status=CricketMatch.Status.COMPLETED,
    ).select_related(
        "team",
        "match",
        "match__fixture",
        "match__fixture__challenge",
        "match__fixture__challenge__challenger_team",
        "match__fixture__challenge__challenged_team",
    )

    team_options = list(
        performances.order_by("team__name", "team_id").values("team_id", "team__name").distinct()
    )
    if team_id:
        performances = performances.filter(team_id=team_id)
    if period == "RECENT":
        performances = performances.filter(match__completed_at__gte=timezone.now() - timedelta(days=RECENT_DAYS))

    performances = list(performances.order_by("-match__completed_at", "-id"))
    match_ids = [performance.match_id for performance in performances]
    batting_matches = set()
    dismissed_matches = set()
    bowling_matches = set()

    if match_ids:
        innings = CricketInnings.objects.filter(match_id__in=match_ids).values(
            "match_id",
            "opening_striker__player_id",
            "opening_non_striker__player_id",
        )
        for innings_row in innings:
            if player.id in {
                innings_row["opening_striker__player_id"],
                innings_row["opening_non_striker__player_id"],
            }:
                batting_matches.add(innings_row["match_id"])

        deliveries = CricketDelivery.objects.filter(
            innings__match_id__in=match_ids,
            is_active=True,
        ).select_related("innings", "striker", "non_striker", "bowler", "dismissed_player", "incoming_batsman")
        for delivery in deliveries:
            match_id = delivery.innings.match_id
            if player.id in {
                delivery.striker.player_id,
                delivery.non_striker.player_id,
                delivery.incoming_batsman.player_id if delivery.incoming_batsman_id else None,
            }:
                batting_matches.add(match_id)
            if delivery.dismissed_player_id and delivery.dismissed_player.player_id == player.id:
                dismissed_matches.add(match_id)
            if delivery.bowler.player_id == player.id:
                bowling_matches.add(match_id)

    matches = [
        _match_context(performance, batting_matches, dismissed_matches, bowling_matches)
        for performance in performances
    ]
    total_runs = sum(performance.runs for performance in performances)
    total_balls_faced = sum(performance.balls_faced for performance in performances)
    total_fours = sum(performance.fours for performance in performances)
    total_sixes = sum(performance.sixes for performance in performances)
    total_balls_bowled = sum(performance.balls_bowled for performance in performances)
    total_runs_conceded = sum(performance.runs_conceded for performance in performances)
    total_wickets = sum(performance.wickets for performance in performances)
    total_catches = sum(performance.catches for performance in performances)
    total_run_outs = sum(performance.run_outs for performance in performances)
    total_stumpings = sum(performance.stumpings for performance in performances)
    batting_innings = len(batting_matches)
    dismissals = len(dismissed_matches)
    bowling_innings = len(bowling_matches)

    batting_candidates = [match for match in matches if match["batting"]["played"]]
    bowling_candidates = [match for match in matches if match["bowling"]["bowled"]]
    best_batting = max(
        batting_candidates,
        key=lambda match: (match["batting"]["runs"], match["batting"]["balls"]),
        default=None,
    )
    best_bowling = max(
        bowling_candidates,
        key=lambda match: (match["bowling"]["wickets"], -match["bowling"]["runs_conceded"]),
        default=None,
    )
    profile = getattr(player, "player_profile", None)
    total_matches = len(matches)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "player": {
            "name": player.full_name,
            "sportspot_id": profile.sportspot_id if profile else "",
            "profile_photo": str(profile.profile_photo) if profile and profile.profile_photo else "",
            "preferred_role": _format_role(profile.preferred_cricksal_role) if profile else "",
        },
        "filters": {
            "period": period,
            "recent_days": RECENT_DAYS,
            "teams": [{"id": row["team_id"], "name": row["team__name"]} for row in team_options],
        },
        "summary": {
            "matches": total_matches,
            "batting_innings": batting_innings,
            "bowling_innings": bowling_innings,
            "not_outs": max(batting_innings - dismissals, 0),
        },
        "batting": {
            "runs": total_runs,
            "balls": total_balls_faced,
            "fours": total_fours,
            "sixes": total_sixes,
            "innings": batting_innings,
            "dismissals": dismissals,
            "not_outs": max(batting_innings - dismissals, 0),
            "average": _ratio(total_runs, dismissals),
            "strike_rate": _rate_per_hundred(total_runs, total_balls_faced),
        },
        "bowling": {
            "innings": bowling_innings,
            "legal_balls": total_balls_bowled,
            "runs_conceded": total_runs_conceded,
            "wickets": total_wickets,
            "average": _ratio(total_runs_conceded, total_wickets),
            "economy": _ratio(total_runs_conceded * 6, total_balls_bowled),
            "three_wicket_hauls": sum(1 for match in bowling_candidates if match["bowling"]["wickets"] >= 3),
            "five_wicket_hauls": sum(1 for match in bowling_candidates if match["bowling"]["wickets"] >= 5),
        },
        "fielding": {
            "catches": total_catches,
            "run_outs": total_run_outs,
            "stumpings": total_stumpings,
        },
        "personal_bests": {
            "highest_score": (
                {
                    "runs": best_batting["batting"]["runs"],
                    "balls": best_batting["batting"]["balls"],
                    "not_out": best_batting["batting"]["not_out"],
                    "opponent": best_batting["opponent"]["name"],
                    "fixture_id": best_batting["fixture_id"],
                    "challenge_id": best_batting["challenge_id"],
                }
                if best_batting
                else None
            ),
            "best_bowling": (
                {
                    "wickets": best_bowling["bowling"]["wickets"],
                    "runs_conceded": best_bowling["bowling"]["runs_conceded"],
                    "legal_balls": best_bowling["bowling"]["legal_balls"],
                    "opponent": best_bowling["opponent"]["name"],
                    "fixture_id": best_bowling["fixture_id"],
                    "challenge_id": best_bowling["challenge_id"],
                }
                if best_bowling
                else None
            ),
        },
        "recent_form": matches[:5],
        "history": {
            "page": page,
            "page_size": page_size,
            "total": total_matches,
            "has_next": end < total_matches,
            "matches": matches[start:end],
        },
    }
