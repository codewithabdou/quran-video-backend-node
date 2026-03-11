# Quran Video Generator - Backend

A robust Node.js/Express application that generates viral-style Quran videos by compositing audio, dynamic backgrounds, and synchronized subtitles using FFmpeg.

## Features

-   **Video Composition**: Uses `fluent-ffmpeg` to merge audio, video, and overlay text.
-   **Background Processing**: Uses **BullMQ** and **Redis** for robust, asynchronous job queuing and management.
-   **Concurrency Control**: Enforces strict IP-based concurrency limits (1 active job per user) to prevent abuse and ensure fair queueing.
-   **Dynamic Backgrounds**: Integrates with **Pexels API** to fetch high-quality background videos.
-   **Typography**: Generates transparent subtitle images using `canvas` for precise text rendering.
-   **API**: RESTful endpoints with Swagger documentation.
-   **Progress Tracking**: Server-Sent Events (SSE) for real-time generation feedback, including queue position.
-   **Notifications**: Web Push support to alert users when rendering is complete.

## Tech Stack

-   **Runtime**: Node.js (v20+)
-   **Framework**: Express.js
-   **Core Libs**: `fluent-ffmpeg`, `canvas`, `axios`, `web-push`, `bullmq`
-   **Database**: Redis (for job queueing and state management)
-   **Testing**: Jest
-   **Architecture**: Modular Controller-Service-Worker pattern

## Installation

1.  **Navigate to backend directory**:
    ```bash
    cd backend-node
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```
    *Note: This automatically installs FFmpeg binaries via `ffmpeg-static`.*

3.  **Environment Setup**:
    Copy the example env file:
    ```bash
    cp .env.example .env
    ```
    Update `.env` with your keys:
    -   `PEXELS_API_KEY`: Required for fetching backgrounds.
    -   `VAPID_*`: Required for push notifications (generate with `npx web-push generate-vapid-keys`).
    -   `REDIS_URL`: Connection string for your Redis instance (e.g., `redis://localhost:6379`).

## Docker Support

The backend includes full Docker support for easy deployment.

-   **Development Mode**:
    ```bash
    docker compose up --build
    ```
    This spins up both the Node.js backend and a Redis container.

-   **Production Mode**:
    Use `docker-compose.prod.yml` to pull from the GitHub Container Registry and run alongside Redis and Watchtower for automated updates.

## Running the Server

-   **Development Mode** (with hot-reload):
    ```bash
    npm run dev
    ```

-   **Production Start**:
    ```bash
    npm start
    ```

The server runs on `http://localhost:5000` by default.

## API Endpoints

Full documentation available at `http://localhost:5000/api-docs` when running.

| Method | Endpoint                    | Description                                                   |
| :----- | :-------------------------- | :------------------------------------------------------------ |
| `POST` | `/api/v1/generate-video`    | Queues a video generation job. Returns immediately.           |
| `GET`  | `/api/v1/progress/:id`      | SSE stream for real-time progress updates & queue position.   |
| `DELETE` | `/api/v1/generate-video/cancel` | Force cancels the active job for the requesting IP.     |
| `GET`  | `/api/v1/download/:jobId`   | Downloads the generated MP4 video file.                       |
| `GET`  | `/api/v1/backgrounds`       | Fetch curated or Pexels background videos.                    |
| `POST` | `/api/v1/check-background`  | Verify if a background video is already cached on the server. |
| `POST` | `/api/v1/upload-background` | Upload a custom background video for a generation job.        |
| `POST` | `/api/v1/subscribe`         | Register for push notifications.                              |
| `GET`  | `/api/v1/admin/jobs`        | Fetches all jobs in the queue (Experimental Admin Dashboard). |
| `DELETE`| `/api/v1/admin/jobs/:jobId`| Instantly force-cancels a queued or active job by its ID.     |

## Testing

Run the test suite (covers Controllers and Utils):
```bash
npm test
```
