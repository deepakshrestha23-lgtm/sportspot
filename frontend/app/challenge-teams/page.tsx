import Link from "next/link";

export default function ChallengeTeamsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Challenge Teams</p>
        <h1 className="mt-2 text-3xl font-black text-sportNavy">Challenge Cricksal Teams</h1>
        <p className="mt-3 text-slate-600">
          Team challenges will let verified Cricksal teams request matches and manage confirmations. The full challenge flow comes in a later phase.
        </p>
        <Link className="mt-6 inline-flex rounded-md bg-sportGreen px-4 py-3 text-sm font-black text-white hover:bg-green-700" href="/challenge-teams/details">
          View Placeholder Details
        </Link>
      </section>
    </main>
  );
}
