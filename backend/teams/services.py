from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from notifications.services import notify_team_invitation_response

from .models import TeamMember


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
