from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from notifications.models import EmailDelivery, Notification
from notifications.services import create_notification, notify_team_invitation
from teams.models import Team, TeamMember


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class NotificationApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.captain = user_model.objects.create_user(
            email="captain@example.com", password="test-password", full_name="Captain Player",
            phone="9800000001", role="PLAYER",
        )
        self.player = user_model.objects.create_user(
            email="player@example.com", password="test-password", full_name="Invited Player",
            phone="9800000002", role="PLAYER",
        )
        self.other_player = user_model.objects.create_user(
            email="other@example.com", password="test-password", full_name="Other Player",
            phone="9800000003", role="PLAYER",
        )
        self.team = Team.objects.create(
            name="Kathmandu Strikers",
            description="Cricksal team",
            location="Kathmandu",
            preferred_playing_area="Baneshwor",
            preferred_playing_time="Evening",
            skill_level=Team.SkillLevel.INTERMEDIATE,
            captain=self.captain,
        )
        self.invitation = TeamMember.objects.create(
            team=self.team,
            user=self.player,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BOWLER,
            status=TeamMember.MemberStatus.INVITED,
        )
        self.notification = notify_team_invitation(self.invitation, self.captain)

    def test_seen_and_read_are_separate_and_scoped_to_recipient(self):
        other_notification = create_notification(
            recipient=self.other_player,
            notification_type=Notification.NotificationType.SYSTEM_ANNOUNCEMENT,
            title="Other player's update",
            message="Private notification.",
            deduplication_key="other-player-update",
        )
        self.client.force_authenticate(self.player)
        response = self.client.post(
            reverse("notification-mark-seen"),
            {"notification_ids": [self.notification.id, other_notification.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.notification.refresh_from_db()
        other_notification.refresh_from_db()
        self.assertTrue(self.notification.is_seen)
        self.assertFalse(self.notification.is_read)
        self.assertIsNotNone(self.notification.seen_at)
        self.assertFalse(other_notification.is_seen)

        response = self.client.post(
            reverse("notification-mark-read", args=[self.notification.id]),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.notification.refresh_from_db()
        self.assertTrue(self.notification.is_read)
        self.assertIsNotNone(self.notification.read_at)

    def test_invitation_action_uses_real_membership_and_is_idempotent(self):
        self.client.force_authenticate(self.player)
        action_url = reverse("notification-action", args=[self.notification.id])

        first_response = self.client.post(action_url, {"action": "accept"}, format="json")
        second_response = self.client.post(action_url, {"action": "accept"}, format="json")

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.invitation.refresh_from_db()
        self.notification.refresh_from_db()
        self.assertEqual(self.invitation.status, TeamMember.MemberStatus.ACTIVE)
        self.assertEqual(self.notification.action_status, Notification.ActionStatus.ACCEPTED)
        self.assertFalse(self.notification.action_required)
        self.assertTrue(self.notification.is_read)
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.captain,
                notification_type=Notification.NotificationType.TEAM_INVITATION_ACCEPTED,
                related_entity_id=self.invitation.id,
            ).count(),
            1,
        )

    def test_user_cannot_access_or_modify_another_users_notification(self):
        self.client.force_authenticate(self.other_player)
        read_response = self.client.post(
            reverse("notification-mark-read", args=[self.notification.id]),
            format="json",
        )
        action_response = self.client.post(
            reverse("notification-action", args=[self.notification.id]),
            {"action": "accept"},
            format="json",
        )

        self.assertEqual(read_response.status_code, 404)
        self.assertEqual(action_response.status_code, 404)

    def test_opening_related_page_marks_only_matching_notifications_read(self):
        unrelated = create_notification(
            recipient=self.player,
            notification_type=Notification.NotificationType.SYSTEM_ANNOUNCEMENT,
            title="Other update",
            message="This should stay unread.",
            action_url="/dashboard/player/settings",
        )
        self.client.force_authenticate(self.player)
        response = self.client.post(
            reverse("notification-read-related"),
            {"target_url": "/dashboard/player/invitations"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.notification.refresh_from_db()
        unrelated.refresh_from_db()
        self.assertTrue(self.notification.is_read)
        self.assertFalse(unrelated.is_read)

    def test_list_filters_and_paginates_without_hardcoded_counts(self):
        for index in range(18):
            create_notification(
                recipient=self.player,
                notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
                title=f"Booking {index}",
                message="Booking confirmed.",
                category=Notification.Category.BOOKINGS,
                deduplication_key=f"booking-list-test:{index}",
            )
        self.client.force_authenticate(self.player)
        response = self.client.get(reverse("notification-list"), {"category": "BOOKINGS"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 18)
        self.assertEqual(len(response.data["results"]), 15)
        self.assertIsNotNone(response.data["next"])
        self.assertEqual(response.data["unseen_count"], 19)

    def test_deduplication_key_prevents_duplicate_events(self):
        for _ in range(2):
            create_notification(
                recipient=self.player,
                notification_type=Notification.NotificationType.SYSTEM_ANNOUNCEMENT,
                title="One update",
                message="Only one row should exist.",
                deduplication_key="system:one-update",
            )

        self.assertEqual(Notification.objects.filter(deduplication_key="system:one-update").count(), 1)

    def test_team_invitation_email_is_transactional_and_deduplicated(self):
        invited_user = get_user_model().objects.create_user(
            email="email-invite@example.com",
            password="test-password",
            full_name="Email Invite Player",
            phone="9800000044",
            role="PLAYER",
        )
        invitation = TeamMember.objects.create(
            team=self.team,
            user=invited_user,
            member_type=TeamMember.MemberType.REGISTERED,
            role_in_team=TeamMember.TeamRole.PLAYER,
            cricksal_role=TeamMember.CricksalRole.BATSMAN,
            status=TeamMember.MemberStatus.INVITED,
        )

        with self.captureOnCommitCallbacks(execute=True):
            notify_team_invitation(invitation, self.captain)
            notify_team_invitation(invitation, self.captain)

        deliveries = EmailDelivery.objects.filter(
            recipient=invited_user,
            email_type=EmailDelivery.EmailType.TEAM_INVITATION,
        )
        self.assertEqual(deliveries.count(), 1)
        self.assertEqual(deliveries.get().status, EmailDelivery.Status.SENT)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(self.team.name, mail.outbox[0].body)
