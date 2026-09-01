export type TeamSkillLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
export type CricksalRole = "BATSMAN" | "BOWLER" | "ALL_ROUNDER" | "WICKETKEEPER" | "NONE";
export type TeamMemberType = "REGISTERED" | "GUEST";
export type TeamMemberRole = "CAPTAIN" | "PLAYER" | "GUEST";
export type TeamMemberStatus = "ACTIVE" | "INVITED" | "REJECTED" | "LEFT" | "REMOVED";

export type TeamCricketScore = {
  runs: number;
  wickets: number;
  overs: string;
};

export type TeamCricketResult = {
  fixture_id: number;
  challenge_id: number;
  opponent: { id: number; name: string; team_photo: string };
  outcome: "WIN" | "LOSS" | "TIE" | "NO_RESULT";
  result: string;
  completed_at: string;
  team_score: TeamCricketScore | null;
  opponent_score: TeamCricketScore | null;
};

export type TeamCricketRecord = {
  matches_played: number;
  wins: number;
  losses: number;
  ties: number;
  no_results: number;
  win_rate: number | null;
  runs_for: number;
  runs_against: number;
  recent_results: TeamCricketResult[];
};

export interface TeamMember {
  id: number;
  user: number | null;
  full_name: string;
  display_name: string;
  is_guest: boolean;
  sportspot_id: string;
  skill_level: TeamSkillLevel | "";
  location: string;
  profile_photo: string;
  weekly_availability: string;
  playing_style: string;
  reliability_score: number | null;
  reliability_label: string;
  completed_matches_count: number;
  average_rating: string;
  guest_name: string;
  guest_phone: string;
  member_type: TeamMemberType;
  role_in_team: TeamMemberRole;
  cricksal_role: CricksalRole;
  status: TeamMemberStatus;
  joined_at: string;
  invited_at: string;
}

export interface Team {
  id: number;
  name: string;
  team_photo: string;
  description: string;
  location: string;
  preferred_playing_area: string;
  preferred_playing_time: string;
  skill_level: TeamSkillLevel;
  accepts_team_challenges: boolean;
  captain: number;
  captain_name: string;
  members_count: number;
  is_captain: boolean;
  team_reliability_score: number | null;
  team_reliability_label: string;
  average_rating: string;
  matches_played_count: number;
  cricket_record?: TeamCricketRecord;
  members?: TeamMember[];
  created_at: string;
  updated_at: string;
}

export interface MyTeamsResponse {
  teams: Team[];
}

export interface TeamResponse {
  team: Team;
}

export interface TeamPayload {
  name: string;
  description: string;
  location: string;
  preferred_playing_area: string;
  preferred_playing_time: string;
  skill_level: TeamSkillLevel;
  accepts_team_challenges: boolean;
}

export interface GuestMemberPayload {
  guest_name: string;
  guest_phone: string;
  cricksal_role: CricksalRole;
}

export interface PlayerLookup {
  user_id: number;
  full_name: string;
  sportspot_id: string;
  skill_level: TeamSkillLevel;
  location: string;
  preferred_cricksal_role: CricksalRole;
  reliability_score: number | null;
  completed_matches_count: number;
  average_rating: string;
  profile_photo: string;
  reliability_label: string;
}

export interface PlayerLookupResponse {
  player: PlayerLookup;
}

export interface TeamInvitation {
  id: number;
  team: number;
  team_name: string;
  team_description: string;
  team_location: string;
  team_preferred_playing_area: string;
  team_preferred_playing_time: string;
  team_skill_level: TeamSkillLevel;
  team_photo: string;
  team_members_count: number;
  team_reliability_score: number | null;
  team_reliability_label: string;
  team_average_rating: string;
  team_matches_played_count: number;
  team_created_at: string;
  captain_name: string;
  cricksal_role: CricksalRole;
  status: TeamMemberStatus;
  invited_at: string;
}

export interface TeamInvitationsResponse {
  invitations: TeamInvitation[];
}
