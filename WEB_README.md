# Youwee Web Branch

This branch contains the web version of Youwee, designed to run on Render with a proper multi-user architecture.

## Architecture

```
Browser (React) → HTTPS API (Hono) → PostgreSQL + Queue (BullMQ) → Background Worker (yt-dlp + FFmpeg) → Object Storage
```

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- Bun
- PostgreSQL
- Redis
- yt-dlp, FFmpeg, Deno installed locally

### Setup

1. **Install dependencies:**
```bash
bun install
cd server && bun install && cd ..
cd worker && bun install && cd ..
```

2. **Set up environment:**
```bash
cp .env.example .env
# Edit .env with your local database/redis URLs
```

3. **Run database migrations:**
```bash
cd server && bun run db:generate && bun run db:migrate && cd ..
```

4. **Start development servers:**
```bash
# Terminal 1: Frontend
bun run dev:web

# Terminal 2: API Server
cd server && bun run dev

# Terminal 3: Worker
cd worker && bun run dev
```

## Deployment to Render

### 1. Create Render Resources

The `render.yaml` defines:
- Web Service (API)
- Background Worker
- PostgreSQL Database
- Redis (Key Value)

### 2. Deploy

```bash
# Push to GitHub
git push origin web

# On Render dashboard:
# 1. New → Blueprint
# 2. Connect your GitHub repo
# 3. Select the web branch
# 4. Render will create all resources from render.yaml
```

### 3. Configure Environment Variables

On Render dashboard, add these environment variables:

**Web Service:**
- `SESSION_SECRET` - Auto-generated
- `PUBLIC_APP_URL` - Your Render URL (e.g., `https://youwee-web.onrender.com`)
- `STORAGE_ENDPOINT` - S3-compatible endpoint (e.g., `https://s3.us-east-1.amazonaws.com`)
- `STORAGE_BUCKET` - Your bucket name
- `STORAGE_ACCESS_KEY` - AWS access key
- `STORAGE_SECRET_KEY` - AWS secret key
- `STORAGE_REGION` - Region (e.g., `us-east-1` or `auto`)

**Worker:**
- Same storage variables as web service

## Features (MVP)

- ✅ Youwee account authentication (register/login/logout)
- ✅ Secure HTTP-only cookie sessions
- ✅ URL metadata extraction
- ✅ Video download with format/quality selection
- ✅ Real-time progress via Server-Sent Events
- ✅ Download library/history
- ✅ File download via signed URLs
- ✅ User isolation (each user sees only their data)

## Upcoming Features

- [ ] Playlists support
- [ ] Audio extraction
- [ ] Subtitle download
- [ ] Video processing (cut, convert, etc.)
- [ ] SponsorBlock integration
- [ ] Channel following
- [ ] AI video summaries
- [ ] Browser extension integration

## Project Structure

```
youwee-web/
├── src/                    # React frontend (shared with desktop)
│   ├── contexts/
│   │   └── AuthContext.tsx    # New: Web authentication
│   ├── lib/
│   │   └── backend/           # New: Backend adapter
│   │       ├── index.ts       # Factory for web/desktop
│   │       ├── types.ts       # Shared types
│   │       ├── webBackend.ts  # HTTP API implementation
│   │       └── desktopBackend.ts # Tauri implementation
│   ├── pages/
│   │   └── LoginPage.tsx      # New: Login/Register page
│   └── App.tsx                # Updated: Conditional rendering
├── server/                   # New: Hono API server
│   ├── src/
│   │   ├── auth/              # Authentication (register, login, logout, me)
│   │   ├── metadata/          # Metadata extraction
│   │   ├── downloads/         # Download job management
│   │   ├── files/             # File access via signed URLs
│   │   ├── db/                # Drizzle ORM + PostgreSQL schema
│   │   ├── queue/             # BullMQ + Redis queue
│   │   └── index.ts           # Main Hono app
│   ├── package.json
│   └── tsconfig.json
├── worker/                   # New: Background worker
│   ├── src/
│   │   └── index.ts           # yt-dlp + FFmpeg processing
│   ├── package.json
│   └── tsconfig.json
├── lib/
│   └── backend/               # Backend adapter for React
│       ├── index.ts           # getBackend() factory
│       ├── types.ts           # Shared TypeScript types
│       ├── webBackend.ts      # HTTP API implementation
│       └── desktopBackend.ts  # Tauri implementation
├── Dockerfile.web             # Web service Docker image
├── Dockerfile.worker          # Worker Docker image
├── render.yaml                # Render Blueprint
└── drizzle.config.ts          # Database migrations
```

## Desktop vs Web

| Feature | Desktop (Tauri) | Web (Hono) |
|---------|-----------------|------------|
| Auth | None (local) | Youwee accounts + sessions |
| Downloads | Local filesystem | Object storage + signed URLs |
| Progress | Tauri events | Server-Sent Events |
| Database | SQLite (local) | PostgreSQL (shared) |
| Queue | In-memory | BullMQ + Redis |
| Dependencies | Auto-managed | Pre-installed in Docker |
| FFmpeg | Bundled | Pre-installed in Docker |
| yt-dlp | Auto-updated | Pre-installed in Docker |

## Development Notes

- The React frontend is **shared** between desktop and web
- Backend calls are abstracted via `lib/backend/index.ts`
- `VITE_WEB_MODE=true` enables web-specific code paths
- Desktop build: `bun run tauri:build` (unchanged)
- Web build: `bun run build:web`
- All existing desktop functionality preserved