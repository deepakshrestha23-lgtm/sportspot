from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .email_service import (
    schedule_booking_cancelled,
    schedule_booking_confirmed,
    schedule_booking_payment_failed,
    schedule_refund_completed,
    schedule_refund_pending,
    schedule_team_invitation,
    schedule_venue_message,
    schedule_venue_status,
    schedule_venue_submitted,
)
from .models import Notification
from .realtime import publish_notification_created


TYPE_CATEGORY = {
    Notification.NotificationType.TEAM_INVITATION_RECEIVED: Notification.Category.TEAMS,
    Notification.NotificationType.TEAM_INVITATION_ACCEPTED: Notification.Category.TEAMS,
    Notification.NotificationType.TEAM_INVITATION_REJECTED: Notification.Category.TEAMS,
    Notification.NotificationType.TEAM_MEMBER_JOINED: Notification.Category.TEAMS,
    Notification.NotificationType.TEAM_MEMBER_REMOVED: Notification.Category.TEAMS,
    Notification.NotificationType.JOIN_REQUEST_RECEIVED: Notification.Category.TEAMS,
    Notification.NotificationType.JOIN_REQUEST_ACCEPTED: Notification.Category.TEAMS,
    Notification.NotificationType.JOIN_REQUEST_REJECTED: Notification.Category.TEAMS,
    Notification.NotificationType.CHALLENGE_RECEIVED: Notification.Category.CHALLENGES,
    Notification.NotificationType.CHALLENGE_ACCEPTED: Notification.Category.CHALLENGES,
    Notification.NotificationType.CHALLENGE_REJECTED: Notification.Category.CHALLENGES,
    Notification.NotificationType.CHALLENGE_COUNTERED: Notification.Category.CHALLENGES,
    Notification.NotificationType.CHALLENGE_EXPIRED: Notification.Category.CHALLENGES,
    Notification.NotificationType.MATCH_SCHEDULED: Notification.Category.MATCHES,
    Notification.NotificationType.MATCH_UPDATED: Notification.Category.MATCHES,
    Notification.NotificationType.MATCH_CANCELLED: Notification.Category.MATCHES,
    Notification.NotificationType.MATCH_REMINDER: Notification.Category.MATCHES,
    Notification.NotificationType.GAME_ROOM_CREATED: Notification.Category.MATCHES,
    Notification.NotificationType.GAME_ROOM_UPDATED: Notification.Category.MATCHES,
    Notification.NotificationType.RATING_REQUIRED: Notification.Category.MATCHES,
    Notification.NotificationType.BOOKING_RESERVED: Notification.Category.BOOKINGS,
    Notification.NotificationType.BOOKING_CONFIRMED: Notification.Category.BOOKINGS,
    Notification.NotificationType.BOOKING_PAYMENT_FAILED: Notification.Category.BOOKINGS,
    Notification.NotificationType.BOOKING_CANCELLED_BY_PLAYER: Notification.Category.BOOKINGS,
    Notification.NotificationType.BOOKING_CANCELLED_BY_OWNER: Notification.Category.BOOKINGS,
    Notification.NotificationType.BOOKING_REMINDER: Notification.Category.BOOKINGS,
    Notification.NotificationType.BOOKING_COMPLETED: Notification.Category.BOOKINGS,
    Notification.NotificationType.REFUND_PENDING: Notification.Category.BOOKINGS,
    Notification.NotificationType.REFUND_APPROVED: Notification.Category.BOOKINGS,
    Notification.NotificationType.REFUND_REJECTED: Notification.Category.BOOKINGS,
    Notification.NotificationType.REFUND_COMPLETED: Notification.Category.BOOKINGS,
    Notification.NotificationType.VENUE_MESSAGE: Notification.Category.BOOKINGS,
}




def notification_allowed_for_recipient(recipient, notification_type):
    try:
        settings = recipient.account_settings
    except Exception:
        return True

    preference_map = {
        Notification.NotificationType.TEAM_INVITATION_RECEIVED: "notify_team_invitations",
        Notification.NotificationType.TEAM_INVITATION_ACCEPTED: "notify_team_invitations",
        Notification.NotificationType.TEAM_INVITATION_REJECTED: "notify_team_invitations",
        Notification.NotificationType.TEAM_MEMBER_JOINED: "notify_team_invitations",
        Notification.NotificationType.TEAM_MEMBER_REMOVED: "notify_team_invitations",
        Notification.NotificationType.JOIN_REQUEST_RECEIVED: "notify_join_requests",
        Notification.NotificationType.JOIN_REQUEST_ACCEPTED: "notify_join_requests",
        Notification.NotificationType.JOIN_REQUEST_REJECTED: "notify_join_requests",
        Notification.NotificationType.CHALLENGE_RECEIVED: "notify_team_challenges",
        Notification.NotificationType.CHALLENGE_ACCEPTED: "notify_team_challenges",
        Notification.NotificationType.CHALLENGE_REJECTED: "notify_team_challenges",
        Notification.NotificationType.CHALLENGE_COUNTERED: "notify_team_challenges",
        Notification.NotificationType.CHALLENGE_EXPIRED: "notify_team_challenges",
        Notification.NotificationType.MATCH_SCHEDULED: "notify_game_updates",
        Notification.NotificationType.MATCH_UPDATED: "notify_game_updates",
        Notification.NotificationType.MATCH_CANCELLED: "notify_game_updates",
        Notification.NotificationType.MATCH_REMINDER: "notify_game_updates",
        Notification.NotificationType.GAME_ROOM_CREATED: "notify_game_updates",
        Notification.NotificationType.GAME_ROOM_UPDATED: "notify_game_updates",
        Notification.NotificationType.RATING_REQUIRED: "notify_rating_reminders",
        Notification.NotificationType.BOOKING_RESERVED: "notify_booking_updates",
        Notification.NotificationType.BOOKING_CONFIRMED: "notify_booking_updates",
        Notification.NotificationType.BOOKING_PAYMENT_FAILED: "notify_booking_updates",
        Notification.NotificationType.BOOKING_REMINDER: "notify_booking_updates",
        Notification.NotificationType.BOOKING_COMPLETED: "notify_booking_updates",
        Notification.NotificationType.BOOKING_CANCELLED_BY_PLAYER: "notify_cancellation_refunds",
        Notification.NotificationType.BOOKING_CANCELLED_BY_OWNER: "notify_cancellation_refunds",
        Notification.NotificationType.REFUND_PENDING: "notify_cancellation_refunds",
        Notification.NotificationType.REFUND_APPROVED: "notify_cancellation_refunds",
        Notification.NotificationType.REFUND_REJECTED: "notify_cancellation_refunds",
        Notification.NotificationType.REFUND_COMPLETED: "notify_cancellation_refunds",
        Notification.NotificationType.VENUE_MESSAGE: "notify_booking_updates",
    }
    field_name = preference_map.get(notification_type)
    if not field_name:
        return True
    return bool(getattr(settings, field_name, True))

def create_notification(
    *,
    recipient,
    notification_type,
    title,
    message,
    actor=None,
    category=None,
    priority=Notification.Priority.NORMAL,
    action_url="",
    related_entity_type="",
    related_entity_id=None,
    metadata=None,
    action_required=False,
    action_status=Notification.ActionStatus.NONE,
    deduplication_key=None,
):
    if not recipient or not recipient.is_active:
        return None
    if not notification_allowed_for_recipient(recipient, notification_type):
        return None

    values = {
        "recipient": recipient,
        "actor": actor if actor and actor.is_active else None,
        "notification_type": notification_type,
        "category": category or TYPE_CATEGORY.get(notification_type, Notification.Category.SYSTEM),
        "priority": priority,
        "title": title,
        "message": message,
        "action_url": action_url,
        "related_entity_type": related_entity_type,
        "related_entity_id": related_entity_id,
        "metadata": metadata or {},
        "action_required": action_required,
        "action_status": action_status,
    }

    if not deduplication_key:
        notification = Notification.objects.create(**values)
        transaction.on_commit(
            lambda created_notification=notification: publish_notification_created(
                created_notification
            )
        )
        return notification

    notification, created = Notification.objects.get_or_create(
        deduplication_key=deduplication_key,
        defaults=values,
    )
    if created:
        transaction.on_commit(
            lambda created_notification=notification: publish_notification_created(
                created_notification
            )
        )
    return notification


def mark_related_action_state(*, recipient, related_entity_type, related_entity_id, action_status):
    return Notification.objects.filter(
        recipient=recipient,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        action_required=True,
    ).update(
        action_required=False,
        action_status=action_status,
        is_seen=True,
        seen_at=timezone.now(),
        is_read=True,
        read_at=timezone.now(),
        updated_at=timezone.now(),
    )


def notify_team_invitation(member, actor):
    team = member.team
    notification = create_notification(
        recipient=member.user,
        actor=actor,
        notification_type=Notification.NotificationType.TEAM_INVITATION_RECEIVED,
        title="Team invitation",
        message=f"{actor.full_name} invited you to join {team.name} as {member.get_cricksal_role_display()}.",
        priority=Notification.Priority.IMPORTANT,
        action_url="/dashboard/player/invitations",
        related_entity_type="team_member",
        related_entity_id=member.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={
            "team_id": team.id,
            "team_name": team.name,
            "member_id": member.id,
            "cricksal_role": member.cricksal_role,
        },
        deduplication_key=f"team-invitation:{member.id}:received",
    )
    schedule_team_invitation(member)
    return notification


def notify_team_invitation_response(member, actor, decision):
    accepted = decision == "accept"
    action_status = Notification.ActionStatus.ACCEPTED if accepted else Notification.ActionStatus.REJECTED
    mark_related_action_state(
        recipient=member.user,
        related_entity_type="team_member",
        related_entity_id=member.id,
        action_status=action_status,
    )
    response_notification = create_notification(
        recipient=member.team.captain,
        actor=actor,
        notification_type=(
            Notification.NotificationType.TEAM_INVITATION_ACCEPTED
            if accepted
            else Notification.NotificationType.TEAM_INVITATION_REJECTED
        ),
        title="Invitation accepted" if accepted else "Invitation rejected",
        message=f"{actor.full_name} {'accepted' if accepted else 'rejected'} your invitation to join {member.team.name}.",
        action_url=f"/dashboard/player/teams/{member.team_id}",
        related_entity_type="team_member",
        related_entity_id=member.id,
        action_status=action_status,
        metadata={"team_id": member.team_id, "member_id": member.id},
        deduplication_key=f"team-invitation:{member.id}:{'accepted' if accepted else 'rejected'}",
    )
    if accepted:
        active_teammates = (
            member.team.members.filter(
                status="ACTIVE",
                member_type="REGISTERED",
                user__isnull=False,
            )
            .exclude(user_id__in=[member.user_id, member.team.captain_id])
            .select_related("user")
        )
        for teammate in active_teammates:
            create_notification(
                recipient=teammate.user,
                actor=actor,
                notification_type=Notification.NotificationType.TEAM_MEMBER_JOINED,
                title="New team member",
                message=f"{actor.full_name} joined {member.team.name}.",
                action_url=f"/dashboard/player/teams/{member.team_id}",
                related_entity_type="team_member",
                related_entity_id=member.id,
                action_status=Notification.ActionStatus.COMPLETED,
                metadata={"team_id": member.team_id, "member_id": member.id},
                deduplication_key=f"team-member:{member.id}:joined:{teammate.user_id}",
            )
    return response_notification


def notify_team_member_removed(member, actor, was_invited=False):
    removed_notification = None
    if member.user_id:
        mark_related_action_state(
            recipient=member.user,
            related_entity_type="team_member",
            related_entity_id=member.id,
            action_status=Notification.ActionStatus.CANCELLED,
        )
        removed_notification = create_notification(
            recipient=member.user,
            actor=actor,
            notification_type=Notification.NotificationType.TEAM_MEMBER_REMOVED,
            title="Invitation cancelled" if was_invited else "Removed from team",
            message=(
                f"Your invitation to join {member.team.name} was cancelled."
                if was_invited
                else f"You were removed from {member.team.name}."
            ),
            priority=Notification.Priority.IMPORTANT,
            action_url="/dashboard/player/teams",
            related_entity_type="team_member",
            related_entity_id=member.id,
            action_status=Notification.ActionStatus.CANCELLED,
            metadata={"team_id": member.team_id, "member_id": member.id},
            deduplication_key=f"team-member:{member.id}:removed",
        )
    if not was_invited:
        active_teammates = (
            member.team.members.filter(
                status="ACTIVE",
                member_type="REGISTERED",
                user__isnull=False,
            )
            .exclude(user_id__in=[member.user_id, actor.id])
            .select_related("user")
        )
        for teammate in active_teammates:
            create_notification(
                recipient=teammate.user,
                actor=actor,
                notification_type=Notification.NotificationType.TEAM_MEMBER_REMOVED,
                title="Team roster updated",
                message=f"{member.display_name} is no longer a member of {member.team.name}.",
                action_url=f"/dashboard/player/teams/{member.team_id}",
                related_entity_type="team_member",
                related_entity_id=member.id,
                action_status=Notification.ActionStatus.CANCELLED,
                metadata={"team_id": member.team_id, "member_id": member.id},
                deduplication_key=f"team-member:{member.id}:removed:{teammate.user_id}",
            )
    return removed_notification


def notify_admins_venue_submitted(venue, actor, is_change_request=False):
    user_model = get_user_model()
    title = "Venue resubmitted" if is_change_request else "Venue awaiting review"
    message = (
        f"{venue.name} was resubmitted after requested changes."
        if is_change_request
        else f"{venue.name} was submitted by {actor.full_name} for verification."
    )
    for admin_user in user_model.objects.filter(role="ADMIN", is_active=True):
        create_notification(
            recipient=admin_user,
            actor=actor,
            notification_type=Notification.NotificationType.VENUE_SUBMITTED,
            title=title,
            message=message,
            priority=Notification.Priority.IMPORTANT,
            action_url="/dashboard/admin/venues",
            related_entity_type="venue",
            related_entity_id=venue.id,
            action_required=True,
            action_status=Notification.ActionStatus.PENDING,
            metadata={"venue_id": venue.id, "venue_name": venue.name, "status": venue.status},
            deduplication_key=f"venue:{venue.id}:submitted:{venue.submitted_at.isoformat() if venue.submitted_at else venue.updated_at.isoformat()}",
        )
    schedule_venue_submitted(venue)


def notify_owner_venue_review(venue, actor, action):
    settings = {
        "APPROVE": (
            Notification.NotificationType.VENUE_APPROVED,
            "Venue approved",
            f"{venue.name} is approved and visible to players.",
            "/dashboard/owner",
            Notification.Priority.IMPORTANT,
            Notification.ActionStatus.ACCEPTED,
        ),
        "NEEDS_CHANGES": (
            Notification.NotificationType.VENUE_NEEDS_CHANGES,
            "Venue changes required",
            f"{venue.name} needs changes before approval. Review the admin note.",
            "/dashboard/owner/venue-setup",
            Notification.Priority.IMPORTANT,
            Notification.ActionStatus.PENDING,
        ),
        "REJECT": (
            Notification.NotificationType.VENUE_REJECTED,
            "Venue submission rejected",
            f"{venue.name} was rejected. Review the admin feedback before resubmitting.",
            "/dashboard/owner/venue-setup",
            Notification.Priority.IMPORTANT,
            Notification.ActionStatus.REJECTED,
        ),
        "SUSPEND": (
            Notification.NotificationType.VENUE_SUSPENDED,
            "Venue suspended",
            f"{venue.name} has been suspended and is hidden from players.",
            "/dashboard/owner",
            Notification.Priority.URGENT,
            Notification.ActionStatus.CANCELLED,
        ),
    }
    notification_type, title, message, action_url, priority, action_status = settings[action]
    Notification.objects.filter(
        related_entity_type="venue",
        related_entity_id=venue.id,
        notification_type=Notification.NotificationType.VENUE_SUBMITTED,
        action_required=True,
    ).update(action_required=False, action_status=action_status, updated_at=timezone.now())
    notification = create_notification(
        recipient=venue.owner,
        actor=actor,
        notification_type=notification_type,
        title=title,
        message=message,
        priority=priority,
        action_url=action_url,
        related_entity_type="venue",
        related_entity_id=venue.id,
        action_required=action == "NEEDS_CHANGES",
        action_status=action_status,
        metadata={"venue_id": venue.id, "status": venue.status, "review_note": venue.admin_review_note},
        deduplication_key=f"venue:{venue.id}:review:{venue.status}:{venue.submitted_at.isoformat() if venue.submitted_at else 'initial'}",
    )
    schedule_venue_status(venue)
    return notification


def _booking_metadata(booking):
    slots = booking.booked_slots
    return {
        "booking_id": booking.id,
        "booking_code": booking.booking_code,
        "venue_id": booking.venue_id,
        "court_id": booking.court_id,
        "slot_ids": [slot.id for slot in slots],
        "booking_status": booking.status,
        "payment_status": booking.payment_status,
        "refund_status": booking.refund_status,
        "cancellation_tier": booking.cancellation_tier,
        "refund_percentage": booking.refund_percentage,
        "refund_amount": str(booking.refund_amount),
    }


def notify_owner_booking_reserved(booking, actor):
    return create_notification(
        recipient=booking.venue.owner,
        actor=actor,
        notification_type=Notification.NotificationType.BOOKING_RESERVED,
        title="New booking reservation",
        message=f"{booking.player.full_name} reserved {booking.court.name}. Payment is pending.",
        action_url="/dashboard/owner/bookings",
        related_entity_type="booking",
        related_entity_id=booking.id,
        metadata=_booking_metadata(booking),
        deduplication_key=f"booking:{booking.id}:reserved:owner",
    )


def notify_booking_confirmed(booking, actor):
    for recipient, action_url, title, message in [
        (
            booking.venue.owner,
            "/dashboard/owner/bookings",
            "Booking confirmed",
            f"{booking.booking_code} is confirmed for {booking.court.name}.",
        ),
        (
            booking.player,
            f"/dashboard/player/bookings/{booking.id}",
            "Booking confirmed",
            f"Your booking at {booking.venue.name} is confirmed. Your booking pass is ready.",
        ),
    ]:
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            title=title,
            message=message,
            priority=Notification.Priority.IMPORTANT,
            action_url=action_url,
            related_entity_type="booking",
            related_entity_id=booking.id,
            action_status=Notification.ActionStatus.COMPLETED,
            metadata=_booking_metadata(booking),
            deduplication_key=f"booking:{booking.id}:confirmed:{recipient.id}",
        )
    schedule_booking_confirmed(booking, booking.player)
    schedule_booking_confirmed(booking, booking.venue.owner, owner_copy=True)


def notify_booking_payment_failed(booking, actor):
    for recipient, action_url, message in [
        (booking.player, f"/dashboard/player/bookings/{booking.id}", "Payment failed and the reserved slots were released."),
        (booking.venue.owner, "/dashboard/owner/calendar", f"Payment failed for {booking.booking_code}; the slots are available again."),
    ]:
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=Notification.NotificationType.BOOKING_PAYMENT_FAILED,
            title="Payment failed",
            message=message,
            priority=Notification.Priority.IMPORTANT,
            action_url=action_url,
            related_entity_type="booking",
            related_entity_id=booking.id,
            action_status=Notification.ActionStatus.EXPIRED,
            metadata=_booking_metadata(booking),
            deduplication_key=f"booking:{booking.id}:payment-failed:{recipient.id}",
        )
    schedule_booking_payment_failed(booking)


def notify_booking_completed(booking):
    for recipient, action_url, message in [
        (
            booking.player,
            f"/dashboard/player/bookings/{booking.id}",
            f"Your booking {booking.booking_code} at {booking.venue.name} is now completed.",
        ),
        (
            booking.venue.owner,
            "/dashboard/owner/bookings",
            f"{booking.booking_code} for {booking.court.name} has moved to completed history.",
        ),
    ]:
        create_notification(
            recipient=recipient,
            actor=None,
            notification_type=Notification.NotificationType.BOOKING_COMPLETED,
            title="Booking completed",
            message=message,
            priority=Notification.Priority.NORMAL,
            action_url=action_url,
            related_entity_type="booking",
            related_entity_id=booking.id,
            action_status=Notification.ActionStatus.COMPLETED,
            metadata=_booking_metadata(booking),
            deduplication_key=f"booking:{booking.id}:completed:{recipient.id}",
        )


def notify_booking_cancelled(booking, actor):
    cancelled_by_role = booking.cancellation_actor_role
    owner_cancelled = cancelled_by_role == "COURT_OWNER"
    admin_cancelled = cancelled_by_role == "ADMIN"
    if owner_cancelled:
        notification_type = Notification.NotificationType.BOOKING_CANCELLED_BY_OWNER
        title = "Booking cancelled by venue"
    elif admin_cancelled:
        notification_type = Notification.NotificationType.SYSTEM_ANNOUNCEMENT
        title = "Booking cancelled by SportSpot"
    else:
        notification_type = Notification.NotificationType.BOOKING_CANCELLED_BY_PLAYER
        title = "Booking cancelled by player"
    priority = Notification.Priority.URGENT if owner_cancelled or admin_cancelled else Notification.Priority.IMPORTANT
    recipients = []
    if actor.id != booking.player_id:
        recipients.append((booking.player, f"/dashboard/player/bookings/{booking.id}"))
    if actor.id != booking.venue.owner_id:
        recipients.append((booking.venue.owner, "/dashboard/owner/bookings"))
    metadata = {**_booking_metadata(booking), "reason": booking.cancellation_reason}
    for recipient, action_url in recipients:
        create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=notification_type,
            category=Notification.Category.BOOKINGS,
            title=title,
            message=f"{booking.booking_code} was cancelled. Reason: {booking.cancellation_reason}",
            priority=priority,
            action_url=action_url,
            related_entity_type="booking",
            related_entity_id=booking.id,
            action_status=Notification.ActionStatus.CANCELLED,
            metadata=metadata,
            deduplication_key=f"booking:{booking.id}:cancelled:{recipient.id}",
        )
    for email_recipient in [booking.player, booking.venue.owner]:
        schedule_booking_cancelled(
            booking,
            email_recipient,
            cancelled_by_venue=owner_cancelled or admin_cancelled,
        )


def notify_owner_refund_requested(booking, actor):
    notification = create_notification(
        recipient=booking.venue.owner,
        actor=actor,
        notification_type=Notification.NotificationType.REFUND_PENDING,
        title="Refund needs processing",
        message=(
            f"{booking.booking_code} requires a {booking.refund_percentage}% refund "
            f"of Rs {booking.refund_amount}."
        ),
        priority=Notification.Priority.IMPORTANT,
        action_url="/dashboard/owner/refunds",
        related_entity_type="booking",
        related_entity_id=booking.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata=_booking_metadata(booking),
        deduplication_key=f"booking:{booking.id}:refund-pending",
    )
    schedule_refund_pending(booking, booking.player)
    schedule_refund_pending(booking, booking.venue.owner, owner_copy=True)
    return notification


def notify_refund_updated(booking, actor):
    is_completed = booking.refund_status in [
        booking.RefundStatus.REFUNDED,
        booking.RefundStatus.PARTIALLY_REFUNDED,
    ]
    notification_type = (
        Notification.NotificationType.REFUND_COMPLETED
        if is_completed
        else Notification.NotificationType.REFUND_REJECTED
    )
    mark_related_action_state(
        recipient=booking.venue.owner,
        related_entity_type="booking",
        related_entity_id=booking.id,
        action_status=Notification.ActionStatus.COMPLETED if is_completed else Notification.ActionStatus.REJECTED,
    )
    notification = create_notification(
        recipient=booking.player,
        actor=actor,
        notification_type=notification_type,
        title="Refund completed" if is_completed else "Refund update",
        message=(
            f"Refund status for {booking.booking_code}: {booking.get_refund_status_display()}. "
            f"Amount: Rs {booking.refund_amount}."
        ),
        priority=Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/bookings/{booking.id}",
        related_entity_type="booking",
        related_entity_id=booking.id,
        action_status=Notification.ActionStatus.COMPLETED if is_completed else Notification.ActionStatus.REJECTED,
        metadata={**_booking_metadata(booking), "owner_note": booking.refund_owner_note},
        deduplication_key=f"booking:{booking.id}:refund:{booking.refund_status}",
    )
    if is_completed:
        schedule_refund_completed(booking)
    return notification


def notify_venue_message(booking_message):
    booking = booking_message.booking
    urgent = booking_message.message_type in [
        booking_message.MessageType.MAINTENANCE_NOTICE,
        booking_message.MessageType.VENUE_CLOSURE,
    ]
    notification = create_notification(
        recipient=booking.player,
        actor=booking_message.sender,
        notification_type=Notification.NotificationType.VENUE_MESSAGE,
        title=f"Message from {booking.venue.name}",
        message=booking_message.message,
        priority=Notification.Priority.URGENT if urgent else Notification.Priority.IMPORTANT,
        action_url=f"/dashboard/player/bookings/{booking.id}",
        related_entity_type="booking_message",
        related_entity_id=booking_message.id,
        metadata={
            "booking_id": booking.id,
            "booking_code": booking.booking_code,
            "venue_id": booking.venue_id,
            "message_type": booking_message.message_type,
        },
        deduplication_key=f"booking-message:{booking_message.id}:sent",
    )
    schedule_venue_message(booking_message)
    return notification
