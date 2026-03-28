import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "./config";
import { getFocusState } from "./focusApi";
import {
  clearLeaveDuringFocus,
  getCompletedSessions,
  getLastSession,
  getLeaveDuringFocusAt,
  getStreak,
} from "./sessionStats";

function fmtLocalTime(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function readSnapshot() {
  return {
    completedSessions: getCompletedSessions(),
    streak: getStreak(),
    lastSession: getLastSession(),
    leftDuringFocusAt: getLeaveDuringFocusAt(),
  };
}

export default function Home() {
  const navigate = useNavigate();
  const [joinId, setJoinId] = useState("");
  const [focus, setFocus] = useState(25);
  const [brk, setBrk] = useState(5);
  const [err, setErr] = useState("");
  const [snapshot, setSnapshot] = useState(readSnapshot);
  const [focusSummary, setFocusSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getFocusState()
      .then((state) => {
        if (!cancelled) setFocusSummary(state);
      })
      .catch(() => {
        // Keep local snapshot UI if focus API is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const returnHookMessage = useMemo(() => {
    if (!snapshot.lastSession) return "No previous committed session yet.";
    if (snapshot.lastSession.status === "completed") {
      return `Last session completed at ${fmtLocalTime(snapshot.lastSession.at)}.`;
    }
    return `Last session was broken at ${fmtLocalTime(snapshot.lastSession.at)}.`;
  }, [snapshot.lastSession]);

  const focusTodayCompleted = focusSummary?.todayCompleted ?? 0;
  const focusStreak = focusSummary?.streakDays ?? snapshot.streak;
  const focusPoints = focusSummary?.sessionPoints ?? 0;
  const unlockedNotes = Boolean(focusSummary?.unlocks?.notes);
  const unlockedWhitelist = Boolean(focusSummary?.unlocks?.whitelist);
  const unlockedAudio = Boolean(focusSummary?.unlocks?.audio);

  async function createRoom() {
    try {
      const res = await fetch(`${API_URL}/room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focusDuration: focus * 60,
          breakDuration: brk * 60,
        }),
      });
      const { roomId } = await res.json();
      navigate(`/room/${roomId}`);
    } catch {
      setErr("Cannot reach server. Is it running on port 4000?");
    }
  }

  async function joinRoom() {
    const id = joinId.trim().toUpperCase();
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/room/${id}`);
      if (!res.ok) {
        setErr("Room not found.");
        return;
      }
      navigate(`/room/${id}`);
    } catch {
      setErr("Cannot reach server. Is it running on port 4000?");
    }
  }

  function dismissLeaveWarning() {
    clearLeaveDuringFocus();
    setSnapshot(readSnapshot());
  }

  return (
    <div className="home">
      <div className="home-brand">
        <h1>Focus Room</h1>
        <p className="tagline">FOCUS. WORK. REST. REPEAT.</p>
      </div>

      <p className="sub">Join a room &middot; Lock in &middot; Stay focused together.</p>

      <div className="return-hook">
        <p>{returnHookMessage}</p>
        <div className="return-stats">
          <span>Streak {focusStreak}</span>
          <span>Today {focusTodayCompleted}</span>
          <span>Completed {snapshot.completedSessions}</span>
          <span>Points {focusPoints}</span>
        </div>
        <div className="unlock-strip">
          <span className={`unlock-pill ${unlockedNotes ? "on" : ""}`}>Notes</span>
          <span className={`unlock-pill ${unlockedWhitelist ? "on" : ""}`}>Whitelist</span>
          <span className={`unlock-pill ${unlockedAudio ? "on" : ""}`}>Audio</span>
        </div>
      </div>

      {snapshot.leftDuringFocusAt && (
        <div className="nudge-card">
          <p>You left during focus at {fmtLocalTime(snapshot.leftDuringFocusAt)}. Rejoin and finish this block.</p>
          <button className="nudge-dismiss" onClick={dismissLeaveWarning}>
            Acknowledge
          </button>
        </div>
      )}

      <div className="card">
        <h2>Create Room</h2>
        <div className="row">
          <label>
            Focus{" "}
            <input
              type="number"
              value={focus}
              min={1}
              max={90}
              onChange={(e) => setFocus(Number(e.target.value))}
            />{" "}
            min
          </label>
          <label>
            Break{" "}
            <input
              type="number"
              value={brk}
              min={1}
              max={30}
              onChange={(e) => setBrk(Number(e.target.value))}
            />{" "}
            min
          </label>
        </div>
        <button onClick={createRoom}>Create Room</button>
      </div>

      <div className="card">
        <h2>Join Room</h2>
        <input
          placeholder="Enter Room ID"
          value={joinId}
          onChange={(e) => {
            setJoinId(e.target.value);
            setErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
        />
        {err && <p className="err">{err}</p>}
        <button onClick={joinRoom}>Join Room</button>
      </div>
    </div>
  );
}
