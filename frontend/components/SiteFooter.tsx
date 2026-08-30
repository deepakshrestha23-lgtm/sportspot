import Link from "next/link";

import Logo from "@/components/Logo";

const playerLinks = [
  { label: "Find courts", href: "/courts" },
  { label: "Find games", href: "/find-game" },
  { label: "Challenge teams", href: "/challenge-teams" },
  { label: "Sign in", href: "/login" },
];

const ownerLinks = [
  { label: "Register a venue", href: "/register" },
  { label: "Owner dashboard", href: "/dashboard/owner" },
  { label: "Manage bookings", href: "/dashboard/owner/bookings" },
  { label: "Get support", href: "/support" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-sportNavy text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_0.8fr_0.8fr] lg:px-8 lg:py-14">
        <div className="max-w-md">
          <Logo href="/" markClassName="h-9" showText textClassName="text-xl" variant="light" />
          <p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">
            Book verified Cricksal courts, find your next game, and keep every team plan in one place.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-400" />
            Built for Cricksal in Nepal
          </div>
        </div>

        <FooterLinkGroup heading="Play on SportSpot" links={playerLinks} />
        <FooterLinkGroup heading="For venue owners" links={ownerLinks} />
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs font-semibold text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© SportSpot. Better games start with a better plan.</p>
          <p>Courts · players · teams · match day</p>
        </div>
      </div>
    </footer>
  );
}

function FooterLinkGroup({ heading, links }: { heading: string; links: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <h2 className="text-xs font-black uppercase tracking-[0.16em] text-green-300">{heading}</h2>
      <nav aria-label={heading} className="mt-4 flex flex-col items-start gap-3">
        {links.map((link) => (
          <Link className="rounded-sm text-sm font-semibold text-slate-300 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-2 focus-visible:ring-offset-sportNavy" href={link.href} key={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
