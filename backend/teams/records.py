"""Read-only team cricket records derived from completed SportSpot scorecards."""

from django.db.models import Prefetch, Q

from scoring.models import CricketInnings, CricketMatch


def _overs(legal_balls):
    return f"{legal_balls // 6}.{legal_balls % 6}"


def _score(innings):
    return {
        "runs": innings.total_runs,
        "wickets": innings.wickets,
        "overs": _overs(innings.legal_balls),
    }


def get_team_cricket_record(team, *, recent_limit=5):
    """Return scorer-backed results without duplicating mutable aggregate fields.

    A completed scorecard is the source of truth. If its final ball is corrected,
    the scorer reopens the match and it immediately drops out of this projection.
    Free-text manual results are deliberately excluded because they have no
    structured winner or score to safely include in a cricket record.
    """
    matches = list(
        CricketMatch.objects.filter(
            status=CricketMatch.Status.COMPLETED,
            completed_at__isnull=False,
        )
        .filter(
            Q(fixture__challenge__challenger_team_id=team.id)
            | Q(fixture__challenge__challenged_team_id=team.id)
        )
        .select_related(
            "fixture__challenge__challenger_team",
            "fixture__challenge__challenged_team",
        )
        .prefetch_related(
            Prefetch(
                "innings",
                queryset=CricketInnings.objects.select_related("batting_team").order_by("number"),
            )
        )
        .order_by("-completed_at", "-id")
    )

    wins = losses = ties = no_results = runs_for = runs_against = 0
    recent_results = []

    for match in matches:
        challenge = match.fixture.challenge
        opponent = (
            challenge.challenged_team
            if challenge.challenger_team_id == team.id
            else challenge.challenger_team
        )
        innings = list(match.innings.all())
        team_innings = next((item for item in innings if item.batting_team_id == team.id), None)
        opponent_innings = next((item for item in innings if item.batting_team_id == opponent.id), None)

        # A completed two-innings scorer should always have both rows. Retain a
        # defensive no-result path so malformed historical data is never miscounted.
        if not team_innings or not opponent_innings:
            no_results += 1
            outcome = "NO_RESULT"
            team_score = opponent_score = None
        else:
            runs_for += team_innings.total_runs
            runs_against += opponent_innings.total_runs
            team_score = _score(team_innings)
            opponent_score = _score(opponent_innings)
            if team_innings.total_runs > opponent_innings.total_runs:
                wins += 1
                outcome = "WIN"
            elif team_innings.total_runs < opponent_innings.total_runs:
                losses += 1
                outcome = "LOSS"
            else:
                ties += 1
                outcome = "TIE"

        if len(recent_results) < recent_limit:
            recent_results.append(
                {
                    "fixture_id": match.fixture_id,
                    "challenge_id": challenge.id,
                    "opponent": {
                        "id": opponent.id,
                        "name": opponent.name,
                        "team_photo": opponent.team_photo.url if opponent.team_photo else "",
                    },
                    "outcome": outcome,
                    "result": match.result,
                    "completed_at": match.completed_at,
                    "team_score": team_score,
                    "opponent_score": opponent_score,
                }
            )

    matches_played = wins + losses + ties + no_results
    return {
        "matches_played": matches_played,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "no_results": no_results,
        "win_rate": round((wins / matches_played) * 100, 1) if matches_played else None,
        "runs_for": runs_for,
        "runs_against": runs_against,
        "recent_results": recent_results,
    }
