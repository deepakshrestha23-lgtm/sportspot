"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import FeedbackToast from "@/components/FeedbackToast";
import LoadingIndicator from "@/components/LoadingIndicator";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatDateTimeInNepal } from "@/lib/dates";
import type { OwnerFeedbackItem, OwnerReviewsResponse } from "@/types/venue";

type FeedbackType = "all" | "reviews" | "comments";
type FeedbackPeriod = "all" | "30" | "90";
type FeedbackSort = "newest" | "oldest" | "highest" | "lowest";
type ReportReason = "SPAM" | "INAPPROPRIATE" | "MISLEADING" | "OTHER";

const feedbackTypes: Array<{ label: string; value: FeedbackType }> = [
  { label: "All", value: "all" },
  { label: "Ratings", value: "reviews" },
  { label: "Comments", value: "comments" },
];

const reportReasons: Array<{ label: string; value: ReportReason }> = [
  { label: "Inappropriate content", value: "INAPPROPRIATE" },
  { label: "Spam", value: "SPAM" },
  { label: "Misleading information", value: "MISLEADING" },
  { label: "Other policy concern", value: "OTHER" },
];

export default function OwnerReviewsPage() {
  const [feedback, setFeedback] = useState<OwnerReviewsResponse | null>(null);
  const [type, setType] = useState<FeedbackType>("all");
  const [period, setPeriod] = useState<FeedbackPeriod>("all");
  const [courtId, setCourtId] = useState("all");
  const [rating, setRating] = useState("all");
  const [sort, setSort] = useState<FeedbackSort>("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reportTarget, setReportTarget] = useState<OwnerFeedbackItem | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("INAPPROPRIATE");
  const [reportDetails, setReportDetails] = useState("");
  const [isReporting, setIsReporting] = useState(false);
  const [reportedTargets, setReportedTargets] = useState<Record<string, boolean>>({});
  const requestSequence = useRef(0);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    const query = new URLSearchParams({ type, period, sort, page: "1", page_size: "20" });
    if (courtId !== "all") query.set("court_id", courtId);
    if (rating !== "all" && type !== "comments") query.set("rating", rating);

    setIsLoading(true);
    setError("");
    void api
      .get<OwnerReviewsResponse>(`/api/venues/owner/reviews/?${query.toString()}`)
      .then((response) => {
        if (requestId === requestSequence.current) setFeedback(response.data);
      })
      .catch((requestError) => {
        if (requestId === requestSequence.current) setError(getApiErrorMessage(requestError, "Could not load venue feedback."));
      })
      .finally(() => {
        if (requestId === requestSequence.current) setIsLoading(false);
      });
  }, [courtId, period, rating, sort, type]);

  const visibleCount = feedback?.pagination.total || 0;
  const averageRating = feedback?.summary.average_rating ? Number(feedback.summary.average_rating) : 0;
  const selectedCourtLabel = useMemo(
    () => feedback?.courts.find((court) => String(court.id) === courtId)?.name,
    [courtId, feedback?.courts],
  );

  function openReport(item: OwnerFeedbackItem) {
    setReportTarget(item);
    setReportReason("INAPPROPRIATE");
    setReportDetails("");
    setError("");
  }

  async function submitReport() {
    if (!reportTarget) return;
    const targetKey = `${reportTarget.content_type}-${reportTarget.id}`;
    setIsReporting(true);
    setError("");
    try {
      await api.post("/api/venues/owner/reviews/report/", {
        target_type: reportTarget.content_type,
        target_id: reportTarget.id,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setReportedTargets((current) => ({ ...current, [targetKey]: true }));
      setReportTarget(null);
      setNotice("The feedback was sent to SportSpot moderation. It remains unchanged while the report is reviewed.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not submit the moderation report."));
    } finally {
      setIsReporting(false);
    }
  }

  return (
    <div className="owner-feedback-page">
      <FeedbackToast
        message={error || notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
        type={error ? "error" : notice ? "success" : "info"}
      />

      <OwnerPageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {feedback?.venue ? <Link className="owner-secondary-button" href="/dashboard/owner/venue">Manage venue</Link> : null}
            <Link className="owner-primary-button" href="/dashboard/owner/reports">View reports</Link>
          </div>
        }
        description="Review verified player ratings, compare court feedback, and report genuine policy concerns when needed."
        eyebrow="Venue Manager"
        title="Reviews & Feedback"
      />

      {isLoading && !feedback ? <FeedbackLoading /> : null}

      {!isLoading && error && !feedback ? (
        <section className="owner-feedback-message" role="alert">
          <div>
            <p className="owner-section-kicker">Feedback unavailable</p>
            <h2>We could not load your venue feedback.</h2>
            <p>{error}</p>
          </div>
          <button className="owner-secondary-button" onClick={() => window.location.reload()} type="button">Try again</button>
        </section>
      ) : null}

      {!isLoading && feedback && !feedback.venue ? (
        <section className="sport-empty-state">
          <p className="owner-section-kicker">Venue setup required</p>
          <h2 className="mt-2 text-xl font-black text-sportNavy">Create your venue to receive feedback</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Verified player ratings and comments will appear here after players complete a paid booking at one of your courts.</p>
          <Link className="owner-primary-button mt-5" href="/dashboard/owner/venue-setup">Complete venue setup</Link>
        </section>
      ) : null}

      {feedback?.venue ? (
        <>
          <section aria-label="Feedback summary" className="owner-feedback-summary">
            <SummaryMetric label="Average rating" value={feedback.summary.average_rating || "No rating"} detail={feedback.summary.rating_count ? `${feedback.summary.rating_count} verified rating${feedback.summary.rating_count === 1 ? "" : "s"}` : "No ratings yet"} tone="rating" stars={averageRating} />
            <SummaryMetric label="Ratings" value={String(feedback.summary.rating_count)} detail={`${feedback.summary.positive_rating_count} positive`} />
            <SummaryMetric label="Comments" value={String(feedback.summary.comment_count)} detail="Written feedback" />
            <SummaryMetric label="All feedback" value={String(feedback.summary.total_feedback)} detail={feedback.summary.latest_feedback_at ? `Updated ${formatDateTimeInNepal(feedback.summary.latest_feedback_at, { month: "short", day: "numeric" })}` : "No feedback yet"} />
          </section>

          <section aria-labelledby="feedback-insights-heading" className="owner-feedback-insights">
            <div className="owner-feedback-panel owner-feedback-rating-panel">
              <div className="owner-feedback-panel-heading">
                <div>
                  <p className="owner-section-kicker">Rating distribution</p>
                  <h2 id="feedback-insights-heading">Venue rating breakdown</h2>
                </div>
                <span className="owner-feedback-panel-note">Verified bookings</span>
              </div>
              <div className="owner-feedback-distribution">
                {feedback.distribution.map((item) => {
                  const width = feedback.summary.rating_count ? `${(item.count / feedback.summary.rating_count) * 100}%` : "0%";
                  return (
                    <div className="owner-feedback-distribution-row" key={item.rating}>
                      <span className="owner-feedback-distribution-label">{item.rating} <StarIcon /></span>
                      <span className="owner-feedback-distribution-track"><span style={{ width }} /></span>
                      <strong>{item.count}</strong>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="owner-feedback-panel owner-feedback-courts-panel">
              <div className="owner-feedback-panel-heading">
                <div>
                  <p className="owner-section-kicker">Court comparison</p>
                  <h2>Ratings by court</h2>
                </div>
                <Link className="owner-feedback-panel-link" href="/dashboard/owner/courts">Manage courts <span aria-hidden="true">-&gt;</span></Link>
              </div>
              {feedback.courts.length ? (
                <div className="owner-feedback-court-list">
                  {feedback.courts.map((court) => (
                    <button className={`owner-feedback-court-row${String(court.id) === courtId ? " is-selected" : ""}`} key={court.id} onClick={() => setCourtId(String(court.id))} type="button">
                      <span className="owner-feedback-court-main"><strong>{court.name}</strong><small className={court.is_active ? "is-active" : "is-inactive"}>{court.is_active ? "Active" : "Inactive"}</small></span>
                      <span className="owner-feedback-court-rating">{court.average_rating ? <span className="owner-feedback-court-score"><strong>{court.average_rating}</strong><StarIcon /></span> : <span>No rating</span>}<small>{court.rating_count} rating{court.rating_count === 1 ? "" : "s"} · {court.comment_count} comment{court.comment_count === 1 ? "" : "s"}</small></span>
                      <span aria-hidden="true" className="owner-feedback-court-arrow">›</span>
                    </button>
                  ))}
                </div>
              ) : <p className="owner-feedback-empty-copy">Add a court to start collecting player feedback.</p>}
            </div>
          </section>

          <section aria-labelledby="feedback-stream-heading" className="owner-feedback-stream">
            <div className="owner-feedback-stream-heading">
              <div>
                <p className="owner-section-kicker">Feedback</p>
                <h2 id="feedback-stream-heading">Recent feedback</h2>
                <p>{selectedCourtLabel ? `${selectedCourtLabel} · ` : ""}{visibleCount} matching item{visibleCount === 1 ? "" : "s"}</p>
              </div>
              <span className="owner-feedback-protection-note"><ShieldIcon /> Feedback comes from completed paid bookings.</span>
            </div>

            <div aria-label="Feedback filters" className="owner-feedback-filters">
              <div className="owner-feedback-type-tabs" role="tablist">
                {feedbackTypes.map((item) => (
                  <button aria-selected={type === item.value} className={type === item.value ? "is-active" : ""} key={item.value} onClick={() => { setType(item.value); if (item.value === "comments") setRating("all"); }} role="tab" type="button">{item.label}</button>
                ))}
              </div>
              <label className="owner-feedback-filter-field">
                <span>Court</span>
                <select onChange={(event) => setCourtId(event.target.value)} value={courtId}>
                  <option value="all">All courts</option>
                  {feedback.courts.map((court) => <option key={court.id} value={court.id}>{court.name}{court.is_active ? "" : " (inactive)"}</option>)}
                </select>
              </label>
              <label className="owner-feedback-filter-field">
                <span>Period</span>
                <select onChange={(event) => setPeriod(event.target.value as FeedbackPeriod)} value={period}>
                  <option value="all">All time</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </label>
              {type !== "comments" ? (
                <label className="owner-feedback-filter-field">
                  <span>Rating</span>
                  <select onChange={(event) => setRating(event.target.value)} value={rating}>
                    <option value="all">All ratings</option>
                    {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}
                  </select>
                </label>
              ) : null}
              <label className="owner-feedback-filter-field">
                <span>Sort</span>
                <select onChange={(event) => setSort(event.target.value as FeedbackSort)} value={sort}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  {type !== "comments" ? <><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option></> : null}
                </select>
              </label>
            </div>

            {isLoading ? <div className="owner-feedback-refreshing" aria-live="polite"><LoadingIndicator label="Updating feedback" size="sm" /></div> : null}
            {!isLoading && !feedback.feedback.length ? <FeedbackEmpty hasFilters={type !== "all" || courtId !== "all" || period !== "all" || rating !== "all"} onClear={() => { setType("all"); setCourtId("all"); setPeriod("all"); setRating("all"); }} /> : null}
            {feedback.feedback.length ? (
              <div className="owner-feedback-list">
                {feedback.feedback.map((item) => <FeedbackItem isReported={Boolean(reportedTargets[`${item.content_type}-${item.id}`])} item={item} key={`${item.content_type}-${item.id}`} onReport={openReport} />)}
              </div>
            ) : null}
          </section>

          <p className="owner-feedback-footer">Feedback is tied to completed paid bookings. SportSpot moderation handles policy violations; ordinary owner improvements should be based on patterns rather than removing individual opinions.</p>
        </>
      ) : null}

      {reportTarget ? <ReportDialog details={reportDetails} isSubmitting={isReporting} onClose={() => setReportTarget(null)} onDetailsChange={setReportDetails} onReasonChange={setReportReason} onSubmit={() => void submitReport()} reason={reportReason} target={reportTarget} /> : null}
    </div>
  );
}

function SummaryMetric({ detail, label, stars, tone = "default", value }: { detail: string; label: string; stars?: number; tone?: "default" | "rating"; value: string }) {
  return (
    <div className={`owner-feedback-summary-metric owner-feedback-summary-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {stars ? <RatingStars rating={stars} /> : null}
      <small>{detail}</small>
    </div>
  );
}

function FeedbackItem({ isReported, item, onReport }: { isReported: boolean; item: OwnerFeedbackItem; onReport: (item: OwnerFeedbackItem) => void }) {
  return (
    <article className="owner-feedback-item">
      <div className="owner-feedback-item-avatar" aria-hidden="true">{getInitials(item.reviewer_name)}</div>
      <div className="owner-feedback-item-body">
        <div className="owner-feedback-item-topline">
          <div className="owner-feedback-item-author"><strong>{item.reviewer_name}</strong><span>{item.content_type === "review" ? "Player rating" : "Player comment"}</span></div>
          <time dateTime={item.updated_at}>{formatDateTimeInNepal(item.updated_at, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time>
        </div>
        <div className="owner-feedback-item-meta">
          <span className={`owner-feedback-content-badge owner-feedback-content-badge-${item.content_type}`}>{item.content_type === "review" ? "Rating" : "Comment"}</span>
          <Link href={`/courts/${item.court_id}`}>{item.court_name}</Link>
          {item.rating ? <RatingStars rating={item.rating} /> : null}
        </div>
        <p className={item.comment ? "" : "is-muted"}>{item.comment || "No written comment was added."}</p>
        <div className="owner-feedback-item-actions">
          <span><ThumbIcon />{item.like_count} helpful</span>
          <span><DislikeIcon />{item.dislike_count} not helpful</span>
          {isReported ? <span className="owner-feedback-reported"><CheckIcon />Sent to moderation</span> : <button onClick={() => onReport(item)} type="button">Report a concern</button>}
        </div>
      </div>
    </article>
  );
}

function FeedbackEmpty({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="owner-feedback-empty">
      <span className="owner-feedback-empty-icon"><MessageIcon /></span>
      <h3>{hasFilters ? "No feedback matches these filters" : "No player feedback yet"}</h3>
      <p>{hasFilters ? "Try a broader court, period, or content filter." : "Verified ratings and comments will appear after completed paid bookings."}</p>
      {hasFilters ? <button className="owner-secondary-button" onClick={onClear} type="button">Clear filters</button> : null}
    </div>
  );
}

function FeedbackLoading() {
  return <section aria-label="Loading feedback" className="owner-feedback-loading"><LoadingIndicator label="Loading venue feedback" size="lg" /></section>;
}

function ReportDialog({ details, isSubmitting, onClose, onDetailsChange, onReasonChange, onSubmit, reason, target }: { details: string; isSubmitting: boolean; onClose: () => void; onDetailsChange: (value: string) => void; onReasonChange: (value: ReportReason) => void; onSubmit: () => void; reason: ReportReason; target: OwnerFeedbackItem }) {
  return (
    <div className="owner-feedback-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div aria-labelledby="report-feedback-title" aria-modal="true" className="owner-feedback-dialog" role="dialog">
        <div className="owner-feedback-dialog-heading">
          <div><p className="owner-section-kicker">SportSpot moderation</p><h2 id="report-feedback-title">Report a policy concern</h2></div>
          <button aria-label="Close report dialog" className="owner-feedback-dialog-close" onClick={onClose} type="button"><CloseIcon /></button>
        </div>
        <p className="owner-feedback-dialog-copy">This does not remove the player&apos;s feedback. It sends a private report to SportSpot for review.</p>
        <div className="owner-feedback-dialog-preview"><strong>{target.court_name}</strong><span>{target.reviewer_name} · {target.content_type === "review" ? `${target.rating} stars` : "Comment"}</span><p>{target.comment || "No written comment was added."}</p></div>
        <label className="owner-feedback-dialog-field"><span>Reason</span><select onChange={(event) => onReasonChange(event.target.value as ReportReason)} value={reason}>{reportReasons.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="owner-feedback-dialog-field"><span>Details <small>Optional</small></span><textarea maxLength={500} onChange={(event) => onDetailsChange(event.target.value)} placeholder="Tell SportSpot what needs review." rows={4} value={details} /></label>
        <div className="owner-feedback-dialog-actions"><button className="owner-secondary-button" disabled={isSubmitting} onClick={onClose} type="button">Cancel</button><button className="owner-primary-button" disabled={isSubmitting} onClick={onSubmit} type="button">{isSubmitting ? "Sending..." : "Send report"}</button></div>
      </div>
    </div>
  );
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P";
}

function RatingStars({ rating }: { rating: number }) {
  return <span aria-label={`${rating} out of 5 stars`} className="owner-feedback-stars">{[1, 2, 3, 4, 5].map((star) => <StarIcon filled={star <= rating} key={star} />)}</span>;
}

function StarIcon({ filled = true }: { filled?: boolean }) {
  return <svg aria-hidden="true" className={`owner-feedback-star${filled ? " is-filled" : ""}`} fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function ShieldIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="m12 3 7 3v5c0 4.4-2.8 8.2-7 10-4.2-1.8-7-5.6-7-10V6l7-3Zm-3 9 2 2 4-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function ThumbIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M8 10v10H5V10h3Zm0 10h8.3a2 2 0 0 0 1.9-1.4l1.5-5A2 2 0 0 0 17.8 11H15l.5-3.3A2.3 2.3 0 0 0 13.2 5L8 10v10Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function DislikeIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M16 14V4h3v10h-3Zm0-10H7.7a2 2 0 0 0-1.9 1.4l-1.5 5A2 2 0 0 0 6.2 13H9l-.5 3.3A2.3 2.3 0 0 0 10.8 19L16 14V4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function MessageIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4.5A2.5 2.5 0 0 1 5 12.5v-6Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function CheckIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>;
}
