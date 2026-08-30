from datetime import datetime

from django.core.exceptions import ValidationError

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.models import Notification
from teams.models import TeamMember
from venues.models import Booking
from venues.policies import get_booking_start_at

from .models import ParticipationCommitment, PlayerProfile, ReliabilityEvent
from .permissions import IsPlayer
from .serializers import PlayerProfileSerializer
from .services import (
    get_pending_rating_items,
    get_pending_attendance_reviews,
    get_player_commitment_summary,
    get_player_rating_summary,
    resolve_commitment_dispute,
    submit_player_rating_eligibility,
)


class PlayerProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_profile(self, user):
        try:
            return user.player_profile
        except PlayerProfile.DoesNotExist:
            return None

    def get(self, request):
        profile = self.get_profile(request.user)
        if not profile:
            return Response(
                {
                    "exists": False,
                    "detail": "Player profile has not been created yet.",
                    "profile": None,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "exists": True,
                "profile": PlayerProfileSerializer(profile).data,
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        if self.get_profile(request.user):
            return Response(
                {"detail": "Player profile already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = PlayerProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(
            {
                "exists": True,
                "profile": serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )

    def put(self, request):
        profile = self.get_profile(request.user)
        if not profile:
            return Response(
                {"detail": "Player profile has not been created yet."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = PlayerProfileSerializer(profile, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {
                "exists": True,
                "profile": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request):
        profile = self.get_profile(request.user)
        if not profile:
            return Response(
                {"detail": "Player profile has not been created yet."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = PlayerProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {
                "exists": True,
                "profile": serializer.data,
            },
            status=status.HTTP_200_OK,
        )


class PlayerDashboardOverviewView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        user = request.user
        now = timezone.now()
        profile = get_player_profile(user)

        active_memberships = TeamMember.objects.filter(
            user=user,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.ACTIVE,
        ).select_related("team", "team__captain")
        team_count = active_memberships.values("team_id").distinct().count()

        booking_candidates = list(
            Booking.objects.filter(
                player=user,
                status__in=[Booking.BookingStatus.CONFIRMED, Booking.BookingStatus.RESERVED],
                slot__date__gte=timezone.localdate(now),
            )
            .select_related("venue", "court", "slot")
            .prefetch_related("slot_items__slot")
            .order_by("slot__date", "slot__start_time", "id")[:60]
        )
        upcoming_confirmed = [
            booking for booking in booking_candidates
            if booking.status == Booking.BookingStatus.CONFIRMED
            and booking.payment_status == Booking.PaymentStatus.PAID
            and get_booking_start_at(booking)
            and get_booking_start_at(booking) > now
        ]
        pending_payment_bookings = [
            booking for booking in booking_candidates
            if booking.status == Booking.BookingStatus.RESERVED
            and booking.payment_status == Booking.PaymentStatus.PENDING
            and booking.reserved_until > now
        ]

        pending_invitations = list(
            TeamMember.objects.filter(
                user=user,
                member_type=TeamMember.MemberType.REGISTERED,
                status=TeamMember.MemberStatus.INVITED,
            )
            .select_related("team", "team__captain")
            .order_by("-invited_at")[:3]
        )

        recent_notifications = Notification.objects.filter(recipient=user).select_related("actor").order_by("-created_at")[:5]
        next_booking = min(upcoming_confirmed, key=get_booking_start_at) if upcoming_confirmed else None

        return Response(
            {
                "player": {
                    "full_name": user.full_name,
                    "sportspot_id": profile.sportspot_id if profile else "",
                },
                "profile": {
                    "exists": bool(profile),
                    "is_complete": bool(profile and profile.is_profile_complete),
                    "completion_percentage": profile.profile_completion_percentage if profile else 0,
                    "reliability_score": profile.reliability_score if profile else None,
                    "reliability_label": profile.reliability_label if profile else "Profile not created",
                    "completed_matches_count": profile.completed_matches_count if profile else 0,
                },
                "summary": {
                    "team_count": team_count,
                    "upcoming_game_count": 0,
                    "upcoming_booking_count": len(upcoming_confirmed),
                    "pending_payment_count": len(pending_payment_bookings),
                },
                "next_activity": serialize_booking_activity(next_booking) if next_booking else None,
                "pending_actions": [
                    *[serialize_invitation_action(invitation) for invitation in pending_invitations],
                    *[serialize_payment_action(booking) for booking in pending_payment_bookings[:3]],
                ][:5],
                "recent_activity": [serialize_notification_activity(notification) for notification in recent_notifications],
            },
            status=status.HTTP_200_OK,
        )


class PlayerRatingsReliabilityView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get(self, request):
        profile = get_player_profile(request.user)

        if not profile:
            return Response(
                {
                    "profile_exists": False,
                    "last_updated": None,
                    "reliability": {
                        "score": None,
                        "display_score": None,
                        "level": "Profile Needed",
                        "is_provisional": True,
                        "verified_games_considered": 0,
                        "progress_percent": 0,
                    },
                    "rating": {
                        "average": None,
                        "has_rating": False,
                        "total_ratings": 0,
                        "completed_games_represented": 0,
                        "distribution": [],
                        "feedback_tags": [],
                    },
                    "metrics": {
                        "completed_games": 0,
                        "attendance_rate": None,
                        "commitments_honoured_rate": None,
                        "accountable_commitments": 0,
                        "late_cancellations": 0,
                        "no_shows": 0,
                        "pending_attendance_reviews": 0,
                    },
                    "breakdown": get_reliability_breakdown(None),
                    "activity": [],
                    "pending_ratings": [],
                    "pending_attendance_reviews": [],
                    "recent_ratings": [],
                    "improvement_guidance": "Complete your player profile first so teams can understand your Cricksal identity.",
                },
                status=status.HTTP_200_OK,
            )

        commitment_summary = get_player_commitment_summary(request.user)
        has_commitment_history = commitment_summary["accountable_commitments"] > 0 or commitment_summary["pending_reviews"] > 0
        completed_games = commitment_summary["attended"] if has_commitment_history else profile.completed_matches_count
        reliability_events = list(ReliabilityEvent.objects.filter(player=request.user).order_by("-occurred_at", "-id")[:5])
        no_shows = commitment_summary["finalized_no_shows"] if has_commitment_history else profile.no_show_count
        late_cancellations = commitment_summary["late_cancellations"] if has_commitment_history else profile.late_cancellation_count
        history_count = commitment_summary["accountable_commitments"] if has_commitment_history else completed_games
        is_provisional = history_count < (5 if has_commitment_history else 3)
        attendance_rate = (
            round((completed_games / history_count) * 100)
            if history_count
            else None
        )
        rating_summary = get_player_rating_summary(request.user)

        return Response(
            {
                "profile_exists": True,
                "last_updated": profile.updated_at.isoformat(),
                "reliability": {
                    "score": profile.reliability_score,
                    "display_score": None if is_provisional else profile.reliability_score,
                    "level": get_reliability_level(profile.reliability_score, history_count),
                    "is_provisional": is_provisional,
                    "verified_games_considered": history_count,
                    "progress_percent": 0 if is_provisional else profile.reliability_score,
                },
                "rating": {
                    "average": str(rating_summary["average"]) if rating_summary["average"] else None,
                    "has_rating": rating_summary["has_rating"],
                    "total_ratings": rating_summary["total_ratings"],
                    "completed_games_represented": rating_summary["completed_games_represented"],
                    "distribution": rating_summary["distribution"],
                    "feedback_tags": rating_summary["feedback_tags"],
                },
                "metrics": {
                    "completed_games": completed_games,
                    "attendance_rate": attendance_rate,
                    "commitments_honoured_rate": commitment_summary["commitments_honoured_rate"] if has_commitment_history else attendance_rate,
                    "accountable_commitments": history_count,
                    "late_cancellations": late_cancellations,
                    "no_shows": no_shows,
                    "pending_attendance_reviews": commitment_summary["pending_reviews"],
                },
                "breakdown": get_reliability_breakdown(profile, commitment_summary),
                "activity": get_reliability_activity(reliability_events),
                "pending_ratings": get_pending_rating_items(request.user),
                "pending_attendance_reviews": get_pending_attendance_reviews(request.user),
                "recent_ratings": rating_summary["recent"],
                    "improvement_guidance": get_reliability_guidance(profile, attendance_rate, commitment_summary),
            },
            status=status.HTTP_200_OK,
        )


class PlayerRatingEligibilitySubmitView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def post(self, request, eligibility_id):
        try:
            rating_value = int(request.data.get("rating"))
        except (TypeError, ValueError):
            return Response({"detail": "Choose a rating from 1 to 5."}, status=status.HTTP_400_BAD_REQUEST)

        feedback_tags = request.data.get("feedback_tags", [])
        if not isinstance(feedback_tags, list):
            return Response({"detail": "Choose valid feedback tags."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            player_rating, _created = submit_player_rating_eligibility(
                eligibility_id=eligibility_id,
                rater=request.user,
                rating=rating_value,
                feedback_tags=feedback_tags,
                comment=request.data.get("comment", ""),
            )
        except ValidationError as exc:
            message = exc.messages[0] if getattr(exc, "messages", None) else "We could not submit this rating. Please try again."
            return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "detail": "Your rating has been submitted.",
                "rating": {
                    "id": player_rating.id,
                    "value": str(player_rating.rating),
                    "rated_player": player_rating.rated_player.full_name,
                },
            },
            status=status.HTTP_200_OK,
        )


class ParticipationDisputeResolveView(APIView):
    """Protected staff hook for resolving an attendance dispute."""

    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]

    def post(self, request, commitment_id):
        commitment = ParticipationCommitment.objects.filter(pk=commitment_id).first()
        if not commitment:
            return Response({"detail": "Attendance record not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            if commitment.source_type == ParticipationCommitment.SourceType.TEAM_FIXTURE:
                from team_challenges.services import resolve_fixture_attendance_dispute

                resolved = resolve_fixture_attendance_dispute(
                    commitment.source_id,
                    commitment.source_participant_id,
                    request.user,
                    request.data.get("outcome"),
                )
            else:
                resolved = resolve_commitment_dispute(
                    commitment_id=commitment.id,
                    actor=request.user,
                    outcome=request.data.get("outcome"),
                )
        except ValidationError as exc:
            message = exc.messages[0] if getattr(exc, "messages", None) else "We could not resolve this attendance dispute."
            return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)

        return Response({"attendance": {"id": resolved.id, "status": resolved.status, "resolved_at": resolved.resolved_at.isoformat() if resolved.resolved_at else None}})

def get_player_profile(user):
    return PlayerProfile.objects.filter(user=user).first()


def get_reliability_level(score, completed_games):
    if completed_games < 5:
        return "Provisional"
    if score >= 90:
        return "Excellent"
    if score >= 80:
        return "Good"
    if score >= 70:
        return "Fair"
    return "Needs Improvement"


def get_reliability_breakdown(profile, commitment_summary=None):
    if profile and commitment_summary is None:
        commitment_summary = get_player_commitment_summary(profile.user)
    completed_games = commitment_summary["attended"] if commitment_summary else (profile.completed_matches_count if profile else 0)
    late_cancellations = commitment_summary["late_cancellations"] if commitment_summary else (profile.late_cancellation_count if profile else 0)
    no_shows = commitment_summary["finalized_no_shows"] if commitment_summary else (profile.no_show_count if profile else 0)

    return [
        {
            "title": "Attended confirmed games",
            "description": "Completed game commitments build your reliability history.",
            "value": completed_games,
            "impact": "POSITIVE" if completed_games else "NEUTRAL",
        },
        {
            "title": "Late game cancellations",
            "description": "Cancelling a confirmed game commitment after the allowed deadline can reduce reliability.",
            "value": late_cancellations,
            "impact": "NEGATIVE" if late_cancellations else "NO_IMPACT",
        },
        {
            "title": "No-shows",
            "description": "Missing a confirmed game commitment affects trust with teams and captains.",
            "value": no_shows,
            "impact": "NEGATIVE" if no_shows else "NO_IMPACT",
        },
        {
            "title": "Declined invitations or challenges",
            "description": "Saying no before committing does not affect reliability.",
            "value": 0,
            "impact": "NO_IMPACT",
        },
        {
            "title": "Ordinary court bookings",
            "description": "Booking-only activity affects booking records and refunds, not player sports reliability.",
            "value": 0,
            "impact": "NO_IMPACT",
        },
        {
            "title": "Venue-caused cancellations",
            "description": "Cancellations caused by a venue are not counted against players.",
            "value": 0,
            "impact": "NO_IMPACT",
        },
    ]


def get_reliability_activity(events):
    return [
        {
            "id": event.id,
            "title": event.title,
            "description": event.description,
            "impact": event.impact,
            "date": event.occurred_at.isoformat(),
            "event_type": event.event_type,
            "points_delta": event.points_delta,
            "related_entity_type": event.related_entity_type,
            "related_entity_id": event.related_entity_id,
        }
        for event in events
    ]


def get_reliability_guidance(profile, attendance_rate, commitment_summary=None):
    history_count = commitment_summary["accountable_commitments"] if commitment_summary else profile.completed_matches_count
    no_shows = commitment_summary["finalized_no_shows"] if commitment_summary else profile.no_show_count
    late_cancellations = commitment_summary["late_cancellations"] if commitment_summary else profile.late_cancellation_count
    if history_count < 5:
        return "Attend your next confirmed games to build a meaningful reliability history."
    if no_shows:
        return "Avoid missing confirmed games to rebuild trust with teams and captains."
    if late_cancellations:
        return "Avoid late game cancellations where possible to protect your reliability score."
    if attendance_rate is not None and attendance_rate >= 90 and profile.reliability_score >= 90:
        return "Your attendance record is strong. Keep accepting games you can confidently attend."
    return "Keep completing confirmed games to strengthen your SportSpot trust profile."

def serialize_booking_activity(booking):
    start_at = get_booking_start_at(booking)
    slots = booking.booked_slots
    end_at = timezone.make_aware(
        datetime.combine(slots[-1].date, slots[-1].end_time),
        timezone.get_current_timezone(),
    ) if slots else None
    return {
        "type": "BOOKING",
        "title": "Cricksal court booking",
        "status": booking.status,
        "booking_id": booking.id,
        "booking_code": booking.booking_code,
        "venue_name": booking.venue.name,
        "court_name": booking.court.name,
        "date": slots[0].date.isoformat() if slots else "",
        "start_at": start_at.isoformat() if start_at else None,
        "end_at": end_at.isoformat() if end_at else None,
        "display_time": f"{slots[0].start_time.strftime('%I:%M %p').lstrip('0')} - {slots[-1].end_time.strftime('%I:%M %p').lstrip('0')}" if slots else "",
        "amount": str(booking.amount),
        "action_url": f"/dashboard/player/bookings/{booking.id}",
    }


def serialize_invitation_action(invitation):
    return {
        "id": f"team-invitation-{invitation.id}",
        "type": "TEAM_INVITATION",
        "title": "Team invitation",
        "message": f"{invitation.team.name} invited you to join their Cricksal squad.",
        "created_at": invitation.invited_at.isoformat() if invitation.invited_at else None,
        "action_url": "/dashboard/player/invitations",
        "status": invitation.status,
    }


def serialize_payment_action(booking):
    return {
        "id": f"booking-payment-{booking.id}",
        "type": "BOOKING_PAYMENT",
        "title": "Booking awaiting payment",
        "message": f"Complete payment for {booking.booking_code} before the reservation expires.",
        "created_at": booking.created_at.isoformat(),
        "action_url": f"/dashboard/player/bookings/payment/{booking.id}",
        "status": booking.status,
    }


def serialize_notification_activity(notification):
    return {
        "id": notification.id,
        "type": notification.notification_type,
        "category": notification.category,
        "title": notification.title,
        "message": notification.message,
        "created_at": notification.created_at.isoformat(),
        "action_url": notification.action_url,
        "status": notification.action_status,
    }
