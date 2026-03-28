# Focus Room

Join -> Lock in -> Focus.

## Run

Terminal 1 - Server
```bash
cd server
npm start
```
Runs on `http://localhost:4000`

Terminal 2 - Client
```bash
cd client
npm run dev
```
Runs on `http://localhost:5173`

## Multi-client Sync Test

From `server/`:
```bash
npm run test:multi
```

Optional environment variables:
- `TEST_ITERATIONS` (default `5`)
- `TEST_CLIENTS` (default `3`)
- `TEST_PORT` (default `4100`)
- `TEST_SYNC_TIMEOUT_MS` (default `7000`)

Example:
```bash
TEST_ITERATIONS=10 TEST_CLIENTS=4 npm run test:multi
```

## Room Persistence (optional)

Configure with `ROOM_PERSISTENCE`:
- `none`: disable persistence (default)
- `file`: persist rooms to JSON file (optional)
- `redis`: persist rooms to Redis hash (advanced optional)

### File persistence (optional)

PowerShell:
```powershell
cd server
$env:ROOM_PERSISTENCE="file"
npm start
```

CMD:
```bash
cd server
set ROOM_PERSISTENCE=file
npm start
```

Bash:
```bash
cd server
ROOM_PERSISTENCE=file npm start
```

Optional file path:
- `ROOM_STATE_FILE` (default `server/room-state.json`)

### Redis persistence

PowerShell:
```powershell
cd server
$env:ROOM_PERSISTENCE="redis"
$env:REDIS_URL="redis://localhost:6379"
$env:REDIS_KEY="focus-room:rooms"
npm start
```

CMD:
```bash
cd server
set ROOM_PERSISTENCE=redis
set REDIS_URL=redis://localhost:6379
set REDIS_KEY=focus-room:rooms
npm start
```

Bash:
```bash
cd server
ROOM_PERSISTENCE=redis REDIS_URL=redis://localhost:6379 REDIS_KEY=focus-room:rooms npm start
```

Notes:
- Redis mode expects the `redis` package (`npm i redis` in `server/`).
- If Redis is unavailable, the server falls back to file persistence.

## Stack
- Backend: Node.js + Express + Socket.io
- Frontend: React + Vite + react-router-dom
