import Link from "next/link";

export default function FindGamePage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Find Game</p>
        <h1 className="mt-2 text-3xl font-black text-sportNavy">Find Cricksal Games</h1>
        <p className="mt-3 text-slate-600">
          Discover open Cricksal game slots and missing player requests. The real find-game flow will be implemented in a later phase.
        </p>
        <Link className="mt-6 inline-flex rounded-md bg-sportGreen px-4 py-3 text-sm font-black text-white hover:bg-green-700" href="/dashboard/player">
          Go to Dashboard
        </Link>
      </section>
    </main>
  );
}
