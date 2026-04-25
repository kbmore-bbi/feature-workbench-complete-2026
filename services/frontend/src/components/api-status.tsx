"use client";

import { useEffect, useState } from "react";

type ApiStatus = {
  name: string;
  environment: string;
  version: string;
  api_base_path: string;
  health_path: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: ApiStatus };

export function ApiStatusCard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/v1/workbench/info", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }

        const payload = (await response.json()) as ApiStatus;
        if (!cancelled) {
          setState({ status: "ready", payload });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Unable to reach backend",
          });
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="text-sm text-slate-600">Connecting to backend...</p>;
  }

  if (state.status === "error") {
    return <p className="text-sm text-rose-700">{state.message}</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <StatusItem label="API service" value={state.payload.name} />
      <StatusItem label="Environment" value={state.payload.environment} />
      <StatusItem label="Version" value={state.payload.version} />
      <StatusItem label="API base path" value={state.payload.api_base_path} />
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

