import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import socket from "./socket";
import TimerRing from "./TimerRing";
import { playBreakStart, playFocusStart } from "./sounds";
import { getCompletedSessions, recordBrokenSession, recordCompletedSession } from "./sessionStats";
import { breakFocusSession, completeFocusSession, initFocusState } from "./focusApi";

const DEFAULT_FOCUS_SECONDS = 25 * 60;
const DEFAULT_BREAK_SECONDS = 5 * 60;

function fmtFromMs(remainingMs) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function getPhaseAt(nowMs, cycleStartTime, focusDuration, breakDuration) {
  const focusMs = focusDuration * 1000;
  const breakMs = breakDuration * 1000;
  const cycleLengthMs = focusMs + breakMs;

  const elapsedMs = Math.max(0, nowMs - cycleStartTime);
  const cycleIndex = Math.floor(elapsedMs / cycleLengthMs);
  const timeInCycleMs = elapsedMs % cycleLengthMs;

  if (timeInCycleMs < focusMs) {
    return {
      mode: "focus",
      remainingMs: focusMs - timeInCycleMs,
      totalMs: focusMs,
      cycleIndex,
    };
  }

  return {
    mode: "break",
    remainingMs: cycleLengthMs - timeInCycleMs,
    totalMs: breakMs,
    cycleIndex,
  };
}

function toParticipants(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      id: String(item?.id || ""),
      name: String(item?.name || "Mate"),
      initials: String(item?.initials || "M").slice(0, 2).toUpperCase(),
      status: item?.status === "idle" ? "idle" : "active",
    }))
    .filter((item) => item.id);
}

function buildFallbackParticipants(userCount) {
  const total = Math.max(0, Math.min(8, Math.floor(userCount)));
  return Array.from({ length: total }, (_, index) => ({
    id: `fallback-${index}`,
    name: `Mate ${index + 1}`,
    initials: String(index + 1),
    status: "active",
  }));
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSyncPayload(payload, fallbackMeta) {
  const fallbackFocus = fallbackMeta?.focusDuration ?? DEFAULT_FOCUS_SECONDS;
  const fallbackBreak = fallbackMeta?.breakDuration ?? DEFAULT_BREAK_SECONDS;

  const focusDuration = Math.max(60, Math.floor(toFiniteNumber(payload?.focusDuration) ?? fallbackFocus));
  const breakDuration = Math.max(60, Math.floor(toFiniteNumber(payload?.breakDuration) ?? fallbackBreak));
  const serverTime = toFiniteNumber(payload?.serverTime) ?? Date.now();

  let cycleStartTime = toFiniteNumber(payload?.cycleStartTime);

  if (!Number.isFinite(cycleStartTime)) {
    const mode = payload?.mode === "break" ? "break" : "focus";
    const remainingRaw = toFiniteNumber(payload?.remaining);
    if (!Number.isFinite(remainingRaw)) return null;

    const expected = mode === "focus" ? focusDuration : breakDuration;
    const remaining = Math.max(0, Math.min(expected, Math.floor(remainingRaw)));
    const elapsedInCycleSeconds =
      mode === "focus" ? focusDuration - remaining : focusDuration + (breakDuration - remaining);
    cycleStartTime = serverTime - elapsedInCycleSeconds * 1000;
  }

  return {
    cycleStartTime,
    focusDuration,
    breakDuration,
    serverTime,
    userCount: toFiniteNumber(payload?.userCount),
    participants: toParticipants(payload?.participants),
  };
}

export default function Room({ soundOn }) {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [timer, setTimer] = useState(null);
  const [roomMeta, setRoomMeta] = useState(null);
  const [users, setUsers] = useState(1);
  const [participants, setParticipants] = useState([]);
  const [copied, setCopied] = useState(false);
  const [connectionState, setConnectionState] = useState("connected");
  const [showResyncedCue, setShowResyncedCue] = useState(false);
  const [showSessionReturn, setShowSessionReturn] = useState(false);
  const [showCompletionMoment, setShowCompletionMoment] = useState(false);
  const [commitTargetFocusIndex, setCommitTargetFocusIndex] = useState(null);
  const [dismissedFocusIndex, setDismissedFocusIndex] = useState(null);
  const [leaveGuardOpen, setLeaveGuardOpen] = useState(false);
  const [leaveConfirmEnabled, setLeaveConfirmEnabled] = useState(false);
  const [leaveCountdownMs, setLeaveCountdownMs] = useState(1500);
  const [joinError, setJoinError] = useState("");
  const [completedCount, setCompletedCount] = useState(() => getCompletedSessions());
  const [focusState, setFocusState] = useState(null);
  const [activeFocusers, setActiveFocusers] = useState(0);

  const timerRef = useRef(timer);
  const roomMetaRef = useRef(roomMeta);
  const roomIdRef = useRef(roomId);
  const soundOnRef = useRef(soundOn);
  const navigateRef = useRef(navigate);
  const previousPhaseRef = useRef(null);
  const commitTargetRef = useRef(null);
  const expectingResyncRef = useRef(false);
  const clockOffsetRef = useRef(0);
  const resyncTimeoutRef = useRef(null);
  const sessionReturnTimeoutRef = useRef(null);
  const completionTimeoutRef = useRef(null);

  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  useEffect(() => {
    roomMetaRef.current = roomMeta;
  }, [roomMeta]);

  useEffect(() => {
    commitTargetRef.current = commitTargetFocusIndex;
  }, [commitTargetFocusIndex]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    initFocusState()
      .then((state) => {
        if (!cancelled) setFocusState(state);
      })
      .catch(() => {
        // Keep local-only stats if focus API is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearTransientTimers = useCallback(() => {
    if (resyncTimeoutRef.current) window.clearTimeout(resyncTimeoutRef.current);
    if (sessionReturnTimeoutRef.current) window.clearTimeout(sessionReturnTimeoutRef.current);
    if (completionTimeoutRef.current) window.clearTimeout(completionTimeoutRef.current);
    resyncTimeoutRef.current = null;
    sessionReturnTimeoutRef.current = null;
    completionTimeoutRef.current = null;
  }, []);

  const handlePhaseTransition = useCallback((previousPhase, nextPhase) => {
    if (soundOnRef.current) {
      if (nextPhase.mode === "focus") playFocusStart();
      if (nextPhase.mode === "break") playBreakStart();
    }

    if (previousPhase.mode === "focus" && nextPhase.mode === "break") {
      const committedCycle = commitTargetRef.current;
      const completedCommittedSession = committedCycle === previousPhase.cycleIndex;

      if (completedCommittedSession) {
        const result = recordCompletedSession(roomIdRef.current);
        setCompletedCount(result.completed);
        const durationSeconds = Math.max(
          60,
          Math.floor(roomMetaRef.current?.focusDuration ?? DEFAULT_FOCUS_SECONDS)
        );
        void completeFocusSession(durationSeconds)
          .then((payload) => {
            if (payload?.state) setFocusState(payload.state);
          })
          .catch(() => {
            // Keep local stats if backend focus state cannot be updated.
          });
        socket.emit("focus_end");
        setShowCompletionMoment(true);
        if (completionTimeoutRef.current) window.clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = window.setTimeout(() => {
          setShowCompletionMoment(false);
        }, 1700);
      }

      if (completedCommittedSession) {
        commitTargetRef.current = null;
        setCommitTargetFocusIndex(null);
      }
    }

    if (previousPhase.mode === "break" && nextPhase.mode === "focus") {
      setDismissedFocusIndex(null);
    }
  }, []);

  const applySync = useCallback((payload) => {
    const normalized = normalizeSyncPayload(payload, roomMetaRef.current);
    if (!normalized) return;

    clockOffsetRef.current = normalized.serverTime - Date.now();

    const nextRoomMeta = {
      cycleStartTime: normalized.cycleStartTime,
      focusDuration: normalized.focusDuration,
      breakDuration: normalized.breakDuration,
    };
    setRoomMeta(nextRoomMeta);

    const now = Date.now() + clockOffsetRef.current;
    const nextPhase = getPhaseAt(
      now,
      normalized.cycleStartTime,
      normalized.focusDuration,
      normalized.breakDuration
    );
    const previousPhase = previousPhaseRef.current;
    if (previousPhase && (previousPhase.mode !== nextPhase.mode || previousPhase.cycleIndex !== nextPhase.cycleIndex)) {
      handlePhaseTransition(previousPhase, nextPhase);
    }
    previousPhaseRef.current = nextPhase;
    setTimer(nextPhase);

    if (Number.isFinite(normalized.userCount)) {
      setUsers(normalized.userCount);
    }
    if (normalized.participants.length > 0) {
      setParticipants(normalized.participants);
    } else if (Number.isFinite(normalized.userCount)) {
      setParticipants(buildFallbackParticipants(normalized.userCount));
    }

    if (joinError) setJoinError("");

    if (expectingResyncRef.current) {
      expectingResyncRef.current = false;
      setConnectionState("connected");
      setShowResyncedCue(true);
      setShowSessionReturn(true);

      if (resyncTimeoutRef.current) window.clearTimeout(resyncTimeoutRef.current);
      if (sessionReturnTimeoutRef.current) window.clearTimeout(sessionReturnTimeoutRef.current);

      resyncTimeoutRef.current = window.setTimeout(() => setShowResyncedCue(false), 1400);
      sessionReturnTimeoutRef.current = window.setTimeout(() => setShowSessionReturn(false), 700);
    }
  }, [handlePhaseTransition, joinError]);

  useEffect(() => {
    const normalizedRoomId = String(roomId || "").trim().toUpperCase();
    let disposed = false;
    let joinTimeoutId = null;

    const clearJoinTimeout = () => {
      if (joinTimeoutId) {
        window.clearTimeout(joinTimeoutId);
        joinTimeoutId = null;
      }
    };

    const armJoinTimeout = () => {
      clearJoinTimeout();
      joinTimeoutId = window.setTimeout(() => {
        if (disposed || timerRef.current) return;
        setJoinError("Unable to sync room. Retry or restart backend.");
      }, 8000);
    };

    const joinCurrentRoom = () => {
      armJoinTimeout();
      socket.emit("room:join", normalizedRoomId, (response) => {
        clearJoinTimeout();
        if (disposed) return;

        if (response?.error) {
          setJoinError("Room not found.");
          navigateRef.current("/");
          return;
        }

        applySync(response);
      });
    };

    const onConnect = () => {
      setConnectionState(expectingResyncRef.current ? "syncing" : "connected");
      joinCurrentRoom();
    };

    const onDisconnect = () => {
      expectingResyncRef.current = true;
      setConnectionState("reconnecting");
    };

    const onConnectError = () => {
      setJoinError("Realtime connection failed. Check server on port 4000.");
    };

    const onPresenceUpdate = (payload = {}) => {
      const count = toFiniteNumber(payload.userCount);
      if (Number.isFinite(count)) {
        setUsers(count);
      }
      const peers = toParticipants(payload.participants);
      if (peers.length > 0) {
        setParticipants(peers);
      } else if (Number.isFinite(count)) {
        setParticipants(buildFallbackParticipants(count));
      }
    };

    const onFocusCountUpdate = (count) => {
      const numeric = toFiniteNumber(count);
      setActiveFocusers(Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("timer:sync", applySync);
    socket.on("presence:update", onPresenceUpdate);
    socket.on("focus_count_update", onFocusCountUpdate);

    socket.connect();
    if (socket.connected) onConnect();

    return () => {
      disposed = true;
      clearJoinTimeout();

      const currentTimer = timerRef.current;
      const committedCurrentFocus =
        currentTimer?.mode === "focus" && commitTargetRef.current === currentTimer.cycleIndex;

      if (committedCurrentFocus) {
        const progressSec = Math.max(
          0,
          Math.floor((currentTimer.totalMs - currentTimer.remainingMs) / 1000)
        );
        recordBrokenSession(roomIdRef.current);
        void breakFocusSession(progressSec).catch(() => {
          // Keep local stats if backend focus state cannot be updated.
        });
        socket.emit("focus_end");
      }

      socket.emit("room:leave", normalizedRoomId);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("timer:sync", applySync);
      socket.off("presence:update", onPresenceUpdate);
      socket.off("focus_count_update", onFocusCountUpdate);
      socket.disconnect();

      clearTransientTimers();
      expectingResyncRef.current = false;
    };
  }, [roomId, applySync, clearTransientTimers]);

  useEffect(() => {
    if (!roomMeta) return undefined;

    let rafId = null;
    const tick = () => {
      const now = Date.now() + clockOffsetRef.current;
      const nextPhase = getPhaseAt(now, roomMeta.cycleStartTime, roomMeta.focusDuration, roomMeta.breakDuration);
      const previousPhase = previousPhaseRef.current;

      if (previousPhase && (previousPhase.mode !== nextPhase.mode || previousPhase.cycleIndex !== nextPhase.cycleIndex)) {
        handlePhaseTransition(previousPhase, nextPhase);
      }

      previousPhaseRef.current = nextPhase;
      setTimer(nextPhase);
      rafId = window.requestAnimationFrame(tick);
    };

    tick();
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [roomMeta, handlePhaseTransition]);

  useEffect(() => {
    if (!leaveGuardOpen) return undefined;

    const unlockAt = Date.now() + 1500;
    const id = window.setInterval(() => {
      const remain = Math.max(0, unlockAt - Date.now());
      setLeaveCountdownMs(remain);
      if (remain === 0) {
        setLeaveConfirmEnabled(true);
        window.clearInterval(id);
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [leaveGuardOpen]);

  useEffect(() => {
    const emitActivity = (() => {
      let lastActivePingAt = 0;
      return (state = "active") => {
        if (!socket.connected) return;
        if (state === "active") {
          const now = Date.now();
          if (now - lastActivePingAt < 10_000) return;
          lastActivePingAt = now;
        }
        socket.emit("client:activity", { state });
      };
    })();

    const onUserActivity = () => emitActivity("active");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        socket.emit("client:activity", { state: "idle" });
      } else {
        emitActivity("active");
      }
    };

    window.addEventListener("mousemove", onUserActivity, { passive: true });
    window.addEventListener("keydown", onUserActivity);
    window.addEventListener("pointerdown", onUserActivity, { passive: true });
    window.addEventListener("touchstart", onUserActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    const heartbeatId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        emitActivity("active");
      }
    }, 15_000);

    return () => {
      window.removeEventListener("mousemove", onUserActivity);
      window.removeEventListener("keydown", onUserActivity);
      window.removeEventListener("pointerdown", onUserActivity);
      window.removeEventListener("touchstart", onUserActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeatId);
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      const currentTimer = timerRef.current;
      const committedCurrentFocus =
        currentTimer?.mode === "focus" && commitTargetRef.current === currentTimer.cycleIndex;
      if (!committedCurrentFocus) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const visibleParticipants = useMemo(() => participants.slice(0, 8), [participants]);

  function commitToSession() {
    if (!timer) return;
    const target = timer.mode === "focus" ? timer.cycleIndex : timer.cycleIndex + 1;
    commitTargetRef.current = target;
    setCommitTargetFocusIndex(target);
    setDismissedFocusIndex(null);
    socket.emit("focus_start");
  }

  function skipCommit() {
    if (!timer) return;
    if (timer.mode === "focus") {
      setDismissedFocusIndex(timer.cycleIndex);
    }
  }

  function requestLeaveRoom() {
    if (!timer) return;
    if (timer.mode === "focus") {
      setLeaveConfirmEnabled(false);
      setLeaveCountdownMs(1500);
      setLeaveGuardOpen(true);
      return;
    }
    navigate("/");
  }

  async function confirmLeaveRoom() {
    const currentTimer = timerRef.current;
    const committedCurrentFocus =
      currentTimer?.mode === "focus" && commitTargetRef.current === currentTimer.cycleIndex;

    if (committedCurrentFocus) {
      const progressSec = Math.max(
        0,
        Math.floor((currentTimer.totalMs - currentTimer.remainingMs) / 1000)
      );
      recordBrokenSession(roomIdRef.current);
      try {
        const payload = await breakFocusSession(progressSec);
        if (payload?.state) setFocusState(payload.state);
      } catch {
        // Keep local stats if backend focus state cannot be updated.
      }
      socket.emit("focus_end");
      commitTargetRef.current = null;
      setCommitTargetFocusIndex(null);
    }

    setLeaveGuardOpen(false);
    navigate("/");
  }

  function cancelLeaveRoom() {
    setLeaveGuardOpen(false);
  }

  async function copyLink() {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!timer) {
    return (
      <div className="loading">
        <div className="loading-box">
          <p>{joinError || "Joining room..."}</p>
          {joinError && (
            <div className="loading-actions">
              <button onClick={() => window.location.reload()}>Retry</button>
              <button className="loading-back" onClick={() => navigate("/")}>
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isFocus = timer.mode === "focus";
  const displayRoomId = String(roomId || "").trim().toUpperCase();
  const progress = timer.totalMs > 0 ? timer.remainingMs / timer.totalMs : 0;
  const focusUrgency = isFocus ? Math.max(0, Math.min(1, 1 - progress)) : 0;
  const totalParticipants = Math.max(users, visibleParticipants.length);
  const liveFocusers = Math.max(activeFocusers, totalParticipants);
  const todayCompleted = focusState?.todayCompleted ?? 0;
  const streakDays = focusState?.streakDays ?? 0;
  const sessionPoints = focusState?.sessionPoints ?? 0;
  const unlockedNotes = Boolean(focusState?.unlocks?.notes);
  const unlockedWhitelist = Boolean(focusState?.unlocks?.whitelist);
  const unlockedAudio = Boolean(focusState?.unlocks?.audio);
  const stageNote = isFocus
    ? "Deep work window. Stay with the room."
    : "Recover briefly. Next focus begins automatically.";
  const roomClasses = `room ${isFocus ? "focus" : "brk"} ${showSessionReturn ? "session-returning" : ""}`;
  const wrapClasses = `timer-wrap ${isFocus ? "focus-pulse" : ""} ${showSessionReturn ? "session-return" : ""}`;
  const roomStyle = { "--urgency": `${focusUrgency.toFixed(3)}` };

  const focusMin = roomMeta ? Math.round(roomMeta.focusDuration / 60) : 25;
  const breakMin = roomMeta ? Math.round(roomMeta.breakDuration / 60) : 5;

  const committedForCurrentFocus = isFocus && commitTargetFocusIndex === timer.cycleIndex;
  const committedForNextFocus = timer.mode === "break" && commitTargetFocusIndex === timer.cycleIndex + 1;
  const showCommitPrompt =
    timer.mode === "focus" &&
    !committedForCurrentFocus &&
    dismissedFocusIndex !== timer.cycleIndex;

  return (
    <div className={roomClasses} style={roomStyle}>
      {connectionState !== "connected" && (
        <div className="reconnect-banner">
          {connectionState === "reconnecting"
            ? "Connection lost. Reconnecting..."
            : "Connected. Syncing timer..."}
        </div>
      )}
      {showResyncedCue && <div className="resynced-cue">Resynced</div>}
      {showCompletionMoment && <div className="completion-cue">Focus block complete ✓</div>}

      <div className="room-top">
        <div className="room-headline">
          <div className="mode-badge">{isFocus ? "FOCUS" : "BREAK"}</div>
          <div className="users-chip">{liveFocusers} focusing now</div>
        </div>

        <div className="presence-strip" aria-label="Participants">
          {visibleParticipants.map((participant) => (
            <div
              className={`presence-dot ${participant.status}`}
              key={participant.id}
              title={`${participant.name} (${participant.status})`}
              aria-label={`${participant.name} is ${participant.status}`}
            >
              <span className="presence-avatar">{participant.initials}</span>
              <span className="presence-status-dot" aria-hidden="true" />
            </div>
          ))}
        </div>

        {(committedForCurrentFocus || committedForNextFocus) && (
          <div className="commit-state">
            {committedForCurrentFocus ? "LOCKED session active" : "LOCKED for next focus block"}
          </div>
        )}

        <div className="focus-stats-strip">
          <span className="focus-stat">Today {todayCompleted}</span>
          <span className="focus-stat">Streak {streakDays}</span>
          <span className="focus-stat">Points {sessionPoints}</span>
        </div>

        <div className="unlock-strip">
          <span className={`unlock-pill ${unlockedNotes ? "on" : ""}`}>Notes</span>
          <span className={`unlock-pill ${unlockedWhitelist ? "on" : ""}`}>Whitelist</span>
          <span className={`unlock-pill ${unlockedAudio ? "on" : ""}`}>Audio</span>
        </div>
      </div>

      {showCommitPrompt && (
        <div className="commit-card">
          <p>Commit to this focus session?</p>
          <div className="commit-actions">
            <button className="commit-btn" onClick={commitToSession}>
              Commit
            </button>
            <button className="commit-skip" onClick={skipCommit}>
              Not now
            </button>
          </div>
        </div>
      )}

      <div className="room-center">
        <div className="focus-stage">
          <p className="stage-note">{stageNote}</p>
          <div className={wrapClasses.trim()}>
            <TimerRing progress={progress} urgency={focusUrgency} mode={timer.mode} />
            <div className="timer-text">{fmtFromMs(timer.remainingMs)}</div>
            <div className="timer-subtext">{isFocus ? "Stay locked in" : "Short reset"}</div>
            {showCompletionMoment && <div className="completion-burst" />}
          </div>

          <div className="mode-chips">
            <div className={`mode-chip ${isFocus ? "active-chip" : ""}`}>
              <span className="mode-chip-icon">🎯</span>
              <span className="mode-chip-label">Focus</span>
              <span className="mode-chip-time">{focusMin} min</span>
            </div>
            <div className={`mode-chip ${!isFocus ? "active-chip break-chip" : ""}`}>
              <span className="mode-chip-icon">☕</span>
              <span className="mode-chip-label">Short Break</span>
              <span className="mode-chip-time">{breakMin} min</span>
            </div>
          </div>
        </div>
      </div>

      <div className="room-bottom">
        <div className="meta">
          <div className="session-counter">
            Sessions: <span className="count-value">{completedCount}</span>
          </div>
          <button className="copy-btn" onClick={copyLink}>
            {copied ? "Copied!" : `Room: ${displayRoomId}`}
          </button>
          <button className={`leave-btn ${committedForCurrentFocus ? "critical" : ""}`} onClick={requestLeaveRoom}>
            Leave
          </button>
        </div>
      </div>

      {leaveGuardOpen && (
        <div className="leave-guard-backdrop">
          <div className="leave-guard">
            <h3>Leaving breaks your session</h3>
            <p>You committed to this focus block. Pause before you quit.</p>
            {!leaveConfirmEnabled && (
              <p className="leave-countdown">Hold for {Math.ceil(leaveCountdownMs / 1000)}s...</p>
            )}
            <div className="leave-actions">
              <button className="stay-btn" onClick={cancelLeaveRoom}>
                Stay in room
              </button>
              <button className="leave-confirm-btn" onClick={confirmLeaveRoom} disabled={!leaveConfirmEnabled}>
                Leave anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
