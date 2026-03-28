const FOCUS_USER_STORAGE_KEY = "focusRoom:userId";

function createUserId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `focus-${stamp}-${random}`;
}

export function getFocusUserId() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "focus-anon";
  }

  let userId = window.localStorage.getItem(FOCUS_USER_STORAGE_KEY);
  if (!userId) {
    userId = createUserId();
    window.localStorage.setItem(FOCUS_USER_STORAGE_KEY, userId);
  }

  return userId;
}
