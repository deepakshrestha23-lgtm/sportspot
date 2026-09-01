import { expect, test } from "@playwright/test";

const teamLogo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%2300873d'/%3E%3C/svg%3E";

const fixture = {
  id: 123,
  status: "SCHEDULED",
  status_label: "Scheduled",
  room_state: "CONFIRMED",
  room_access: "CONFIRMED",
  booking_summary: null,
  result: "",
  result_submitted_at: null,
  result_confirmed_at: null,
  scorecard: { available: false, can_set_up: true },
  participants: [
    participant(1, 1, "Home Captain", "Home XI"),
    participant(2, 1, "Home One", "Home XI"),
    participant(3, 1, "Home Two", "Home XI"),
    participant(4, 2, "Away Captain", "Away XI"),
    participant(5, 2, "Away One", "Away XI"),
    participant(6, 2, "Away Two", "Away XI"),
  ],
  permissions: {
    is_captain: true,
    team_id: 1,
    can_manage_lineup: true,
    can_record_attendance: false,
    can_submit_result: false,
    can_confirm_result: false,
    scorecard_result_pending_acknowledgement: false,
  },
  created_at: "2026-08-31T10:00:00Z",
  updated_at: "2026-08-31T10:00:00Z",
};

const challenge = {
  id: 42,
  source: "TEAM_CHALLENGE",
  challenger_team: { id: 1, name: "Home XI" },
  challenged_team: { id: 2, name: "Away XI" },
};

const players = {
  home: [squadPlayer(11, 1, "Home Captain"), squadPlayer(12, 2, "Home One"), squadPlayer(13, 3, "Home Two")],
  away: [squadPlayer(21, 4, "Away Captain"), squadPlayer(22, 5, "Away One"), squadPlayer(23, 6, "Away Two")],
};

function participant(id: number, team: number, playerName: string, teamName: string) {
  return { id, team, team_name: teamName, player: id, player_name: playerName, sportspot_id: `SSP-${id}`, status: "SELECTED", status_label: "Selected", attendance_recorded_at: null, created_at: "2026-08-31T10:00:00Z" };
}

function squadPlayer(id: number, playerId: number, name: string) {
  return { id, player_id: playerId, name, batting_order: id % 10 };
}

function scorecard(overrides: Record<string, unknown> = {}) {
  return {
    id: 88,
    fixture_id: 123,
    status: "SETUP",
    overs_per_innings: 6,
    toss: { winner_team_id: null, winner_team_name: "", decision: "", first_batting_team_id: null, second_batting_team_id: null },
    scorer: { id: null, name: "" },
    teams: [
      { id: 1, name: "Home XI", team_photo: teamLogo, squad_confirmed: false, squad_confirmed_at: null, players: [] },
      { id: 2, name: "Away XI", team_photo: teamLogo, squad_confirmed: false, squad_confirmed_at: null, players: [] },
    ],
    innings: [],
    active_innings_id: null,
    chase: null,
    result: "",
    permissions: { can_view: true, is_captain: true, team_id: 1, is_assigned_scorer: false, can_score: true, can_confirm_squad: true, can_assign_scorer: true },
    can_start_innings: false,
    ...overrides,
  };
}

function confirmedSetup() {
  return scorecard({
    teams: [
      { id: 1, name: "Home XI", team_photo: teamLogo, squad_confirmed: true, squad_confirmed_at: "2026-08-31T10:01:00Z", players: players.home },
      { id: 2, name: "Away XI", team_photo: teamLogo, squad_confirmed: true, squad_confirmed_at: "2026-08-31T10:01:00Z", players: players.away },
    ],
  });
}

function liveScore(totalRuns: number, lastOver: string[]) {
  return scorecard({
    status: "INNINGS_ONE",
    toss: { winner_team_id: 1, winner_team_name: "Home XI", decision: "BAT", first_batting_team_id: 1, second_batting_team_id: 2 },
    teams: [
      { id: 1, name: "Home XI", team_photo: teamLogo, squad_confirmed: true, squad_confirmed_at: "2026-08-31T10:01:00Z", players: players.home },
      { id: 2, name: "Away XI", team_photo: teamLogo, squad_confirmed: true, squad_confirmed_at: "2026-08-31T10:01:00Z", players: players.away },
    ],
    innings: [{
      id: 501,
      number: 1,
      status: "IN_PROGRESS",
      closing_reason: "",
      batting_team_id: 1,
      batting_team_name: "Home XI",
      bowling_team_id: 2,
      bowling_team_name: "Away XI",
      target_runs: null,
      total_runs: totalRuns,
      wickets: 0,
      legal_balls: lastOver.length,
      overs: `0.${lastOver.length}`,
      run_rate: totalRuns ? totalRuns * 6 : 0,
      extras: { wides: 0, no_balls: 0, byes: 0, leg_byes: 0, total: 0 },
      current_striker_id: 11,
      current_non_striker_id: 12,
      current_bowler_id: 21,
      current_striker_name: "Home Captain",
      current_non_striker_name: "Home One",
      current_bowler_name: "Away Captain",
      partnership: { runs: totalRuns, balls: lastOver.length },
      last_over: lastOver,
      deliveries: lastOver.map((token, index) => ({ id: 900 + index, sequence: index + 1, token, runs_off_bat: Number(token) || 0, extra_type: "NONE", extra_runs: 0, wicket_kind: "NONE", dismissed_player_id: null, fielder_id: null, incoming_batsman_id: null })),
      batting: [],
      bowling: [],
      fall_of_wickets: [],
    }],
    active_innings_id: 501,
  });
}

function wicketScore() {
  const next = liveScore(0, ["W"]) as unknown as {
    innings: Array<{
      wickets: number;
      current_striker_id: number;
      current_striker_name: string;
      current_non_striker_id: number;
      current_non_striker_name: string;
    }>;
  };
  next.innings[0].wickets = 1;
  next.innings[0].current_striker_id = 12;
  next.innings[0].current_striker_name = "Home One";
  next.innings[0].current_non_striker_id = 13;
  next.innings[0].current_non_striker_name = "Home Two";
  return next;
}

test("captain can move from scorecard setup to a corrected live ball", async ({ page }) => {
  await page.route("**/api/team-challenges/challenges/42/room/", async (route) => route.fulfill({ json: { challenge, fixture } }));
  await page.route("**/api/scoring/fixtures/123/", async (route) => route.fulfill({ json: { scorecard: null } }));
  await page.route("**/api/scoring/fixtures/123/setup/", async (route) => route.fulfill({ json: { scorecard: scorecard() } }));
  await page.route("**/api/scoring/fixtures/123/squad/", async (route) => route.fulfill({ json: { scorecard: confirmedSetup() } }));
  await page.route("**/api/scoring/fixtures/123/toss/", async (route) => route.fulfill({ json: { scorecard: scorecard({ ...confirmedSetup(), toss: { winner_team_id: 1, winner_team_name: "Home XI", decision: "BAT", first_batting_team_id: 1, second_batting_team_id: 2 }, can_start_innings: true }) } }));
  await page.route("**/api/scoring/fixtures/123/innings/start/", async (route) => route.fulfill({ json: { scorecard: liveScore(0, []) } }));
  await page.route("**/api/scoring/fixtures/123/deliveries/edit/", async (route) => route.fulfill({ json: { scorecard: liveScore(0, ["0"]) } }));
  await page.route("**/api/scoring/fixtures/123/deliveries/", async (route) => {
    const body = route.request().postDataJSON() as { wicket_kind?: string };
    return route.fulfill({ json: { scorecard: body.wicket_kind ? wicketScore() : liveScore(4, ["4"]) } });
  });

  await page.goto("/challenge-teams/42/scorer");
  await expect(page.getByRole("heading", { name: "Set up the scorecard" })).toBeVisible();
  await page.getByRole("button", { name: "Set up scorer" }).click();
  await expect(page.getByRole("heading", { name: "Confirm match squads" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm 3 players" }).click();
  await expect(page.getByRole("heading", { name: "Record toss" })).toBeVisible();
  await page.getByRole("button", { name: "Save toss" }).click();
  await expect(page.getByRole("heading", { name: "Start first innings" })).toBeVisible();
  await page.getByRole("button", { name: "Use first listed players" }).click();
  await page.getByRole("button", { name: "Start innings" }).click();
  await expect(page.getByRole("heading", { name: "Home Captain on strike" })).toBeVisible();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await expect(page.getByText("4/0", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Correct last ball" }).click();
  await expect(page.getByText("Choose the replacement outcome for the latest ball.")).toBeVisible();
  await page.getByRole("button", { name: "0", exact: true }).click();
  await expect(page.getByText("0/0", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Wicket" }).click();
  await page.getByLabel("Dismissed batter").selectOption("11");
  await page.getByLabel("Incoming batter").selectOption("13");
  await page.getByRole("button", { name: "Record wicket" }).click();
  await expect(page.getByText("0/1", { exact: true }).first()).toBeVisible();
});

test("an existing live scorecard opens directly instead of showing new setup", async ({ page }) => {
  const liveFixture = {
    ...fixture,
    status: "IN_PROGRESS",
    scorecard: { available: true, id: 88, status: "INNINGS_ONE", can_view: true, can_score: true, can_set_up: false },
  };
  await page.route("**/api/team-challenges/challenges/42/room/", async (route) => route.fulfill({ json: { challenge, fixture: liveFixture } }));
  await page.route("**/api/scoring/fixtures/123/", async (route) => route.fulfill({ json: { scorecard: liveScore(4, ["4"]) } }));

  await page.goto("/challenge-teams/42/scorer");

  await expect(page.getByRole("heading", { name: "Home Captain on strike" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up the scorecard" })).toHaveCount(0);
  await expect(page.getByAltText("Home XI team logo")).toBeVisible();
  await expect(page.getByAltText("Away XI team logo")).toBeVisible();
  await expect(page.getByRole("button", { name: "4", exact: true })).toBeVisible();
});

test("player can open the scorer hub for a confirmed booked fixture", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sportspot_user", JSON.stringify({ id: 1, full_name: "Home Captain", role: "PLAYER" }));
  });
  await page.route("**/api/venues/bookings/my/", async (route) => route.fulfill({ json: { bookings: [] } }));
  await page.route("**/api/notifications/**", async (route) => route.fulfill({ json: { unseen_count: 0, notifications: [], next: null } }));
  await page.route("**/api/scoring/match-requests/", async (route) => route.fulfill({ json: { incoming: [], outgoing: [] } }));
  await page.route("**/api/scoring/teams/", async (route) => route.fulfill({ json: { my_teams: [], opponents: [] } }));
  await page.route("**/api/scoring/fixtures/available/", async (route) => route.fulfill({
    json: {
      fixtures: [{
        fixture_id: 123,
        challenge_id: 42,
        match_source: "TEAM_CHALLENGE",
        status: "SCHEDULED",
        status_label: "Scheduled",
        scorecard_available: false,
        scorecard_status: null,
        scorecard_result: "",
        can_view: false,
        can_score: false,
        can_set_up: true,
        is_captain: true,
        is_assigned_scorer: false,
        challenger_team: { id: 1, name: "Home XI" },
        challenged_team: { id: 2, name: "Away XI" },
        booking: {
          id: 88,
          booking_code: "SSB-TEST-88",
          venue_name: "SportSpot Ground",
          venue_area: "Baneshwor",
          venue_city: "Kathmandu",
          court_name: "Court 1",
          start_at: "2026-09-02T18:00:00+05:45",
          end_at: "2026-09-02T19:00:00+05:45",
          amount: "1500.00",
          status: "CONFIRMED",
          payment_status: "PAID",
        },
      }],
    },
  }));

  await page.goto("/scorer");
  await expect(page.getByRole("heading", { name: "Cricket Scorer" })).toBeVisible();
  await page.getByRole("tab", { name: /Ready to Score/ }).click();
  await expect(page.getByRole("heading", { name: "Home XI vs Away XI" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Set up scorer/ })).toHaveAttribute("href", "/challenge-teams/42/scorer");
  await expect(page.getByRole("link", { name: "Cricket Scorer" })).toHaveAttribute("aria-current", "page");
});

test("completed scorer cards open the final scorecard viewer", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sportspot_user", JSON.stringify({ id: 1, full_name: "Home Captain", role: "PLAYER" }));
  });
  await page.route("**/api/venues/bookings/my/", async (route) => route.fulfill({ json: { bookings: [] } }));
  await page.route("**/api/notifications/**", async (route) => route.fulfill({ json: { unseen_count: 0, notifications: [], next: null } }));
  await page.route("**/api/scoring/match-requests/", async (route) => route.fulfill({ json: { incoming: [], outgoing: [] } }));
  await page.route("**/api/scoring/teams/", async (route) => route.fulfill({ json: { my_teams: [], opponents: [] } }));
  await page.route("**/api/scoring/fixtures/available/", async (route) => route.fulfill({ json: {
    fixtures: [{
      fixture_id: 77,
      challenge_id: 42,
      match_source: "INSTANT_SCORER",
      status: "COMPLETED",
      status_label: "Completed",
      scorecard_available: true,
      scorecard_status: "COMPLETED",
      scorecard_result: "Home XI won by 3 runs",
      can_view: true,
      can_set_up: false,
      can_score: false,
      is_captain: true,
      is_assigned_scorer: true,
      challenger_team: { id: 1, name: "Home XI" },
      challenged_team: { id: 2, name: "Away XI" },
      booking: null,
    }],
  } }));

  await page.goto("/scorer");
  await page.getByRole("tab", { name: /Completed/ }).click();
  await expect(page.getByRole("link", { name: "View scorecard" })).toHaveAttribute("href", "/dashboard/player/performance/scorecards/77");
});

test("captain can send an instant scoring request from the scorer home", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sportspot_user", JSON.stringify({ id: 1, full_name: "Home Captain", role: "PLAYER" }));
  });
  await page.route("**/api/venues/bookings/my/", async (route) => route.fulfill({ json: { bookings: [] } }));
  await page.route("**/api/notifications/**", async (route) => route.fulfill({ json: { unseen_count: 0, notifications: [], next: null } }));
  await page.route("**/api/scoring/fixtures/available/", async (route) => route.fulfill({ json: { fixtures: [] } }));
  await page.route("**/api/scoring/match-requests/", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { challenger_team_id: number; challenged_team_id: number };
      expect(body.challenger_team_id).toBe(1);
      expect(body.challenged_team_id).toBe(2);
      return route.fulfill({ status: 201, json: { request: { id: 31 } } });
    }
    return route.fulfill({ json: { incoming: [], outgoing: [] } });
  });
  await page.route("**/api/scoring/teams/**", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    return route.fulfill({
      json: {
        my_teams: [{ id: 1, name: "Home XI", team_photo: "", location: "Kathmandu", skill_level: "INTERMEDIATE", captain_name: "Home Captain", active_players: 6 }],
        opponents: search ? [{ id: 2, name: "Away XI", team_photo: "", location: "Lalitpur", skill_level: "INTERMEDIATE", captain_name: "Away Captain", active_players: 6 }] : [],
      },
    });
  });

  await page.goto("/scorer");
  await page.getByLabel("My team").selectOption("1");
  await page.getByLabel("Find opponent").fill("Away");
  await expect(page.getByRole("button", { name: /Away XI/ })).toBeVisible();
  await page.getByRole("button", { name: /Away XI/ }).click();
  await page.getByRole("button", { name: "Send match request" }).click();
  await expect(page.getByRole("heading", { name: "Cricket Scorer" })).toBeVisible();
});

test("instant scored matches redirect old game-room URLs into the scorer workspace", async ({ page }) => {
  const instantChallenge = { ...challenge, source: "INSTANT_SCORER" };
  await page.route("**/api/team-challenges/challenges/42/room/", async (route) => route.fulfill({ json: { challenge: instantChallenge, fixture } }));
  await page.route("**/api/scoring/fixtures/123/", async (route) => route.fulfill({ json: { scorecard: null } }));
  await page.route("**/api/team-challenges/fixtures/123/eligible-players/", async (route) => route.fulfill({ json: { players: [] } }));

  await page.goto("/challenge-teams/42/room");

  await expect(page).toHaveURL("/challenge-teams/42/scorer");
  await expect(page.getByRole("button", { name: "Match chat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Game room" })).toHaveCount(0);
});
