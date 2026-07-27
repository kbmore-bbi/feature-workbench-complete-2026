"use client";

import { useEffect } from "react";

import type { TourId } from "../types/tour.types";
import { hasSeenTour } from "./tour-persistence";
import {
  resolveContextualTourIdForPath,
  resolvePrimaryTourIdForPath,
} from "./tour-resolve";

type StartTourOptions = {
  autoLaunch?: boolean;
};

const NAV_AUTO_START_DELAY_MS = 600;
const CONTEXT_AUTO_START_DELAY_MS = 400;
const AUTO_START_RETRY_MS = 300;
const AUTO_START_MAX_ATTEMPTS = 30;

type TourAutoLaunchProps = {
  pathname: string;
  modalTourId: TourId | null;
  isOpen: boolean;
  startTour: (tourId: TourId, options?: StartTourOptions) => void;
  /** Bumps on route change or modal open. */
  navigationLaunchKey?: string | number;
  /** Bumps on row selection, automap, tab change, etc. */
  contextLaunchKey?: string | number;
  autoLaunchEnabled?: boolean;
};

export function TourAutoLaunch({
  pathname,
  modalTourId,
  isOpen,
  startTour,
  navigationLaunchKey = 0,
  contextLaunchKey = 0,
  autoLaunchEnabled = true,
}: TourAutoLaunchProps) {
  /** Primary page tour — first visit per session when navigating to a route. */
  useEffect(() => {
    if (!autoLaunchEnabled) return;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const attempt = () => {
      if (cancelled || isOpen) return;

      const tourId = modalTourId ?? resolvePrimaryTourIdForPath(pathname);
      if (!tourId) {
        attempts += 1;
        if (attempts < AUTO_START_MAX_ATTEMPTS) {
          retryTimer = window.setTimeout(attempt, AUTO_START_RETRY_MS);
        }
        return;
      }

      if (hasSeenTour(tourId)) return;

      startTour(tourId, { autoLaunch: true });
    };

    const startTimer = window.setTimeout(attempt, NAV_AUTO_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [autoLaunchEnabled, isOpen, modalTourId, pathname, navigationLaunchKey, startTour]);

  /** Contextual tour — row selection, automap, tabs (first time per session only). */
  useEffect(() => {
    if (!autoLaunchEnabled) return;
    if (modalTourId) return;

    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const attempt = () => {
      if (cancelled || isOpen) return;

      const tourId = resolveContextualTourIdForPath(pathname);
      if (!tourId) {
        attempts += 1;
        if (attempts < AUTO_START_MAX_ATTEMPTS) {
          retryTimer = window.setTimeout(attempt, AUTO_START_RETRY_MS);
        }
        return;
      }

      if (hasSeenTour(tourId)) return;

      startTour(tourId, { autoLaunch: true });
    };

    const startTimer = window.setTimeout(attempt, CONTEXT_AUTO_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [autoLaunchEnabled, contextLaunchKey, isOpen, modalTourId, pathname, startTour]);

  return null;
}
