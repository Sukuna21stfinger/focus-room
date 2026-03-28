#!/usr/bin/env node
const assert = require("assert/strict");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT_DIR, "server");
const SERVER_ENTRY = path.join(SERVER_DIR, "index.js");

let io;
try {
  ({ io } = require("socket.io-client"));
} catch {
  ({ io } = require(path.join(ROOT_DIR, "client", "node_modules", "socket.io-client")));
}

const ITERATIONS = Math.max(1, Number(process.env.TEST_ITERATIONS || 5));
const CLIENTS_PER_ROOM = Math.max(2, Number(process.env.TEST_CLIENTS || 3));
const PORT = Math.max(1024, Number(process.env.TEST_PORT || 4100));
const SYNC_TIMEOUT_MS = Math.max(3000, Number(process.env.TEST_SYNC_TIMEOUT_MS || 7000));
const BASE_URL = `http://127.0.0.1:${PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fn();
      if (result) return;
    } catch {
      // Keep polling.
    }
    await delay(120);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

function onceWithTimeout(socket, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for "${eventName}"`));
    }, timeoutMs);

    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(eventName, onEvent);
  });
}

async function waitForConnect(socket) {
  if (socket.connected) return;
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

async function createRoom(focusDuration, breakDuration) {
  const res = await fetch(`${BASE_URL}/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ focusDuration, breakDuration }),
  });
  assert.equal(res.status, 200, "create room request should return 200");
  const payload = await res.json();
  assert.ok(payload.roomId, "create room should return roomId");
  return payload.roomId;
}

async function getRoom(roomId) {
  return fetch(`${BASE_URL}/room/${roomId}`);
}

function startServer() {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      ROOM_PERSISTENCE: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[server-err] ${chunk}`);
  });

  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;

  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000),
  ]);

  if (!child.killed) {
    child.kill("SIGKILL");
  }
}

async function runIteration(iteration) {
  const focusDuration = 600 + iteration;
  const breakDuration = 180;
  const roomId = await createRoom(focusDuration, breakDuration);

  const clients = Array.from({ length: CLIENTS_PER_ROOM }, () =>
    io(BASE_URL, { transports: ["websocket"], reconnection: false })
  );

  try {
    await Promise.all(clients.map(waitForConnect));

    for (let i = 0; i < clients.length; i += 1) {
      const payload = await new Promise((resolve) => {
        clients[i].emit("room:join", roomId, resolve);
      });

      assert.ok(!payload.error, `join should succeed for client ${i + 1}`);
      assert.equal(payload.userCount, i + 1, `join count mismatch for client ${i + 1}`);
      assert.equal(payload.focusDuration, focusDuration, "focusDuration mismatch in join payload");
      assert.equal(payload.breakDuration, breakDuration, "breakDuration mismatch in join payload");
      assert.ok(Number.isFinite(payload.cycleStartTime), "cycleStartTime must be present");
    }

    const syncPromises = clients.map((client) => onceWithTimeout(client, "timer:sync", SYNC_TIMEOUT_MS));
    const syncPayloads = await Promise.all(syncPromises);
    const modes = new Set(syncPayloads.map((payload) => payload.mode));
    const remainingValues = syncPayloads.map((payload) => payload.remaining);
    const maxRemaining = Math.max(...remainingValues);
    const minRemaining = Math.min(...remainingValues);

    assert.equal(modes.size, 1, "clients should agree on timer mode");
    assert.ok(maxRemaining - minRemaining <= 2, "clients should stay tightly synced");

    const observer = clients[1];
    const presenceUpdatePromise = onceWithTimeout(observer, "presence:update", 2000);
    await new Promise((resolve) => {
      clients[0].emit("room:leave", roomId, resolve);
    });
    const presencePayload = await presenceUpdatePromise;
    assert.equal(
      presencePayload.userCount,
      CLIENTS_PER_ROOM - 1,
      "presence count should decrement after leave"
    );

    for (const client of clients) {
      client.close();
    }

    await waitFor(async () => {
      const res = await getRoom(roomId);
      return res.status === 404;
    }, 3000, "room cleanup");

    console.log(
      `[ok] iteration=${iteration + 1} room=${roomId} mode=${[...modes][0]} delta=${maxRemaining - minRemaining}`
    );
  } finally {
    for (const client of clients) {
      client.close();
    }
  }
}

async function main() {
  console.log(
    `[test] Starting multi-client test: iterations=${ITERATIONS}, clients=${CLIENTS_PER_ROOM}, port=${PORT}`
  );
  const serverProcess = startServer();

  try {
    await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/room/NOPE1`);
      return res.status === 404;
    }, 8000, "server startup");

    for (let i = 0; i < ITERATIONS; i += 1) {
      await runIteration(i);
    }

    console.log("[test] All iterations passed.");
  } finally {
    await stopServer(serverProcess);
  }
}

main().catch((error) => {
  console.error("[test] FAILED:", error.message);
  process.exit(1);
});
