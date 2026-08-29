import type { Booking } from "@/types/venue";

export type GameType = "PICKUP" | "FILL_SQUAD";
export type GameCreationMode = "BOOKING_FIRST" | "PLAN_FIRST";
export type GameIntensity = "CASUAL" | "COMPETITIVE" | "PRACTICE";
export type GameStatus = "DRAFT" | "RECRUITING" | "FULL" | "CLOSED" | "BOOKING_PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type GameSkillLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "OPEN";
export type GameRole = "BATSMAN" | "BOWLER" | "ALL_ROUNDER" | "WICKETKEEPER" | "ANY";
export type JoinRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WAITLISTED" | "INVITED" | "WITHDRAWN" | "REMOVED" | "EXPIRED";
export type ParticipantStatus = "CONFIRMED" | "PROVISIONAL" | "RECONFIRM_REQUIRED" | "GUEST_CONFIRMATION_REQUIRED" | "DECLINED" | "LEFT" | "REMOVED";

export type GameRoleRequirement = {
  id: number;
  role: GameRole;
  role_label: string;
  required_count: number;
};

export type GameRoleProgress = GameRoleRequirement & {
  filled_count: number;
  available_count: number;
  is_filled: boolean;
};

export type GameParticipant = {
  id: number;
  user: number | null;
  full_name: string;
  guest_name: string;
  sportspot_id: string;
  skill_level: string;
  reliability_label: string;
  average_rating: string;
  profile_photo: string;
  participant_type: "HOST" | "TEAM_MEMBER" | "TEMPORARY" | "GUEST";
  participant_type_label: string;
  role: GameRole;
  role_label: string;
  status: ParticipantStatus;
  status_label: string;
  reconfirmation_required: boolean;
  reconfirmation_kind: "PLAYER_RESPONSE" | "HOST_ACKNOWLEDGEMENT" | "NONE";
  joined_at: string;
};

export type GameUserState = {
  is_host: boolean;
  is_participant: boolean;
  participant_status?: ParticipantStatus | "";
  requires_reconfirmation: boolean;
  reconfirmation_status?: "PENDING" | "";
  request_status: JoinRequestStatus | "";
  join_request_id: number | null;
  room_access?: "NONE" | "PLANNING" | "RECONFIRMATION" | "CONFIRMED" | "READ_ONLY";
};

export type MatchmakingGame = {
  id: number;
  game_type: GameType;
  creation_mode: GameCreationMode;
  creation_mode_label: string;
  game_intensity: GameIntensity;
  game_intensity_label: string;
  status: GameStatus;
  status_label: string;
  title: string;
  description: string;
  host_notes: string;
  game_room_note: string;
  reporting_instructions: string;
  equipment_instructions: string;
  host: number;
  host_name: string;
  host_sportspot_id: string;
  host_reliability_label: string;
  team: number | null;
  team_name: string;
  team_photo: string;
  team_location: string;
  team_skill_level: string;
  team_members_count: number;
  squad_summary: {
    permanent_count: number;
    temporary_count: number;
    guest_count: number;
    permanent_roles: Record<string, number>;
    temporary_roles: Record<string, number>;
  };
  booking: number | null;
  booking_code: string;
  booking_amount: string;
  booking_status: string;
  payment_status: string;
  venue_name: string;
  venue_area: string;
  venue_city: string;
  venue_address: string;
  venue_latitude: number | string | null;
  venue_longitude: number | string | null;
  venue_map_location: string;
  court_name: string;
  booking_display_time: string;
  start_at: string | null;
  end_at: string | null;
  date: string;
  proposed_date: string | null;
  proposed_start_time: string | null;
  proposed_end_time: string | null;
  preferred_district: string;
  preferred_area: string;
  preferred_venue_name: string;
  alternative_details: string;
  booking_deadline: string | null;
  booking_attached_at: string | null;
  requires_reconfirmation: boolean;
  is_booking_verified: boolean;
  min_skill_level: GameSkillLevel;
  total_capacity: number;
  minimum_players_to_proceed: number;
  waitlist_enabled: boolean;
  recruitment_deadline: string | null;
  is_public: boolean;
  confirmed_participants_count: number;
  provisional_participants_count: number;
  occupied_spots_count: number;
  available_spots: number;
  waitlist_count: number;
  reconfirmation_pending_count: number;
  guest_confirmation_pending_count: number;
  registered_reconfirmation_pending_count: number;
  role_requirements: GameRoleRequirement[];
  role_progress: GameRoleProgress[];
  participants: GameParticipant[];
  user_state: GameUserState;
  published_at: string;
  created_at: string;
  updated_at: string;
};

export type JoinRequest = {
  id: number;
  game: number;
  game_title: string;
  player: number;
  player_name: string;
  sportspot_id: string;
  skill_level: string;
  reliability_label: string;
  average_rating: string;
  requested_role: GameRole;
  requested_role_label: string;
  message: string;
  attendance_confirmed: boolean;
  status: JoinRequestStatus;
  waitlist_position: number | null;
  created_at: string;
  updated_at: string;
};

export type EligibleGameBooking = Pick<
  Booking,
  "id" | "booking_code" | "amount" | "venue_name" | "court_name"
> & {
  venue_area: string;
  venue_city: string;
  booking_display_time: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  payment_status: string;
};

export type GameCreatePayload = {
  client_request_id?: string;
  game_type: GameType;
  creation_mode: GameCreationMode;
  booking_id?: number | null;
  team_id?: number | null;
  selected_team_member_ids?: number[];
  title: string;
  description?: string;
  host_notes?: string;
  game_room_note?: string;
  reporting_instructions?: string;
  equipment_instructions?: string;
  game_intensity: GameIntensity;
  min_skill_level: GameSkillLevel;
  total_capacity: number;
  minimum_players_to_proceed: number;
  waitlist_enabled: boolean;
  recruitment_deadline?: string | null;
  proposed_date?: string | null;
  proposed_start_time?: string | null;
  proposed_end_time?: string | null;
  preferred_district?: string;
  preferred_area?: string;
  preferred_venue_name?: string;
  alternative_details?: string;
  booking_deadline?: string | null;
  role_requirements: Array<{ role: GameRole; required_count: number }>;
  guests?: Array<{ name: string; role: GameRole }>;
};

export type GameListResponse = { games: MatchmakingGame[] };
export type GameResponse = { game: MatchmakingGame; room_access?: "NONE" | "PLANNING" | "RECONFIRMATION" | "CONFIRMED" | "READ_ONLY" };
export type EligibleBookingsResponse = { bookings: EligibleGameBooking[] };
export type JoinRequestResponse = { request: JoinRequest };

export type GamePlayerLookup = {
  id: number;
  full_name: string;
  sportspot_id: string;
  skill_level: string;
  preferred_role: GameRole | "";
  reliability_label: string;
  average_rating: string;
  profile_photo: string;
};
export type GamePlayerLookupResponse = { player: GamePlayerLookup };

export type MyGamesResponse = {
  upcoming: MatchmakingGame[];
  hosted: MatchmakingGame[];
  requests: JoinRequest[];
  incoming_requests: JoinRequest[];
  completed: MatchmakingGame[];
  cancelled: MatchmakingGame[];
  team_matches?: {
    upcoming: MyTeamMatch[];
    completed: MyTeamMatch[];
    cancelled: MyTeamMatch[];
  };
};

export type MyTeamMatch = {
  id: number;
  challenge_id: number;
  status: string;
  status_label: string;
  room_access: "NONE" | "RECONFIRMATION" | "CONFIRMED" | "IN_PROGRESS" | "READ_ONLY";
  is_captain: boolean;
  is_participant: boolean;
  team_name: string;
  team_photo: string;
  opponent_team_name: string;
  opponent_team_photo: string;
  booking_summary: {
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
  } | null;
  result: string;
  created_at: string;
  updated_at: string;
};

