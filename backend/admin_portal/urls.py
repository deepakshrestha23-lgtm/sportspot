from django.urls import path

from .views import (
    AdminBookingListView,
    AdminOverviewView,
    AdminReviewReportActionView,
    AdminReviewReportListView,
    AdminReliabilityActionView,
    AdminReliabilityListView,
    AdminOperationsView,
    AdminUserListView,
    AdminUserStatusView,
)


urlpatterns = [
    path("overview/", AdminOverviewView.as_view(), name="admin-overview"),
    path("users/", AdminUserListView.as_view(), name="admin-users"),
    path("users/<int:user_id>/status/", AdminUserStatusView.as_view(), name="admin-user-status"),
    path("bookings/", AdminBookingListView.as_view(), name="admin-bookings"),
    path("reports/", AdminReviewReportListView.as_view(), name="admin-reports"),
    path("reports/<int:report_id>/action/", AdminReviewReportActionView.as_view(), name="admin-report-action"),
    path("reliability/", AdminReliabilityListView.as_view(), name="admin-reliability"),
    path("reliability/<int:commitment_id>/action/", AdminReliabilityActionView.as_view(), name="admin-reliability-action"),
    path("operations/", AdminOperationsView.as_view(), name="admin-operations"),
]
