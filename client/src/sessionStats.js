export const LEAVE_DURING_FOCUS_KEY = "focusRoom:lastLeaveDuringFocusAt";
export const COMPLETED_SESSIONS_KEY = "focusRoom:completedSessions";
export const STREAK_KEY = "focusRoom:streak";
export const LAST_SESSION_KEY = "focusRoom:lastSession";

function hasStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readNumber(key, fallback = 0) {
  if (!hasStorage()) return fallback;
  const raw = Number(window.localStorage.getItem(key));
  return Number.isFinite(raw) ? raw : fallback;
}

function writeNumber(key, value) {
  if (!hasStorage()) return;
  window.localStorage.setItem(key, String(value));
}

function writeLastSession(payload) {
  if (!hasStorage()) return;
  window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(payload));
}

export function getCompletedSessions() {
  return Math.max(0, Math.floor(readNumber(COMPLETED_SESSIONS_KEY, 0)));
}

export function getStreak() {
  return Math.max(0, Math.floor(readNumber(STREAK_KEY, 0)));
}

export function getLeaveDuringFocusAt() {
  const ts = readNumber(LEAVE_DURING_FOCUS_KEY, 0);
  return ts > 0 ? ts : null;
}

export function clearLeaveDuringFocus() {
  if (!hasStorage()) return;
  window.localStorage.removeItem(LEAVE_DURING_FOCUS_KEY);
}

export function getLastSession() {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.status !== "completed" && parsed.status !== "broken") return null;
    return {
      status: parsed.status,
      at: Number(parsed.at) || Date.now(),
      roomId: String(parsed.roomId || ""),
      streakAfter: Math.max(0, Math.floor(Number(parsed.streakAfter) || 0)),
    };
  } catch {
    return null;
  }
}

export function recordCompletedSession(roomId) {
  const completed = getCompletedSessions() + 1;
  const streak = getStreak() + 1;
  writeNumber(COMPLETED_SESSIONS_KEY, completed);
  writeNumber(STREAK_KEY, streak);
  clearLeaveDuringFocus();
  writeLastSession({
    status: "completed",
    at: Date.now(),
    roomId: String(roomId || "").toUpperCase(),
    streakAfter: streak,
  });
  return { completed, streak };
}

export function recordBrokenSession(roomId) {
  const previousStreak = getStreak();
  writeNumber(STREAK_KEY, 0);
  writeNumber(LEAVE_DURING_FOCUS_KEY, Date.now());
  writeLastSession({
    status: "broken",
    at: Date.now(),
    roomId: String(roomId || "").toUpperCase(),
    streakAfter: 0,
    streakBefore: previousStreak,
  });
  return { previousStreak };
}
