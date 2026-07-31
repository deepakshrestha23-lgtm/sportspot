export type NotificationCategory = "TEAMS" | "CHALLENGES" | "MATCHES" | "BOOKINGS" | "SYSTEM";
export type NotificationPriority = "NORMAL" | "IMPORTANT" | "URGENT";
export type NotificationActionStatus = "NONE" | "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "COMPLETED";

export type NotificationType =
  | "TEAM_INVITATION_RECEIVED"
  | "TEAM_INVITATION_ACCEPTED"
  | "TEAM_INVITATION_REJECTED"
  | "TEAM_MEMBER_JOINED"
  | "TEAM_MEMBER_REMOVED"
  | "JOIN_REQUEST_RECEIVED"
  | "JOIN_REQUEST_ACCEPTED"
  | "JOIN_REQUEST_REJECTED"
  | "CHALLENGE_RECEIVED"
  | "CHALLENGE_ACCEPTED"
  | "CHALLENGE_REJECTED"
  | "CHALLENGE_COUNTERED"
  | "CHALLENGE_EXPIRED"
  | "MATCH_SCHEDULED"
  | "MATCH_UPDATED"
  | "MATCH_CANCELLED"
  | "MATCH_REMINDER"
  | "GAME_ROOM_CREATED"
  | "GAME_ROOM_UPDATED"
  | "RATING_REQUIRED"
  | "BOOKING_RESERVED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_PAYMENT_FAILED"
  | "BOOKING_CANCELLED_BY_PLAYER"
  | "BOOKING_CANCELLED_BY_OWNER"
  | "BOOKING_REMINDER"
  | "BOOKING_COMPLETED"
  | "REFUND_PENDING"
  | "REFUND_APPROVED"
  | "REFUND_REJECTED"
  | "REFUND_COMPLETED"
  | "VENUE_MESSAGE"
  | "VENUE_SUBMITTED"
  | "VENUE_APPROVED"
  | "VENUE_NEEDS_CHANGES"
  | "VENUE_REJECTED"
  | "VENUE_SUSPENDED"
  | "DISPUTE_CREATED"
  | "DISPUTE_UPDATED"
  | "DISPUTE_RESOLVED"
  | "SYSTEM_ANNOUNCEMENT"
  | "TEAM_INVITATION"
  | "INVITATION_ACCEPTED"
  | "INVITATION_REJECTED"
  | "BOOKING_CANCELLED"
  | "REFUND_REQUESTED"
  | "REFUND_UPDATED";

export interface NotificationAction {
  key: "open" | "accept" | "reject" | string;
  label: string;
  style: "primary" | "secondary" | "danger";
  url: string;
}

export interface SportSpotNotification {
  id: number;
  notification_type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  action_url: string;
  related_entity_type: string;
  related_entity_id: number | null;
  action_required: boolean;
  action_status: NotificationActionStatus;
  is_seen: boolean;
  seen_at: string | null;
  is_read: boolean;
  read_at: string | null;
  metadata: Record<string, unknown>;
  actor_name: string;
  actor_avatar: string;
  actions: NotificationAction[];
  time_label: string;
  full_time: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: SportSpotNotification[];
  unseen_count: number;
}

export interface NotificationCountResponse {
  unseen_count: number;
  latest_notification: {
    id: number;
    title: string;
    created_at: string;
  } | null;
}

export interface NotificationActionResponse {
  detail: string;
  target_url?: string;
  notification: SportSpotNotification;
  unseen_count: number;
}
