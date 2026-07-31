from django.urls import path

from .views import (
    MarkAllNotificationsReadView,
    MarkNotificationReadView,
    MarkNotificationsSeenView,
    MarkRelatedNotificationsReadView,
    NotificationActionView,
    NotificationListView,
    UnseenNotificationCountView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notification-list"),
    path("unseen-count/", UnseenNotificationCountView.as_view(), name="notification-unseen-count"),
    path("seen/", MarkNotificationsSeenView.as_view(), name="notification-mark-seen"),
    path("mark-all-read/", MarkAllNotificationsReadView.as_view(), name="notification-mark-all-read"),
    path("read-related/", MarkRelatedNotificationsReadView.as_view(), name="notification-read-related"),
    path("<int:notification_id>/read/", MarkNotificationReadView.as_view(), name="notification-mark-read"),
    path("<int:notification_id>/action/", NotificationActionView.as_view(), name="notification-action"),
]
