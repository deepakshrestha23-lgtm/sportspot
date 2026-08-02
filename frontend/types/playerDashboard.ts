export interface PlayerDashboardOverviewResponse {
  player: {
    full_name: string;
    sportspot_id: string;
  };
  profile: {
    exists: boolean;
    is_complete: boolean;
    completion_percentage: number;
    reliability_score: number | null;
    reliability_label: string;
    completed_matches_count: number;
  };
  summary: {
    team_count: number;
    upcoming_game_count: number;
    upcoming_booking_count: number;
    pending_payment_count: number;
  };
  next_activity: PlayerNextActivity | null;
  pending_actions: PlayerPendingAction[];
  recent_activity: PlayerRecentActivity[];
}

export interface PlayerNextActivity {
  type: "BOOKING";
  title: string;
  status: string;
  booking_id: number;
  booking_code: string;
  venue_name: string;
  court_name: string;
  date: string;
  start_at: string | null;
  end_at: string | null;
  display_time: string;
  amount: string;
  action_url: string;
  game_room_url?: string;
}

export interface PlayerPendingAction {
  id: string;
  type: "TEAM_INVITATION" | "BOOKING_PAYMENT" | string;
  title: string;
  message: string;
  created_at: string | null;
  action_url: string;
  status: string;
}

export interface PlayerRecentActivity {
  id: number;
  type: string;
  category: string;
  title: string;
  message: string;
  created_at: string;
  action_url: string;
  status: string;
}
