const fs = require("fs");
const path = require("path");

const FILE_DEFAULT_PATH = path.join(__dirname, "room-state.json");
const REDIS_DEFAULT_KEY = "focus-room:rooms";

function normalizePersistedRoom(input) {
  if (!input || typeof input !== "object") return null;

  const id = String(input.id || "").trim().toUpperCase();
  const cycleStartTime = Number(input.cycleStartTime);
  const focusDuration = Number(input.focusDuration);
  const breakDuration = Number(input.breakDuration);

  if (!id) return null;
  if (!Number.isFinite(cycleStartTime)) return null;
  if (!Number.isFinite(focusDuration)) return null;
  if (!Number.isFinite(breakDuration)) return null;

  return { id, cycleStartTime, focusDuration, breakDuration };
}

class NoopStore {
  constructor(mode = "none") {
    this.mode = mode;
  }

  async loadRooms() {
    return [];
  }

  async upsertRoom() {}

  async deleteRoom() {}

  async close() {}
}

class FileStore {
  constructor(filePath) {
    this.filePath = filePath || FILE_DEFAULT_PATH;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  readState() {
    if (!fs.existsSync(this.filePath)) {
      return { rooms: {} };
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { rooms: {} };
    } catch (error) {
      console.warn(`[persistence:file] Failed to read ${this.filePath}:`, error.message);
      return { rooms: {} };
    }
  }

  writeState(state) {
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }

  async loadRooms() {
    const state = this.readState();
    const values = Object.values(state.rooms || {});
    return values.map(normalizePersistedRoom).filter(Boolean);
  }

  async upsertRoom(room) {
    const normalized = normalizePersistedRoom(room);
    if (!normalized) return;

    const state = this.readState();
    state.rooms = state.rooms || {};
    state.rooms[normalized.id] = normalized;
    this.writeState(state);
  }

  async deleteRoom(roomId) {
    const id = String(roomId || "").trim().toUpperCase();
    if (!id) return;

    const state = this.readState();
    if (!state.rooms || !state.rooms[id]) return;
    delete state.rooms[id];
    this.writeState(state);
  }

  async close() {}
}

class RedisStore {
  constructor(redisUrl, redisKey = REDIS_DEFAULT_KEY) {
    this.redisUrl = redisUrl;
    this.redisKey = redisKey;
    this.client = null;
  }

  async init() {
    let createClient;
    try {
      ({ createClient } = require("redis"));
    } catch {
      throw new Error('Redis mode requires the "redis" package. Install with: npm i redis');
    }

    this.client = createClient({ url: this.redisUrl });
    this.client.on("error", (error) => {
      console.error("[persistence:redis] Client error:", error.message);
    });

    await this.client.connect();
  }

  async loadRooms() {
    const raw = await this.client.hGetAll(this.redisKey);
    const rooms = [];
    for (const value of Object.values(raw || {})) {
      try {
        const parsed = JSON.parse(value);
        const normalized = normalizePersistedRoom(parsed);
        if (normalized) rooms.push(normalized);
      } catch {
        // Ignore malformed room payloads instead of failing server startup.
      }
    }
    return rooms;
  }

  async upsertRoom(room) {
    const normalized = normalizePersistedRoom(room);
    if (!normalized) return;
    await this.client.hSet(this.redisKey, normalized.id, JSON.stringify(normalized));
  }

  async deleteRoom(roomId) {
    const id = String(roomId || "").trim().toUpperCase();
    if (!id) return;
    await this.client.hDel(this.redisKey, id);
  }

  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

async function createPersistenceStore() {
  const mode = String(process.env.ROOM_PERSISTENCE || "none").toLowerCase();

  if (mode === "none") {
    console.log("[persistence] Mode: none");
    return new NoopStore(mode);
  }

  if (mode === "redis") {
    const redisUrl = process.env.REDIS_URL;
    const redisKey = process.env.REDIS_KEY || REDIS_DEFAULT_KEY;
    if (!redisUrl) {
      console.warn("[persistence] ROOM_PERSISTENCE=redis but REDIS_URL is missing. Falling back to file.");
    } else {
      try {
        const store = new RedisStore(redisUrl, redisKey);
        await store.init();
        console.log("[persistence] Mode: redis");
        return store;
      } catch (error) {
        console.warn(`[persistence] Redis unavailable (${error.message}). Falling back to file.`);
      }
    }
  }

  const filePath = process.env.ROOM_STATE_FILE || FILE_DEFAULT_PATH;
  console.log(`[persistence] Mode: file (${filePath})`);
  return new FileStore(filePath);
}

module.exports = { createPersistenceStore, normalizePersistedRoom };
