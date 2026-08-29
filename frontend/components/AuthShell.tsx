import type { ReactNode } from "react";

import Logo from "@/components/Logo";

export default function AuthShell({
  children,
  contentClassName = "max-w-[520px]",
  contentPlacement = "center",
  eyebrow,
  hideHeader = false,
  subtitle,
  title,
}: {
  children: ReactNode;
  contentClassName?: string;
  contentPlacement?: "center" | "start";
  eyebrow: string;
  hideHeader?: boolean;
  subtitle: string;
  title: string;
}) {
  const placementClassName = contentPlacement === "start" ? "items-start" : "items-center";

  return (
    <main className="min-h-screen bg-[var(--sport-canvas)] lg:h-screen lg:overflow-hidden">
      <div className="grid min-h-screen lg:h-full lg:min-h-0 lg:grid-cols-[1.04fr_0.96fr]">
        <section className="relative hidden h-full overflow-hidden bg-sportNavy text-white lg:block">
          <img
            alt="Cricksal player in a SportSpot match atmosphere"
            className="absolute inset-0 h-full w-full object-cover"
            src="/images/sportspot-auth-cricksal.png"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,28,24,0.92)_0%,rgba(6,28,24,0.62)_48%,rgba(6,28,24,0.20)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(0deg,rgba(2,19,13,0.94)_0%,transparent_100%)]" />

          <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
            <Logo variant="light" />

            <div className="max-w-xl pb-3">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-green-300">{eyebrow}</p>
              <h1 className="mt-4 text-4xl font-black leading-[1.02] tracking-tight xl:text-5xl">
                The future of Nepali <span className="text-green-300">Cricksal.</span>
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-slate-200">{subtitle}</p>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <AuthFeature label="Find open games" />
                <AuthFeature label="Build teams" />
                <AuthFeature label="Book verified courts" />
                <AuthFeature label="Play with trust" />
              </div>
            </div>
          </div>
        </section>

        <section className={`flex min-h-screen ${placementClassName} justify-center px-4 py-10 sm:px-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:px-12`}>
          <div className={`w-full ${contentClassName}`}>
            <Logo className="mb-8 justify-center lg:hidden" />

            {!hideHeader ? (
              <div className="mb-7">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-sportGreen">{eyebrow}</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-sportNavy">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{subtitle}</p>
              </div>
            ) : null}

            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthFeature({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/10 px-4 py-4 text-sm font-black text-white shadow-sm backdrop-blur">
      <span className="h-2.5 w-2.5 rounded-full bg-green-300 shadow-[0_0_18px_rgba(134,239,172,0.9)]" />
      {label}
    </div>
  );
}
