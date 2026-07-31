"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { PublicVenue } from "@/types/venue";

const journeySteps = [
  {
    title: "Find a court",
    description: "Browse verified Cricksal venues and choose a court that fits your plan.",
    label: "Discover",
  },
  {
    title: "Reserve your time",
    description: "Pick a date, choose consecutive slots, and confirm one clean booking.",
    label: "Book",
  },
  {
    title: "Build the squad",
    description: "Invite registered players or add guests to your team when you need them.",
    label: "Team",
  },
  {
    title: "Arrive ready",
    description: "Use your booking pass, notifications, and venue updates on match day.",
    label: "Play",
  },
];

const actionCards = [
  {
    title: "Book a Court",
    description: "Find a verified Cricksal venue, select your court, and reserve available slots.",
    href: "/courts",
    cta: "Explore courts",
    accent: "bg-green-50 text-sportGreen",
  },
  {
    title: "Find a Game",
    description: "A player discovery flow for joining open Cricksal games is planned next.",
    href: "/find-game",
    cta: "View page",
    accent: "bg-sky-50 text-sky-700",
  },
  {
    title: "Challenge Teams",
    description: "Team challenges will connect real SportSpot teams when the challenge module is added.",
    href: "/challenge-teams",
    cta: "View page",
    accent: "bg-orange-50 text-sportOrange",
  },
  {
    title: "Register Venue",
    description: "Court owners can submit a venue, add courts, generate slots, and manage bookings.",
    href: "/register",
    cta: "Start setup",
    accent: "bg-slate-100 text-sportNavy",
  },
];

const trustPoints = [
  "Verified venues before public listing",
  "Multi-slot booking with one pass",
  "Team invitations by SportSpot ID",
  "Booking alerts in one Notification Centre",
];

const faqs = [
  {
    question: "What sport does SportSpot support right now?",
    answer: "SportSpot currently focuses on Cricksal only, so courts, teams, bookings, and player identity are built around Cricksal.",
  },
  {
    question: "Can I book more than one slot?",
    answer: "Yes. You can reserve consecutive slots for the same court and date as one booking with one payment and one booking pass.",
  },
  {
    question: "How do venues appear on SportSpot?",
    answer: "Court owners submit venue details, courts, slots, photos, and proof. After review, verified venues become visible to players.",
  },
];

export default function Home() {
  const [venues, setVenues] = useState<PublicVenue[]>([]);
  const [isLoadingVenues, setIsLoadingVenues] = useState(true);
  const [venueError, setVenueError] = useState("");
  const [activeFaq, setActiveFaq] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    loadApprovedVenues();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((step) => (step + 1) % journeySteps.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, []);

  async function loadApprovedVenues() {
    setIsLoadingVenues(true);
    setVenueError("");
    try {
      const response = await api.get<{ venues: PublicVenue[] }>("/api/venues/venues/");
      setVenues(response.data.venues);
    } catch (requestError) {
      setVenueError(getApiErrorMessage(requestError, "We could not load venues right now."));
    } finally {
      setIsLoadingVenues(false);
    }
  }

  const venuePreview = useMemo(() => venues.slice(0, 3), [venues]);

  return (
    <main className="overflow-hidden bg-[#f6f9f6] text-sportNavy">
      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(22,163,74,0.13),transparent_28%),radial-gradient(circle_at_88%_14%,rgba(14,165,233,0.09),transparent_25%),linear-gradient(180deg,#fbfffc_0%,#f6f9f6_70%,#ffffff_100%)]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:px-8">
          <div className="sportspot-reveal">
            <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-white/85 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-sportGreen shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-sportGreen" />
              Built for Nepal's Cricksal community
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.95] tracking-tight text-sportNavy sm:text-6xl lg:text-7xl">
              Book courts, build teams, and play with confidence.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              SportSpot brings Cricksal court booking, team coordination, player identity, and match-day updates into one smooth platform for players and venue owners.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link className="group inline-flex items-center justify-center rounded-md bg-sportGreen px-6 py-4 text-sm font-black text-white shadow-lg shadow-green-200 transition hover:-translate-y-0.5 hover:bg-green-700" href="/courts">
                Explore Courts
                <span className="ml-2 transition group-hover:translate-x-1">-&gt;</span>
              </Link>
              <Link className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-6 py-4 text-sm font-black text-sportNavy shadow-sm transition hover:-translate-y-0.5 hover:border-green-200 hover:bg-green-50" href="/register">
                Create Account
              </Link>
            </div>

            <div className="mt-9 flex flex-wrap gap-2">
              {trustPoints.map((point) => (
                <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-xs font-bold text-slate-600 shadow-sm" key={point}>
                  {point}
                </span>
              ))}
            </div>
          </div>

          <HeroPlayboard activeStep={activeStep} onSelectStep={setActiveStep} />
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Start here" title="What do you want to do today?" description="Choose the path that matches your next move on SportSpot." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {actionCards.map((card, index) => (
              <Link className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-green-200 hover:shadow-xl" href={card.href} key={card.title}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`grid h-11 w-11 place-items-center rounded-lg text-sm font-black ${card.accent}`}>0{index + 1}</span>
                  <span className="text-xl text-slate-300 transition group-hover:translate-x-1 group-hover:text-sportGreen">-&gt;</span>
                </div>
                <h3 className="mt-5 text-lg font-black text-sportNavy">{card.title}</h3>
                <p className="mt-2 min-h-16 text-sm leading-6 text-slate-600">{card.description}</p>
                <span className="mt-4 inline-flex text-sm font-black text-sportGreen">{card.cta}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f3f7fb] py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeader align="left" eyebrow="Courts" title="Cricksal venues near you" description="Browse verified venues and reserve available court slots when you are ready to play." />
            <Link className="text-sm font-black text-sportGreen hover:text-green-700" href="/courts">View all courts -&gt;</Link>
          </div>


          {isLoadingVenues ? (
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={item}>
                  <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
                  <div className="mt-5 h-5 w-2/3 animate-pulse rounded bg-slate-100" />
                  <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : venuePreview.length > 0 ? (
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {venuePreview.map((venue) => (
                <VenueCard key={venue.id} venue={venue} />
              ))}
            </div>
          ) : (
            <EmptyState
              actionHref="/register"
              actionLabel="Register a venue"
              title="No Cricksal venues are available yet."
              description="New venues will appear here after owner submission and verification."
            />
          )}
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Play flow" title="From plan to pitch in four steps" description="SportSpot keeps the important parts of your Cricksal session connected." />
          <div className="mt-12 grid gap-5 md:grid-cols-4">
            {journeySteps.map((step, index) => (
              <button
                className={`rounded-xl border p-5 text-left shadow-sm transition hover:-translate-y-1 ${
                  activeStep === index ? "border-green-300 bg-green-50 shadow-green-100" : "border-slate-200 bg-white hover:border-green-200"
                }`}
                key={step.title}
                onClick={() => setActiveStep(index)}
                type="button"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-sportNavy text-sm font-black text-white">{index + 1}</span>
                <h3 className="mt-5 text-lg font-black text-sportNavy">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#eaf3ff] py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl bg-sportNavy text-white shadow-2xl shadow-slate-300">
            <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[1fr_250px] lg:items-center">
              <div>
                <span className="rounded-full bg-green-400/15 px-3 py-1 text-xs font-black uppercase tracking-wide text-green-300">For venue owners</span>
                <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">Turn your venue into a bookable Cricksal destination.</h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  Submit venue details, add courts, generate slots, upload verification proof, and manage confirmed bookings from your owner dashboard.
                </p>
                <Link className="mt-6 inline-flex rounded-md bg-sportGreen px-5 py-3 text-sm font-black text-white hover:bg-green-700" href="/register">
                  Register Venue -&gt;
                </Link>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="space-y-3 text-sm font-semibold text-slate-300">
                  <div className="rounded-lg bg-white/10 p-3">Venue verification</div>
                  <div className="rounded-lg bg-white/10 p-3">Court and slot setup</div>
                  <div className="rounded-lg bg-white/10 p-3">Booking operations</div>
                  <div className="rounded-lg bg-white/10 p-3">Player communication</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Questions" title="Frequently asked questions" description="A few practical answers before you start." />
          <div className="mt-8 space-y-3">
            {faqs.map((faq, index) => (
              <button className="w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-green-200" key={faq.question} onClick={() => setActiveFaq(activeFaq === index ? -1 : index)} type="button">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-black text-sportNavy">{faq.question}</span>
                  <span className="text-xl font-black text-sportGreen">{activeFaq === index ? "-" : "+"}</span>
                </div>
                {activeFaq === index ? <p className="mt-3 text-sm leading-6 text-slate-600">{faq.answer}</p> : null}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function HeroPlayboard({ activeStep, onSelectStep }: { activeStep: number; onSelectStep: (step: number) => void }) {
  const step = journeySteps[activeStep];

  return (
    <div className="sportspot-float relative">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-green-200/30 blur-3xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-white bg-white/80 p-4 shadow-2xl shadow-green-100 backdrop-blur">
        <div className="relative min-h-[470px] overflow-hidden rounded-[1.5rem] bg-sportNavy p-6 text-white">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <div className="absolute left-1/2 top-20 h-72 w-72 -translate-x-1/2 rounded-full border border-green-300/25" />
          <div className="absolute left-1/2 top-32 h-44 w-44 -translate-x-1/2 rounded-full border border-green-300/20" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-green-300">SportSpot play flow</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight">{step.title}</h2>
              </div>
              <span className="rounded-full bg-green-400 px-3 py-1 text-xs font-black text-green-950">Cricksal</span>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3">
              {journeySteps.map((item, index) => (
                <button
                  className={`rounded-xl border p-4 text-left transition ${
                    activeStep === index ? "border-green-300 bg-green-400/15" : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                  key={item.title}
                  onClick={() => onSelectStep(index)}
                  type="button"
                >
                  <span className="text-xs font-black uppercase tracking-wide text-green-300">{item.label}</span>
                  <p className="mt-2 text-sm font-black">{item.title}</p>
                </button>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur">
              <p className="text-sm leading-6 text-slate-200">{step.description}</p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-sportGreen transition-all duration-700" style={{ width: `${((activeStep + 1) / journeySteps.length) * 100}%` }} />
              </div>
            </div>

            <div className="mt-8 grid gap-3 text-sm font-semibold text-slate-200">
              <div className="flex items-center justify-between rounded-xl bg-white/10 p-4">
                <span>Verified venue</span>
                <span className="text-green-300">Ready</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/10 p-4">
                <span>Court and slot</span>
                <span className="text-green-300">Selected by player</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/10 p-4">
                <span>Booking pass</span>
                <span className="text-green-300">After payment</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VenueCard({ venue }: { venue: PublicVenue }) {
  const cover = getVenueCover(venue);

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
      <div className="relative h-52 bg-slate-200">
        {cover ? (
          <img alt={venue.name} className="h-full w-full object-cover" src={cover} />
        ) : (
          <div className="grid h-full place-items-center bg-sportNavy text-4xl font-black text-white">
            {getInitials(venue.name)}
          </div>
        )}
        <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-black text-sportGreen">Verified</span>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-sportNavy">{venue.name}</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">{venue.area}, {venue.city}</p>
          </div>
          <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-sportGreen">
            {venue.court_count} court{venue.court_count === 1 ? "" : "s"}
          </span>
        </div>

        {venue.facilities?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {venue.facilities.slice(0, 4).map((facility) => (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600" key={facility}>{facility}</span>
            ))}
            {venue.facilities.length > 4 ? <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-sportGreen">+{venue.facilities.length - 4}</span> : null}
          </div>
        ) : (
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-500">Facilities will be shown when available.</p>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">Starting from</p>
            <p className="font-black text-sportNavy">{formatPrice(venue.minimum_price)}</p>
          </div>
          <Link className="rounded-md bg-sportGreen px-4 py-2 text-sm font-black text-white hover:bg-green-700" href={`/courts/${venue.id}`}>View Venue</Link>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ actionHref, actionLabel, description, title }: { actionHref: string; actionLabel: string; description: string; title: string }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-50 text-sm font-black text-sportGreen">SS</div>
      <h3 className="mt-5 text-2xl font-black text-sportNavy">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
      <Link className="mt-6 inline-flex rounded-md border border-green-200 px-5 py-3 text-sm font-black text-sportGreen hover:bg-green-50" href={actionHref}>
        {actionLabel}
      </Link>
    </div>
  );
}

function SectionHeader({ align = "center", description, eyebrow, title }: { align?: "center" | "left"; description: string; eyebrow: string; title: string }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-sportGreen">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-sportNavy sm:text-4xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function getVenueCover(venue: PublicVenue) {
  const image = venue.front_photo || venue.court_area_photo || venue.photos?.[0]?.image || venue.courts?.find((court) => court.court_photo)?.court_photo || "";
  return getMediaUrl(image);
}

function getMediaUrl(path: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${path}`;
}

function formatPrice(value?: string | null) {
  if (!value) return "Not set";
  const amount = Number(value);
  return Number.isFinite(amount) ? `Rs ${amount.toLocaleString()}` : "Not set";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
