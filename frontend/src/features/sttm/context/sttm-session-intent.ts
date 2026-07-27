const NEW_DRAFT_INTENT_KEY = "sttm-builder-new-draft-intent-v1";

export function markExplicitNewDraftIntent(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(NEW_DRAFT_INTENT_KEY, String(Date.now()));
}

export function consumeExplicitNewDraftIntent(): boolean {
  if (typeof window === "undefined") return false;
  const requested = window.sessionStorage.getItem(NEW_DRAFT_INTENT_KEY) !== null;
  if (requested) window.sessionStorage.removeItem(NEW_DRAFT_INTENT_KEY);
  return requested;
}
