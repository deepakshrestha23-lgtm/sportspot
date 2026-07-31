from rest_framework import permissions

from accounts.models import User


class IsPlayer(permissions.BasePermission):
    message = "Only player accounts can access player profiles."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == User.Role.PLAYER)
