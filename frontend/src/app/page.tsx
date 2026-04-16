import { ApiStatusCard } from "../components/api-status";
import LandingPage from '../features/LandingPage';

export default function Home() {
  return (
    <LandingPage />
  )
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 sm:px-10">
      <section className="grid gap-8 rounded-[2rem] border border-white/60 bg-[var(--panel)] p-8 shadow-[0_24px_80px_rgba(17,24,39,0.12)] backdrop-blur sm:p-12">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--accent)]">
            BBI Workbench
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
            AI Migration Workbench for secure Snowflake delivery
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            This shell app is wired for local development, containerized
            previews, and Snowpark Container Services deployment through a
            single public gateway.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[1.75rem] bg-slate-950 p-6 text-slate-100 shadow-xl">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-amber-300">
              Delivery Path
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm font-medium text-slate-300">
              <FlowPill label="CodeCommit" />
              <FlowPill label="CodePipeline" />
              <FlowPill label="CodeBuild" />
              <FlowPill label="ECR" />
              <FlowPill label="Snowflake Registry" />
              <FlowPill label="SPCS" />
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200 bg-white/60 p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              Runtime status
            </p>
            <div className="mt-4">
              <ApiStatusCard />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function FlowPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/6 px-4 py-2">
      {label}
    </span>
  );
}
