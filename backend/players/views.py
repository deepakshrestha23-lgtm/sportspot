from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PlayerProfile
from .permissions import IsPlayer
from .serializers import PlayerProfileSerializer


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
