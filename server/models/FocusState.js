const { toDateKey } = require("./FocusSession");

const states = new Map();

function cloneState(state) {
  return {
    userId: state.userId,
    todayKey: state.todayKey,
    todayCompleted: state.todayCompleted,
    lastSession: {
      status: state.lastSession.status,
      at: state.lastSession.at,
      progressSec: state.lastSession.progressSec,
    },
    streakDays: state.streakDays,
    sessionPoints: state.sessionPoints,
    unlocks: {
      notes: state.unlocks.notes,
      whitelist: state.unlocks.whitelist,
      audio: state.unlocks.audio,
    },
    lastStreakDate: state.lastStreakDate,
    lastStreakUpdate: state.lastStreakUpdate,
  };
}

function createDefaultState(userId) {
  const now = Date.now();
  return {
    userId: String(userId).trim(),
    todayKey: toDateKey(now),
    todayCompleted: 0,
    lastSession: {
      status: null,
      at: null,
      progressSec: 0,
    },
    streakDays: 0,
    sessionPoints: 0,
    unlocks: {
      notes: false,
      whitelist: false,
      audio: false,
    },
    lastStreakDate: null,
    lastStreakUpdate: now,
  };
}

function getOrCreateInternalState(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  if (!states.has(normalizedUserId)) {
    states.set(normalizedUserId, createDefaultState(normalizedUserId));
  }
  return states.get(normalizedUserId);
}

function initializeFocusState(userId) {
  return cloneState(getOrCreateInternalState(userId));
}

function readFocusState(userId) {
  return cloneState(getOrCreateInternalState(userId));
}

function mutateFocusState(userId, mutator) {
  const state = getOrCreateInternalState(userId);
  mutator(state);
  states.set(state.userId, state);
  return cloneState(state);
}

module.exports = {
  initializeFocusState,
  readFocusState,
  mutateFocusState,
};
