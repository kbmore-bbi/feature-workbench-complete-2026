"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { openSttmFromBackend } from "@/features/sttm/store/sttm-builder-slice";

export function SavedSttmLoader({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const activeSttmId = useAppSelector((state) => state.sttmBuilder.activeSttmId);
  const status = useAppSelector((state) => state.sttmBuilder.openSttmStatus);
  const error = useAppSelector((state) => state.sttmBuilder.openSttmErrorMessage);
  const sttmId = Array.isArray(params.id) ? params.id[0] : params.id;
  const attemptedId = useRef<string | null>(null);

  useEffect(() => {
    if (
      !sttmId ||
      attemptedId.current === sttmId ||
      (activeSttmId === sttmId && status === "success") ||
      status === "loading"
    ) return;
    attemptedId.current = sttmId;
    void dispatch(openSttmFromBackend({ sttmId }));
  }, [activeSttmId, dispatch, status, sttmId]);

  if (status === "error" && attemptedId.current === sttmId) {
    return (
      <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{error ?? "Unable to load this mapping."}</p>
        <button
          type="button"
          className="mt-3 rounded border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100"
          onClick={() => {
            attemptedId.current = null;
            void dispatch(openSttmFromBackend({ sttmId }));
            attemptedId.current = sttmId;
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!sttmId || status === "loading" || activeSttmId !== sttmId) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading saved mapping…</div>;
  }
  return <>{children}</>;
}
