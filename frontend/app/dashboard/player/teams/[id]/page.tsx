
"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { emitToast } from "@/lib/toast";
import type { CricksalRole, GuestMemberPayload, PlayerLookup, PlayerLookupResponse, Team, TeamMember, TeamPayload, TeamResponse, TeamSkillLevel } from "@/types/team";
import type { TeamChallenge, TeamChallengeListResponse } from "@/types/teamChallenge";

type TeamTab = "overview" | "members" | "games" | "challenges" | "settings";
type MemberTab = "registered" | "guests" | "invitations";
type RecruitTab = "registered" | "guest";
type ConfirmAction = { title: string; message: string; confirmLabel: string; tone: "danger" | "normal"; onConfirm: () => Promise<void> | void } | null;

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];
const playingTimes = ["Weekday evenings", "Saturday morning", "Saturday afternoon", "Saturday evening", "Sunday morning", "Sunday afternoon", "Sunday evening", "Flexible"];
const skills: Array<{ label: string; value: TeamSkillLevel }> = [
  { label: "Beginner", value: "BEGINNER" },
  { label: "Intermediate", value: "INTERMEDIATE" },
  { label: "Advanced", value: "ADVANCED" },
];
const cricksalRoles: Array<{ label: string; value: CricksalRole }> = [
  { label: "Batsman", value: "BATSMAN" },
  { label: "Bowler", value: "BOWLER" },
  { label: "All-rounder", value: "ALL_ROUNDER" },
  { label: "Wicketkeeper", value: "WICKETKEEPER" },
  { label: "None", value: "NONE" },
];

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const teamId = params.id;

  const [team, setTeam] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState<TeamPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TeamTab>("overview");
  const [memberTab, setMemberTab] = useState<MemberTab>("registered");
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);
  const [isRecruiting, setIsRecruiting] = useState(false);
  const [recruitTab, setRecruitTab] = useState<RecruitTab>("registered");
  const [sportspotId, setSportspotId] = useState("");
  const [lookupPlayer, setLookupPlayer] = useState<PlayerLookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [inviteRole, setInviteRole] = useState<CricksalRole>("NONE");
  const [guestForm, setGuestForm] = useState<GuestMemberPayload>({ guest_name: "", guest_phone: "", cricksal_role: "NONE" });
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [teamPhotoFile, setTeamPhotoFile] = useState<File | null>(null);
  const [teamPhotoPreview, setTeamPhotoPreview] = useState("");

  useEffect(() => { loadTeam(); }, [teamId]);
  useEffect(() => () => { if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview); }, [teamPhotoPreview]);

  async function loadTeam() {
    setIsLoading(true);
    setPageError("");
    try {
      const response = await api.get<TeamResponse>(`/api/teams/${teamId}/`);
      setTeam(response.data.team);
      setEditForm(toTeamPayload(response.data.team));
    } catch (error) {
      setPageError(getApiErrorMessage(error, "We could not load this team right now. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  async function updateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm) return;
    setActionInProgress(true);
    try {
      const response = await api.patch<TeamResponse>(`/api/teams/${teamId}/`, cleanTeamPayload(editForm));
      setTeam(response.data.team);
      setEditForm(toTeamPayload(response.data.team));
      emitToast({ message: "Team details have been updated.", type: "success", dedupeKey: `team-updated-${teamId}` });
    } catch (error) {
      getApiErrorMessage(error, "We could not update this team. Please try again.");
    } finally {
      setActionInProgress(false);
    }
  }

  function handleTeamPhotoChange(file: File | null) {
    if (!file) { setTeamPhotoFile(null); setTeamPhotoPreview(""); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { emitToast({ message: "Please upload a JPG, JPEG, or PNG image.", type: "error" }); return; }
    if (file.size > 2 * 1024 * 1024) { emitToast({ message: "Team logo must be 2MB or smaller.", type: "error" }); return; }
    if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    setTeamPhotoFile(file);
    setTeamPhotoPreview(URL.createObjectURL(file));
  }

  async function saveTeamPhoto() {
    if (!teamPhotoFile) { emitToast({ message: "Choose a team logo first.", type: "warning" }); return; }
    const payload = new FormData();
    payload.append("team_photo", teamPhotoFile);
    setActionInProgress(true);
    try {
      const response = await api.patch<TeamResponse>(`/api/teams/${teamId}/`, payload);
      setTeam(response.data.team);
      setTeamPhotoFile(null);
      setTeamPhotoPreview("");
      emitToast({ message: "Team logo has been updated.", type: "success", dedupeKey: `team-photo-${teamId}` });
    } catch (error) {
      getApiErrorMessage(error, "We could not update the team logo. Please try again.");
    } finally {
      setActionInProgress(false);
    }
  }

  async function lookupRegisteredPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupError("");
    setLookupPlayer(null);
    if (!sportspotId.trim()) { setLookupError("Enter the player's SportSpot ID."); return; }
    setActionInProgress(true);
    try {
      const response = await api.get<PlayerLookupResponse>("/api/teams/players/lookup/", { params: { sportspot_id: sportspotId.trim().toUpperCase() } });
      setLookupPlayer(response.data.player);
      setInviteRole(response.data.player.preferred_cricksal_role || "NONE");
    } catch (error) {
      setLookupError(getApiErrorMessage(error, "No registered player found with this SportSpot ID."));
    } finally {
      setActionInProgress(false);
    }
  }

  async function sendInvitation() {
    if (!lookupPlayer) return;
    setActionInProgress(true);
    try {
      await api.post(`/api/teams/${teamId}/invite/`, { sportspot_id: lookupPlayer.sportspot_id, cricksal_role: inviteRole });
      setSportspotId("");
      setLookupPlayer(null);
      setInviteRole("NONE");
      setIsRecruiting(false);
      emitToast({ message: "The invitation has been sent.", type: "success", dedupeKey: `team-invite-${lookupPlayer.sportspot_id}` });
      await loadTeam();
    } catch (error) {
      setLookupError(getApiErrorMessage(error, "We could not send this invitation. Please try again."));
    } finally {
      setActionInProgress(false);
    }
  }

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guestForm.guest_name.trim()) { emitToast({ message: "Guest name is required.", type: "warning" }); return; }
    setActionInProgress(true);
    try {
      await api.post(`/api/teams/${teamId}/members/guest/`, { ...guestForm, guest_name: guestForm.guest_name.trim(), guest_phone: guestForm.guest_phone.trim() });
      setGuestForm({ guest_name: "", guest_phone: "", cricksal_role: "NONE" });
      setIsRecruiting(false);
      emitToast({ message: "Guest player has been added.", type: "success", dedupeKey: `guest-added-${teamId}` });
      await loadTeam();
    } catch (error) {
      getApiErrorMessage(error, "We could not add this guest player. Please try again.");
    } finally {
      setActionInProgress(false);
    }
  }

  async function removeMember(member: TeamMember) {
    setActionInProgress(true);
    try {
      await api.delete(`/api/teams/${teamId}/members/${member.id}/`);
      emitToast({ message: member.status === "INVITED" ? "The invitation has been cancelled." : "The member has been removed.", type: "success", dedupeKey: `member-remove-${member.id}` });
      await loadTeam();
    } catch (error) {
      getApiErrorMessage(error, "We could not update this member. Please try again.");
    } finally {
      setActionInProgress(false);
      setConfirmAction(null);
    }
  }

  async function deleteTeam() {
    setActionInProgress(true);
    try {
      await api.delete(`/api/teams/${teamId}/`);
      emitToast({ message: "The team has been deleted.", type: "success", dedupeKey: `team-deleted-${teamId}` });
      router.push("/dashboard/player/teams");
    } catch (error) {
      getApiErrorMessage(error, "We could not delete this team. Please try again.");
    } finally {
      setActionInProgress(false);
      setConfirmAction(null);
    }
  }
  async function leaveTeam() {
    setActionInProgress(true);
    try {
      await api.post(`/api/teams/${teamId}/leave/`);
      emitToast({ message: "You have left the team.", type: "success", dedupeKey: `team-left-${teamId}` });
      router.push("/dashboard/player/teams");
    } catch (error) {
      getApiErrorMessage(error, "We could not leave this team. Please try again.");
    } finally {
      setActionInProgress(false);
      setConfirmAction(null);
    }
  }

  const members = team?.members || [];
  const captain = useMemo(() => members.find((member) => member.role_in_team === "CAPTAIN") || null, [members]);
  const registeredMembers = useMemo(() => members.filter((member) => member.member_type === "REGISTERED" && member.status === "ACTIVE"), [members]);
  const guestMembers = useMemo(() => members.filter((member) => member.member_type === "GUEST" && member.status === "ACTIVE"), [members]);
  const pendingInvitations = useMemo(() => members.filter((member) => member.member_type === "REGISTERED" && member.status === "INVITED"), [members]);
  const recentActivity = useMemo(() => buildTeamActivity(members), [members]);
  const teamPhotoSrc = useMemo(() => getMediaSrc(teamPhotoPreview || team?.team_photo || ""), [teamPhotoPreview, team?.team_photo]);
  const tabs: TeamTab[] = team?.is_captain ? ["overview", "members", "games", "challenges", "settings"] : ["overview", "members", "games", "challenges"];

  if (isLoading) return <TeamDetailSkeleton />;

  if (!team || !editForm) {
    return (
      <section className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-black text-sportNavy">Team not available</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-red-700">{pageError || "This team could not be found or you do not have access."}</p>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700" href="/dashboard/player/teams">Back to My Teams</Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm font-bold text-slate-500">
        <Link className="text-sportGreen hover:text-green-700" href="/dashboard/player/teams">My Teams</Link>
        <span>/</span>
        <span className="truncate text-sportNavy">{team.name}</span>
      </nav>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
            <TeamLogo image={teamPhotoSrc} name={team.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-black tracking-tight text-sportNavy sm:text-3xl">{team.name}</h1>
                <Badge tone={team.is_captain ? "green" : "slate"}>{team.is_captain ? "Captain" : "Member"}</Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 line-clamp-2">{team.description || "No team description has been added yet."}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="soft">{team.location}</Badge>
                {team.preferred_playing_area && normalize(team.preferred_playing_area) !== normalize(team.location) ? <Badge tone="soft">{team.preferred_playing_area}</Badge> : null}
                <Badge tone="soft">{team.preferred_playing_time}</Badge>
                <Badge tone="soft">{formatChoice(team.skill_level)}</Badge>
                <Badge tone="green">Active</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-sportNavy hover:border-sportGreen hover:text-sportGreen" onClick={() => emitToast({ message: "Public team profile is not available yet.", type: "info", dedupeKey: "team-public-profile" })} type="button">View Public Profile</button>
            {team.is_captain ? <button className="min-h-11 rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700" onClick={() => setIsRecruiting(true)} type="button">Invite Player</button> : null}
            {team.is_captain ? <button className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700 hover:bg-slate-50" onClick={() => setActiveTab("settings")} type="button">Manage Team</button> : <MemberMoreMenu onLeave={() => setConfirmAction({ title: "Leave team?", message: `You will lose access to ${team.name} private team details after leaving.`, confirmLabel: "Leave Team", tone: "danger", onConfirm: leaveTeam })} />}
          </div>
        </div>

        <div className="mt-6 flex gap-2 overflow-x-auto border-t border-slate-200 pt-4" role="tablist" aria-label="Team detail sections">
          {tabs.map((tab) => <TeamTabButton active={activeTab === tab} key={tab} label={tabLabel(tab)} onClick={() => setActiveTab(tab)} />)}
        </div>
      </section>

      {activeTab === "overview" ? <OverviewTab team={team} captain={captain} recentActivity={recentActivity} onOpenProfile={setSelectedMember} /> : null}
      {activeTab === "members" ? <MembersTab activeTab={memberTab} canManage={team.is_captain} guests={guestMembers} invitations={pendingInvitations} onAddGuest={() => { setRecruitTab("guest"); setIsRecruiting(true); }} onCancelInvitation={(member) => setConfirmAction({ title: "Cancel invitation?", message: `Cancel the invitation sent to ${member.display_name}?`, confirmLabel: "Cancel Invitation", tone: "danger", onConfirm: () => removeMember(member) })} onOpenProfile={setSelectedMember} onRemove={(member) => setConfirmAction({ title: "Remove member?", message: `${member.display_name} will lose access to this team's private details.`, confirmLabel: "Remove Member", tone: "danger", onConfirm: () => removeMember(member) })} onTabChange={setMemberTab} registered={registeredMembers} /> : null}
      {activeTab === "games" ? <GamesTab /> : null}
      {activeTab === "challenges" ? <ChallengesTab isCaptain={team.is_captain} teamId={team.id} /> : null}
      {activeTab === "settings" && team.is_captain ? <SettingsTab actionInProgress={actionInProgress} editForm={editForm} onDelete={() => setConfirmAction({ title: "Delete team?", message: "This action permanently removes the team. Only continue if this team was created by mistake and has no required history.", confirmLabel: "Delete Team", tone: "danger", onConfirm: deleteTeam })} onPhotoChange={handleTeamPhotoChange} onSavePhoto={saveTeamPhoto} onSubmit={updateTeam} photoPreview={teamPhotoSrc} setEditForm={setEditForm} /> : null}

      {isRecruiting ? <RecruitModal actionInProgress={actionInProgress} guestForm={guestForm} inviteRole={inviteRole} lookupError={lookupError} lookupPlayer={lookupPlayer} onAddGuest={addGuest} onClose={() => setIsRecruiting(false)} onGuestChange={setGuestForm} onInviteRoleChange={setInviteRole} onLookup={lookupRegisteredPlayer} onSendInvitation={sendInvitation} onSportspotIdChange={setSportspotId} onTabChange={setRecruitTab} sportspotId={sportspotId} tab={recruitTab} /> : null}
      {selectedMember ? <PlayerProfileModal member={selectedMember} onClose={() => setSelectedMember(null)} /> : null}
      {confirmAction ? <ConfirmModal action={confirmAction} isProcessing={actionInProgress} onClose={() => setConfirmAction(null)} /> : null}
    </div>
  );
}

function OverviewTab({ captain, onOpenProfile, recentActivity, team }: { captain: TeamMember | null; onOpenProfile: (member: TeamMember) => void; recentActivity: TeamActivity[]; team: Team }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <main className="space-y-5">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Active Members" value={team.members_count} helper="Registered and guest players" />
          <SummaryCard label="Upcoming Games" value="0" helper="No team games connected yet" />
          <SummaryCard label="Open Games" value="0" helper="No open games created yet" />
          <SummaryCard label="Active Challenges" value="0" helper="No challenge records yet" />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeading title="Team Information" description="Core team identity and playing preferences." />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <InfoTile label="Home Location" value={team.location} />
            {team.preferred_playing_area && normalize(team.preferred_playing_area) !== normalize(team.location) ? <InfoTile label="Preferred Playing Areas" value={team.preferred_playing_area} /> : null}
            <InfoTile label="Preferred Play Schedule" value={team.preferred_playing_time} />
            <InfoTile label="Skill Level" value={formatChoice(team.skill_level)} />
            <InfoTile label="Team Created" value={formatDate(team.created_at)} />
            <div className="rounded-xl bg-slate-50 p-4 sm:col-span-2"><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Description</p><p className="mt-2 text-sm leading-6 text-slate-700">{team.description || "No team description has been added yet."}</p></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeading title="Next Game" description="Confirmed team matches will appear here." />
          <EmptyPanel title="No confirmed team games yet." description="Once this team has a confirmed Cricksal game, the date, venue, court and Game Room action will appear here." />
        </section>
      </main>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeading title="Team Captain" description="Captain profile visible to team members." />
          {captain ? <CaptainCard captain={captain} onOpenProfile={() => onOpenProfile(captain)} /> : <EmptyPanel title="Captain details unavailable." description="Captain information could not be loaded." compact />}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><SectionHeading title="Recent Team Activity" description="Latest meaningful roster activity." /><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-sportGreen">Live</span></div>
          {recentActivity.length ? <ActivityList items={recentActivity} /> : <EmptyPanel title="No team activity yet." description="Roster and invitation activity will appear here." compact />}
        </section>
      </aside>
    </div>
  );
}

function MembersTab({ activeTab, canManage, guests, invitations, onAddGuest, onCancelInvitation, onOpenProfile, onRemove, onTabChange, registered }: { activeTab: MemberTab; canManage: boolean; guests: TeamMember[]; invitations: TeamMember[]; onAddGuest: () => void; onCancelInvitation: (member: TeamMember) => void; onOpenProfile: (member: TeamMember) => void; onRemove: (member: TeamMember) => void; onTabChange: (tab: MemberTab) => void; registered: TeamMember[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Member sections">
          <TeamTabButton active={activeTab === "registered"} label={`Registered Members (${registered.length})`} onClick={() => onTabChange("registered")} />
          <TeamTabButton active={activeTab === "guests"} label={`Guest Players (${guests.length})`} onClick={() => onTabChange("guests")} />
          <TeamTabButton active={activeTab === "invitations"} label={`Invitations (${invitations.length})`} onClick={() => onTabChange("invitations")} />
        </div>
        {canManage ? <button className="min-h-11 rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700" onClick={onAddGuest} type="button">Add Guest Player</button> : null}
      </div>
      <div className="p-4 sm:p-5">
        {activeTab === "registered" ? <MemberGrid canManage={canManage} emptyText="No active registered members yet." members={registered} onOpenProfile={onOpenProfile} onRemove={onRemove} /> : null}
        {activeTab === "guests" ? <GuestGrid canManage={canManage} guests={guests} onRemove={onRemove} /> : null}
        {activeTab === "invitations" ? <InvitationGrid canManage={canManage} invitations={invitations} onCancel={onCancelInvitation} /> : null}
      </div>
    </section>
  );
}

function MemberGrid({ canManage, emptyText, members, onOpenProfile, onRemove }: { canManage: boolean; emptyText: string; members: TeamMember[]; onOpenProfile: (member: TeamMember) => void; onRemove: (member: TeamMember) => void }) {
  if (!members.length) return <EmptyPanel title={emptyText} description="Invite registered players or add guests when your team is ready." />;
  return <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{members.map((member) => <MemberCard canManage={canManage} key={member.id} member={member} onOpenProfile={() => onOpenProfile(member)} onRemove={() => onRemove(member)} />)}</div>;
}

function MemberCard({ canManage, member, onOpenProfile, onRemove }: { canManage: boolean; member: TeamMember; onOpenProfile: () => void; onRemove: () => void }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <PlayerAvatar member={member} />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-black text-sportNavy">{member.display_name}</h3><Badge tone={member.role_in_team === "CAPTAIN" ? "green" : "soft"}>{formatChoice(member.role_in_team)}</Badge></div><p className="mt-1 text-xs font-black text-sportGreen">{member.sportspot_id || "SportSpot ID unavailable"}</p><p className="mt-2 text-sm font-semibold text-slate-600">{formatChoice(member.cricksal_role)} · {formatChoice(member.skill_level)}</p><p className="mt-1 text-sm text-slate-500">{member.location || "Location not set"}</p></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2"><MiniStat label="Reliability" value={member.reliability_label || "New Player"} /><MiniStat label="Rating" value={formatRating(member.average_rating)} /></div>
      <div className="mt-4 flex gap-2"><button className="min-h-10 flex-1 rounded-xl border border-green-200 px-3 text-sm font-black text-sportGreen hover:bg-green-50" onClick={onOpenProfile} type="button">View Profile</button>{canManage && member.role_in_team !== "CAPTAIN" ? <button className="min-h-10 rounded-xl border border-red-200 px-3 text-sm font-black text-red-700 hover:bg-red-50" onClick={onRemove} type="button">Remove</button> : null}</div>
    </article>
  );
}

function GuestGrid({ canManage, guests, onRemove }: { canManage: boolean; guests: TeamMember[]; onRemove: (member: TeamMember) => void }) {
  if (!guests.length) return <EmptyPanel title="No guest players yet." description="Guest players can be added by the captain when teammates do not have SportSpot accounts yet." />;
  return <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{guests.map((guest) => <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={guest.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-sportNavy">{guest.display_name}</h3><p className="mt-1 text-sm font-semibold text-slate-600">{formatChoice(guest.cricksal_role)}</p><p className="mt-1 text-sm text-slate-500">Added {formatDate(guest.joined_at)}</p></div><Badge tone="soft">Guest</Badge></div><p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">Guest players do not have SportSpot IDs, ratings, or reliability scores.</p>{canManage ? <button className="mt-4 min-h-10 rounded-xl border border-red-200 px-3 text-sm font-black text-red-700 hover:bg-red-50" onClick={() => onRemove(guest)} type="button">Remove Guest</button> : null}</article>)}</div>;
}

function InvitationGrid({ canManage, invitations, onCancel }: { canManage: boolean; invitations: TeamMember[]; onCancel: (member: TeamMember) => void }) {
  if (!invitations.length) return <EmptyPanel title="No pending invitations." description="Registered-player invitations sent by the captain will appear here until accepted or declined." />;
  return <div className="grid gap-4 lg:grid-cols-2">{invitations.map((member) => <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={member.id}><div className="flex items-start gap-3"><PlayerAvatar member={member} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-black text-sportNavy">{member.display_name}</h3><StatusBadge status={member.status} /></div><p className="mt-1 text-xs font-black text-sportGreen">{member.sportspot_id}</p><p className="mt-2 text-sm font-semibold text-slate-600">Invited as {formatChoice(member.cricksal_role)}</p><p className="mt-1 text-sm text-slate-500">Sent {formatDate(member.invited_at)}</p></div></div>{canManage ? <button className="mt-4 min-h-10 rounded-xl border border-red-200 px-3 text-sm font-black text-red-700 hover:bg-red-50" onClick={() => onCancel(member)} type="button">Cancel Invitation</button> : null}</article>)}</div>;
}

function GamesTab() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-4"><StaticSubTab label="Upcoming" active /><StaticSubTab label="Open Games" /><StaticSubTab label="Completed" /></div>
      <EmptyPanel title="No team games yet." description="Team games, open games, match status, and Game Room links will appear here when the game module is connected to teams." />
    </section>
  );
}

type ChallengeSection = "received" | "sent" | "accepted" | "closed";

function ChallengesTab({ isCaptain, teamId }: { isCaptain: boolean; teamId: number }) {
  const [section, setSection] = useState<ChallengeSection>("received");
  const [challenges, setChallenges] = useState<TeamChallenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadChallenges() {
      setIsLoading(true);
      setError("");
      try {
        const response = await api.get<TeamChallengeListResponse>("/api/team-challenges/challenges/", { params: { scope: "all" } });
        if (mounted) setChallenges(response.data.challenges);
      } catch (requestError) {
        if (mounted) setError(getApiErrorMessage(requestError, "We could not load this team's challenges right now. Please try again.", { notify: false }));
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void loadChallenges();
    return () => { mounted = false; };
  }, [teamId]);

  const teamChallenges = challenges.filter((challenge) => String(challenge.challenger_team.id) === String(teamId) || String(challenge.challenged_team?.id) === String(teamId));
  const received = teamChallenges.filter((challenge) => String(challenge.challenged_team?.id) === String(teamId) && !isClosedChallenge(challenge));
  const sent = teamChallenges.filter((challenge) => String(challenge.challenger_team.id) === String(teamId) && !isClosedChallenge(challenge));
  const accepted = teamChallenges.filter((challenge) => ["ACCEPTED_AWAITING_BOOKING", "RECONFIRMATION_REQUIRED", "CONFIRMED"].includes(challenge.status));
  const closed = teamChallenges.filter(isClosedChallenge);
  const sections: Array<{ key: ChallengeSection; label: string; items: TeamChallenge[] }> = [
    { key: "received", label: "Received", items: received },
    { key: "sent", label: "Sent", items: sent },
    { key: "accepted", label: "Accepted", items: accepted },
    { key: "closed", label: "Closed", items: closed },
  ];
  const selected = sections.find((item) => item.key === section) || sections[0];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 className="text-lg font-black text-sportNavy">Team challenges</h2>
          <p className="mt-1 text-sm text-slate-600">Review real challenge proposals involving this team.</p>
        </div>
        {isCaptain ? <Link className="min-h-10 rounded-xl bg-sportGreen px-4 py-2.5 text-center text-sm font-black text-white hover:bg-green-700" href={`/challenge-teams/create?team=${teamId}`}>Create Challenge</Link> : null}
      </div>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 px-4 pt-3 sm:px-5" role="tablist" aria-label="Team challenge sections">
        {sections.map((item) => <button aria-selected={section === item.key} className={`min-h-10 shrink-0 border-b-2 px-2 pb-3 text-sm font-black ${section === item.key ? "border-sportGreen text-sportGreen" : "border-transparent text-slate-500 hover:text-sportNavy"}`} key={item.key} onClick={() => setSection(item.key)} role="tab" type="button">{item.label}<span className="ml-1.5 text-xs font-bold text-slate-400">{item.items.length}</span></button>)}
      </div>
      <div className="p-4 sm:p-5">
        {isLoading ? <div className="grid gap-4 lg:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /></div> : error ? <div className="rounded-xl border border-red-200 bg-red-50 p-5"><p className="text-sm font-bold text-red-900">{error}</p><p className="mt-2 text-xs text-red-800">Refresh the page to try loading the team challenges again.</p></div> : selected.items.length ? <div className="grid gap-4 lg:grid-cols-2">{selected.items.map((challenge) => <TeamChallengeCard challenge={challenge} teamId={teamId} key={challenge.id} />)}</div> : <EmptyPanel title={section === "closed" ? "No closed challenges." : "No team challenges yet."} description={section === "received" ? "Challenges sent to this team will appear here." : section === "sent" ? "Challenges created by this team will appear here." : section === "accepted" ? "Accepted challenges and confirmed team matches will appear here." : "Closed challenge history will appear here."} />}
      </div>
    </section>
  );
}

function TeamChallengeCard({ challenge, teamId }: { challenge: TeamChallenge; teamId: number }) {
  const proposal = challenge.current_proposal;
  const isSender = challenge.challenger_team.id === teamId;
  const opponent = isSender ? challenge.challenged_team?.name || "Open opponent search" : challenge.challenger_team.name;
  const date = proposal.booking_summary?.start_at || (proposal.proposed_date ? `${proposal.proposed_date}T${proposal.proposed_start_time || "00:00:00"}` : null);
  const location = proposal.booking_summary ? `${proposal.booking_summary.venue_name} · ${proposal.booking_summary.court_name}` : [proposal.preferred_venue_name, proposal.preferred_area, proposal.preferred_district].filter(Boolean).join(" · ") || "Court details to be agreed";
  return <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-sportGreen">{isSender ? "Sent challenge" : "Received challenge"}</p><h3 className="mt-1 text-lg font-black text-sportNavy">{opponent}</h3></div><Badge tone={isClosedChallenge(challenge) ? "slate" : challenge.status === "CONFIRMED" ? "green" : "soft"}>{challenge.status_label}</Badge></div><div className="mt-4 grid gap-2 text-sm text-slate-600"><p><span className="font-bold text-slate-800">When:</span> {formatDate(date)}</p><p><span className="font-bold text-slate-800">Where:</span> {location}</p><p><span className="font-bold text-slate-800">Format:</span> {proposal.players_per_side} a side · {formatChoice(proposal.intensity)}</p></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4"><p className="text-xs font-semibold text-slate-500">{challenge.is_open_for_response ? `Response ${relativeDeadline(challenge.response_deadline)}` : "No longer accepting responses"}</p><Link className="min-h-10 rounded-xl bg-sportGreen px-4 py-2.5 text-center text-sm font-black text-white hover:bg-green-700" href={`/challenge-teams/${challenge.id}`}>View Details</Link></div></article>;
}

function isClosedChallenge(challenge: TeamChallenge) {
  return ["DECLINED", "WITHDRAWN", "EXPIRED", "CANCELLED", "COMPLETED"].includes(challenge.status);
}

function relativeDeadline(value: string) {
  const delta = new Date(value).getTime() - Date.now();
  if (delta <= 0) return "now";
  const hours = Math.floor(delta / 3600000);
  if (hours > 24) return `in ${Math.floor(hours / 24)}d`;
  if (hours > 0) return `in ${hours}h`;
  return `in ${Math.max(1, Math.floor(delta / 60000))}m`;
}

function SettingsTab({ actionInProgress, editForm, onDelete, onPhotoChange, onSavePhoto, onSubmit, photoPreview, setEditForm }: { actionInProgress: boolean; editForm: TeamPayload; onDelete: () => void; onPhotoChange: (file: File | null) => void; onSavePhoto: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; photoPreview: string; setEditForm: (form: TeamPayload) => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={onSubmit}>
        <SectionHeading title="Team Settings" description="Captain-only team identity and playing preferences." />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Team Name"><input className={inputClassName} maxLength={100} required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></Field>
          <Field label="Sport"><div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-black text-sportNavy">Cricksal</div></Field>
          <Field className="sm:col-span-2" label="Description"><textarea className={`${inputClassName} min-h-28 py-3`} value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} /></Field>
          <Field label="Home Location"><select className={inputClassName} required value={editForm.location} onChange={(event) => setEditForm({ ...editForm, location: event.target.value })}>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></Field>
          <Field label="Preferred Playing Areas"><input className={inputClassName} required value={editForm.preferred_playing_area} onChange={(event) => setEditForm({ ...editForm, preferred_playing_area: event.target.value })} /></Field>
          <Field label="Preferred Play Schedule"><select className={inputClassName} required value={editForm.preferred_playing_time} onChange={(event) => setEditForm({ ...editForm, preferred_playing_time: event.target.value })}>{playingTimes.map((time) => <option key={time} value={time}>{time}</option>)}</select></Field>
          <Field label="Skill Level"><select className={inputClassName} value={editForm.skill_level} onChange={(event) => setEditForm({ ...editForm, skill_level: event.target.value as TeamSkillLevel })}>{skills.map((skill) => <option key={skill.value} value={skill.value}>{skill.label}</option>)}</select></Field>
        </div>
        <button className="mt-5 min-h-11 rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={actionInProgress} type="submit">{actionInProgress ? "Saving..." : "Save Changes"}</button>
      </form>
      <aside className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><SectionHeading title="Team Logo" description="JPG, JPEG or PNG. Maximum 2MB." /><div className="mt-4 flex items-center gap-4"><TeamLogo image={photoPreview} name={editForm.name || "Team"} size="md" /><label className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700 hover:bg-slate-50">Choose Logo<input accept=".jpg,.jpeg,.png,image/jpeg,image/png" className="sr-only" onChange={(event) => onPhotoChange(event.target.files?.[0] || null)} type="file" /></label></div><button className="mt-4 min-h-10 rounded-xl bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={actionInProgress} onClick={onSavePhoto} type="button">Save Logo</button></section>
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm"><SectionHeading title="Danger Zone" description="Use destructive actions only when this team was created by mistake." /><button className="mt-4 min-h-11 rounded-xl bg-red-600 px-4 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-400" disabled={actionInProgress} onClick={onDelete} type="button">Delete Team</button></section>
      </aside>
    </div>
  );
}

function RecruitModal({ actionInProgress, guestForm, inviteRole, lookupError, lookupPlayer, onAddGuest, onClose, onGuestChange, onInviteRoleChange, onLookup, onSendInvitation, onSportspotIdChange, onTabChange, sportspotId, tab }: { actionInProgress: boolean; guestForm: GuestMemberPayload; inviteRole: CricksalRole; lookupError: string; lookupPlayer: PlayerLookup | null; onAddGuest: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; onGuestChange: (form: GuestMemberPayload) => void; onInviteRoleChange: (role: CricksalRole) => void; onLookup: (event: FormEvent<HTMLFormElement>) => void; onSendInvitation: () => void; onSportspotIdChange: (value: string) => void; onTabChange: (tab: RecruitTab) => void; sportspotId: string; tab: RecruitTab }) {
  return (
    <Modal eyebrow="Team action" title="Invite Player" onClose={onClose}>
      <p className="text-sm leading-6 text-slate-600">Invite a registered SportSpot player by SportSpot ID or add a guest player to this Cricksal roster.</p>
      <div className="mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1"><ModalTab active={tab === "registered"} label="Registered Player" onClick={() => onTabChange("registered")} /><ModalTab active={tab === "guest"} label="Guest Player" onClick={() => onTabChange("guest")} /></div>
      {tab === "registered" ? (
        <div className="mt-5 space-y-5">
          <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={onLookup}><Field label="SportSpot ID"><input className={inputClassName} placeholder="SSP-10008" value={sportspotId} onChange={(event) => onSportspotIdChange(event.target.value.toUpperCase())} />{lookupError ? <p className="mt-2 text-xs font-bold text-red-600">{lookupError}</p> : <p className="mt-2 text-xs font-semibold text-slate-500">Use the player's SportSpot ID. Email and phone search are not used.</p>}</Field><button className="mt-7 h-12 rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={actionInProgress} type="submit">{actionInProgress ? "Finding..." : "Find Player"}</button></form>
          {lookupPlayer ? <PlayerLookupCard inviteRole={inviteRole} player={lookupPlayer} saving={actionInProgress} onInvite={onSendInvitation} onRoleChange={onInviteRoleChange} /> : null}
        </div>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={onAddGuest}><Field label="Guest Name"><input className={inputClassName} required value={guestForm.guest_name} onChange={(event) => onGuestChange({ ...guestForm, guest_name: event.target.value })} placeholder="e.g. Suman Karki" /></Field><Field label="Guest Phone"><input className={inputClassName} inputMode="tel" value={guestForm.guest_phone} onChange={(event) => onGuestChange({ ...guestForm, guest_phone: event.target.value.replace(/\D/g, "").slice(0, 13) })} placeholder="98XXXXXXXX" /></Field><Field label="Cricksal Role"><select className={inputClassName} value={guestForm.cricksal_role} onChange={(event) => onGuestChange({ ...guestForm, cricksal_role: event.target.value as CricksalRole })}>{cricksalRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></Field><button className="min-h-11 rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={actionInProgress} type="submit">{actionInProgress ? "Adding..." : "Add Guest Player"}</button></form>
      )}
    </Modal>
  );
}

function PlayerLookupCard({ inviteRole, onInvite, onRoleChange, player, saving }: { inviteRole: CricksalRole; onInvite: () => void; onRoleChange: (role: CricksalRole) => void; player: PlayerLookup; saving: boolean }) {
  return <div className="rounded-2xl border border-green-200 bg-green-50 p-4"><div className="flex gap-3"><div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sportNavy text-sm font-black text-white">{player.profile_photo ? <Image alt={`${player.full_name} profile photo`} className="object-cover" fill sizes="64px" src={getMediaSrc(player.profile_photo)} unoptimized /> : initials(player.full_name)}</div><div className="min-w-0"><h3 className="truncate text-lg font-black text-sportNavy">{player.full_name}</h3><p className="mt-1 text-xs font-black text-sportGreen">{player.sportspot_id}</p><p className="mt-2 text-sm font-semibold text-slate-600">{formatChoice(player.skill_level)} · {formatChoice(player.preferred_cricksal_role)} · {player.location}</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><MiniStat label="Reliability" value={player.reliability_label} /><MiniStat label="Matches" value={player.completed_matches_count} /><MiniStat label="Rating" value={formatRating(player.average_rating)} /></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><Field label="Role in this team"><select className={inputClassName} value={inviteRole} onChange={(event) => onRoleChange(event.target.value as CricksalRole)}>{cricksalRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></Field><button className="h-12 rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={saving} onClick={onInvite} type="button">{saving ? "Sending..." : "Send Invitation"}</button></div></div>;
}

function PlayerProfileModal({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  return <Modal eyebrow="Player card" title={member.display_name} onClose={onClose}><div className="grid gap-4 sm:grid-cols-[auto_1fr]"><PlayerAvatar member={member} large /><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">{member.sportspot_id || "Registered player"}</p><h3 className="mt-1 text-2xl font-black text-sportNavy">{member.display_name}</h3><p className="mt-2 text-sm font-semibold text-slate-600">{formatChoice(member.cricksal_role)} · {formatChoice(member.skill_level)} · {member.location || "Location not set"}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MiniStat label="Reliability" value={member.reliability_label || "New Player"} /><MiniStat label="Rating" value={formatRating(member.average_rating)} /><MiniStat label="Matches" value={member.completed_matches_count} /><MiniStat label="Joined" value={formatDate(member.joined_at)} /></div><div className="mt-5 grid gap-4 md:grid-cols-2"><InfoTile label="Weekly Availability" value={member.weekly_availability || "Not added yet."} /><InfoTile label="Playing Style" value={member.playing_style || "Not added yet."} /></div></Modal>;
}

function ConfirmModal({ action, isProcessing, onClose }: { action: NonNullable<ConfirmAction>; isProcessing: boolean; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true"><button aria-label="Close confirmation" className="absolute inset-0 bg-sportNavy/45" onClick={onClose} type="button" /><div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><h2 className="text-xl font-black text-sportNavy">{action.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{action.message}</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700 hover:bg-slate-50" disabled={isProcessing} onClick={onClose} type="button">Cancel</button><button className={`min-h-11 rounded-xl px-4 text-sm font-black text-white disabled:bg-slate-400 ${action.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-sportGreen hover:bg-green-700"}`} disabled={isProcessing} onClick={() => action.onConfirm()} type="button">{isProcessing ? "Working..." : action.confirmLabel}</button></div></div></div>;
}

function Modal({ children, eyebrow, onClose, title }: { children: ReactNode; eyebrow: string; onClose: () => void; title: string }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true"><button aria-label="Close dialog" className="absolute inset-0 bg-sportNavy/45" onClick={onClose} type="button" /><div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">{eyebrow}</p><h2 className="mt-1 text-2xl font-black text-sportNavy">{title}</h2></div><button className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-xl leading-none text-slate-600 hover:bg-slate-50" onClick={onClose} type="button">x</button></div><div className="mt-5">{children}</div></div></div>;
}

function CaptainCard({ captain, onOpenProfile }: { captain: TeamMember; onOpenProfile: () => void }) {
  return <div className="mt-4"><div className="flex items-center gap-3"><PlayerAvatar member={captain} /><div className="min-w-0"><h3 className="truncate font-black text-sportNavy">{captain.display_name}</h3><p className="mt-1 text-xs font-black text-sportGreen">{captain.sportspot_id || "SportSpot ID unavailable"}</p><p className="mt-1 text-sm font-semibold text-slate-600">{formatChoice(captain.cricksal_role)} · {formatChoice(captain.skill_level)}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><MiniStat label="Reliability" value={captain.reliability_label || "New Player"} /><MiniStat label="Rating" value={formatRating(captain.average_rating)} /></div><button className="mt-4 min-h-10 w-full rounded-xl border border-green-200 px-3 text-sm font-black text-sportGreen hover:bg-green-50" onClick={onOpenProfile} type="button">View Profile</button></div>;
}

function ActivityList({ items }: { items: TeamActivity[] }) {
  return <div className="mt-4 space-y-3">{items.map((item) => <div className="flex gap-3 rounded-xl bg-slate-50 p-3" key={item.id}><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sportGreen" /><div><p className="text-sm font-bold leading-5 text-sportNavy">{item.message}</p><p className="mt-1 text-xs font-semibold text-slate-500">{item.time}</p></div></div>)}</div>;
}

function SummaryCard({ helper, label, value }: { helper: string; label: string; value: string | number }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-3 text-2xl font-black text-sportNavy">{value}</p><p className="mt-1 text-xs font-semibold text-slate-500">{helper}</p></article>;
}

function SectionHeading({ description, title }: { description: string; title: string }) {
  return <div><h2 className="text-lg font-black text-sportNavy">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{description}</p></div>;
}

function InfoTile({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-2 text-sm font-black leading-6 text-sportNavy">{value || "Not set"}</p></div>;
}

function EmptyPanel({ compact = false, description, title }: { compact?: boolean; description: string; title: string }) {
  return <div className={`mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center ${compact ? "p-4" : "p-8"}`}><h3 className="font-black text-sportNavy">{title}</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p></div>;
}

function TeamTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button aria-selected={active} className={`relative min-h-11 shrink-0 px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${active ? "text-sportGreen" : "text-slate-600 hover:text-sportNavy"}`} onClick={onClick} role="tab" type="button">{label}{active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sportGreen" /> : null}</button>;
}

function StaticSubTab({ active = false, label }: { active?: boolean; label: string }) {
  return <span className={`min-h-10 shrink-0 rounded-xl px-4 py-2 text-sm font-black ${active ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-500"}`}>{label}</span>;
}

function ModalTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button className={`rounded-lg px-3 py-2 text-sm font-black transition ${active ? "bg-white text-sportGreen shadow-sm" : "text-slate-600 hover:bg-white/70"}`} onClick={onClick} type="button">{label}</button>;
}

function Badge({ children, tone }: { children: ReactNode; tone: "green" | "slate" | "soft" }) {
  const className = tone === "green" ? "bg-green-50 text-sportGreen" : tone === "slate" ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-600 border border-slate-200";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${className}`}>{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "green" : status === "INVITED" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-1 text-xs font-black ${tone === "green" ? "bg-green-50 text-sportGreen" : tone}`}>{formatChoice(status)}</span>;
}

function TeamLogo({ image, name, size }: { image: string; name: string; size: "md" | "lg" }) {
  const dimension = size === "lg" ? "h-20 w-20 text-xl sm:h-24 sm:w-24" : "h-16 w-16 text-base";
  return <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-sportNavy font-black text-white shadow-sm ${dimension}`}>{image ? <Image alt={`${name} team logo`} className="object-cover" fill sizes={size === "lg" ? "96px" : "64px"} src={image} unoptimized /> : initials(name)}</div>;
}

function PlayerAvatar({ large = false, member }: { large?: boolean; member: TeamMember }) {
  const size = large ? "h-20 w-20 text-xl" : "h-12 w-12 text-sm";
  const src = getMediaSrc(member.profile_photo);
  return <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sportNavy font-black text-white ${size}`}>{src ? <Image alt={`${member.display_name} profile photo`} className="object-cover" fill sizes={large ? "80px" : "48px"} src={src} unoptimized /> : initials(member.display_name)}</div>;
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-sportNavy">{value || "Not set"}</p></div>;
}

function Field({ children, className = "", label }: { children: ReactNode; className?: string; label: string }) {
  return <label className={`block text-sm font-black text-slate-800 ${className}`}>{label}{children}</label>;
}

function MemberMoreMenu({ onLeave }: { onLeave: () => void }) {
  return <button className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-black text-red-700 hover:bg-red-50" onClick={onLeave} type="button">Leave Team</button>;
}

function TeamDetailSkeleton() {
  return <div className="space-y-5"><div className="h-8 w-56 animate-pulse rounded-xl bg-slate-200" /><div className="h-64 animate-pulse rounded-[1.5rem] bg-white shadow-sm" /><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div className="h-32 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />)}</div><div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" /></div><div className="h-96 animate-pulse rounded-2xl bg-white shadow-sm" /></div></div>;
}

type TeamActivity = { id: string; message: string; sortAt: number; time: string };
function buildTeamActivity(members: TeamMember[]): TeamActivity[] {
  return members
    .filter((member) => member.joined_at || member.invited_at)
    .map((member) => {
      const rawTime = member.status === "INVITED" ? member.invited_at : member.joined_at;
      return {
        id: `${member.id}-${member.status}`,
        message: member.status === "INVITED" ? `${member.display_name} was invited to the team.` : `${member.display_name} joined the team.`,
        sortAt: rawTime ? new Date(rawTime).getTime() : 0,
        time: formatDateTime(rawTime),
      };
    })
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, 5);
}

function cleanTeamPayload(form: TeamPayload): TeamPayload { return { ...form, name: form.name.trim(), description: form.description.trim(), location: form.location.trim(), preferred_playing_area: form.preferred_playing_area.trim(), preferred_playing_time: form.preferred_playing_time.trim() }; }
function toTeamPayload(team: Team): TeamPayload { return { name: team.name, description: team.description || "", location: team.location, preferred_playing_area: team.preferred_playing_area, preferred_playing_time: team.preferred_playing_time, skill_level: team.skill_level }; }
function tabLabel(tab: TeamTab) { return tab.charAt(0).toUpperCase() + tab.slice(1); }
function normalize(value: string) { return value.trim().toLowerCase(); }
function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "SS"; }
function formatChoice(value?: string) { if (!value) return "Not set"; return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
function formatRating(value?: string) { const numberValue = Number(value || 0); return Number.isFinite(numberValue) ? numberValue.toFixed(1) : "0.0"; }
function formatDate(value?: string | null) { if (!value) return "Not set"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "Not set"; return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date); }
function formatDateTime(value?: string) { if (!value) return "Recently"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "Recently"; return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date); }
function getMediaSrc(value: string) { if (!value) return ""; if (value.startsWith("blob:") || value.startsWith("http")) return value; const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"; return `${apiBaseUrl}${value}`; }

const inputClassName = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-2 focus:ring-green-100";
