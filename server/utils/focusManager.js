const { createFocusSession, countFocusSessions, toDateKey } = require("../models/FocusSession");
const { initializeFocusState, mutateFocusState, readFocusState } = require("../models/FocusState");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function clampNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
}

function ensureTodayState(state, timestamp = Date.now()) {
  const key = toDateKey(timestamp);
  if (state.todayKey !== key) {
    state.todayKey = key;
    state.todayCompleted = 0;
  }
}

function updateUnlocks(state) {
  if (state.sessionPoints >= 3) state.unlocks.notes = true;
  if (state.sessionPoints >= 5) state.unlocks.whitelist = true;
  if (state.sessionPoints >= 8) state.unlocks.audio = true;
}

function initialize(userId) {
  return initializeFocusState(userId);
}

function updateStreak(userId) {
  const todayKey = toDateKey();
  const yesterdayKey = toDateKey(Date.now() - ONE_DAY_MS);
  const sessionsToday = countFocusSessions({
    userId,
    status: "completed",
    dateKey: todayKey,
  });

  return mutateFocusState(userId, (state) => {
    ensureTodayState(state);
    if (sessionsToday === 0) {
      state.streakDays = 0;
      state.lastStreakDate = null;
      state.lastStreakUpdate = Date.now();
      return;
    }

    if (state.lastStreakDate === todayKey) {
      state.lastStreakUpdate = Date.now();
      return;
    }

    if (state.lastStreakDate === yesterdayKey) {
      state.streakDays += 1;
    } else {
      state.streakDays = 1;
    }

    state.lastStreakDate = todayKey;
    state.lastStreakUpdate = Date.now();
  });
}

function completeSession(userId, duration) {
  const normalizedDuration = clampNumber(duration, 25 * 60);
  const session = createFocusSession({
    userId,
    duration: normalizedDuration,
    status: "completed",
    progressSec: normalizedDuration,
  });

  mutateFocusState(userId, (state) => {
    ensureTodayState(state);
    state.todayCompleted += 1;
    state.sessionPoints += 1;
    updateUnlocks(state);
    state.lastSession = {
      status: "completed",
      at: Date.now(),
      progressSec: normalizedDuration,
    };
  });

  const state = updateStreak(userId);
  return { session, state };
}

function breakSession(userId, progressSec) {
  const normalizedProgress = clampNumber(progressSec, 0);
  const session = createFocusSession({
    userId,
    duration: 0,
    status: "broken",
    progressSec: normalizedProgress,
  });

  const state = mutateFocusState(userId, (stateInput) => {
    ensureTodayState(stateInput);
    stateInput.sessionPoints = Math.max(0, stateInput.sessionPoints - 1);
    updateUnlocks(stateInput);
    stateInput.lastSession = {
      status: "broken",
      at: Date.now(),
      progressSec: normalizedProgress,
    };
  });

  return { session, state };
}

function getStats(userId) {
  const todayKey = toDateKey();
  const todayCompleted = countFocusSessions({
    userId,
    status: "completed",
    dateKey: todayKey,
  });
  const totalSessions = countFocusSessions({ userId });
  const completionRate = totalSessions > 0 ? Number(((todayCompleted / totalSessions) * 100).toFixed(1)) : 0;
  const state = readFocusState(userId);

  return {
    todayCompleted,
    totalSessions,
    completionRate,
    streakDays: state.streakDays,
    sessionPoints: state.sessionPoints,
    unlocks: state.unlocks,
    lastSession: state.lastSession,
  };
}

module.exports = {
  initializeFocusState: initialize,
  completeSession,
  breakSession,
  updateStreak,
  getStats,
};
