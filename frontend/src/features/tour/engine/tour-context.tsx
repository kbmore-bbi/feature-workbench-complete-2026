"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { authService } from '@/services/authService';

import {
  buildCombinedTourSteps,
  getAllTours,
  getTourById,
} from "../registry";
import type { TourDefinition, TourId, TourStep } from "../types/tour.types";
import { TourAutoLaunch } from "./tour-auto-launch";
import {
  hasSeenTour,
  isTourAutoLaunchEnabled,
  markPrimaryTourSeenForPath,
  markTourSeen,
  setTourAutoLaunchEnabled,
} from "./tour-persistence";
import { resolveTourIdForContext } from "./tour-resolve";

type StartTourOptions = {
  autoLaunch?: boolean;
};

type ActiveTour = {
  id: TourId | "combined";
  label: string;
  steps: TourStep[];
};

type TourContextValue = {
  isOpen: boolean;
  activeTour: ActiveTour | null;
  stepIndex: number;
  currentStep: TourStep | null;
  stepCount: number;
  availableTours: TourDefinition[];
  startTour: (tourId: TourId, options?: StartTourOptions) => void;
  startCombinedTour: (tourIds: TourId[], label: string) => void;
  startTourForPath: (pathname?: string) => boolean;
  /** When a modal is open, its tour takes priority over the page tour. */
  registerModalTour: (tourId: TourId | null) => void;
  /** Re-check and auto-launch when tabs or contextual UI changes on the same route. */
  notifyTourContextChanged: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  close: () => void;
  autoLaunchEnabled: boolean;
  setAutoLaunchEnabled: (enabled: boolean) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

function isSamePath(a: string, b: string) {
  const normalize = (v: string) => (v || "/").replace(/\/$/, "") || "/";
  return normalize(a) === normalize(b);
}

function navigateToStepRoute(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  step: TourStep | null | undefined,
) {
  if (!step?.route) return;
  if (isSamePath(pathname, step.route)) return;
  router.push(step.route);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeTour, setActiveTour] = useState<ActiveTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [modalTourId, setModalTourId] = useState<TourId | null>(null);
  const [navigationLaunchKey, setNavigationLaunchKey] = useState(0);
  const [contextLaunchKey, setContextLaunchKey] = useState(0);
  const pathnameRef = useRef(pathname);
  const [tourUserId, setTourUserId] = useState<string | null>(null);
  const [autoLaunchEnabled, setAutoLaunchEnabledState] = useState(false);
  const [tourPreferenceLoaded, setTourPreferenceLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authService.getSession()
      .then((session) => {
        if (cancelled) return;
        const userId = session?.user_id != null ? String(session.user_id) : null;
        setTourUserId(userId);
        setAutoLaunchEnabledState(isTourAutoLaunchEnabled(userId));
        setTourPreferenceLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAutoLaunchEnabledState(isTourAutoLaunchEnabled(null));
        setTourPreferenceLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const setAutoLaunchEnabled = useCallback((enabled: boolean) => {
    setAutoLaunchEnabledState(enabled);
    setTourAutoLaunchEnabled(enabled, tourUserId);
  }, [tourUserId]);

  const availableTours = useMemo(() => getAllTours(), []);

  const steps = activeTour?.steps ?? [];
  const currentStep = steps[stepIndex] ?? null;
  const stepCount = steps.length;

  const close = useCallback(() => {
    setActiveTour((current) => {
      if (current && current.id !== "combined") {
        markTourSeen(current.id);
      }
      return null;
    });
    setIsOpen(false);
    setStepIndex(0);
  }, []);

  const startTour = useCallback(
    (tourId: TourId, options?: StartTourOptions) => {
      if (options?.autoLaunch && hasSeenTour(tourId)) {
        return;
      }

      const tour = getTourById(tourId);
      setActiveTour({ id: tour.id, label: tour.label, steps: tour.steps });
      setStepIndex(0);
      setIsOpen(true);

      if (options?.autoLaunch) {
        markTourSeen(tourId);
      }

      navigateToStepRoute(router, pathname, tour.steps[0]);
    },
    [pathname, router],
  );

  const startCombinedTour = useCallback(
    (tourIds: TourId[], label: string) => {
      const combinedSteps = buildCombinedTourSteps(tourIds);
      setActiveTour({ id: "combined", label, steps: combinedSteps });
      setStepIndex(0);
      setIsOpen(true);
      navigateToStepRoute(router, pathname, combinedSteps[0]);
    },
    [pathname, router],
  );

  const registerModalTour = useCallback((tourId: TourId | null) => {
    setModalTourId(tourId);
    if (tourId) {
      setActiveTour((current) => {
        if (current && current.id !== "combined") {
          markTourSeen(current.id);
        }
        return null;
      });
      setIsOpen(false);
      setStepIndex(0);
      setNavigationLaunchKey((key) => key + 1);
    }
  }, []);

  const notifyTourContextChanged = useCallback(() => {
    setContextLaunchKey((key) => key + 1);
  }, []);

  const startTourForPath = useCallback(
    (pathOverride?: string) => {
      const effectivePath = pathOverride ?? pathname;
      const tourId = resolveTourIdForContext(effectivePath, modalTourId);
      if (!tourId) return false;
      startTour(tourId);
      return true;
    },
    [modalTourId, pathname, startTour],
  );

  const next = useCallback(() => {
    setStepIndex((prev) => {
      const nextIndex = Math.min(prev + 1, stepCount - 1);
      if (nextIndex !== prev) {
        navigateToStepRoute(router, pathname, steps[nextIndex]);
      }
      return nextIndex;
    });
  }, [pathname, router, stepCount, steps]);

  const back = useCallback(() => {
    setStepIndex((prev) => {
      const prevIndex = Math.max(prev - 1, 0);
      if (prevIndex !== prev) {
        navigateToStepRoute(router, pathname, steps[prevIndex]);
      }
      return prevIndex;
    });
  }, [pathname, router, steps]);

  const skip = useCallback(() => {
    close();
  }, [close]);

  useEffect(() => {
    const previousPath = pathnameRef.current;
    if (previousPath !== pathname) {
      markPrimaryTourSeenForPath(previousPath);
      pathnameRef.current = pathname;
    }

    setActiveTour((current) => {
      if (current && current.id !== "combined") {
        markTourSeen(current.id);
      }
      return null;
    });
    setIsOpen(false);
    setStepIndex(0);
    setNavigationLaunchKey((key) => key + 1);
  }, [pathname]);

  const value = useMemo<TourContextValue>(
    () => ({
      isOpen,
      activeTour,
      stepIndex,
      currentStep,
      stepCount,
      availableTours,
      startTour,
      startCombinedTour,
      startTourForPath,
      registerModalTour,
      notifyTourContextChanged,
      next,
      back,
      skip,
      close,
      autoLaunchEnabled,
      setAutoLaunchEnabled,
    }),
    [
      activeTour,
      availableTours,
      back,
      close,
      autoLaunchEnabled,
      currentStep,
      isOpen,
      next,
      notifyTourContextChanged,
      skip,
      startCombinedTour,
      startTour,
      startTourForPath,
      registerModalTour,
      setAutoLaunchEnabled,
      stepCount,
      stepIndex,
    ],
  );

  return (
    <TourContext value={value}>
      {children}
      <TourAutoLaunch
        pathname={pathname}
        modalTourId={modalTourId}
        isOpen={isOpen}
        startTour={startTour}
        navigationLaunchKey={navigationLaunchKey}
        contextLaunchKey={contextLaunchKey}
        autoLaunchEnabled={tourPreferenceLoaded && autoLaunchEnabled}
      />
    </TourContext>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used within TourProvider");
  }
  return ctx;
}
