# Quran Video Generator - Backend

A robust Node.js/Express application that generates viral-style Quran videos by compositing audio, dynamic backgrounds, and synchronized subtitles using FFmpeg.

## 🚀 Features

-   **Video Composition**: Uses `fluent-ffmpeg` to merge audio, video, and overlay text.
-   **Dynamic Backgrounds**: Integrates with **Pexels API** to fetch high-quality background videos.
-   **Typography**: Generates transparent subtitle images using `canvas` for precise text rendering.
-   **API**: RESTful endpoints with Swagger documentation.
-   **Progress Tracking**: Server-Sent Events (SSE) for real-time generation feedback.
-   **Notifications**: Web Push support to alert users when rendering is complete.

## 🛠️ Tech Stack

-   **Runtime**: Node.js (v20+)
-   **Framework**: Express.js
-   **Core Libs**: `fluent-ffmpeg`, `canvas`, `axios`, `web-push`
-   **Testing**: Jest
-   **Architecture**: Modular Controller-Service pattern

## 📦 Installation

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

## 🏃‍♂️ Running the Server

-   **Development Mode** (with hot-reload):
    ```bash
    npm run dev
    ```

-   **Production Start**:
    ```bash
    npm start
    ```

The server runs on `http://localhost:5000` by default.

## 🔌 API Endpoints

Full documentation available at `http://localhost:5000/api-docs` when running.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/generate-video` | Triggers video generation. |
| `GET` | `/api/v1/progress/:id` | SSE stream for progress updates. |
| `GET` | `/api/v1/backgrounds` | Fetch curated or Pexels videos. |
| `POST` | `/api/v1/subscribe` | Register for push notifications. |

## 🧪 Testing

Run the test suite (covers Controllers and Utils):
```bash
npm test
```
