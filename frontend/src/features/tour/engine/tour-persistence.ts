import type { TourId } from "../types/tour.types";

/**
 * Per-browser-session tour state (sessionStorage).
 * - First visit to each screen in a session → auto-show tour once.
 * - Navigating away and back in the same session → no repeat.
 * - User closes the browser/tab and returns later → tours auto-show again.
 * Manual "Tour Guide" button always works regardless.
 */
const STORAGE_KEY = "aia-tour-seen";
const AUTO_LAUNCH_STORAGE_PREFIX = "aia-tour-auto-launch";

type SeenTours = Partial<Record<TourId, boolean>>;

/** Authoritative in-memory set — always checked first. */
const seenTourIds = new Set<TourId>();
let hydratedFromStorage = false;

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function persistSeenTours() {
  const storage = getStorage();
  if (!storage) return;
  const payload: SeenTours = {};
  for (const tourId of seenTourIds) {
    payload[tourId] = true;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / privacy mode errors — in-memory set still applies.
  }
}

function hydrateSeenTours() {
  if (hydratedFromStorage || typeof window === "undefined") return;
  hydratedFromStorage = true;
  const storage = getStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as SeenTours;
    if (!parsed || typeof parsed !== "object") return;
    for (const [tourId, seen] of Object.entries(parsed)) {
      if (seen) seenTourIds.add(tourId as TourId);
    }
  } catch {
    // Ignore corrupt storage payloads.
  }
}

export function hasSeenTour(tourId: TourId): boolean {
  hydrateSeenTours();
  return seenTourIds.has(tourId);
}

export function markTourSeen(tourId: TourId) {
  hydrateSeenTours();
  if (seenTourIds.has(tourId)) return;
  seenTourIds.add(tourId);
  persistSeenTours();
}

export function markToursSeen(tourIds: TourId[]) {
  hydrateSeenTours();
  let changed = false;
  for (const tourId of tourIds) {
    if (!seenTourIds.has(tourId)) {
      seenTourIds.add(tourId);
      changed = true;
    }
  }
  if (changed) persistSeenTours();
}

/** Mark only the primary page tour when leaving a route (not contextual tours). */
export function markPrimaryTourSeenForPath(pathname: string) {
  const normalized = pathname.replace(/\/$/, "") || "/";

  if (normalized.startsWith("/sttm/builder/new/mapping")) {
    markTourSeen("sttm-mapping");
    return;
  }

  if (normalized.startsWith("/sttm/builder/new/summary")) {
    markTourSeen("sttm-summary");
    return;
  }

  if (normalized.startsWith("/sttm/builder/new")) {
    markTourSeen("sttm-table-selection");
    return;
  }

  if (normalized === "/dashboard") {
    markTourSeen("dashboard");
    return;
  }

  if (normalized === "/projects") {
    markTourSeen("projects");
    return;
  }

  if (normalized === "/mappings") {
    markTourSeen("mappings");
    return;
  }

  if (normalized === "/landing" || normalized === "/home" || normalized === "/") {
    markTourSeen("landing");
  }
}

export function isTourAutoLaunchEnabled(userId?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(
      `${AUTO_LAUNCH_STORAGE_PREFIX}:${userId || 'anonymous'}`,
    ) !== 'false';
  } catch {
    return true;
  }
}

export function setTourAutoLaunchEnabled(enabled: boolean, userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${AUTO_LAUNCH_STORAGE_PREFIX}:${userId || 'anonymous'}`,
      String(enabled),
    );
  } catch {
    // Preference persistence is best effort in restricted browser modes.
  }
}
