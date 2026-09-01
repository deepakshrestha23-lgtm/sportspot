from rest_framework import permissions


class IsAdminRole(permissions.BasePermission):
    message = "Only SportSpot administrators can access this workspace."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == "ADMIN"
            and request.user.is_active
        )
