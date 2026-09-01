export type AdminSummary = {
  total_users: number;
  players: number;
  venue_owners: number;
  verified_users: number;
  active_users: number;
  today_bookings: number;
  today_revenue: string;
  last_30_day_revenue: string;
  pending_refunds: number;
  open_feedback_reports: number;
  attendance_disputes: number;
  active_games: number;
  active_challenges: number;
  live_scorecards: number;
  completed_scorecards: number;
};

export type AdminPipelineItem = {
  value: string;
  label: string;
  count: number;
};

export type AdminAttentionItem = {
  kind: "VENUE_REVIEW" | "FEEDBACK_REPORT" | "REFUND" | "ATTENDANCE_DISPUTE";
  id: number;
  title: string;
  detail: string;
  status: string;
  priority: "HIGH" | "NORMAL";
  created_at: string;
  href: string;
};

export type AdminOverviewResponse = {
  generated_at: string;
  today: string;
  summary: AdminSummary;
  venue_pipeline: AdminPipelineItem[];
  booking_pipeline: AdminPipelineItem[];
  payment_pipeline: AdminPipelineItem[];
  operations: {
    active_venues: number;
    active_courts: number;
    active_teams: number;
    scheduled_fixtures: number;
    unread_notifications: number;
    failed_emails: number;
  };
  attention: AdminAttentionItem[];
};

export type AdminUser = {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  role: "PLAYER" | "COURT_OWNER" | "ADMIN";
  is_active: boolean;
  email_verified: boolean;
  date_joined: string;
  venue: { id: number; name: string; status: string } | null;
  team_count: number;
  booking_count: number;
};

export type AdminBooking = {
  id: number;
  booking_code: string;
  player: { id: number; name: string; email: string };
  venue: { id: number; name: string };
  court: { id: number; name: string };
  slot_date: string;
  slot_start_time: string;
  slot_end_time: string;
  amount: string;
  status: string;
  payment_status: string;
  payment_provider: string;
  refund_status: string;
  refund_amount: string;
  refund_reason: string;
  check_in: boolean;
  matchmaking_game_id: number | null;
  created_at: string;
  updated_at: string;
};

export type AdminReport = {
  id: number;
  status: "OPEN" | "REVIEWED" | "DISMISSED";
  reason: string;
  reason_label: string;
  details: string;
  reporter: { id: number; name: string };
  target: {
    type: "review" | "comment";
    id: number | null;
    text: string;
    rating: number | null;
    author: string;
    court: string;
    venue: string;
  };
  created_at: string;
  updated_at: string;
};

export type AdminAttendanceRecord = {
  id: number;
  status: string;
  source_type: "MATCHMAKING_GAME" | "TEAM_FIXTURE";
  source_label: string;
  source_detail: string;
  source_id: number;
  player: { id: number; name: string; email: string };
  start_at: string;
  end_at: string;
  review_deadline_at: string | null;
  disputed_at: string | null;
  resolved_at: string | null;
  attendance_recorded_at: string | null;
  attendance_recorded_by: string | null;
  resolved_by: string | null;
  dispute_reason: string;
};

export type AdminOperationItem = {
  id: number;
  kind: "GAME" | "CHALLENGE" | "SCORECARD";
  title: string;
  status: string;
  subtitle: string;
  owner: string;
  schedule: string;
  location: string;
  meta: string[];
  updated_at: string;
};

export type AdminPagination = {
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};
