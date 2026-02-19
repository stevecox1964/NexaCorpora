# BookMarkManager

A self-hosted app for saving and managing YouTube video bookmarks with built-in transcription, AI-powered summaries, and a chat interface for querying your video knowledge base. Runs as a single Docker container — Flask serves both the REST API and the React frontend. Includes a Chrome extension for one-click saving from YouTube.

## Features

- **Save YouTube videos** via the Chrome extension or the web UI
- **Transcribe videos** using yt-dlp + AssemblyAI with real-time status polling
- **View transcripts** in-app with copy-to-clipboard support
- **AI-powered summaries** — generate per-video summaries with Google Gemini, displayed inline as expandable rows
- **Bulk summarize** — "Summarize All" button generates summaries for all transcribed videos at once
- **Chat with your videos** — Gemini-powered chat drawer with SSE streaming; ask questions against your transcript knowledge base
- **Search transcripts** with basic text search
- **Import bookmarks** from Chrome or from JSON files
- **Paginated list view** with thumbnails, video info, transcript/summary status, and actions

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An [AssemblyAI API key](https://www.assemblyai.com/) (for transcription)
- A [Google AI API key](https://aistudio.google.com/apikey) (for summaries and chat)

### Run

```bash
# 1. Clone the repo
git clone <repo-url> && cd BookMarkManager

# 2. Create your .env file
cp .env.example .env
# Edit .env and add your API keys (ASSEMBLYAI_API_KEY and GOOGLE_API_KEY)

# 3. Start the app
docker compose up --build
```

Open **http://localhost:5000** in your browser.

### Docker Rebuild Commands

```bash
# Normal rebuild (picks up code changes)
docker compose up -d --build

# Force full rebuild (when having cache issues)
docker compose down
docker compose build --no-cache
docker compose up -d

# View logs
docker compose logs -f app
```

## Chrome Extension Setup

1. Make sure the Docker container is running
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `chrome-extension/` folder
5. Navigate to any YouTube video and click the extension icon
6. Click **Save to BookMarkManager** to save the video

**Popup layout:**
- **Toolbar**: Title + green/red API status dot
- **Video strip**: Current YouTube video title + channel + Save button
- **Main area**: Embedded iframe loading `http://localhost:5000` (the full BookMarkManager UI)
- If Docker is offline, shows an offline message instead of the iframe

**Permissions**: `activeTab`, `scripting`, `tabs` + host access to `youtube.com` and `localhost:5000`. No `storage`, `downloads`, or `notifications` used.

## Architecture

```
BookMarkManager/
├── chrome-extension/                # Chrome Extension (Manifest v3)
│   ├── manifest.json
│   ├── background.js                # Scrapes YouTube DOM; POSTs to Flask API
│   ├── popup.html / popup.js        # Popup UI and logic
│   └── icons/
├── frontend/                        # React SPA (Vite + React 18)
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoCard.jsx        # Video row with transcript/summary actions
│   │   │   ├── AddVideoModal.jsx    # Manual video add modal
│   │   │   ├── TranscriptModal.jsx  # Transcript viewer modal
│   │   │   └── ChatDrawer.jsx       # Gemini-powered chat drawer
│   │   ├── services/
│   │   │   └── api.js               # API service layer (fetch + SSE streaming)
│   │   └── App.jsx                  # Main app: video list, pagination, polling
│   └── package.json
├── backend/                         # Flask API + SQLite
│   ├── app/
│   │   ├── __init__.py              # Serves SPA from /app/static
│   │   ├── routes.py                # API endpoints
│   │   ├── models.py                # SQLite models (Video, Transcript, Job)
│   │   ├── database.py              # DB connection + schema + migrations
│   │   ├── bookmarks.py             # Chrome bookmarks parser
│   │   ├── transcripts.py           # Transcript search + status helpers
│   │   ├── transcription_service.py # yt-dlp + AssemblyAI background jobs
│   │   └── gemini_service.py        # Gemini integration (summaries + chat)
│   ├── run.py
│   └── requirements.txt
├── utils/                           # Utility scripts
│   └── import_json_to_db.py
├── sql/                             # Schema and query references
├── .env.example
├── Dockerfile                       # Multi-stage: build frontend + install ffmpeg + run backend
└── docker-compose.yaml              # Single service, port 5000
```

**Stack:** React 18, Vite, Flask, SQLite, Gunicorn, yt-dlp, AssemblyAI, Google Gemini, Docker

### How It Works

- **Frontend** is built at Docker image build time and served as static files by Flask
- **Backend** exposes a REST API under `/api/*` and serves the SPA for all other routes
- **Transcription** runs in a background thread: yt-dlp downloads audio, AssemblyAI transcribes it, and the frontend polls for status updates
- **Summarization** reads transcripts from the DB, sends them to Gemini, and stores the generated summary back in the transcripts table
- **Chat** searches transcripts via LIKE query for relevant context (falls back to summaries), then streams a Gemini response via SSE
- **Data** is persisted in a SQLite database on a Docker volume (`backend/data/`)

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/videos` | List videos (paginated) |
| `POST` | `/api/videos` | Add a video |
| `GET` | `/api/videos/<id>` | Get a video |
| `DELETE` | `/api/videos/<id>` | Delete a video |
| `POST` | `/api/transcribe/<id>` | Start transcription job |
| `GET` | `/api/jobs/<job_id>` | Poll job status |
| `GET` | `/api/jobs/video/<video_id>` | Get active job for a video |
| `GET` | `/api/transcripts/<id>` | Get transcript text |
| `GET` | `/api/transcripts/<id>/status` | Check transcript status |
| `GET` | `/api/transcripts/search?q=` | Search transcripts |
| `POST` | `/api/summaries/<id>` | Generate summary via Gemini |
| `GET` | `/api/summaries/<id>` | Get stored summary |
| `POST` | `/api/summaries/bulk` | Summarize all un-summarized transcripts |
| `POST` | `/api/chat` | Stream chat response (SSE) |
| `GET` | `/api/bookmarks/chrome` | List Chrome YouTube bookmarks |
| `POST` | `/api/bookmarks/chrome/import` | Import Chrome bookmarks |

## Database Schema

### videos

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| video_id | TEXT | YouTube video ID (unique) |
| video_title | TEXT | Video title |
| channel_id | TEXT | YouTube channel ID |
| channel_name | TEXT | Channel display name |
| channel_url | TEXT | Channel URL |
| video_url | TEXT | Full video URL |
| scraped_at | TEXT | ISO8601 timestamp |
| created_at | TEXT | Record creation timestamp |

### transcripts

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| video_id | TEXT | Foreign key to videos |
| content | TEXT | Full transcript text |
| summary | TEXT | Gemini-generated summary |
| indexed_at | TEXT | Indexing timestamp |

### jobs

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| video_id | TEXT | Foreign key to videos |
| job_type | TEXT | Job type (e.g., "transcribe") |
| status | TEXT | pending / downloading / transcribing / completed / failed |
| error_message | TEXT | Error details if failed |
| created_at | TEXT | Job creation timestamp |
| completed_at | TEXT | Job completion timestamp |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ASSEMBLYAI_API_KEY` | For transcription | Your AssemblyAI API key |
| `GOOGLE_API_KEY` | For summaries + chat | Your Google AI API key |
| `GEMINI_MODEL` | No (default: `gemini-2.5-flash`) | Gemini model to use |

Available Gemini model options:
- `gemini-2.5-flash` — stable, fast, good price/performance (default)
- `gemini-3-flash-preview` — newest, frontier-class, still in preview
- `gemini-2.5-flash-lite` — cheapest, good for high volume

## Development

To run the frontend and backend separately for development:

```bash
# Backend
cd backend
pip install -r requirements.txt
python run.py
# API at http://localhost:5000

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
# UI at http://localhost:5173 (Vite proxies /api to port 5000)
```

## Utilities

### JSON Import

Bulk-import video metadata from JSON files:

```bash
# Dry run
python utils/import_json_to_db.py --test

# Import
python utils/import_json_to_db.py --import
```

See `utils/import_json_to_db.py` for options (`--source`, `--db`).

## License

MIT
