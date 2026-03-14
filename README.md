# Quran Video Generator — Backend

A Node.js/Express backend that generates Quran video reels by compositing audio, video backgrounds, and synchronized subtitles with FFmpeg. Includes Google OAuth authentication, PostgreSQL-backed user management, and an admin dashboard.

## Features

- **Video Composition**: FFmpeg-based pipeline merging recitation audio, dynamic backgrounds, and Arabic/English subtitle overlays.
- **Background Processing**: BullMQ + Redis for robust async job queuing with per-IP concurrency control.
- **Google OAuth**: Server-side authentication flow issuing JWTs. First user auto-promoted to ADMIN.
- **User Management**: PostgreSQL via Prisma v7 — users, roles, generation history.
- **Admin Dashboard**: Stats, user management (promote/demote/delete), and queue control.
- **Generation History**: Every generation (completed, failed, cancelled) saved with metadata.
- **Push Notifications**: Web Push (VAPID) alerts users when rendering completes — subscription passed through BullMQ job data to the worker.
- **Dynamic Backgrounds**: Pexels API integration with server-side caching.
- **Progress Tracking**: Server-Sent Events (SSE) with queue position.
- **API Docs**: Swagger UI at `/api-docs`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Express.js |
| Database | PostgreSQL 16 (via Prisma v7 + `@prisma/adapter-pg`) |
| Queue | Redis 7 + BullMQ |
| Video | FFmpeg (`fluent-ffmpeg`, `canvas`) |
| Auth | Passport.js (Google OAuth 2.0), JWT |
| Notifications | `web-push` (VAPID) |
| Testing | Jest |
| Containerization | Docker + Docker Compose |

## Quick Start

### Docker (Recommended)

```bash
docker compose up --build
```

This starts **PostgreSQL**, **Redis**, and the **Node.js backend** together.

### Local Development

1. **Start infrastructure** (PostgreSQL + Redis):
   ```bash
   docker compose up postgres redis -d
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   Required variables:
   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | PostgreSQL connection string |
   | `REDIS_URL` | Redis connection string |
   | `GOOGLE_CLIENT_ID` | Google OAuth client ID |
   | `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
   | `JWT_SECRET` | Secret for signing JWTs |
   | `FRONTEND_URL` | Frontend URL for OAuth redirect |
   | `PEXELS_API_KEY` | Pexels API key for backgrounds |
   | `VAPID_PUBLIC_KEY` | Web Push public key |
   | `VAPID_PRIVATE_KEY` | Web Push private key |
   | `VAPID_EMAIL` | Contact email for VAPID |

4. **Run migrations**:
   ```bash
   npx prisma migrate dev
   ```

5. **Start the server**:
   ```bash
   npm run dev
   ```

Server runs at `http://localhost:5000`. Swagger docs at `http://localhost:5000/api-docs`.

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/auth/google` | Initiate Google OAuth login |
| `GET` | `/api/v1/auth/google/callback` | OAuth callback (issues JWT) |
| `GET` | `/api/v1/auth/me` | Get current user profile 🔒 |

### Video Generation
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/generate-video` | Queue a video generation job 🔒 |
| `GET` | `/api/v1/progress/:id` | SSE stream for progress updates |
| `DELETE` | `/api/v1/generate-video/cancel` | Cancel active job for requesting IP |
| `GET` | `/api/v1/download/:jobId` | Download completed video |
| `POST` | `/api/v1/subscribe` | Register for push notifications |

### Backgrounds
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/backgrounds` | Fetch Pexels background videos |
| `POST` | `/api/v1/check-background` | Check if a background is cached |
| `POST` | `/api/v1/upload-background` | Upload a custom background |

### History
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/history` | Paginated generation history 🔒 |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/admin/stats` | System statistics 🔒👑 |
| `GET` | `/api/v1/admin/users` | List/search users 🔒👑 |
| `PATCH` | `/api/v1/admin/users/:id/role` | Change user role 🔒👑 |
| `DELETE` | `/api/v1/admin/users/:id` | Delete user 🔒👑 |
| `GET` | `/api/v1/admin/jobs` | List all queue jobs 🔒👑 |
| `DELETE` | `/api/v1/admin/jobs/:jobId` | Force-cancel a job 🔒👑 |

> 🔒 = Requires JWT auth &nbsp; 👑 = Requires ADMIN role

## Testing

```bash
npm test
```

Covers controllers (`videoController`, `backgroundsController`), routes (`api`), and utils (`fileOps`, `textGen`).

## Architecture

```
src/
├── config/         # Database, queue, passport, swagger
├── controllers/    # Route handlers
├── middleware/      # Auth, validation, rate limiting, upload
├── routes/         # Express routers with Swagger JSDoc
├── services/       # Business logic (video composition)
├── utils/          # File operations, text generation
├── worker.js       # BullMQ worker (FFmpeg processing)
└── server.js       # Express app entry point
```
