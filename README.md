# BookMarkManager

A self-hosted app for saving and managing YouTube video bookmarks with built-in transcription, AI-powered summaries, semantic search, curated AI knowledge bases ("Brains"), and a RAG-powered chat interface. Runs as a single Docker container — Flask serves both the REST API and the React frontend. Includes a Chrome extension for one-click saving from YouTube.

## Features

- **Save YouTube videos** via the Chrome extension or the web UI
- **Transcribe videos** using yt-dlp + AssemblyAI or Gemini Audio, with real-time status polling and provider badges
- **View transcripts** in-app with an embedded YouTube player and clickable timestamps
- **AI-powered summaries** — generate structured (FAQ-style) or narrative summaries with Google Gemini, displayed inline as expandable rows
- **Bulk summarize** — "Summarize All" button generates summaries for all transcribed videos at once
- **Semantic search** — vector similarity search across transcript chunks using Gemini embeddings + sqlite-vec
- **AI Brains** — curated knowledge bases: group videos into brains, chat with brain-scoped RAG context, auto-assign videos after transcription
- **Chat with your videos** — RAG-powered chat drawer with SSE streaming, embedded YouTube player, and clickable timestamps
- **Delete & re-manage transcripts** — delete transcripts (cascades to embeddings + summary), re-transcribe with a different provider
- **Import bookmarks** from Chrome
- **Configurable settings** — choose transcription provider, Gemini model, manage embeddings, and customize your profile
- **Paginated list view** with thumbnails, video info, transcript/summary status, and actions

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An [AssemblyAI API key](https://www.assemblyai.com/) (for transcription via AssemblyAI)
- A [Google AI API key](https://aistudio.google.com/apikey) (for summaries, chat, embeddings, and optional Gemini transcription)

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

## Architecture

```
BookMarkManager/
├── chrome-extension/                # Chrome Extension (Manifest v3)
│   ├── manifest.json
│   ├── background.js                # Scrapes YouTube DOM; POSTs to Flask API
│   ├── popup.html / popup.js        # Popup UI and logic
│   └── icons/
├── frontend/                        # React SPA (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoCard.jsx        # Video row with transcript/summary actions
│   │   │   ├── AddVideoModal.jsx    # Manual video add modal
│   │   │   ├── TranscriptModal.jsx  # Transcript viewer with embedded YouTube player
│   │   │   ├── ChatDrawer.jsx       # RAG-powered chat drawer (Gemini + vector search)
│   │   │   ├── Sidebar.jsx          # Left navigation (Videos, Brains, Settings)
│   │   │   ├── SettingsPage.jsx     # Unified settings (profile, model, provider, embeddings, API status)
│   │   │   └── BrainsPage.jsx       # AI Brains — curated knowledge bases with scoped chat
│   │   ├── services/
│   │   │   └── api.js               # API service layer (fetch + SSE streaming)
│   │   ├── utils/
│   │   │   └── chatUtils.jsx        # Shared timestamp parsing + rendering for chat messages
│   │   └── App.jsx                  # Main app: sidebar layout, search, video list, polling
│   └── package.json
├── backend/                         # Flask API + SQLite + sqlite-vec
│   ├── app/
│   │   ├── __init__.py              # Serves SPA from /app/static
│   │   ├── routes.py                # API endpoints
│   │   ├── models.py                # SQLite models (Video, Transcript, Job, Setting, Brain)
│   │   ├── database.py              # DB connection + schema + sqlite-vec extension
│   │   ├── gemini_service.py        # Gemini integration (summaries + RAG chat)
│   │   ├── embedding_service.py     # Gemini embeddings + sqlite-vec vector search
│   │   ├── brain_service.py         # Brain-scoped RAG search, chat, auto-assign
│   │   ├── transcription_service.py # yt-dlp + AssemblyAI/Gemini transcription
│   │   ├── bookmarks.py             # Chrome bookmarks parser
│   │   └── transcripts.py           # Transcript search + status helpers
│   ├── run.py
│   └── requirements.txt
├── sql/                             # Schema and query references
├── .env.example
├── Dockerfile                       # Multi-stage: build frontend + install ffmpeg + run backend
└── docker-compose.yaml              # Single service, port 5000
```

**Stack:** React, Vite, Flask, SQLite, sqlite-vec, Gunicorn, yt-dlp, AssemblyAI, Google Gemini, Docker

### How It Works

- **Frontend** is built at Docker image build time and served as static files by Flask
- **Backend** exposes a REST API under `/api/*` and serves the SPA for all other routes
- **Transcription** runs in a background thread: yt-dlp downloads audio, AssemblyAI or Gemini transcribes it with `[M:SS]` timestamps, and the frontend polls for status updates. Transcripts are auto-embedded for vector search after completion.
- **Embeddings** use Gemini's `gemini-embedding-001` model (768-dim) to embed transcript chunks into a sqlite-vec virtual table for KNN similarity search
- **Semantic search** embeds the query via Gemini, runs KNN against the vector store, and returns the best-matching transcript chunks grouped by video
- **AI Brains** let you group videos into curated knowledge bases with brain-scoped RAG chat. Videos are auto-assigned to matching brains after transcription (>0.85 cosine similarity).
- **Summarization** reads transcripts from the DB, sends them to Gemini with a structured or narrative prompt, and stores the result
- **Chat (RAG)** retrieves the top-k matching transcript chunks via vector search (falls back to summaries), passes them as context to Gemini, and streams the response via SSE
- **Data** is persisted in a SQLite database on a Docker volume (`backend/data/`)

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/videos` | List videos (paginated) |
| `POST` | `/api/videos` | Add a video |
| `GET` | `/api/videos/<id>` | Get a video |
| `DELETE` | `/api/videos/<id>` | Delete a video |
| `POST` | `/api/transcribe/<id>` | Start transcription job |
| `GET` | `/api/jobs/<job_id>` | Poll job status |
| `GET` | `/api/jobs/video/<video_id>` | Get active job for a video |
| `GET` | `/api/transcripts/<id>` | Get transcript text |
| `DELETE` | `/api/transcripts/<id>` | Delete transcript (cascades to embeddings + summary) |
| `GET` | `/api/transcripts/<id>/status` | Check transcript status |
| `GET` | `/api/transcripts/search?q=` | Search transcripts (text) |
| `POST` | `/api/summaries/<id>` | Generate summary via Gemini |
| `GET` | `/api/summaries/<id>` | Get stored summary |
| `POST` | `/api/summaries/bulk` | Summarize all un-summarized transcripts |
| `POST` | `/api/chat` | Stream chat response (SSE, RAG) |
| `GET` | `/api/search?q=` | Semantic vector search |
| `POST` | `/api/embeddings/build` | Embed all unembedded transcripts |
| `POST` | `/api/embeddings/rebuild` | Clear and re-embed all transcripts |
| `GET` | `/api/embeddings/status` | Get embedding statistics |
| `GET` | `/api/brains` | List all brains |
| `POST` | `/api/brains` | Create a brain |
| `GET` | `/api/brains/<id>` | Get brain with videos |
| `PUT` | `/api/brains/<id>` | Update brain name/description |
| `DELETE` | `/api/brains/<id>` | Delete a brain |
| `POST` | `/api/brains/<id>/videos` | Add a video to a brain |
| `DELETE` | `/api/brains/<id>/videos/<vid>` | Remove a video from a brain |
| `POST` | `/api/brains/<id>/videos/bulk` | Bulk add videos to a brain |
| `POST` | `/api/brains/<id>/chat` | Brain-scoped chat (SSE, RAG) |
| `GET` | `/api/brains/suggest/<vid>` | Suggest brains for a video |
| `GET` | `/api/settings` | Get app settings + API key status |
| `PUT` | `/api/settings` | Update settings |
| `GET` | `/api/stats` | Get collection statistics |
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
| provider | TEXT | Transcription provider (assemblyai or gemini) |
| indexed_at | TEXT | Indexing timestamp |

### transcript_chunks

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| video_id | TEXT | Foreign key to videos |
| chunk_index | INTEGER | Chunk position within transcript |
| content | TEXT | Chunk text (~2000 chars) |

### vec_chunks (sqlite-vec virtual table)

| Column | Type | Description |
|--------|------|-------------|
| chunk_id | INTEGER | References transcript_chunks.id |
| embedding | float[768] | 768-dim Gemini embedding vector |

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

### settings

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Primary key (setting name) |
| value | TEXT | Setting value |
| updated_at | TEXT | Last update timestamp |

### brains

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| name | TEXT | Brain name (max 100 chars) |
| description | TEXT | Optional description (max 500 chars) |
| created_at | TEXT | Creation timestamp |
| updated_at | TEXT | Last update timestamp |

### brain_videos

| Column | Type | Description |
|--------|------|-------------|
| brain_id | TEXT | Foreign key to brains (composite PK) |
| video_id | TEXT | Foreign key to videos (composite PK) |
| added_at | TEXT | When video was added to brain |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ASSEMBLYAI_API_KEY` | For transcription | Your AssemblyAI API key |
| `GOOGLE_API_KEY` | For summaries, chat, embeddings | Your Google AI API key |
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

## License

MIT
