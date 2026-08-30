export type ReliabilityImpact = "POSITIVE" | "NEGATIVE" | "NO_IMPACT" | "NEUTRAL";

export interface ReliabilitySummary {
  score: number | null;
  display_score: number | null;
  level: string;
  is_provisional: boolean;
  verified_games_considered: number;
  progress_percent: number;
}

export interface RatingSummary {
  average: string | null;
  has_rating: boolean;
  total_ratings: number;
  completed_games_represented: number;
  distribution: Array<{ rating: number; count: number }>;
  feedback_tags: string[];
}

export interface ReliabilityMetrics {
  completed_games: number;
  attendance_rate: number | null;
  commitments_honoured_rate: number | null;
  accountable_commitments: number;
  late_cancellations: number;
  no_shows: number;
  pending_attendance_reviews: number;
}

export interface ReliabilityBreakdownItem {
  title: string;
  description: string;
  value: number;
  impact: ReliabilityImpact;
}

export interface ReliabilityActivityItem {
  id?: number;
  title: string;
  description: string;
  impact: ReliabilityImpact;
  date: string | null;
  event_type?: string;
  points_delta?: number;
  related_entity_type?: string;
  related_entity_id?: number | null;
}

export interface PendingRatingItem {
  id: number;
  title: string;
  match_date: string;
  participants_awaiting_feedback: number;
  action_url: string;
  rated_player_name: string;
  rated_player_sportspot_id: string;
  rated_player_role: string;
  deadline_at: string | null;
  related_entity_type: string;
  related_entity_id: number;
}

export interface PendingAttendanceReview {
  id: number;
  title: string;
  source_type: "MATCHMAKING_GAME" | "TEAM_FIXTURE";
  source_id: number;
  source_participant_id: number;
  start_at: string;
  status: "NO_SHOW_REPORTED" | "DISPUTED";
  review_deadline_at: string | null;
  action_url: string;
  can_dispute: boolean;
}

export interface RecentRatingItem {
  id: number;
  value: string;
  related_game: string;
  match_date: string;
  feedback_tags: string[];
  comment: string;
}

export interface PlayerRatingsReliabilityResponse {
  profile_exists: boolean;
  last_updated: string | null;
  reliability: ReliabilitySummary;
  rating: RatingSummary;
  metrics: ReliabilityMetrics;
  breakdown: ReliabilityBreakdownItem[];
  activity: ReliabilityActivityItem[];
  pending_ratings: PendingRatingItem[];
  pending_attendance_reviews: PendingAttendanceReview[];
  recent_ratings: RecentRatingItem[];
  improvement_guidance: string;
}
