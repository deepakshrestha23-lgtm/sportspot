import Link from "next/link";

const actions = ["Book a Court", "Find a Game", "Challenge a Team"];

export default function Home() {
  return (
    <main className="bg-slate-50">
      <section className="mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <div>
          <p className="mb-4 inline-flex rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800">
            Built for Nepal's Cricksal community
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-sportNavy sm:text-5xl lg:text-6xl">
            Find Courts. Join Games. Challenge Teams.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            SportSpot helps players and teams in Nepal discover courts, find missing players, challenge opponents, and manage confirmed matches through one smart sports platform.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {actions.map((action, index) => (
              <Link
                className={`rounded-md px-5 py-3 text-center text-sm font-semibold shadow-sm ${
                  index === 0
                    ? "bg-sportGreen text-white hover:bg-green-700"
                    : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                }`}
                href="#"
                key={action}
              >
                {action}
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4">
            <div className="rounded-md bg-sportNavy p-5 text-white">
              <p className="text-sm text-slate-300">Upcoming Game Room</p>
              <h2 className="mt-2 text-2xl font-bold">Kathmandu Warriors vs ABC Strikers</h2>
              <p className="mt-3 text-sm text-slate-300">NCS Indoor Cricksal · Saturday · 6:00 PM</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-500">Open Slots</p>
                <p className="mt-2 text-3xl font-bold text-sportGreen">8</p>
              </div>
              <div className="rounded-md border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-500">Teams Looking</p>
                <p className="mt-2 text-3xl font-bold text-sportOrange">5</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
