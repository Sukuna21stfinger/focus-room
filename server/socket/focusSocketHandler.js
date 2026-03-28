const activeFocusers = new Map(); // userId -> Set(socketId)

function normalizeUserId(socket) {
  const fromAuth = socket.handshake?.auth?.userId;
  const fromQuery = socket.handshake?.query?.focusUserId;
  const value = String(fromAuth || fromQuery || socket.id || "").trim();
  return value || socket.id;
}

function emitCount(io) {
  io.emit("focus_count_update", activeFocusers.size);
}

function markFocused(io, socket) {
  const userId = socket.data.focusUserId || normalizeUserId(socket);
  socket.data.focusUserId = userId;
  const entries = activeFocusers.get(userId) || new Set();
  entries.add(socket.id);
  activeFocusers.set(userId, entries);
  emitCount(io);
}

function clearFocused(io, socket) {
  const userId = socket.data.focusUserId || normalizeUserId(socket);
  if (!userId || !activeFocusers.has(userId)) return;

  const entries = activeFocusers.get(userId);
  entries.delete(socket.id);

  if (entries.size === 0) {
    activeFocusers.delete(userId);
  } else {
    activeFocusers.set(userId, entries);
  }

  emitCount(io);
}

function registerFocusSocketHandler(io) {
  io.on("connection", (socket) => {
    socket.data.focusUserId = normalizeUserId(socket);
    socket.emit("focus_count_update", activeFocusers.size);

    socket.on("focus_start", () => {
      markFocused(io, socket);
    });

    socket.on("focus_end", () => {
      clearFocused(io, socket);
    });

    socket.on("disconnect", () => {
      clearFocused(io, socket);
    });
  });
}

module.exports = { registerFocusSocketHandler };
