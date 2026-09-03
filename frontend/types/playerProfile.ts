export type PreferredSport = "CRICKSAL";
export type SkillLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
export type CricksalRole = "BATSMAN" | "BOWLER" | "ALL_ROUNDER" | "WICKETKEEPER" | "NONE";
export type AvailabilityDay = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type AvailabilityTimePeriod = "MORNING" | "AFTERNOON" | "EVENING" | "FLEXIBLE";
export type PlayerLocationSource = "GEOCODED" | "MANUAL_PIN" | "DEVICE_LOCATION" | "LEGACY_DISTRICT" | "";

export interface CricketSummary {
  matches: number;
  total_runs: number;
  best_score: number;
  wickets: number;
}

export interface PlayerProfile {
  id: number;
  user: number;
  full_name: string;
  email: string;
  sportspot_id: string;
  profile_photo: string;
  preferred_sport: PreferredSport;
  skill_level: SkillLevel;
  location: string;
  preferred_area: string;
  latitude: string | null;
  longitude: string | null;
  location_source: PlayerLocationSource;
  location_confirmed: boolean;
  location_updated_at: string | null;
  travel_radius_km: number;
  weekly_availability: string;
  availability_days: AvailabilityDay[];
  availability_time_periods: AvailabilityTimePeriod[];
  playing_style: string;
  bio: string;
  preferred_cricksal_role: CricksalRole;
  preferred_futsal_role?: string;
  reliability_score: number;
  average_rating: string;
  no_show_count: number;
  late_cancellation_count: number;
  completed_matches_count: number;
  profile_completion_percentage: number;
  is_profile_complete: boolean;
  reliability_label: string;
  cricket_summary: CricketSummary;
  created_at: string;
  updated_at: string;
}

export interface PlayerProfileResponse {
  exists: boolean;
  detail?: string;
  profile: PlayerProfile | null;
}

export interface PlayerProfilePayload {
  preferred_sport: PreferredSport;
  skill_level: SkillLevel;
  location: string;
  preferred_area: string;
  latitude: number | null;
  longitude: number | null;
  location_source: PlayerLocationSource;
  location_confirmed: boolean;
  travel_radius_km: number;
  weekly_availability: string;
  availability_days: AvailabilityDay[];
  availability_time_periods: AvailabilityTimePeriod[];
  playing_style: string;
  bio: string;
  preferred_cricksal_role: CricksalRole;
  remove_profile_photo?: boolean;
  remove_precise_location?: boolean;
}
