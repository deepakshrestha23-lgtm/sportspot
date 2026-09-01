from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from matchmaking.models import ACTIVE_PARTICIPANT_STATUSES, Game, GameParticipant
from notifications.models import EmailDelivery, Notification
from players.models import ParticipationCommitment
from scoring.models import CricketMatch
from team_challenges.models import TeamChallenge, TeamFixture
from teams.models import Team
from venues.models import (
    Booking,
    Court,
    CourtFeedbackReport,
    CourtReview,
    CourtReviewComment,
    Venue,
)

from .permissions import IsAdminRole


User = get_user_model()


class AdminOverviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        today = timezone.localdate()
        thirty_days_ago = today - timedelta(days=29)
        booking_statuses = [Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.COMPLETED]

        venue_counts = {
            value: Venue.objects.filter(status=value).count()
            for value, _label in Venue.Status.choices
        }
        booking_counts = {
            value: Booking.objects.filter(status=value).count()
            for value, _label in Booking.BookingStatus.choices
        }
        payment_counts = {
            value: Booking.objects.filter(payment_status=value).count()
            for value, _label in Booking.PaymentStatus.choices
        }

        today_bookings = Booking.objects.filter(slot__date=today, status__in=booking_statuses)
        today_revenue = today_bookings.filter(
            payment_status=Booking.PaymentStatus.PAID,
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
        recent_revenue = Booking.objects.filter(
            slot__date__gte=thirty_days_ago,
            slot__date__lte=today,
            status__in=booking_statuses,
            payment_status=Booking.PaymentStatus.PAID,
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")

        return Response(
            {
                "generated_at": timezone.now(),
                "today": today,
                "summary": {
                    "total_users": User.objects.count(),
                    "players": User.objects.filter(role=User.Role.PLAYER).count(),
                    "venue_owners": User.objects.filter(role=User.Role.COURT_OWNER).count(),
                    "verified_users": User.objects.filter(email_verified=True).count(),
                    "active_users": User.objects.filter(is_active=True).count(),
                    "today_bookings": today_bookings.count(),
                    "today_revenue": money(today_revenue),
                    "last_30_day_revenue": money(recent_revenue),
                    "pending_refunds": Booking.objects.filter(
                        refund_status=Booking.RefundStatus.PENDING_OWNER_ACTION,
                    ).count(),
                    "open_feedback_reports": CourtFeedbackReport.objects.filter(
                        status=CourtFeedbackReport.Status.OPEN,
                    ).count(),
                    "attendance_disputes": ParticipationCommitment.objects.filter(
                        status=ParticipationCommitment.Status.DISPUTED,
                    ).count(),
                    "active_games": Game.objects.filter(
                        status__in=[
                            Game.Status.RECRUITING,
                            Game.Status.FULL,
                            Game.Status.BOOKING_PENDING,
                            Game.Status.IN_PROGRESS,
                        ]
                    ).count(),
                    "active_challenges": TeamChallenge.objects.filter(
                        status__in=[
                            TeamChallenge.Status.OPEN,
                            TeamChallenge.Status.COUNTERED,
                            TeamChallenge.Status.ACCEPTED_AWAITING_BOOKING,
                            TeamChallenge.Status.RECONFIRMATION_REQUIRED,
                            TeamChallenge.Status.CONFIRMED,
                        ]
                    ).count(),
                    "live_scorecards": CricketMatch.objects.filter(
                        status__in=[
                            CricketMatch.Status.INNINGS_ONE,
                            CricketMatch.Status.INNINGS_BREAK,
                            CricketMatch.Status.INNINGS_TWO,
                        ]
                    ).count(),
                    "completed_scorecards": CricketMatch.objects.filter(
                        status=CricketMatch.Status.COMPLETED,
                    ).count(),
                },
                "venue_pipeline": [
                    {"value": value, "label": label, "count": venue_counts[value]}
                    for value, label in Venue.Status.choices
                ],
                "booking_pipeline": [
                    {"value": value, "label": label, "count": booking_counts[value]}
                    for value, label in Booking.BookingStatus.choices
                ],
                "payment_pipeline": [
                    {"value": value, "label": label, "count": payment_counts[value]}
                    for value, label in Booking.PaymentStatus.choices
                ],
                "operations": {
                    "active_venues": Venue.objects.filter(status=Venue.Status.APPROVED, is_active=True).count(),
                    "active_courts": Court.objects.filter(
                        venue__status=Venue.Status.APPROVED,
                        venue__is_active=True,
                        is_active=True,
                    ).count(),
                    "active_teams": Team.objects.filter(members__status="ACTIVE").distinct().count(),
                    "scheduled_fixtures": TeamFixture.objects.filter(status=TeamFixture.Status.SCHEDULED).count(),
                    "unread_notifications": Notification.objects.filter(is_read=False).count(),
                    "failed_emails": EmailDelivery.objects.filter(status=EmailDelivery.Status.FAILED).count(),
                },
                "attention": self._build_attention_queue(),
            }
        )

    def _build_attention_queue(self):
        items = []
        venues = Venue.objects.select_related("owner").filter(
            status__in=[Venue.Status.PENDING, Venue.Status.NEEDS_CHANGES]
        ).order_by("submitted_at", "updated_at")[:8]
        for venue in venues:
            items.append(
                {
                    "kind": "VENUE_REVIEW",
                    "id": venue.id,
                    "title": venue.name or "Untitled venue",
                    "detail": f"{venue.owner.full_name} · {venue.get_status_display()}",
                    "status": venue.status,
                    "priority": "HIGH" if venue.status == Venue.Status.PENDING else "NORMAL",
                    "created_at": venue.submitted_at or venue.updated_at,
                    "href": "/dashboard/admin/venues",
                }
            )

        reports = CourtFeedbackReport.objects.select_related(
            "reporter", "review__court", "comment__court"
        ).filter(status=CourtFeedbackReport.Status.OPEN).order_by("created_at")[:8]
        for report in reports:
            target = report.review or report.comment
            items.append(
                {
                    "kind": "FEEDBACK_REPORT",
                    "id": report.id,
                    "title": f"{target.court.name if target else 'Feedback'} reported",
                    "detail": f"{report.get_reason_display()} · reported by {report.reporter.full_name}",
                    "status": report.status,
                    "priority": "HIGH",
                    "created_at": report.created_at,
                    "href": "/dashboard/admin/reports",
                }
            )

        refunds = Booking.objects.select_related("venue").filter(
            refund_status=Booking.RefundStatus.PENDING_OWNER_ACTION
        ).order_by("refund_requested_at", "created_at")[:8]
        for booking in refunds:
            items.append(
                {
                    "kind": "REFUND",
                    "id": booking.id,
                    "title": f"Refund {booking.booking_code}",
                    "detail": f"{booking.venue.name} · Rs {money(booking.refund_amount or booking.amount)}",
                    "status": booking.refund_status,
                    "priority": "HIGH",
                    "created_at": booking.refund_requested_at or booking.created_at,
                    "href": "/dashboard/admin/bookings?status=CANCELLED&refund_status=PENDING_OWNER_ACTION",
                }
            )

        disputes = ParticipationCommitment.objects.select_related("player").filter(
            status=ParticipationCommitment.Status.DISPUTED
        ).order_by("disputed_at", "updated_at")[:8]
        for commitment in disputes:
            items.append(
                {
                    "kind": "ATTENDANCE_DISPUTE",
                    "id": commitment.id,
                    "title": f"Attendance dispute · {commitment.player.full_name}",
                    "detail": f"{commitment.source_type.replace('_', ' ').title()} #{commitment.source_id}",
                    "status": commitment.status,
                    "priority": "HIGH",
                    "created_at": commitment.disputed_at or commitment.updated_at,
                    "href": "/dashboard/admin/reliability",
                }
            )

        return sorted(items, key=lambda item: item["created_at"] or timezone.now())[:16]


class AdminUserListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        queryset = User.objects.order_by("-date_joined", "-id")
        query = str(request.query_params.get("q") or "").strip()
        role = str(request.query_params.get("role") or "").upper().strip()
        account_status = str(request.query_params.get("status") or "").upper().strip()
        if query:
            queryset = queryset.filter(Q(full_name__icontains=query) | Q(email__icontains=query) | Q(phone__icontains=query))
        if role in User.Role.values:
            queryset = queryset.filter(role=role)
        if account_status == "ACTIVE":
            queryset = queryset.filter(is_active=True)
        elif account_status == "SUSPENDED":
            queryset = queryset.filter(is_active=False)

        page_size, page = page_params(request)
        total = queryset.count()
        offset = (page - 1) * page_size
        return Response(
            {
                "users": [serialize_user(user) for user in queryset[offset : offset + page_size]],
                "pagination": pagination(page, page_size, total),
            }
        )


class AdminUserStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    @transaction.atomic
    def post(self, request, user_id):
        target = get_object_or_404(User.objects.select_for_update(), pk=user_id)
        is_active = request.data.get("is_active")
        if not isinstance(is_active, bool):
            return Response({"detail": "is_active must be true or false."}, status=status.HTTP_400_BAD_REQUEST)
        if target.pk == request.user.pk:
            return Response({"detail": "You cannot deactivate your own administrator account."}, status=status.HTTP_400_BAD_REQUEST)
        if target.is_active == is_active:
            return Response({"user": serialize_user(target)})
        if target.role == User.Role.ADMIN and not is_active:
            active_admins = User.objects.select_for_update().filter(role=User.Role.ADMIN, is_active=True).exclude(pk=target.pk).count()
            if active_admins == 0:
                return Response({"detail": "SportSpot must keep at least one active administrator."}, status=status.HTTP_400_BAD_REQUEST)

        target.is_active = is_active
        target.auth_version += 1
        target.save(update_fields=["is_active", "auth_version"])
        return Response({"user": serialize_user(target)})


class AdminBookingListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        queryset = Booking.objects.select_related("player", "venue", "court", "slot").order_by("-created_at", "-id")
        query = str(request.query_params.get("q") or "").strip()
        status_filter = str(request.query_params.get("status") or "").upper().strip()
        payment_filter = str(request.query_params.get("payment_status") or "").upper().strip()
        refund_filter = str(request.query_params.get("refund_status") or "").upper().strip()
        if query:
            queryset = queryset.filter(Q(booking_code__icontains=query) | Q(player__full_name__icontains=query) | Q(player__email__icontains=query) | Q(venue__name__icontains=query))
        if status_filter in Booking.BookingStatus.values:
            queryset = queryset.filter(status=status_filter)
        if payment_filter in Booking.PaymentStatus.values:
            queryset = queryset.filter(payment_status=payment_filter)
        if refund_filter in Booking.RefundStatus.values:
            queryset = queryset.filter(refund_status=refund_filter)

        page_size, page = page_params(request)
        total = queryset.count()
        offset = (page - 1) * page_size
        return Response(
            {
                "bookings": [serialize_booking(booking) for booking in queryset[offset : offset + page_size]],
                "pagination": pagination(page, page_size, total),
            }
        )


class AdminReviewReportListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        queryset = CourtFeedbackReport.objects.select_related(
            "reporter", "review__reviewer", "review__court", "review__venue",
            "comment__reviewer", "comment__court", "comment__venue",
        ).order_by("created_at", "id")
        report_status = str(request.query_params.get("status") or "OPEN").upper().strip()
        if report_status in CourtFeedbackReport.Status.values:
            queryset = queryset.filter(status=report_status)
        query = str(request.query_params.get("q") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(details__icontains=query)
                | Q(reporter__full_name__icontains=query)
                | Q(review__comment__icontains=query)
                | Q(comment__comment__icontains=query)
                | Q(review__court__name__icontains=query)
                | Q(comment__court__name__icontains=query)
            )

        page_size, page = page_params(request)
        total = queryset.count()
        offset = (page - 1) * page_size
        return Response(
            {
                "reports": [serialize_report(report) for report in queryset[offset : offset + page_size]],
                "pagination": pagination(page, page_size, total),
            }
        )


class AdminReviewReportActionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    @transaction.atomic
    def post(self, request, report_id):
        report = get_object_or_404(CourtFeedbackReport.objects.select_for_update(), pk=report_id)
        action = str(request.data.get("action") or "").upper().strip()
        target_status = {"REVIEW": CourtFeedbackReport.Status.REVIEWED, "DISMISS": CourtFeedbackReport.Status.DISMISSED}.get(action)
        if not target_status:
            return Response({"detail": "Choose REVIEW or DISMISS."}, status=status.HTTP_400_BAD_REQUEST)
        report.status = target_status
        report.save(update_fields=["status", "updated_at"])
        report = CourtFeedbackReport.objects.select_related(
            "reporter", "review__reviewer", "review__court", "review__venue",
            "comment__reviewer", "comment__court", "comment__venue",
        ).get(pk=report.pk)
        return Response({"report": serialize_report(report)})


class AdminReliabilityListView(APIView):
    """Give staff a read-only, auditable view of attendance decisions."""

    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        queryset = ParticipationCommitment.objects.select_related(
            "player", "attendance_recorded_by", "resolved_by"
        ).order_by("-disputed_at", "-start_at", "-id")
        commitment_status = str(request.query_params.get("status") or "DISPUTED").upper().strip()
        if commitment_status in ParticipationCommitment.Status.values:
            queryset = queryset.filter(status=commitment_status)
        query = str(request.query_params.get("q") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(player__full_name__icontains=query)
                | Q(player__email__icontains=query)
                | Q(dispute_reason__icontains=query)
            )

        page_size, page = page_params(request)
        total = queryset.count()
        offset = (page - 1) * page_size
        commitments = list(queryset[offset : offset + page_size])
        game_ids = {item.source_id for item in commitments if item.source_type == ParticipationCommitment.SourceType.MATCHMAKING_GAME}
        fixture_ids = {item.source_id for item in commitments if item.source_type == ParticipationCommitment.SourceType.TEAM_FIXTURE}
        games = {
            game.id: game.title
            for game in Game.objects.filter(id__in=game_ids)
        }
        fixtures = {
            fixture.id: challenge_title(fixture.challenge)
            for fixture in TeamFixture.objects.select_related(
                "challenge__challenger_team", "challenge__challenged_team"
            ).filter(id__in=fixture_ids)
        }
        return Response(
            {
                "attendance": [serialize_commitment(item, games, fixtures) for item in commitments],
                "pagination": pagination(page, page_size, total),
            }
        )


class AdminReliabilityActionView(APIView):
    """Resolve a disputed attendance record through the shared service."""

    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    @transaction.atomic
    def post(self, request, commitment_id):
        from players.services import resolve_commitment_dispute

        if not request.user.is_staff:
            return Response(
                {"detail": "This administrator account is not enabled for attendance resolution."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            commitment = resolve_commitment_dispute(
                commitment_id=commitment_id,
                actor=request.user,
                outcome=request.data.get("outcome"),
            )
        except ValidationError as exc:
            message = exc.messages[0] if getattr(exc, "messages", None) else "We could not resolve this attendance dispute."
            return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"attendance": serialize_commitment(commitment, {}, {})})


class AdminOperationsView(APIView):
    """Read-only monitoring for matchmaking, challenges, and scorecards."""

    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def get(self, request):
        operation_type = str(request.query_params.get("type") or "GAMES").upper().strip()
        query = str(request.query_params.get("q") or "").strip()
        status_filter = str(request.query_params.get("status") or "").upper().strip()
        page_size, page = page_params(request)

        if operation_type == "CHALLENGES":
            queryset = TeamChallenge.objects.select_related(
                "challenger_team", "challenged_team", "created_by", "booking__venue", "booking__court"
            ).order_by("-updated_at", "-id")
            if status_filter in TeamChallenge.Status.values:
                queryset = queryset.filter(status=status_filter)
            if query:
                queryset = queryset.filter(
                    Q(challenger_team__name__icontains=query)
                    | Q(challenged_team__name__icontains=query)
                    | Q(created_by__full_name__icontains=query)
                )
            total = queryset.count()
            items = [serialize_operation_challenge(item) for item in queryset[(page - 1) * page_size : page * page_size]]
        elif operation_type == "SCORECARDS":
            queryset = CricketMatch.objects.select_related(
                "fixture__challenge__challenger_team",
                "fixture__challenge__challenged_team",
                "fixture__booking__venue",
                "fixture__booking__court",
                "scorer",
            ).order_by("-updated_at", "-id")
            if status_filter in CricketMatch.Status.values:
                queryset = queryset.filter(status=status_filter)
            if query:
                queryset = queryset.filter(
                    Q(fixture__challenge__challenger_team__name__icontains=query)
                    | Q(fixture__challenge__challenged_team__name__icontains=query)
                    | Q(scorer__full_name__icontains=query)
                    | Q(result__icontains=query)
                )
            total = queryset.count()
            items = [serialize_operation_scorecard(item) for item in queryset[(page - 1) * page_size : page * page_size]]
        else:
            operation_type = "GAMES"
            queryset = Game.objects.select_related(
                "host", "team", "booking__venue", "booking__court", "booking__slot"
            ).annotate(
                occupied_count=Count(
                    "participants",
                    filter=Q(participants__status__in=ACTIVE_PARTICIPANT_STATUSES),
                    distinct=True,
                )
            ).order_by("-updated_at", "-id")
            if status_filter in Game.Status.values:
                queryset = queryset.filter(status=status_filter)
            if query:
                queryset = queryset.filter(
                    Q(title__icontains=query)
                    | Q(host__full_name__icontains=query)
                    | Q(team__name__icontains=query)
                )
            total = queryset.count()
            items = [serialize_operation_game(item) for item in queryset[(page - 1) * page_size : page * page_size]]

        return Response(
            {
                "type": operation_type,
                "items": items,
                "pagination": pagination(page, page_size, total),
            }
        )


def serialize_user(user):
    venue = Venue.objects.filter(owner_id=user.id).values("id", "name", "status").first()
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "is_active": user.is_active,
        "email_verified": user.email_verified,
        "date_joined": user.date_joined,
        "venue": venue,
        "team_count": Team.objects.filter(captain_id=user.id).count(),
        "booking_count": Booking.objects.filter(player_id=user.id).count(),
    }


def serialize_booking(booking):
    return {
        "id": booking.id,
        "booking_code": booking.booking_code,
        "player": {"id": booking.player_id, "name": booking.player.full_name, "email": booking.player.email},
        "venue": {"id": booking.venue_id, "name": booking.venue.name},
        "court": {"id": booking.court_id, "name": booking.court.name},
        "slot_date": booking.slot.date,
        "slot_start_time": booking.slot.start_time,
        "slot_end_time": booking.slot.end_time,
        "amount": money(booking.amount),
        "status": booking.status,
        "payment_status": booking.payment_status,
        "payment_provider": booking.payment_provider,
        "refund_status": booking.refund_status,
        "refund_amount": money(booking.refund_amount),
        "refund_reason": booking.refund_reason,
        "check_in": bool(getattr(booking, "check_in", None)),
        "matchmaking_game_id": booking.matchmaking_game_id,
        "created_at": booking.created_at,
        "updated_at": booking.updated_at,
    }


def serialize_report(report):
    review = report.review
    comment = report.comment
    target = review or comment
    return {
        "id": report.id,
        "status": report.status,
        "reason": report.reason,
        "reason_label": report.get_reason_display(),
        "details": report.details,
        "reporter": {"id": report.reporter_id, "name": report.reporter.full_name},
        "target": {
            "type": "review" if review else "comment",
            "id": target.id if target else None,
            "text": (target.comment if target else "")[:1000],
            "rating": review.rating if review else None,
            "author": target.reviewer.full_name if target else "Unknown player",
            "court": target.court.name if target else "Unknown court",
            "venue": target.venue.name if target else "Unknown venue",
        },
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


def serialize_commitment(commitment, games, fixtures):
    if commitment.source_type == ParticipationCommitment.SourceType.MATCHMAKING_GAME:
        source_label = "Pickup or fill-squad game"
        source_detail = games.get(commitment.source_id, f"Game #{commitment.source_id}")
    else:
        source_label = "Team challenge fixture"
        source_detail = fixtures.get(commitment.source_id, f"Fixture #{commitment.source_id}")
    return {
        "id": commitment.id,
        "status": commitment.status,
        "source_type": commitment.source_type,
        "source_label": source_label,
        "source_detail": source_detail,
        "player": {"id": commitment.player_id, "name": commitment.player.full_name, "email": commitment.player.email},
        "start_at": commitment.start_at,
        "end_at": commitment.end_at,
        "review_deadline_at": commitment.review_deadline_at,
        "disputed_at": commitment.disputed_at,
        "resolved_at": commitment.resolved_at,
        "attendance_recorded_at": commitment.attendance_recorded_at,
        "attendance_recorded_by": commitment.attendance_recorded_by.full_name if commitment.attendance_recorded_by else None,
        "resolved_by": commitment.resolved_by.full_name if commitment.resolved_by else None,
        "dispute_reason": commitment.dispute_reason,
        "source_id": commitment.source_id,
    }


def challenge_title(challenge):
    opponent = challenge.challenged_team.name if challenge.challenged_team_id else "Open opponent search"
    return f"{challenge.challenger_team.name} vs {opponent}"


def serialize_operation_game(game):
    booking = game.booking
    return {
        "id": game.id,
        "kind": "GAME",
        "title": game.title,
        "status": game.status,
        "subtitle": f"{game.get_game_type_display()} · {game.get_creation_mode_display()}",
        "owner": game.host.full_name,
        "schedule": game.start_at,
        "location": f"{booking.venue.name} · {booking.court.name}" if booking else "Court not booked",
        "meta": [f"{game.occupied_count}/{game.total_capacity} active spots", f"{game.waitlist_count} waitlisted"],
        "updated_at": game.updated_at,
    }


def serialize_operation_challenge(challenge):
    booking = challenge.booking
    return {
        "id": challenge.id,
        "kind": "CHALLENGE",
        "title": challenge_title(challenge),
        "status": challenge.status,
        "subtitle": f"{challenge.get_challenge_type_display()} · {challenge.get_court_mode_display()}",
        "owner": challenge.created_by.full_name,
        "schedule": booking.slot.date if booking else challenge.response_deadline,
        "location": f"{booking.venue.name} · {booking.court.name}" if booking else "Plan-first challenge",
        "meta": ["Public" if challenge.is_public else "Private", f"Response by {format_datetime_value(challenge.response_deadline)}"],
        "updated_at": challenge.updated_at,
    }


def serialize_operation_scorecard(match):
    challenge = match.fixture.challenge
    booking = match.fixture.booking
    return {
        "id": match.id,
        "kind": "SCORECARD",
        "title": challenge_title(challenge),
        "status": match.status,
        "subtitle": f"{match.overs_per_innings} overs per innings",
        "owner": match.scorer.full_name if match.scorer else "No scorer assigned",
        "schedule": booking.slot.date if booking else match.created_at,
        "location": f"{booking.venue.name} · {booking.court.name}" if booking else "No venue booking",
        "meta": [match.result or "Result pending", f"Created {format_datetime_value(match.created_at)}"],
        "updated_at": match.updated_at,
    }


def format_datetime_value(value):
    return timezone.localtime(value).strftime("%d %b %Y, %I:%M %p") if value else "Not set"


def page_params(request):
    try:
        page_size = min(max(int(request.query_params.get("page_size") or 25), 1), 50)
    except (TypeError, ValueError):
        page_size = 25
    try:
        page = max(int(request.query_params.get("page") or 1), 1)
    except (TypeError, ValueError):
        page = 1
    return page_size, page


def pagination(page, page_size, total):
    return {"page": page, "page_size": page_size, "total": total, "has_more": (page * page_size) < total}


def money(value):
    return f"{Decimal(value or 0):.2f}"
