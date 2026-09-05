"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DashboardPageHeader } from "@/components/player-dashboard/DashboardPageHeader";
import LoadingIndicator from "@/components/LoadingIndicator";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import { emitToast } from "@/lib/toast";
import type {
  PendingAttendanceReview,
  PendingRatingItem,
  PlayerRatingsReliabilityResponse,
  RatingSummary,
  ReliabilityActivityItem,
  ReliabilityBreakdownItem,
  ReliabilityImpact,
  ReliabilityMetrics,
  ReliabilitySummary,
} from "@/types/playerRatings";

export default function PlayerRatingsPage() {
  const [summary, setSummary] = useState<PlayerRatingsReliabilityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [ratingTarget, setRatingTarget] = useState<PendingRatingItem | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [attendanceTarget, setAttendanceTarget] = useState<PendingAttendanceReview | null>(null);
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false);

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    if (!summary || ratingTarget || typeof window === "undefined") return;
    const requestedId = new URLSearchParams(window.location.search).get("rate");
    if (!requestedId) return;
    const target = summary.pending_ratings.find((item) => String(item.id) === requestedId);
    if (target) setRatingTarget(target);
  }, [ratingTarget, summary]);

  async function loadSummary() {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.get<PlayerRatingsReliabilityResponse>("/api/players/ratings-reliability/");
      setSummary(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "We could not load your ratings and reliability right now. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }

  async function submitRating(target: PendingRatingItem, rating: number, feedbackTags: string[], comment: string) {
    setIsSubmittingRating(true);
    try {
      await api.post(`/api/players/ratings/eligibilities/${target.id}/submit/`, {
        rating,
        feedback_tags: feedbackTags,
        comment,
      });
      emitToast({ message: "Your rating has been submitted.", type: "success", dedupeKey: `rating-submitted-${target.id}` });
      setRatingTarget(null);
      window.dispatchEvent(new Event("sportspot:notifications-changed"));
      await loadSummary();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not submit this rating. Please try again."), type: "error", dedupeKey: `rating-submit-error-${target.id}` });
    } finally {
      setIsSubmittingRating(false);
    }
  }
  if (isLoading) return <RatingsSkeleton />;

  if (error || !summary) {
    return (
      <div className="space-y-4">
        <DashboardPageHeader
          eyebrow="Player trust"
          title="Ratings & Reliability"
          description="Understand the trust signals teams and players use when choosing who to play with."
        />
        <section className="sport-error-state">
          <p className="text-sm font-semibold text-red-700">{error || "We could not load your trust summary."}</p>
          <button className="mt-4 rounded-xl bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" onClick={loadSummary} type="button">
            Retry
          </button>
        </section>
      </div>
    );
  }

  async function submitAttendanceDispute(target: PendingAttendanceReview, reason: string) {
    setIsSubmittingAttendance(true);
    try {
      const prefix = target.source_type === "TEAM_FIXTURE"
        ? `/api/team-challenges/fixtures/${target.source_id}/participants/${target.source_participant_id}/attendance/dispute/`
        : `/api/matchmaking/games/${target.source_id}/participants/${target.source_participant_id}/attendance/dispute/`;
      await api.post(prefix, { reason });
      emitToast({ message: "Your attendance dispute has been submitted for review.", type: "success", dedupeKey: `attendance-dispute-${target.id}` });
      setAttendanceTarget(null);
      await loadSummary();
    } catch (requestError) {
      emitToast({ message: getApiErrorMessage(requestError, "We could not submit the attendance dispute."), type: "error", dedupeKey: `attendance-dispute-error-${target.id}` });
    } finally {
      setIsSubmittingAttendance(false);
    }
  }

  return (
    <div className="space-y-4">
      <DashboardPageHeader
        eyebrow="Player trust"
        title="Ratings & Reliability"
        description="Track your confirmed-game reliability, verified ratings, and the habits that build trust on SportSpot."
      />

      {!summary.profile_exists ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-amber-900">Complete your profile to start building trust.</p>
              <p className="mt-1 text-sm leading-6 text-amber-800">Reliability and ratings become useful after your Cricksal identity and match activity are available.</p>
            </div>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200" href="/dashboard/player/profile">
              Complete Profile
            </Link>
          </div>
        </section>
      ) : null}

      {summary.pending_attendance_reviews.length || summary.pending_ratings.length ? (
        <section aria-labelledby="match-follow-up-title">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Match follow-up</p>
              <h2 className="mt-1 text-xl font-black text-sportNavy" id="match-follow-up-title">Complete your post-match actions</h2>
              <p className="mt-1 text-sm text-slate-600">Attendance reviews and verified player feedback are collected here after a match.</p>
            </div>
            <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/dashboard/player/games">View completed games</Link>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {summary.pending_attendance_reviews.length ? <PendingAttendanceReviews items={summary.pending_attendance_reviews} onReview={setAttendanceTarget} /> : null}
            {summary.pending_ratings.length ? <PendingRatings items={summary.pending_ratings} onRate={setRatingTarget} /> : null}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-2">
        <ReliabilityCard reliability={summary.reliability} lastUpdated={summary.last_updated} />
        <RatingCard rating={summary.rating} />
      </section>

      <MetricGrid metrics={summary.metrics} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-4">
          <ReliabilityBreakdown items={summary.breakdown} />
          <ReliabilityActivity items={summary.activity} />
        </div>
        <div className="space-y-4">
          <RatingSummaryCard rating={summary.rating} />
          <GuidanceCard message={summary.improvement_guidance} />
        </div>
      </section>

      <RecentRatings items={summary.recent_ratings} />

      {ratingTarget ? (
        <RatingSubmissionModal
          isSubmitting={isSubmittingRating}
          onClose={() => setRatingTarget(null)}
          onSubmit={submitRating}
          target={ratingTarget}
        />
      ) : null}
      {attendanceTarget ? (
        <AttendanceDisputeModal
          isSubmitting={isSubmittingAttendance}
          onClose={() => setAttendanceTarget(null)}
          onSubmit={(reason) => void submitAttendanceDispute(attendanceTarget, reason)}
          target={attendanceTarget}
        />
      ) : null}
    </div>
  );
}

function ReliabilityCard({ lastUpdated, reliability }: { lastUpdated: string | null; reliability: ReliabilitySummary }) {
  const progress = Math.max(0, Math.min(100, reliability.progress_percent));
  const isProvisional = reliability.is_provisional;
  const display = isProvisional ? "New" : reliability.display_score ?? "--";

  return (
    <article className="sport-card">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <ProgressRing label={isProvisional ? "Provisional" : "Index"} progress={progress} value={display} />
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${isProvisional ? "bg-slate-100 text-slate-600" : "bg-green-50 text-sportGreen"}`}>
            {isProvisional ? "Building history" : `${reliability.level} status`}
          </span>
          <h2 className="mt-3 text-xl font-black tracking-tight text-sportNavy">
            {isProvisional ? "Reliability starts after verified games" : "Reliability Index"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {isProvisional
              ? "Your score becomes meaningful after a few completed Cricksal games. Booking-only activity does not affect this trust record."
              : "Based on confirmed-game attendance, no-shows, and late game cancellations."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">{reliability.verified_games_considered} verified games</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Updated {formatDate(lastUpdated)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function RatingCard({ rating }: { rating: RatingSummary }) {
  return (
    <article className="sport-card">
      <div className="flex h-full flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Athlete Rating</p>
          <p className="mt-4 text-3xl font-black tracking-tight text-sportNavy">{rating.has_rating ? formatRatingValue(rating.average) : "Not rated yet"}</p>
          <div className="mt-3 flex items-center gap-1" aria-label={rating.has_rating ? `${rating.average} out of 5 rating` : "No rating yet"}>
            {Array.from({ length: 5 }).map((_, index) => <StarIcon active={rating.has_rating && index < Math.round(Number(rating.average || 0))} key={index} />)}
          </div>
        </div>
        <div className="max-w-xs text-sm leading-6 text-slate-600 sm:text-right">
          {rating.has_rating ? (
            <p><span className="font-black text-sportNavy">{rating.total_ratings}</span> verified rating{rating.total_ratings === 1 ? "" : "s"} from {rating.completed_games_represented} completed game{rating.completed_games_represented === 1 ? "" : "s"}.</p>
          ) : (
            <p>Ratings appear after verified completed games where participants submit feedback.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
            {rating.feedback_tags.length ? rating.feedback_tags.slice(0, 3).map((tag) => <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-sportGreen" key={tag}>{tag}</span>) : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500">No feedback yet</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

function MetricGrid({ metrics }: { metrics: ReliabilityMetrics }) {
  const cards = [
    { label: "Attended games", value: String(metrics.completed_games), helper: "Verified commitments", icon: <BallIcon />, tone: "green" },
    { label: "Commitments fulfilled", value: metrics.commitments_honoured_rate === null ? "--" : `${metrics.commitments_honoured_rate}%`, helper: metrics.commitments_honoured_rate === null ? "Not enough data" : "Attendance and on-time follow-through", icon: <CheckIcon />, tone: "slate" },
    { label: "Late Cancels", value: String(metrics.late_cancellations), helper: "After deadline", icon: <ClockIcon />, tone: "slate" },
    { label: "No-Shows", value: String(metrics.no_shows), helper: "Missed games", icon: <WarningIcon />, tone: "red" },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={card.label}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.tone === "red" ? "bg-red-50 text-red-600" : card.tone === "green" ? "bg-green-50 text-sportGreen" : "bg-slate-100 text-slate-500"}`}>{card.icon}</span>
          </div>
          <p className="mt-4 text-2xl font-black tracking-tight text-sportNavy">{card.value}</p>
          <p className="mt-1 text-sm text-slate-600">{card.helper}</p>
        </article>
      ))}
    </section>
  );
}
function ReliabilityBreakdown({ items }: { items: ReliabilityBreakdownItem[] }) {
  return (
    <section className="sport-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-sportNavy">Reliability Breakdown</h2>
          <p className="mt-1 text-sm text-slate-600">The verified factors that currently shape your trust record.</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><InfoIcon /></span>
      </div>
      <div className="mt-4 divide-y divide-slate-100">
        {items.map((item) => (
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between" key={item.title}>
            <div className="flex gap-3">
              <span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${impactTone(item.impact).icon}`}>{impactIcon(item.impact)}</span>
              <div>
                <p className="font-black text-sportNavy">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:justify-end">
              {item.value > 0 ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{item.value}</span> : null}
              <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${impactTone(item.impact).badge}`}>{impactLabel(item.impact)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-green-100 bg-green-50 p-4">
        <p className="text-sm font-black text-sportGreen">How reliability works</p>
        <p className="mt-1 text-sm leading-6 text-green-900">Reliability reflects whether you fulfil confirmed game commitments. Ordinary court bookings stay in booking history; late game cancellations and no-shows can reduce trust.</p>
      </div>
    </section>
  );
}

function ReliabilityActivity({ items }: { items: ReliabilityActivityItem[] }) {
  return (
    <section className="sport-surface overflow-hidden">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <h2 className="text-lg font-black text-sportNavy">Reliability Activity</h2>
        <p className="mt-1 text-sm text-slate-600">Recent records that confirmed or affected your reliability.</p>
      </div>
      {items.length ? (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" key={`${item.title}-${item.date}`}>
              <div className="flex gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${impactTone(item.impact).icon}`}>{impactIcon(item.impact)}</span>
                <div>
                  <p className="font-black text-sportNavy">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${impactTone(item.impact).badge}`}>{impactLabel(item.impact)}</span>
                <p className="mt-2 text-xs font-semibold text-slate-500">{formatDate(item.date)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyPanel title="No reliability activity yet" description="Your reliability history will appear after confirmed games and verified attendance events." />}
    </section>
  );
}

function RatingSummaryCard({ rating }: { rating: RatingSummary }) {
  const total = rating.distribution.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="sport-card">
      <h2 className="text-lg font-black text-sportNavy">Rating Summary</h2>
      <p className="mt-1 text-sm text-slate-600">Feedback from verified participants after completed games.</p>
      {rating.has_rating && rating.distribution.length ? (
        <div className="mt-4 space-y-3">
          {[5, 4, 3, 2, 1].map((value) => {
            const item = rating.distribution.find((entry) => entry.rating === value);
            const count = item?.count || 0;
            const width = total ? Math.round((count / total) * 100) : 0;
            return (
              <div className="grid grid-cols-[24px_1fr_32px] items-center gap-3 text-sm" key={value}>
                <span className="font-black text-slate-700">{value}</span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-sportGreen" style={{ width: `${width}%` }} /></span>
                <span className="text-right font-semibold text-slate-600">{count}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          <p className="font-black text-sportNavy">No verified ratings yet.</p>
          <p className="mt-1">After completed games receive verified feedback, your rating distribution and feedback tags will appear here.</p>
        </div>
      )}
    </section>
  );
}

function PendingAttendanceReviews({ items, onReview }: { items: PendingAttendanceReview[]; onReview: (item: PendingAttendanceReview) => void }) {
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-amber-700">!</span>
        <div>
          <h2 className="text-lg font-black text-amber-950">Attendance reviews</h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">A host reported a missed game. Review it before the deadline; unresolved reports may affect reliability.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <article className="rounded-xl border border-amber-200 bg-white p-3" key={item.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-black text-sportNavy">{item.title}</p>
                <p className="mt-1 text-sm text-slate-600">{formatDate(item.start_at)} · {item.status === "DISPUTED" ? "Under staff review" : item.review_deadline_at ? `Review by ${formatDate(item.review_deadline_at)}` : "Review required"}</p>
              </div>
              {item.can_dispute ? <button className="min-h-10 shrink-0 rounded-lg bg-sportGreen px-4 text-sm font-black text-white hover:bg-green-700" onClick={() => onReview(item)} type="button">Review report</button> : <span className="text-xs font-black uppercase tracking-wide text-amber-800">Under review</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AttendanceDisputeModal({ isSubmitting, onClose, onSubmit, target }: { isSubmitting: boolean; onClose: () => void; onSubmit: (reason: string) => void; target: PendingAttendanceReview }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-sportNavy/50 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="attendance-dispute-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Attendance review</p>
            <h2 className="mt-2 text-xl font-black text-sportNavy" id="attendance-dispute-title">Dispute this no-show report</h2>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600" aria-label="Close attendance dispute" onClick={onClose} type="button">x</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">{target.title} on {formatDate(target.start_at)}. Explain briefly why the report is incorrect. Your reliability stays unchanged while SportSpot reviews the case.</p>
        <textarea className="mt-4 min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-sportNavy outline-none focus:border-sportGreen focus:ring-4 focus:ring-green-100" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="For example: I attended and checked in with the captain." value={reason} />
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-700" disabled={isSubmitting} onClick={onClose} type="button">Cancel</button><button className="min-h-10 rounded-lg bg-sportGreen px-4 text-sm font-black text-white disabled:opacity-50" disabled={isSubmitting || reason.trim().length < 5} onClick={() => onSubmit(reason.trim())} type="button">{isSubmitting ? "Submitting..." : "Submit dispute"}</button></div>
      </div>
    </div>
  );
}

function PendingRatings({ items, onRate }: { items: PendingRatingItem[]; onRate: (item: PendingRatingItem) => void }) {
  return (
    <section className="rounded-2xl bg-sportNavy p-4 text-white shadow-sm sm:p-5">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-green-300"><StarIcon active /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black">Pending Ratings</h2>
          {items.length ? (
            <p className="mt-1 text-sm leading-6 text-slate-300">You have {items.length} verified participant rating{items.length === 1 ? "" : "s"} to complete.</p>
          ) : (
            <p className="mt-1 text-sm leading-6 text-slate-300">No matches are waiting for your rating right now.</p>
          )}
        </div>
      </div>
      {items.length ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <article className="rounded-2xl bg-white/10 p-3.5" key={item.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-white">{item.rated_player_name}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-300">{item.title} - {formatDate(item.match_date)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.rated_player_sportspot_id ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-green-200">{item.rated_player_sportspot_id}</span> : null}
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-green-200">{item.rated_player_role}</span>
                    {item.deadline_at ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-slate-200">Due {formatDate(item.deadline_at)}</span> : null}
                  </div>
                </div>
                <button
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-green-400 px-4 text-sm font-black text-sportNavy transition hover:bg-green-300 focus:outline-none focus:ring-2 focus:ring-green-200"
                  onClick={() => onRate(item)}
                  type="button"
                >
                  Rate Player
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const FEEDBACK_TAG_OPTIONS = [
  { label: "Punctual", value: "PUNCTUAL" },
  { label: "Respectful", value: "RESPECTFUL" },
  { label: "Team Player", value: "TEAM_PLAYER" },
  { label: "Good Communication", value: "GOOD_COMMUNICATION" },
  { label: "Reliable", value: "RELIABLE" },
  { label: "Sportsmanlike", value: "SPORTSMANLIKE" },
];

function RatingSubmissionModal({
  isSubmitting,
  onClose,
  onSubmit,
  target,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (target: PendingRatingItem, rating: number, feedbackTags: string[], comment: string) => void;
  target: PendingRatingItem;
}) {
  const [rating, setRating] = useState(5);
  const [feedbackTags, setFeedbackTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  function toggleTag(value: string) {
    setFeedbackTags((current) => (
      current.includes(value)
        ? current.filter((tag) => tag !== value)
        : [...current, value].slice(0, 5)
    ));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-sportNavy/50 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="rating-modal-title">
      <div className="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">Verified game feedback</p>
            <h2 className="mt-2 text-2xl font-black text-sportNavy" id="rating-modal-title">Rate {target.rated_player_name}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Your feedback helps teams trust verified SportSpot participants.</p>
          </div>
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-green-200" onClick={onClose} type="button" aria-label="Close rating form">
            x
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-black text-sportNavy">{target.title}</p>
          <p className="mt-1 text-sm text-slate-600">{formatDate(target.match_date)} - {target.rated_player_role}</p>
          {target.deadline_at ? <p className="mt-1 text-xs font-semibold text-slate-500">Rating deadline: {formatDate(target.deadline_at)}</p> : null}
        </div>

        <div className="mt-5">
          <label className="text-sm font-black text-sportNavy">Rating</label>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Choose rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                className={`flex min-h-11 min-w-12 items-center justify-center rounded-xl border text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-green-200 ${rating === value ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-slate-700 hover:border-sportGreen"}`}
                key={value}
                onClick={() => setRating(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="text-sm font-black text-sportNavy">Feedback tags</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {FEEDBACK_TAG_OPTIONS.map((tag) => {
              const selected = feedbackTags.includes(tag.value);
              return (
                <button
                  className={`rounded-full border px-3 py-2 text-xs font-black uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-green-200 ${selected ? "border-sportGreen bg-green-50 text-sportGreen" : "border-slate-200 bg-white text-slate-600 hover:border-sportGreen"}`}
                  key={tag.value}
                  onClick={() => toggleTag(tag.value)}
                  type="button"
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <label className="text-sm font-black text-sportNavy" htmlFor="rating-comment">Comment <span className="font-semibold text-slate-400">optional</span></label>
          <textarea
            className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm text-sportNavy outline-none transition placeholder:text-slate-400 focus:border-sportGreen focus:ring-4 focus:ring-green-100"
            id="rating-comment"
            maxLength={500}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Share short, respectful feedback from the completed game."
            value={comment}
          />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-sportNavy hover:border-sportGreen hover:text-sportGreen focus:outline-none focus:ring-2 focus:ring-green-200" disabled={isSubmitting} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="min-h-11 rounded-xl bg-sportGreen px-5 text-sm font-black text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-200 disabled:cursor-not-allowed disabled:opacity-60" disabled={isSubmitting} onClick={() => onSubmit(target, rating, feedbackTags, comment)} type="button">
            {isSubmitting ? <LoadingIndicator label="Submitting rating" size="sm" tone="inverse" /> : "Submit Rating"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GuidanceCard({ message }: { message: string }) {
  return (
    <section className="rounded-xl border border-green-100 bg-green-50 p-4 shadow-sm sm:p-5">
      <p className="text-sm font-black uppercase tracking-[0.16em] text-sportGreen">Next best step</p>
      <p className="mt-2 text-sm font-bold leading-6 text-green-950">{message}</p>
    </section>
  );
}

function RecentRatings({ items }: { items: PlayerRatingsReliabilityResponse["recent_ratings"] }) {
  return (
    <section className="sport-surface overflow-hidden">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <h2 className="text-lg font-black text-sportNavy">Recent Ratings Received</h2>
        <p className="mt-1 text-sm text-slate-600">Only verified participant feedback is shown here. Rater identity stays private.</p>
      </div>
      {items.length ? (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <article className="p-4" key={item.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <p className="text-lg font-black text-sportNavy">{Number(item.value).toFixed(1)}/5</p>
                    <div className="flex items-center gap-1" aria-label={`${item.value} out of 5 rating`}>
                      {Array.from({ length: 5 }).map((_, index) => <StarIcon active={index < Math.round(Number(item.value || 0))} key={index} />)}
                    </div>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-700">Rating received from a verified match participant.</p>
                  <p className="mt-1 text-sm text-slate-500">{item.related_game} - {formatDate(item.match_date)}</p>
                </div>
                {item.feedback_tags.length ? (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {item.feedback_tags.map((tag) => <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-sportGreen" key={tag}>{tag}</span>)}
                  </div>
                ) : null}
              </div>
              {item.comment ? <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{item.comment}</p> : null}
            </article>
          ))}
        </div>
      ) : <EmptyPanel title="No ratings received yet" description="Verified ratings will appear after completed games receive participant feedback." />}
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-black text-sportNavy">{value}</p>
    </div>
  );
}

function ProgressRing({ label, progress, value }: { label: string; progress: number; value: number | string }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative h-28 w-28 shrink-0" aria-label={`${label}: ${value}`}>
      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" fill="none" r={radius} stroke="#e5e7eb" strokeWidth="9" />
        <circle cx="60" cy="60" fill="none" r={radius} stroke={progress ? "#16a34a" : "#cbd5e1"} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" strokeWidth="9" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-black text-sportNavy">{value}</span>
        <span className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function EmptyPanel({ description, title }: { description: string; title: string }) {
  return (
    <div className="p-4 sm:p-5">
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
        <p className="font-black text-sportNavy">{title}</p>
        <p className="mt-1">{description}</p>
      </div>
    </div>
  );
}

function RatingsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-28 animate-pulse rounded-lg bg-white shadow-sm" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-60 animate-pulse rounded-2xl bg-white shadow-sm" />
        <div className="h-60 animate-pulse rounded-2xl bg-white shadow-sm" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div className="h-32 animate-pulse rounded-2xl bg-white shadow-sm" key={index} />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" />
        <div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" />
      </div>
    </div>
  );
}

function impactTone(impact: ReliabilityImpact) {
  if (impact === "POSITIVE") return { badge: "bg-green-50 text-sportGreen", icon: "bg-green-50 text-sportGreen" };
  if (impact === "NEGATIVE") return { badge: "bg-red-50 text-red-700", icon: "bg-red-50 text-red-700" };
  return { badge: "bg-slate-100 text-slate-600", icon: "bg-slate-100 text-slate-600" };
}

function impactLabel(impact: ReliabilityImpact) {
  if (impact === "POSITIVE") return "Positive impact";
  if (impact === "NEGATIVE") return "Negative impact";
  if (impact === "NO_IMPACT") return "No impact";
  return "Building history";
}

function impactIcon(impact: ReliabilityImpact) {
  if (impact === "NEGATIVE") return <WarningIcon />;
  if (impact === "POSITIVE") return <CheckIcon />;
  return <InfoIcon />;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return formatDateTimeInNepal(value, { day: "numeric", month: "short", year: "numeric" });
}

function formatRatingValue(value: string | null) {
  if (!value) return "Not rated yet";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : value;
}

function StarIcon({ active = false }: { active?: boolean }) {
  return (
    <svg aria-hidden="true" className={`h-5 w-5 ${active ? "text-sportGreen" : "text-slate-300"}`} fill="currentColor" viewBox="0 0 20 20">
      <path d="m10 1.8 2.48 5.02 5.54.8-4.01 3.91.95 5.52L10 14.44l-4.96 2.61.95-5.52-4.01-3.9 5.54-.81L10 1.8Z" />
    </svg>
  );
}

function BallIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c1.7-2 2.5-4.2 2.5-6.5S13.7 10 12 8c-1.7 2-2.5 4.2-2.5 6.5S10.3 19 12 21Zm-7.7-5.2c2.4-.2 4.1-.7 5.2-1.3M14.5 14.5c1.1.6 2.8 1.1 5.2 1.3M4.3 8.2c2.4.2 4.1.7 5.2 1.3m5 0c1.1-.6 2.8-1.1 5.2-1.3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>; }
function CheckIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" /></svg>; }
function ClockIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function WarningIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 8v5m0 4h.01M10.3 4.4 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.4a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
function InfoIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M12 11v6m0-9h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
