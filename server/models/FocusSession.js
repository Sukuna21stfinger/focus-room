const sessions = [];

function clampNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function toDateKey(input = Date.now()) {
  return new Date(input).toISOString().slice(0, 10);
}

function normalizeStatus(status) {
  return status === "completed" ? "completed" : "broken";
}

function createSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createFocusSession({ userId, duration, status, progressSec = 0, createdAt = Date.now() }) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  const timestamp = Number(createdAt) || Date.now();
  const normalizedStatus = normalizeStatus(status);
  const normalizedDuration = clampNumber(duration, 0);
  const normalizedProgress = clampNumber(progressSec, 0);

  const session = {
    id: createSessionId(),
    userId: normalizedUserId,
    duration: normalizedDuration,
    status: normalizedStatus,
    progressSec: normalizedProgress,
    createdAt: timestamp,
    dateKey: toDateKey(timestamp),
  };

  sessions.push(session);
  return { ...session };
}

function countFocusSessions({ userId, status, dateKey } = {}) {
  const normalizedUserId = userId ? String(userId).trim() : "";
  const normalizedStatus = status ? normalizeStatus(status) : "";
  const normalizedDateKey = dateKey ? String(dateKey) : "";

  return sessions.filter((session) => {
    if (normalizedUserId && session.userId !== normalizedUserId) return false;
    if (normalizedStatus && session.status !== normalizedStatus) return false;
    if (normalizedDateKey && session.dateKey !== normalizedDateKey) return false;
    return true;
  }).length;
}

module.exports = {
  createFocusSession,
  countFocusSessions,
  toDateKey,
};
