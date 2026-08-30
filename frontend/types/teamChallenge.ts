export type TeamChallengeType = "DIRECT" | "OPEN";
export type TeamChallengeCourtMode = "PLAN_FIRST" | "BOOKING_FIRST";
export type TeamChallengeStatus =
  | "OPEN"
  | "COUNTERED"
  | "ACCEPTED_AWAITING_BOOKING"
  | "RECONFIRMATION_REQUIRED"
  | "CONFIRMED"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "CANCELLED"
  | "COMPLETED";

export type ChallengeTeamSummary = {
  id: number;
  name: string;
  team_photo: string;
  description: string;
  location: string;
  preferred_playing_area: string;
  preferred_playing_time: string;
  skill_level: string;
  accepts_team_challenges: boolean;
  captain_name: string;
  members_count: number;
  created_at: string;
};

export type ChallengeBookingSummary = {
  id: number;
  booking_code: string;
  venue_name: string;
  venue_area: string;
  venue_city: string;
  court_name: string;
  start_at: string | null;
  end_at: string | null;
  amount: string;
  status: string;
  payment_status: string;
};

export type ChallengeProposal = {
  id: number;
  version: number;
  created_by_team: number;
  created_by_team_name: string;
  court_mode: TeamChallengeCourtMode;
  booking_summary: ChallengeBookingSummary | null;
  proposed_date: string | null;
  proposed_start_time: string | null;
  proposed_end_time: string | null;
  preferred_district: string;
  preferred_area: string;
  preferred_venue_name: string;
  players_per_side: number;
  intensity: string;
  message: string;
  response_deadline: string;
  booking_deadline: string | null;
  challenger_decision: string;
  challenged_decision: string;
  created_at: string;
  is_current: boolean;
};

export type OpenChallengeResponse = {
  id: number;
  responding_team: ChallengeTeamSummary;
  message: string;
  status: string;
  status_label: string;
  created_at: string;
  updated_at: string;
};

export type TeamFixture = {
  id: number;
  status: string;
  status_label: string;
  room_state: "PLANNING" | "RECONFIRMATION" | "CONFIRMED" | "IN_PROGRESS" | "READ_ONLY";
  room_access: "NONE" | "PLANNING" | "RECONFIRMATION" | "CONFIRMED" | "IN_PROGRESS" | "READ_ONLY";
  booking_summary: ChallengeBookingSummary | null;
  result: string;
  result_submitted_at: string | null;
  result_confirmed_at: string | null;
  participants: TeamFixtureParticipant[];
  permissions: TeamFixturePermissions;
  created_at: string;
  updated_at: string;
};

export type TeamFixturePermissions = {
  is_captain: boolean;
  team_id: number | null;
  can_manage_lineup: boolean;
  can_record_attendance: boolean;
  can_submit_result: boolean;
  can_confirm_result: boolean;
  can_view_room?: boolean;
};

export type FixtureEligiblePlayer = {
  player_id: number;
  player_name: string;
  sportspot_id: string;
  skill_level: string;
  cricksal_role: string;
};

export type TeamFixtureParticipant = {
  id: number;
  team: number;
  team_name: string;
  player: number;
  player_name: string;
  sportspot_id: string;
  status: string;
  status_label: string;
  attendance_recorded_at: string | null;
  attendance?: {
    id?: number;
    status: string;
    review_deadline_at: string | null;
    can_dispute: boolean;
  };
  created_at: string;
};

export type TeamChallengePermissions = {
  is_captain: boolean;
  is_challenger: boolean;
  is_challenged: boolean;
  can_respond: boolean;
  can_accept: boolean;
  can_counter: boolean;
  can_withdraw: boolean;
  can_cancel: boolean;
  can_select_opponent: boolean;
  can_attach_booking: boolean;
  can_withdraw_response: boolean;
  can_reconfirm: boolean;
  can_reschedule: boolean;
  can_view_room: boolean;
};

export type TeamChallenge = {
  id: number;
  challenge_type: TeamChallengeType;
  court_mode: TeamChallengeCourtMode;
  status: TeamChallengeStatus;
  status_label: string;
  is_public: boolean;
  is_open_for_response: boolean;
  is_open_for_opponent_response: boolean;
  response_deadline: string;
  booking_deadline: string | null;
  reconfirmation_requested_at: string | null;
  reconfirmation_deadline: string | null;
  challenger_team: ChallengeTeamSummary;
  challenged_team: ChallengeTeamSummary | null;
  current_proposal: ChallengeProposal;
  booking_summary: ChallengeBookingSummary | null;
  fixture: TeamFixture | null;
  open_response_count: number;
  open_responses: OpenChallengeResponse[];
  my_open_response: OpenChallengeResponse | null;
  permissions: TeamChallengePermissions;
  created_at: string;
  updated_at: string;
};

export type ChallengeFilterOption = { value: string; label: string };

export type ChallengeTabKey = "teams" | "open" | "mine";
export type ChallengeReferenceResponse = {
  filters: {
    districts: ChallengeFilterOption[];
    areas_by_district: Record<string, ChallengeFilterOption[]>;
    skill_levels: ChallengeFilterOption[];
    intensities: ChallengeFilterOption[];
    court_modes: ChallengeFilterOption[];
    statuses: ChallengeFilterOption[];
    sort_options: Record<ChallengeTabKey, ChallengeFilterOption[]>;
  };
};

export type TeamChallengeListResponse = { count: number; challenges: TeamChallenge[] };
export type TeamChallengeResponse = { challenge: TeamChallenge };
export type ChallengeTeamListResponse = { count: number; teams: ChallengeTeamSummary[] };
