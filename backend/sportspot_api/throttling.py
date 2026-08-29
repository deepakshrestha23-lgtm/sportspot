from rest_framework.throttling import ScopedRateThrottle
from rest_framework.permissions import SAFE_METHODS


class MutationThrottleMixin:
    """Apply the shared safety limit to state-changing API views."""

    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "sportspot_mutation"

    def get_throttles(self):
        if self.request.method in SAFE_METHODS:
            return []
        return super().get_throttles()
