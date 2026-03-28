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

## Deploy (Vercel + Render)

This project should be deployed as:
- Frontend (`client/`) on Vercel
- Backend (`server/`) on Render

### 1) Deploy backend on Render

1. Go to Render dashboard -> `New +` -> `Web Service`
2. Connect your GitHub repo: `Sukuna21stfinger/focus-room`
3. Use these settings:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables:
   - `PORT` = `10000` (or leave Render default)
   - `CLIENT_ORIGIN` = your Vercel app URL (set this after frontend deploy)
5. Deploy and copy backend URL (example: `https://focus-room-api.onrender.com`)

### 2) Deploy frontend on Vercel

1. Go to Vercel dashboard -> `Add New...` -> `Project`
2. Import repo: `Sukuna21stfinger/focus-room`
3. Use these settings:
   - Root Directory: `client`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Add environment variable:
   - `VITE_API_URL` = your Render backend URL
5. Deploy and copy frontend URL (example: `https://focus-room.vercel.app`)

### 3) Final CORS update on Render

After Vercel URL is ready:
1. Open Render service -> `Environment`
2. Set `CLIENT_ORIGIN` to exact Vercel URL
3. Redeploy Render service

### 4) Verify

1. Open Vercel app URL
2. Create room and join from another tab/device
3. Confirm timer sync + live presence + focus count updates work
