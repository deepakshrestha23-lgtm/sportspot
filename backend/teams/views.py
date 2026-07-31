from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.services import notify_team_invitation, notify_team_member_removed
from players.models import PlayerProfile
from .models import Team, TeamMember
from .permissions import IsPlayer
from .serializers import (
    GuestMemberCreateSerializer,
    InvitationSerializer,
    PlayerLookupSerializer,
    RegisteredPlayerInviteSerializer,
    TeamDetailSerializer,
    TeamMemberSerializer,
    TeamSerializer,
)
from .services import decide_team_invitation


class TeamAccessMixin:
    permission_classes = [permissions.IsAuthenticated, IsPlayer]

    def get_member_teams_queryset(self, user):
        return Team.objects.filter(
            members__user=user,
            members__status=TeamMember.MemberStatus.ACTIVE,
        ).select_related("captain").distinct()

    def get_team_for_member(self, user, team_id):
        return get_object_or_404(self.get_member_teams_queryset(user), pk=team_id)

    def ensure_player_profile(self, user):
        return PlayerProfile.objects.filter(user=user).exists()

    def is_captain(self, team, user):
        return team.captain_id == user.id


class MyTeamsView(TeamAccessMixin, APIView):
    def get(self, request):
        teams = self.get_member_teams_queryset(request.user)
        serializer = TeamSerializer(teams, many=True, context={"request": request})
        return Response({"teams": serializer.data}, status=status.HTTP_200_OK)


class TeamCreateView(TeamAccessMixin, APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request):
        if not self.ensure_player_profile(request.user):
            return Response(
                {"detail": "Complete your player profile before creating a team."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = TeamSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        team = serializer.save(captain=request.user)

        profile = request.user.player_profile
        TeamMember.objects.create(
            team=team,
            user=request.user,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.CAPTAIN,
            cricksal_role=profile.preferred_cricksal_role,
            status=TeamMember.MemberStatus.ACTIVE,
        )

        return Response(
            {"team": TeamDetailSerializer(team, context={"request": request}).data},
            status=status.HTTP_201_CREATED,
        )


class TeamDetailView(TeamAccessMixin, APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, team_id):
        team = self.get_team_for_member(request.user, team_id)
        return Response({"team": TeamDetailSerializer(team, context={"request": request}).data})

    def put(self, request, team_id):
        return self.update(request, team_id, partial=False)

    def patch(self, request, team_id):
        return self.update(request, team_id, partial=True)

    def update(self, request, team_id, partial):
        team = self.get_team_for_member(request.user, team_id)
        if not self.is_captain(team, request.user):
            return Response({"detail": "Only the team captain can edit this team."}, status=status.HTTP_403_FORBIDDEN)

        serializer = TeamSerializer(team, data=request.data, partial=partial, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"team": TeamDetailSerializer(team, context={"request": request}).data})

    def delete(self, request, team_id):
        team = self.get_team_for_member(request.user, team_id)
        if not self.is_captain(team, request.user):
            return Response({"detail": "Only the team captain can delete this team."}, status=status.HTTP_403_FORBIDDEN)

        team.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class GuestMemberCreateView(TeamAccessMixin, APIView):
    def post(self, request, team_id):
        team = self.get_team_for_member(request.user, team_id)
        if not self.is_captain(team, request.user):
            return Response({"detail": "Only the team captain can add guest players."}, status=status.HTTP_403_FORBIDDEN)

        serializer = GuestMemberCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        member = TeamMember.objects.create(
            team=team,
            member_type=TeamMember.MemberType.GUEST,
            role_in_team=TeamMember.TeamRole.GUEST,
            status=TeamMember.MemberStatus.ACTIVE,
            **serializer.validated_data,
        )

        return Response({"member": TeamMemberSerializer(member).data}, status=status.HTTP_201_CREATED)


class TeamMemberRemoveView(TeamAccessMixin, APIView):
    def delete(self, request, team_id, member_id):
        team = self.get_team_for_member(request.user, team_id)
        if not self.is_captain(team, request.user):
            return Response({"detail": "Only the team captain can remove members."}, status=status.HTTP_403_FORBIDDEN)

        member = get_object_or_404(
            team.members,
            pk=member_id,
            status__in=[TeamMember.MemberStatus.ACTIVE, TeamMember.MemberStatus.INVITED],
        )
        if member.role_in_team == TeamMember.TeamRole.CAPTAIN:
            return Response({"detail": "The captain cannot be removed from their own team."}, status=status.HTTP_400_BAD_REQUEST)

        previous_status = member.status
        member.status = TeamMember.MemberStatus.REMOVED
        member.save(update_fields=["status"])

        notify_team_member_removed(
            member,
            request.user,
            was_invited=previous_status == TeamMember.MemberStatus.INVITED,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class PlayerLookupView(TeamAccessMixin, APIView):
    def get(self, request):
        sportspot_id = str(request.query_params.get("sportspot_id", "")).strip().upper()
        if not sportspot_id:
            return Response({"detail": "SportSpot ID is required."}, status=status.HTTP_400_BAD_REQUEST)

        profile = PlayerProfile.objects.select_related("user").filter(sportspot_id=sportspot_id, user__role="PLAYER").first()
        if not profile:
            return Response(
                {"detail": "No registered player found with this SportSpot ID."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"player": PlayerLookupSerializer(profile).data}, status=status.HTTP_200_OK)


class RegisteredPlayerInviteView(TeamAccessMixin, APIView):
    def post(self, request, team_id):
        team = self.get_team_for_member(request.user, team_id)
        if not self.is_captain(team, request.user):
            return Response({"detail": "Only the team captain can invite registered players."}, status=status.HTTP_403_FORBIDDEN)

        serializer = RegisteredPlayerInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        sportspot_id = serializer.validated_data["sportspot_id"]
        profile = PlayerProfile.objects.select_related("user").filter(sportspot_id=sportspot_id, user__role="PLAYER").first()
        if not profile:
            return Response(
                {"detail": "No registered player found with this SportSpot ID."},
                status=status.HTTP_404_NOT_FOUND,
            )

        invited_user = profile.user
        if invited_user.id == request.user.id:
            return Response({"detail": "You cannot invite yourself to your own team."}, status=status.HTTP_400_BAD_REQUEST)

        existing_member = TeamMember.objects.filter(
            team=team,
            user=invited_user,
            status__in=[TeamMember.MemberStatus.ACTIVE, TeamMember.MemberStatus.INVITED],
        ).first()

        if existing_member and existing_member.status == TeamMember.MemberStatus.ACTIVE:
            return Response({"detail": "This player is already an active member of the team."}, status=status.HTTP_400_BAD_REQUEST)

        if existing_member and existing_member.status == TeamMember.MemberStatus.INVITED:
            return Response({"detail": "This player already has a pending invitation."}, status=status.HTTP_400_BAD_REQUEST)

        member = TeamMember.objects.create(
            team=team,
            user=invited_user,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=serializer.validated_data["cricksal_role"],
            status=TeamMember.MemberStatus.INVITED,
        )
        notify_team_invitation(member, request.user)

        return Response({"member": TeamMemberSerializer(member).data}, status=status.HTTP_201_CREATED)


class MyInvitationsView(TeamAccessMixin, APIView):
    def get(self, request):
        invitations = TeamMember.objects.filter(
            user=request.user,
            member_type=TeamMember.MemberType.REGISTERED,
            status=TeamMember.MemberStatus.INVITED,
        ).select_related("team", "team__captain")
        return Response({"invitations": InvitationSerializer(invitations, many=True).data}, status=status.HTTP_200_OK)


class InvitationDecisionView(TeamAccessMixin, APIView):
    def post(self, request, member_id, decision):
        try:
            member, changed = decide_team_invitation(
                member_id=member_id,
                user=request.user,
                decision=decision,
            )
        except ValidationError as error:
            return Response({"detail": error.messages[0]}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "invitation": InvitationSerializer(member).data,
                "detail": (
                    f"Invitation {decision}ed successfully."
                    if changed
                    else f"Invitation was already {member.get_status_display().lower()}."
                ),
            },
            status=status.HTTP_200_OK,
        )
