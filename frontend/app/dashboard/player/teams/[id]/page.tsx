"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import FeedbackToast from "@/components/FeedbackToast";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type {
  CricksalRole,
  GuestMemberPayload,
  PlayerLookup,
  PlayerLookupResponse,
  Team,
  TeamPayload,
  TeamResponse,
  TeamSkillLevel,
} from "@/types/team";

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];
const playingTimes = [
  "Weekday evenings",
  "Saturday morning",
  "Saturday afternoon",
  "Saturday evening",
  "Sunday morning",
  "Sunday afternoon",
  "Sunday evening",
  "Flexible",
];
const skillOptions: Array<{ label: string; value: TeamSkillLevel }> = [
  { label: "Beginner", value: "BEGINNER" },
  { label: "Intermediate", value: "INTERMEDIATE" },
  { label: "Advanced", value: "ADVANCED" },
];
const cricksalRoleOptions: Array<{ label: string; value: CricksalRole }> = [
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
  const [selectedMember, setSelectedMember] = useState<NonNullable<Team["members"]>[number] | null>(null);
  const [teamPhotoFile, setTeamPhotoFile] = useState<File | null>(null);
  const [teamPhotoPreview, setTeamPhotoPreview] = useState("");
  const [guestForm, setGuestForm] = useState<GuestMemberPayload>({
    guest_name: "",
    guest_phone: "",
    cricksal_role: "NONE",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isRecruiting, setIsRecruiting] = useState(false);
  const [recruitTab, setRecruitTab] = useState<"registered" | "guest">("registered");
  const [sportspotId, setSportspotId] = useState("");
  const [lookupPlayer, setLookupPlayer] = useState<PlayerLookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [inviteRole, setInviteRole] = useState<CricksalRole>("NONE");
  const [isPhotoEditing, setIsPhotoEditing] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isSavingGuest, setIsSavingGuest] = useState(false);
  const [isLookingUpPlayer, setIsLookingUpPlayer] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const feedbackMessage = error || success;
  const feedbackType = error ? "error" : success ? "success" : "info";

  useEffect(() => {
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => {
    return () => {
      if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    };
  }, [teamPhotoPreview]);

  async function loadTeam() {
    setIsLoading(true);
    setError("");

    try {
      const response = await api.get<TeamResponse>(`/api/teams/${teamId}/`);
      setTeam(response.data.team);
      setEditForm(toTeamPayload(response.data.team));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load team details."));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm) return;

    setError("");
    setSuccess("");
    setIsSavingTeam(true);

    try {
      const response = await api.patch<TeamResponse>(`/api/teams/${teamId}/`, {
        ...editForm,
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        preferred_playing_area: editForm.preferred_playing_area.trim(),
      });
      setTeam(response.data.team);
      setEditForm(toTeamPayload(response.data.team));
      setIsEditing(false);
      setSuccess("Team details updated.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update team details."));
    } finally {
      setIsSavingTeam(false);
    }
  }

  function handleTeamPhotoChange(file: File | null) {
    setError("");

    if (!file) {
      setTeamPhotoFile(null);
      setTeamPhotoPreview("");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      setError("Team photo must be JPG, JPEG, or PNG.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("Team photo must be 2MB or smaller.");
      return;
    }

    if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    setTeamPhotoFile(file);
    setTeamPhotoPreview(URL.createObjectURL(file));
  }

  function closePhotoEditor() {
    if (teamPhotoPreview) URL.revokeObjectURL(teamPhotoPreview);
    setTeamPhotoFile(null);
    setTeamPhotoPreview("");
    setIsPhotoEditing(false);
  }

  async function handleSaveTeamPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!teamPhotoFile) {
      setError("Please choose a JPG, JPEG, or PNG team photo first.");
      return;
    }

    const payload = new FormData();
    payload.append("team_photo", teamPhotoFile);
    setIsSavingPhoto(true);

    try {
      const response = await api.patch<TeamResponse>(`/api/teams/${teamId}/`, payload);
      setTeam(response.data.team);
      setTeamPhotoFile(null);
      setTeamPhotoPreview("");
      setIsPhotoEditing(false);
      setSuccess("Team photo updated.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update team photo."));
    } finally {
      setIsSavingPhoto(false);
    }
  }

  async function handleAddGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!guestForm.guest_name.trim()) {
      setError("Guest name is required.");
      return;
    }

    setIsSavingGuest(true);

    try {
      await api.post(`/api/teams/${teamId}/members/guest/`, {
        ...guestForm,
        guest_name: guestForm.guest_name.trim(),
        guest_phone: guestForm.guest_phone.trim(),
      });
      setGuestForm({ guest_name: "", guest_phone: "", cricksal_role: "NONE" });
      setIsRecruiting(false);
      setSuccess("Guest player added.");
      await loadTeam();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not add guest player."));
    } finally {
      setIsSavingGuest(false);
    }
  }

  function openRecruitModal(tab: "registered" | "guest") {
    setRecruitTab(tab);
    setIsRecruiting(true);
    setLookupError("");
    setError("");
    setSuccess("");
  }

  async function handleLookupPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupError("");
    setLookupPlayer(null);
    setError("");

    if (!sportspotId.trim()) {
      setLookupError("Enter the player's SportSpot ID.");
      return;
    }

    setIsLookingUpPlayer(true);

    try {
      const response = await api.get<PlayerLookupResponse>("/api/teams/players/lookup/", {
        params: { sportspot_id: sportspotId.trim().toUpperCase() },
      });
      setLookupPlayer(response.data.player);
      setInviteRole(response.data.player.preferred_cricksal_role || "NONE");
    } catch (requestError) {
      setLookupError(getApiErrorMessage(requestError, "No registered player found with this SportSpot ID."));
    } finally {
      setIsLookingUpPlayer(false);
    }
  }

  async function handleSendInvitation() {
    if (!lookupPlayer) return;

    setError("");
    setSuccess("");
    setLookupError("");
    setIsSendingInvite(true);

    try {
      await api.post(`/api/teams/${teamId}/invite/`, {
        sportspot_id: lookupPlayer.sportspot_id,
        cricksal_role: inviteRole,
      });
      setSuccess("Invitation sent successfully.");
      setSportspotId("");
      setLookupPlayer(null);
      setInviteRole("NONE");
      setIsRecruiting(false);
      await loadTeam();
    } catch (requestError) {
      setLookupError(getApiErrorMessage(requestError, "Could not send invitation."));
    } finally {
      setIsSendingInvite(false);
    }
  }

  async function handleRemoveMember(memberId: number) {
    setError("");
    setSuccess("");

    try {
      await api.delete(`/api/teams/${teamId}/members/${memberId}/`);
      setSuccess("Member removed.");
      await loadTeam();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not remove member."));
    }
  }

  async function handleDeleteTeam() {
    if (!window.confirm("Delete this team? This cannot be undone.")) return;

    setError("");
    setSuccess("");

    try {
      await api.delete(`/api/teams/${teamId}/`);
      router.push("/dashboard/player/teams");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not delete team."));
    }
  }

  const captainMembers = useMemo(() => team?.members?.filter((member) => member.role_in_team === "CAPTAIN") || [], [team]);
  const activeRegisteredMembers = useMemo(
    () => team?.members?.filter((member) => member.member_type === "REGISTERED" && member.status === "ACTIVE" && member.role_in_team !== "CAPTAIN") || [],
    [team],
  );
  const pendingInvitations = useMemo(
    () => team?.members?.filter((member) => member.member_type === "REGISTERED" && member.status === "INVITED") || [],
    [team],
  );
  const guestMembers = useMemo(() => team?.members?.filter((member) => member.member_type === "GUEST" && member.status === "ACTIVE") || [], [team]);
  const teamPhotoSrc = useMemo(() => getTeamPhotoSrc(teamPhotoPreview || team?.team_photo || ""), [teamPhotoPreview, team?.team_photo]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-500">Loading team details...</p>
      </div>
    );
  }

  if (!team || !editForm) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-red-700">{error || "Team not found."}</p>
        <Link className="mt-4 inline-flex rounded-md bg-sportGreen px-4 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/player/teams">
          Back to My Teams
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FeedbackToast message={feedbackMessage} onClose={() => { setError(""); setSuccess(""); }} type={feedbackType} />

      <section className="rounded-lg border border-slate-200 bg-sportNavy p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/10 text-3xl font-black text-white">
              {teamPhotoSrc ? (
                <Image alt={`${team.name} team photo`} className="object-cover" fill sizes="112px" src={teamPhotoSrc} unoptimized />
              ) : (
                getTeamInitials(team.name)
              )}
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-wide text-green-300">Cricksal Team</p>
              <h1 className="mt-2 text-3xl font-black">{team.name}</h1>
              <p className="mt-3 max-w-3xl text-slate-300">{team.description || "No team description added yet."}</p>
              {team.is_captain ? (
                <button className="mt-4 rounded-md border border-white/20 px-3 py-2 text-sm font-black text-white hover:bg-white/10" onClick={() => setIsPhotoEditing(true)} type="button">
                  {team.team_photo ? "Edit Team Photo" : "Upload Team Photo"}
                </button>
              ) : null}
            </div>
          </div>
          {team.is_captain ? (
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md bg-white px-4 py-3 text-sm font-black text-sportNavy hover:bg-green-50" onClick={() => setIsEditing((value) => !value)} type="button">
                {isEditing ? "Cancel Edit" : "Edit Team"}
              </button>
              <button className="rounded-md bg-sportGreen px-4 py-3 text-sm font-black text-white hover:bg-green-700" onClick={() => openRecruitModal("registered")} type="button">
                Invite Player
              </button>
              <button className="rounded-md border border-red-300 px-4 py-3 text-sm font-black text-red-100 hover:bg-red-900/30" onClick={handleDeleteTeam} type="button">
                Delete Team
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Location" value={team.location} />
        <SummaryCard label="Preferred Area" value={team.preferred_playing_area} />
        <SummaryCard label="Preferred Time" value={team.preferred_playing_time} />
        <SummaryCard label="Skill Level" value={formatChoice(team.skill_level)} />
        <SummaryCard label="Captain" value={team.captain_name} />
        <SummaryCard label="Members" value={team.members_count} />
        <SummaryCard label="Reliability" value={`${team.team_reliability_score}/100`} />
        <SummaryCard label="Average Rating" value={formatRating(team.average_rating)} />
      </section>

      {isEditing ? (
        <form className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleUpdateTeam}>
          <h2 className="text-xl font-black text-sportNavy">Edit Team Details</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Field label="Team Name">
              <input className={inputClassName} maxLength={100} required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
            </Field>
            <Field label="Sport">
              <ReadOnlySportBadge />
            </Field>
            <Field className="md:col-span-2" label="Description">
              <textarea className={`${inputClassName} min-h-28 py-3`} value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} />
            </Field>
            <Field label="Location">
              <select className={inputClassName} required value={editForm.location} onChange={(event) => setEditForm({ ...editForm, location: event.target.value })}>
                {locations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Preferred Playing Area">
              <input className={inputClassName} required value={editForm.preferred_playing_area} onChange={(event) => setEditForm({ ...editForm, preferred_playing_area: event.target.value })} />
            </Field>
            <Field label="Preferred Playing Time">
              <select className={inputClassName} required value={editForm.preferred_playing_time} onChange={(event) => setEditForm({ ...editForm, preferred_playing_time: event.target.value })}>
                {playingTimes.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Skill Level">
              <select className={inputClassName} value={editForm.skill_level} onChange={(event) => setEditForm({ ...editForm, skill_level: event.target.value as TeamSkillLevel })}>
                {skillOptions.map((skill) => (
                  <option key={skill.value} value={skill.value}>
                    {skill.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button className="mt-6 rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isSavingTeam} type="submit">
            {isSavingTeam ? "Saving Team..." : "Save Team"}
          </button>
        </form>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-2">
        <MemberPanel
          canRemove={false}
          emptyText="Captain information is not available."
          members={captainMembers}
          onOpenProfile={setSelectedMember}
          onRemove={handleRemoveMember}
          title="Captain"
        />
        <MemberPanel
          canRemove={team.is_captain}
          emptyText="No active registered members yet."
          members={activeRegisteredMembers}
          onOpenProfile={setSelectedMember}
          onRemove={handleRemoveMember}
          title="Active Registered Members"
        />
        <MemberPanel
          canRemove={team.is_captain}
          emptyText="No pending invitations."
          members={pendingInvitations}
          onOpenProfile={setSelectedMember}
          onRemove={handleRemoveMember}
          title="Pending Invitations"
        />
        <MemberPanel
          canRemove={team.is_captain}
          emptyText="No guest players yet."
          members={guestMembers}
          onOpenProfile={setSelectedMember}
          onRemove={handleRemoveMember}
          title="Guest Players"
        />
      </section>

      {isRecruiting ? (
        <Modal title="Invite Player" onClose={() => setIsRecruiting(false)}>
          <p className="text-sm text-slate-600">Invite registered SportSpot players by SportSpot ID, or add a guest player to your Cricksal roster.</p>
          <div className="mt-5 grid grid-cols-2 rounded-md bg-slate-100 p-1">
            <TabButton active={recruitTab === "registered"} label="Registered Player" onClick={() => setRecruitTab("registered")} />
            <TabButton active={recruitTab === "guest"} label="Guest Player" onClick={() => setRecruitTab("guest")} />
          </div>

          {recruitTab === "registered" ? (
            <div className="mt-6 space-y-5">
              <div>
                <h3 className="text-lg font-black text-sportNavy">Invite Registered Player</h3>
                <p className="mt-1 text-sm text-slate-600">Invite SportSpot players to join your Cricksal team.</p>
              </div>

              <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={handleLookupPlayer}>
                <label className="block text-sm font-black text-slate-800">
                  SportSpot ID
                  <input
                    className={inputClassName}
                    placeholder="SSP-10008"
                    value={sportspotId}
                    onChange={(event) => {
                      setSportspotId(event.target.value.toUpperCase());
                      setLookupError("");
                    }}
                  />
                  <span className="mt-1 block text-xs font-semibold text-slate-500">Enter the player&apos;s SportSpot ID.</span>
                </label>
                <button className="mt-7 h-12 rounded-md bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isLookingUpPlayer} type="submit">
                  {isLookingUpPlayer ? "Finding..." : "Find Player"}
                </button>
              </form>

              {lookupError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-700">{lookupError}</p>
                  <button className="mt-3 text-sm font-black text-sportGreen hover:text-green-700" onClick={() => setRecruitTab("guest")} type="button">
                    Add as Guest Player instead
                  </button>
                </div>
              ) : null}

              {lookupPlayer ? (
                <PlayerPreviewCard
                  inviteRole={inviteRole}
                  isSendingInvite={isSendingInvite}
                  onInvite={handleSendInvitation}
                  onRoleChange={setInviteRole}
                  player={lookupPlayer}
                />
              ) : null}

              <SuggestedPlayers />
            </div>
          ) : (
            <form className="mt-6" onSubmit={handleAddGuest}>
              <div>
                <h3 className="text-lg font-black text-sportNavy">Add Guest Player</h3>
                <p className="mt-1 text-sm text-slate-600">Add a teammate who does not have a SportSpot account yet.</p>
              </div>
              <div className="mt-5 grid gap-5">
                <Field label="Guest Name">
                  <input className={inputClassName} required value={guestForm.guest_name} onChange={(event) => setGuestForm({ ...guestForm, guest_name: event.target.value })} placeholder="e.g. Suman Karki" />
                </Field>
                <Field label="Guest Phone">
                  <input className={inputClassName} inputMode="tel" value={guestForm.guest_phone} onChange={(event) => setGuestForm({ ...guestForm, guest_phone: event.target.value.replace(/\D/g, "").slice(0, 13) })} placeholder="98XXXXXXXX" />
                </Field>
                <Field label="Cricksal Role">
                  <select className={inputClassName} value={guestForm.cricksal_role} onChange={(event) => setGuestForm({ ...guestForm, cricksal_role: event.target.value as CricksalRole })}>
                    {cricksalRoleOptions.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isSavingGuest} type="submit">
                  {isSavingGuest ? "Adding Guest..." : "Add Guest Player"}
                </button>
                <button className="rounded-md border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50" onClick={() => setIsRecruiting(false)} type="button">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </Modal>
      ) : null}

      {isPhotoEditing ? (
        <Modal title="Team Photo" onClose={closePhotoEditor}>
          <form onSubmit={handleSaveTeamPhoto}>
            <div className="flex items-center gap-4">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sportNavy text-2xl font-black text-white">
                {teamPhotoSrc ? (
                  <Image alt={`${team.name} team photo preview`} className="object-cover" fill sizes="96px" src={teamPhotoSrc} unoptimized />
                ) : (
                  getTeamInitials(team.name)
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-600">Accepted formats: JPG, JPEG, PNG.</p>
                <p className="mt-1 text-sm font-semibold text-slate-600">Maximum size: 2MB.</p>
              </div>
            </div>
            <label className="mt-5 block text-sm font-black text-slate-800">
              Choose Photo
              <input
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                className="mt-2 block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-sportGreen file:px-4 file:py-2 file:font-black file:text-white hover:file:bg-green-700"
                onChange={(event) => handleTeamPhotoChange(event.target.files?.[0] || null)}
                type="file"
              />
            </label>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button className="rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isSavingPhoto} type="submit">
                {isSavingPhoto ? "Saving Photo..." : "Save Photo"}
              </button>
              <button className="rounded-md border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50" onClick={closePhotoEditor} type="button">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {selectedMember ? (
        <PlayerProfileModal member={selectedMember} onClose={() => setSelectedMember(null)} />
      ) : null}
    </div>
  );
}

function MemberPanel({
  canRemove,
  emptyText,
  members,
  onOpenProfile,
  onRemove,
  title,
}: {
  canRemove: boolean;
  emptyText: string;
  members: NonNullable<Team["members"]>;
  onOpenProfile: (member: NonNullable<Team["members"]>[number]) => void;
  onRemove: (memberId: number) => void;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-sportNavy">{title}</h2>
      {members.length === 0 ? (
        <p className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-600">{emptyText}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {members.map((member) => (
            <div className="rounded-md border border-slate-200 p-4" key={member.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sportNavy text-sm font-black text-white">
                    {member.profile_photo ? (
                      <Image alt={`${member.display_name} profile photo`} className="object-cover" fill sizes="48px" src={getTeamPhotoSrc(member.profile_photo)} unoptimized />
                    ) : (
                      getTeamInitials(member.display_name)
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-sportNavy">{member.display_name}</h3>
                      <StatusBadge status={member.status} />
                      {member.member_type === "GUEST" ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">Guest</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatChoice(member.role_in_team)} · {formatChoice(member.cricksal_role)}
                    </p>
                    {member.sportspot_id ? <p className="mt-1 text-xs font-black text-sportGreen">{member.sportspot_id}</p> : null}
                    {member.skill_level || member.location ? (
                      <p className="mt-1 text-sm text-slate-500">
                        {[formatChoice(member.skill_level), member.location].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {member.status === "INVITED" && member.invited_at ? <p className="mt-1 text-xs font-semibold text-slate-400">Invited {formatDate(member.invited_at)}</p> : null}
                    {member.guest_phone ? <p className="mt-1 text-sm text-slate-500">{member.guest_phone}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {member.member_type === "REGISTERED" && member.status === "ACTIVE" ? (
                    <button className="rounded-md border border-green-200 px-3 py-2 text-sm font-black text-sportGreen hover:bg-green-50" onClick={() => onOpenProfile(member)} type="button">
                      View Profile
                    </button>
                  ) : null}
                  {canRemove && member.role_in_team !== "CAPTAIN" ? (
                    <button className="rounded-md border border-red-200 px-3 py-2 text-sm font-black text-red-600 hover:bg-red-50" onClick={() => onRemove(member.id)} type="button">
                      {member.status === "INVITED" ? "Cancel Invite" : "Remove Member"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerPreviewCard({
  inviteRole,
  isSendingInvite,
  onInvite,
  onRoleChange,
  player,
}: {
  inviteRole: CricksalRole;
  isSendingInvite: boolean;
  onInvite: () => void;
  onRoleChange: (role: CricksalRole) => void;
  player: PlayerLookup;
}) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sportNavy text-xl font-black text-white">
          {player.profile_photo ? (
            <Image alt={`${player.full_name} profile photo`} className="object-cover" fill sizes="80px" src={getTeamPhotoSrc(player.profile_photo)} unoptimized />
          ) : (
            getTeamInitials(player.full_name)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xl font-black text-sportNavy">{player.full_name}</h4>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-sportGreen">{player.sportspot_id}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {formatChoice(player.skill_level)} · {formatChoice(player.preferred_cricksal_role)}
          </p>
          <p className="mt-1 text-sm text-slate-600">{player.location}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <MiniStat label="Reliability" value={player.reliability_label} />
            <MiniStat label="Matches" value={player.completed_matches_count} />
            <MiniStat label="Rating" value={formatRating(player.average_rating)} />
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Select role for this team">
          <select className={inputClassName} value={inviteRole} onChange={(event) => onRoleChange(event.target.value as CricksalRole)}>
            {cricksalRoleOptions.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </Field>
        <button className="h-12 rounded-md bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 disabled:bg-slate-400" disabled={isSendingInvite} onClick={onInvite} type="button">
          {isSendingInvite ? "Sending..." : "Send Invitation"}
        </button>
      </div>
    </div>
  );
}

function PlayerProfileModal({
  member,
  onClose,
}: {
  member: NonNullable<Team["members"]>[number];
  onClose: () => void;
}) {
  const profilePhotoSrc = getTeamPhotoSrc(member.profile_photo);

  return (
    <Modal title="Player Profile Card" onClose={onClose}>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="bg-sportNavy p-5 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10 text-2xl font-black text-white">
              {profilePhotoSrc ? (
                <Image alt={`${member.display_name} profile photo`} className="object-cover" fill sizes="96px" src={profilePhotoSrc} unoptimized />
              ) : (
                getTeamInitials(member.display_name)
              )}
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-green-300">Registered SportSpot Player</p>
              <h3 className="mt-1 text-3xl font-black">{member.display_name}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white">{member.sportspot_id || "SportSpot ID unavailable"}</span>
                <span className="rounded-full bg-green-400/15 px-3 py-1 text-xs font-black text-green-200">{formatChoice(member.status)}</span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white">{formatChoice(member.role_in_team)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat label="Skill" value={formatChoice(member.skill_level)} />
            <MiniStat label="Location" value={member.location || "Not set"} />
            <MiniStat label="Team Role" value={formatChoice(member.cricksal_role)} />
            <MiniStat label="Reliability" value={member.reliability_label || "New Player"} />
            <MiniStat label="Matches" value={member.completed_matches_count} />
            <MiniStat label="Rating" value={formatRating(member.average_rating)} />
            <MiniStat label="Sport" value="Cricksal" />
            <MiniStat label="Joined" value={formatDate(member.joined_at) || "Pending"} />
          </div>

          {member.completed_matches_count < 3 ? (
            <p className="mt-4 rounded-md bg-green-50 p-3 text-sm font-semibold text-green-800">
              Reliability becomes meaningful after a few completed matches.
            </p>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Weekly Availability</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{member.weekly_availability || "Not added yet."}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Playing Style</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{member.playing_style || "Not added yet."}</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SuggestedPlayers() {
  const suggestions = [
    { name: "Aayush KC", role: "Bowler", location: "Near Baneshwor", badge: "New Player" },
    { name: "Nisha Gurung", role: "All-rounder", location: "Near Chabahil", badge: "Reliable Player" },
    { name: "Rabin Shrestha", role: "Batsman", location: "Near Lalitpur", badge: "New Player" },
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="font-black text-sportNavy">Suggested Near You</h4>
      <p className="mt-1 text-xs font-semibold text-slate-500">Placeholder suggestions for now. Use SportSpot ID to send a real invitation.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {suggestions.map((player) => (
          <div className="rounded-md bg-slate-50 p-3" key={player.name}>
            <p className="font-black text-sportNavy">{player.name}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{player.role}</p>
            <p className="mt-1 text-xs text-slate-500">{player.location}</p>
            <button className="mt-3 w-full cursor-not-allowed rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-slate-400" disabled type="button">
              Use SportSpot ID
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded px-3 py-2 text-sm font-black transition ${active ? "bg-white text-sportGreen shadow-sm" : "text-slate-600 hover:bg-white/70"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-white p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "ACTIVE"
      ? "bg-green-50 text-sportGreen"
      : status === "INVITED"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return <span className={`rounded-full px-2 py-1 text-xs font-black ${className}`}>{formatChoice(status)}</span>;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-black text-sportNavy">{value}</p>
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-2 focus:ring-green-100";

function Field({ children, className = "", label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <label className={`block text-sm font-black text-slate-800 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function ReadOnlySportBadge() {
  return (
    <div className="mt-2 flex w-full items-center justify-between rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
      <span className="font-black text-sportNavy">Cricksal</span>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-sportGreen">SportSpot Sport</span>
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-sportGreen">Team Action</p>
            <h2 className="mt-1 text-2xl font-black text-sportNavy">{title}</h2>
          </div>
          <button className="rounded-full border border-slate-200 px-3 py-1 text-sm font-black text-slate-500 hover:bg-slate-50" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function toTeamPayload(team: Team): TeamPayload {
  return {
    name: team.name,
    description: team.description || "",
    location: team.location,
    preferred_playing_area: team.preferred_playing_area,
    preferred_playing_time: team.preferred_playing_time,
    skill_level: team.skill_level,
  };
}

function getTeamPhotoSrc(value: string) {
  if (!value) return "";
  if (value.startsWith("blob:") || value.startsWith("http")) return value;
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${apiBaseUrl}${value}`;
}

function getTeamInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatChoice(value?: string) {
  if (!value) return "Not set";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRating(value?: string) {
  if (!value) return "0.00";
  return Number(value).toFixed(2);
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
