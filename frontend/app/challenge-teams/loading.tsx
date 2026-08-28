export default function ChallengeTeamsLoading() {
  return (
    <main className="min-h-[calc(100vh-68px)] bg-[var(--sport-canvas)] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        <div className="h-28 rounded-xl bg-white" />
        <div className="h-20 rounded-xl bg-white" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => <div className="h-64 rounded-xl bg-white" key={index} />)}
        </div>
      </div>
    </main>
  );
}
