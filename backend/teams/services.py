from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from notifications.services import notify_team_invitation, notify_team_invitation_response

from .models import TeamMember


@transaction.atomic
def invite_registered_player_to_team(*, team, actor, player, cricksal_role):
    """Create one permanent-team invitation with the shared team rules."""
    if team.captain_id != actor.id:
        raise ValidationError("Only the team captain can invite registered players.")
    if player.id == actor.id:
        raise ValidationError("You cannot invite yourself to your own team.")
    existing_member = TeamMember.objects.select_for_update().filter(
        team=team,
        user=player,
        status__in=[TeamMember.MemberStatus.ACTIVE, TeamMember.MemberStatus.INVITED],
    ).first()
    if existing_member and existing_member.status == TeamMember.MemberStatus.ACTIVE:
        raise ValidationError("This player is already an active member of the team.")
    if existing_member:
        raise ValidationError("This player already has a pending invitation.")
    member = TeamMember.objects.create(
        team=team,
        user=player,
        member_type=TeamMember.MemberType.REGISTERED,
        role_in_team=TeamMember.TeamRole.PLAYER,
        cricksal_role=cricksal_role or TeamMember.CricksalRole.NONE,
        status=TeamMember.MemberStatus.INVITED,
    )
    notify_team_invitation(member, actor)
    return member


@transaction.atomic
def decide_team_invitation(*, member_id, user, decision):
    if decision not in ["accept", "reject"]:
        raise ValidationError("Invalid invitation action.")

    member = (
        TeamMember.objects.select_for_update()
        .select_related("team", "team__captain", "user")
        .filter(
            pk=member_id,
            user=user,
            member_type=TeamMember.MemberType.REGISTERED,
        )
        .first()
    )
    if not member:
        raise ValidationError("Invitation not found.")

    desired_status = (
        TeamMember.MemberStatus.ACTIVE
        if decision == "accept"
        else TeamMember.MemberStatus.REJECTED
    )
    if member.status == desired_status:
        return member, False
    if member.status != TeamMember.MemberStatus.INVITED:
        raise ValidationError(f"This invitation is already {member.get_status_display().lower()}.")

    member.status = desired_status
    update_fields = ["status"]
    if decision == "accept":
        member.joined_at = timezone.now()
        update_fields.append("joined_at")
    member.save(update_fields=update_fields)
    notify_team_invitation_response(member, user, decision)
    return member, True
