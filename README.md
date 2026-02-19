# BookMarkManager

A self-hosted app for saving and managing YouTube video bookmarks with built-in transcription. Runs as a single Docker container — Flask serves both the REST API and the React frontend. Includes a Chrome extension for one-click saving from YouTube.

## Features

- **Save YouTube videos** via the Chrome extension or the web UI
- **Transcribe videos** using yt-dlp + AssemblyAI with real-time status polling
- **View transcripts** in-app with copy-to-clipboard support
- **Search transcripts** with basic text search
- **Import bookmarks** from Chrome or from JSON files
- **Paginated list view** with thumbnails, video info, and transcript status

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An [AssemblyAI API key](https://www.assemblyai.com/) (only needed for transcription)

### Run

```bash
# 1. Clone the repo
git clone <repo-url> && cd BookMarkManager

# 2. Create your .env file
cp .env.example .env
# Edit .env and add your AssemblyAI key

# 3. Start the app
docker compose up --build
```

Open **http://localhost:5000** in your browser.

## Chrome Extension Setup

1. Make sure the Docker container is running
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `chrome-extension/` folder
5. Navigate to any YouTube video and click the extension icon
6. Click **Save to BookMarkManager** to save the video

The extension popup shows an API status indicator, the current video's metadata, and an embedded iframe of the full BookMarkManager UI.

## Architecture

```
BookMarkManager/
├── chrome-extension/     # Manifest v3 Chrome extension
├── frontend/             # React SPA (Vite + React 18)
├── backend/              # Flask API + SQLite
├── utils/                # Import scripts
├── sql/                  # Schema and query references
├── Dockerfile            # Multi-stage build (Node + Python + ffmpeg)
└── docker-compose.yaml   # Single service, port 5000
```

**Stack:** React 18, Vite, Flask, SQLite, Gunicorn, yt-dlp, AssemblyAI, Docker

### How it works

- **Frontend** is built at Docker image build time and served as static files by Flask
- **Backend** exposes a REST API under `/api/*` and serves the SPA for all other routes
- **Transcription** runs in a background thread: yt-dlp downloads audio, AssemblyAI transcribes it, and the frontend polls for status updates
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
| `GET` | `/api/transcripts/<id>` | Get transcript text |
| `GET` | `/api/transcripts/search?q=` | Search transcripts |
| `GET` | `/api/bookmarks/chrome` | List Chrome YouTube bookmarks |
| `POST` | `/api/bookmarks/chrome/import` | Import Chrome bookmarks |

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ASSEMBLYAI_API_KEY` | For transcription | Your AssemblyAI API key |

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
