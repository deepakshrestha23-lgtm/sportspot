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
  booking_summary: ChallengeBookingSummary | null;
  result: string;
  created_at: string;
  updated_at: string;
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

export type TeamChallengeListResponse = { challenges: TeamChallenge[] };
export type TeamChallengeResponse = { challenge: TeamChallenge };
export type ChallengeTeamListResponse = { teams: ChallengeTeamSummary[] };
