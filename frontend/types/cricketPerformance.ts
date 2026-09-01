export type CricketPerformancePeriod = "ALL" | "RECENT";

export interface CricketPerformanceMatch {
  match_id: number;
  fixture_id: number;
  challenge_id: number;
  source: "TEAM_CHALLENGE" | "INSTANT_SCORER";
  completed_at: string | null;
  team: { id: number; name: string };
  opponent: { id: number; name: string };
  result: string;
  batting: {
    played: boolean;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    dismissed: boolean;
    not_out: boolean;
  };
  bowling: {
    bowled: boolean;
    legal_balls: number;
    runs_conceded: number;
    wickets: number;
    wides: number;
    no_balls: number;
  };
  fielding: { catches: number; run_outs: number; stumpings: number };
}

export interface CricketPerformanceResponse {
  player: { name: string; sportspot_id: string; profile_photo: string; preferred_role: string };
  filters: { period: CricketPerformancePeriod; recent_days: number; teams: Array<{ id: number; name: string }> };
  summary: { matches: number; batting_innings: number; bowling_innings: number; not_outs: number };
  batting: {
    runs: number; balls: number; fours: number; sixes: number; innings: number; dismissals: number; not_outs: number;
    average: number | null; strike_rate: number | null;
  };
  bowling: {
    innings: number; legal_balls: number; runs_conceded: number; wickets: number; average: number | null; economy: number | null;
    three_wicket_hauls: number; five_wicket_hauls: number;
  };
  fielding: { catches: number; run_outs: number; stumpings: number };
  personal_bests: {
    highest_score: { runs: number; balls: number; not_out: boolean; opponent: string; fixture_id: number; challenge_id: number } | null;
    best_bowling: { wickets: number; runs_conceded: number; legal_balls: number; opponent: string; fixture_id: number; challenge_id: number } | null;
  };
  recent_form: CricketPerformanceMatch[];
  history: { page: number; page_size: number; total: number; has_next: boolean; matches: CricketPerformanceMatch[] };
}
