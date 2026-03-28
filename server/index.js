const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { customAlphabet } = require("nanoid");
const { createPersistenceStore } = require("./persistence");
const { createFocusRouter, defaultResolveUserId } = require("./routes/focus");
const { registerFocusSocketHandler } = require("./socket/focusSocketHandler");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const generateRoomId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

const DEFAULT_FOCUS_DURATION = 25 * 60;
const DEFAULT_BREAK_DURATION = 5 * 60;
const MIN_DURATION_SECONDS = 60;
const MAX_FOCUS_SECONDS = 90 * 60;
const MAX_BREAK_SECONDS = 30 * 60;
const ACTIVE_WINDOW_MS = 45_000;
const SYNC_INTERVAL_MS = 5000;

const PORT = Number(process.env.PORT) || 4000;

let persistenceStore = null;
let syncInterval = null;
let shuttingDown = false;

function resolveFocusUserId(req) {
  return (
    String(req.header("x-focus-user") || "").trim() ||
    String(req.body?.userId || "").trim() ||
    String(req.query?.userId || "").trim() ||
    String(defaultResolveUserId(req) || "").trim()
  );
}

function clampDuration(rawValue, fallback, max) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_DURATION_SECONDS, Math.min(max, Math.floor(parsed)));
}

function toPersistedRoom(room) {
  return {
    id: room.id,
    cycleStartTime: room.cycleStartTime,
    focusDuration: room.focusDuration,
    breakDuration: room.breakDuration,
  };
}

function createParticipant(socketId) {
  const short = socketId.slice(-4).toUpperCase();
  return {
    id: socketId,
    name: `Mate ${short}`,
    initials: short.slice(0, 2),
    lastActiveAt: Date.now(),
  };
}

function buildParticipants(room) {
  const now = Date.now();
  return Array.from(room.users.values())
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((participant) => ({
      id: participant.id,
      name: participant.name,
      initials: participant.initials,
      status: now - participant.lastActiveAt <= ACTIVE_WINDOW_MS ? "active" : "idle",
    }));
}

function emitPresence(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("presence:update", {
    userCount: room.users.size,
    participants: buildParticipants(room),
  });
}

function persistRoom(room) {
  if (!persistenceStore) return;
  persistenceStore.upsertRoom(toPersistedRoom(room)).catch((error) => {
    console.error(`[persistence] Failed to save room ${room.id}:`, error.message);
  });
}

function removePersistedRoom(roomId) {
  if (!persistenceStore) return;
  persistenceStore.deleteRoom(roomId).catch((error) => {
    console.error(`[persistence] Failed to remove room ${roomId}:`, error.message);
  });
}

function putRoom({
  id,
  cycleStartTime,
  focusDuration = DEFAULT_FOCUS_DURATION,
  breakDuration = DEFAULT_BREAK_DURATION,
}) {
  const normalizedId = String(id).trim().toUpperCase();
  if (!normalizedId) return null;

  rooms[normalizedId] = {
    id: normalizedId,
    cycleStartTime: Number(cycleStartTime) || Date.now(),
    focusDuration: clampDuration(focusDuration, DEFAULT_FOCUS_DURATION, MAX_FOCUS_SECONDS),
    breakDuration: clampDuration(breakDuration, DEFAULT_BREAK_DURATION, MAX_BREAK_SECONDS),
    users: new Map(),
  };

  return rooms[normalizedId];
}

function createRoom(focusDuration = DEFAULT_FOCUS_DURATION, breakDuration = DEFAULT_BREAK_DURATION) {
  let id = generateRoomId();
  while (rooms[id]) {
    id = generateRoomId();
  }

  const room = putRoom({
    id,
    cycleStartTime: Date.now(),
    focusDuration,
    breakDuration,
  });

  persistRoom(room);
  return room;
}

function getCurrentPhase(room) {
  const elapsed = Math.floor((Date.now() - room.cycleStartTime) / 1000);
  const cycleLength = room.focusDuration + room.breakDuration;
  const timeInCycle = elapsed % cycleLength;

  if (timeInCycle < room.focusDuration) {
    return { mode: "focus", remaining: room.focusDuration - timeInCycle };
  }

  return { mode: "break", remaining: cycleLength - timeInCycle };
}

function buildTimerPayload(room, extra = {}) {
  const phase = getCurrentPhase(room);
  return {
    ...phase,
    serverTime: Date.now(),
    cycleStartTime: room.cycleStartTime,
    focusDuration: room.focusDuration,
    breakDuration: room.breakDuration,
    userCount: room.users.size,
    participants: buildParticipants(room),
    ...extra,
  };
}

function leaveRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.users.delete(socket.id);
  socket.leave(roomId);

  if (room.users.size === 0) {
    delete rooms[roomId];
    removePersistedRoom(roomId);
    return;
  }

  emitPresence(roomId);
}

function handleClientActivity(roomId, socketId, payload = {}) {
  const room = rooms[roomId];
  if (!room) return;
  const participant = room.users.get(socketId);
  if (!participant) return;

  const now = Date.now();
  const wasActive = now - participant.lastActiveAt <= ACTIVE_WINDOW_MS;

  if (payload.state === "idle") {
    participant.lastActiveAt = now - ACTIVE_WINDOW_MS - 1000;
  } else {
    participant.lastActiveAt = now;
  }

  const isActive = now - participant.lastActiveAt <= ACTIVE_WINDOW_MS;
  if (wasActive !== isActive) {
    emitPresence(roomId);
  }
}

async function restoreRoomsFromStore() {
  if (!persistenceStore) return;

  const persistedRooms = await persistenceStore.loadRooms();
  let restoredCount = 0;

  for (const persisted of persistedRooms) {
    const room = putRoom(persisted);
    if (!room) continue;
    restoredCount += 1;
  }

  if (restoredCount > 0) {
    console.log(`[persistence] Restored ${restoredCount} room(s).`);
  }
}

function startSyncLoop() {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    for (const id in rooms) {
      const room = rooms[id];
      if (room.users.size === 0) continue;
      io.to(id).emit("timer:sync", buildTimerPayload(room));
    }
  }, SYNC_INTERVAL_MS);
}

function stopSyncLoop() {
  if (!syncInterval) return;
  clearInterval(syncInterval);
  syncInterval = null;
}

async function closeServer() {
  await new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received. Shutting down...`);

  stopSyncLoop();
  io.close();
  await closeServer();

  if (persistenceStore) {
    await persistenceStore.close();
  }

  process.exit(0);
}

app.post("/room", (req, res) => {
  const { focusDuration, breakDuration } = req.body;
  const room = createRoom(focusDuration, breakDuration);
  res.json({ roomId: room.id });
});

app.get("/room/:id", (req, res) => {
  const room = rooms[req.params.id.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({
    exists: true,
    userCount: room.users.size,
    focusDuration: room.focusDuration,
    breakDuration: room.breakDuration,
  });
});

app.use("/api/focus", createFocusRouter({ resolveUserId: resolveFocusUserId }));

registerFocusSocketHandler(io);

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("room:join", (roomId = "", callback) => {
    const id = String(roomId).trim().toUpperCase();
    const room = rooms[id];
    if (!room) return callback?.({ error: "Room not found" });

    if (currentRoom && currentRoom !== id) {
      leaveRoom(socket, currentRoom);
    }

    currentRoom = id;
    const existing = room.users.get(socket.id);
    room.users.set(socket.id, existing || createParticipant(socket.id));
    socket.join(id);

    callback?.(buildTimerPayload(room));
    emitPresence(id);
  });

  socket.on("client:activity", (payload = {}) => {
    if (!currentRoom) return;
    handleClientActivity(currentRoom, socket.id, payload);
  });

  socket.on("room:leave", (roomId = "", callback) => {
    const targetRoom = String(roomId).trim().toUpperCase() || currentRoom;
    if (!targetRoom || !rooms[targetRoom]) {
      callback?.({ ok: true });
      return;
    }

    leaveRoom(socket, targetRoom);
    if (currentRoom === targetRoom) currentRoom = null;
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    leaveRoom(socket, currentRoom);
    currentRoom = null;
  });
});

async function start() {
  persistenceStore = await createPersistenceStore();
  await restoreRoomsFromStore();
  startSyncLoop();
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error("[server] Shutdown failed:", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error("[server] Shutdown failed:", error);
    process.exit(1);
  });
});

start().catch((error) => {
  console.error("[server] Failed to start:", error);
  process.exit(1);
});
