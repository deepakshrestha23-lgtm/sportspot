from notifications.models import Notification
from notifications.services import create_notification


def _challenge_url(challenge_id):
    return f"/challenge-teams/{challenge_id}"


def _captain(team):
    return getattr(team, "captain", None)


def notify_challenge_received(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.CHALLENGE_RECEIVED,
        title="Team challenge received",
        message=f"{challenge.challenger_team.name} sent your team a challenge.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"challenge_id": challenge.id},
        deduplication_key=f"team-challenge:{challenge.id}:received:{recipient.id}",
    )


def notify_open_challenge_response(challenge, *, recipient, responding_team, response_id, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.CHALLENGE_RECEIVED,
        title="A team responded to your open challenge",
        message=f"{responding_team.name} responded to your open challenge.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"challenge_id": challenge.id, "response_id": response_id},
        deduplication_key=f"team-challenge:{challenge.id}:open-response:{response_id}:{recipient.id}",
    )


def notify_opponent_selected(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.CHALLENGE_RECEIVED,
        title="Your team was selected for a challenge",
        message=f"{challenge.challenger_team.name} selected your team for this challenge.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"challenge_id": challenge.id},
        deduplication_key=f"team-challenge:{challenge.id}:opponent-selected:{recipient.id}",
    )


def notify_open_challenge_not_selected(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.CHALLENGE_REJECTED,
        title="Another team was selected",
        message="Another team was selected for this open challenge. You can explore other team matches on SportSpot.",
        priority=Notification.Priority.NORMAL,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_status=Notification.ActionStatus.REJECTED,
        metadata={"challenge_id": challenge.id},
        deduplication_key=f"team-challenge:{challenge.id}:not-selected:{recipient.id}",
    )


def notify_challenge_countered(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.CHALLENGE_COUNTERED,
        title="Team challenge updated",
        message=f"{challenge.challenger_team.name} sent a new proposal for your challenge.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={"challenge_id": challenge.id},
        deduplication_key=f"team-challenge:{challenge.id}:counter:{challenge.current_proposal_id}:{recipient.id}",
    )


def notify_challenge_decision(challenge, *, recipient, accepted, actor=None):
    notification_type = (
        Notification.NotificationType.CHALLENGE_ACCEPTED
        if accepted
        else Notification.NotificationType.CHALLENGE_REJECTED
    )
    title = "Team challenge accepted" if accepted else "Team challenge declined"
    message = (
        f"Your challenge with {challenge.challenged_team.name if challenge.challenged_team_id else 'the selected team'} is now accepted."
        if accepted
        else f"Your team challenge with {challenge.challenged_team.name if challenge.challenged_team_id else 'the selected team'} was declined."
    )
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=notification_type,
        title=title,
        message=message,
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_status=Notification.ActionStatus.COMPLETED if accepted else Notification.ActionStatus.REJECTED,
        metadata={"challenge_id": challenge.id, "accepted": accepted},
        deduplication_key=f"team-challenge:{challenge.id}:decision:{accepted}:{recipient.id}:{challenge.current_proposal_id}",
    )


def notify_challenge_expired(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.CHALLENGE_EXPIRED,
        title="Team challenge expired",
        message="The response or court-booking deadline for this team challenge has passed.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_status=Notification.ActionStatus.EXPIRED,
        metadata={"challenge_id": challenge.id},
        deduplication_key=f"team-challenge:{challenge.id}:expired:{recipient.id}",
    )


def notify_challenge_reconfirmation_required(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.MATCH_UPDATED,
        title="Team match schedule changed",
        message="The proposed team match details changed. Please confirm whether your team can still play.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_required=True,
        action_status=Notification.ActionStatus.PENDING,
        metadata={
            "challenge_id": challenge.id,
            "reconfirmation_deadline": challenge.reconfirmation_deadline.isoformat() if challenge.reconfirmation_deadline else None,
        },
        deduplication_key=(
            f"team-challenge:{challenge.id}:reconfirmation:{challenge.current_proposal_id}:{recipient.id}"
        ),
    )


def notify_challenge_reconfirmation_expired(challenge, *, recipient, actor=None):
    return create_notification(
        recipient=recipient,
        actor=actor,
        notification_type=Notification.NotificationType.MATCH_CANCELLED,
        title="Team match cancelled",
        message="The updated team match schedule was not confirmed by both teams in time.",
        priority=Notification.Priority.IMPORTANT,
        action_url=_challenge_url(challenge.id),
        related_entity_type="team_challenge",
        related_entity_id=challenge.id,
        action_status=Notification.ActionStatus.EXPIRED,
        metadata={"challenge_id": challenge.id, "reason": "reconfirmation_deadline"},
        deduplication_key=f"team-challenge:{challenge.id}:reconfirmation-expired:{recipient.id}",
    )


def notify_challenge_status(
    challenge,
    *,
    recipients,
    title,
    message,
    actor=None,
    key_suffix="status",
    notification_type=Notification.NotificationType.CHALLENGE_ACCEPTED,
    action_required=False,
    action_status=Notification.ActionStatus.NONE,
):
    notifications = []
    for recipient in recipients:
        notification = create_notification(
            recipient=recipient,
            actor=actor,
            notification_type=notification_type,
            title=title,
            message=message,
            priority=Notification.Priority.IMPORTANT,
            action_url=_challenge_url(challenge.id),
            related_entity_type="team_challenge",
            related_entity_id=challenge.id,
            action_required=action_required,
            action_status=action_status,
            metadata={"challenge_id": challenge.id},
            deduplication_key=f"team-challenge:{challenge.id}:{key_suffix}:{recipient.id}",
        )
        if notification:
            notifications.append(notification)
    return notifications
