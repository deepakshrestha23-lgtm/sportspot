import Link from "next/link";

export default function CourtsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-wide text-sportGreen">Courts</p>
        <h1 className="mt-2 text-3xl font-black text-sportNavy">Cricksal Courts</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Browse available Cricksal courts near you. Court booking and live slot availability will be implemented in a later phase.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {["NCS Indoor Cricksal", "Baneshwor Cricksal Arena", "Kathmandu Sports Court"].map((court) => (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={court}>
              <h2 className="font-black text-sportNavy">{court}</h2>
              <p className="mt-2 text-sm text-slate-600">Cricksal court placeholder</p>
            </div>
          ))}
        </div>
        <Link className="mt-6 inline-flex rounded-md bg-sportGreen px-4 py-3 text-sm font-black text-white hover:bg-green-700" href="/register">
          Join SportSpot
        </Link>
      </section>
    </main>
  );
}
