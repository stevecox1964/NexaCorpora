# BookMarkManager Project

## Overview
A single page application for managing YouTube video bookmarks with a Python Flask backend. The app runs as a single Docker container: Flask serves both the API and the built React frontend.

The repo also includes a Chrome extension (`chrome-extension/`) that scrapes YouTube video metadata and saves it directly to the Docker API — no local Downloads or Chrome storage used.

## Architecture

```
BookMarkManager/
├── chrome-extension/         # Chrome Extension (Manifest v3)
│   ├── background.js         # Scrapes YouTube DOM; POSTs to Flask API
│   ├── popup.html/js         # Popup: toolbar + video strip + iframe to localhost:5000
│   └── manifest.json
├── frontend/                 # React SPA (built and copied into container)
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoCard.jsx        # Video row: thumbnail, info, transcript/summary status, actions
│   │   │   ├── AddVideoModal.jsx    # Modal for manually adding videos
│   │   │   ├── TranscriptModal.jsx  # Modal with embedded YouTube player + clickable timestamps
│   │   │   ├── ChatDrawer.jsx       # Bottom drawer chat component (Gemini-powered, SSE streaming)
│   │   │   ├── ProcessModal.jsx     # Real-time progress modal for Process/Refresh pipeline
│   │   │   ├── Sidebar.jsx          # Left navigation sidebar (Videos, Brains, Settings)
│   │   │   ├── SettingsPage.jsx     # Settings: profile, model config, transcription provider, embeddings
│   │   │   └── BrainsPage.jsx       # AI Brains — curated knowledge bases with scoped chat
│   │   ├── services/api.js          # All fetch calls + SSE streaming
│   │   ├── utils/chatUtils.jsx      # Shared timestamp parsing/rendering for chat messages
│   │   ├── utils/saveToFile.js      # Browser download utility (Blob + createObjectURL)
│   │   └── App.jsx                  # Main app: sidebar layout, page switching, video list, transcription polling
├── backend/
│   ├── app/
│   │   ├── routes.py                # All API endpoints
│   │   ├── models.py                # SQLite models (Video, Transcript, Job, Setting, Brain)
│   │   ├── database.py              # DB connection + schema init + migrations + sqlite-vec
│   │   ├── transcription_service.py # yt-dlp download + AssemblyAI/Gemini transcription + auto-embed
│   │   ├── gemini_service.py        # Gemini: summaries + RAG chat streaming
│   │   ├── embedding_service.py     # Gemini embeddings: chunking, embedding, vector search
│   │   └── brain_service.py         # Brain-scoped RAG search, chat, auto-assign
│   ├── mcp_server.py                # MCP server — 15 tools via SSE on port 8001
│   └── requirements.txt
├── .mcp.json                 # MCP server config for Claude Code integration
├── Dockerfile                # Multi-stage: build frontend + install ffmpeg + run backend + MCP
├── entrypoint.sh             # Starts gunicorn (Flask) and MCP server in one container
├── docker-compose.yaml       # Single service on ports 5000 (Flask) + 8001 (MCP)
└── CLAUDE.md
```

## Key Data Flows

**Save video**: Chrome extension → `POST /api/videos` → SQLite → auto-assign to brain by channel

**Process pipeline**: "Process" button → `POST /api/transcribe/<id>` → background thread: yt-dlp download → AssemblyAI/Gemini transcription → summary → FAQ → auto-embed → auto-assign brains. Frontend polls `GET /api/jobs/<id>` every 4s via ProcessModal.

**Chat (RAG)**: `POST /api/chat` → embed query → KNN over `vec_chunks` (sqlite-vec) → top 8 chunks → Gemini SSE stream. Falls back to summaries if no embeddings.

**Embeddings**: After transcription, chunks transcript (~2000-char overlapping), embeds via `gemini-embedding-001` (768-dim), stores in `transcript_chunks` + `vec_chunks` (sqlite-vec virtual table).

**AI Brains**: Brain-scoped KNN search (post-filter by brain's video IDs). Auto-assign: channel-based (≥50% channel share) on video add; embedding-based (cosine >0.90) after transcription.

## API Endpoints Summary

See `backend/app/routes.py` for full details. Key groups:
- Videos: `GET/POST /api/videos`, `GET/DELETE /api/videos/<id>`
- Transcripts: `GET/DELETE /api/transcripts/<id>`, `POST /api/transcribe/<id>`
- Summary/FAQ: `GET/POST/DELETE /api/summaries/<id>`, `GET /api/faq/<id>`, `POST /api/refresh/<id>`
- Chat: `POST /api/chat` (SSE), `POST /api/brains/<id>/chat` (SSE)
- Jobs: `GET /api/jobs/<id>`, `GET /api/jobs/video/<id>`
- Embeddings: `POST /api/embeddings/build`, `POST /api/embeddings/rebuild`, `GET /api/embeddings/status`
- Search: `GET /api/search?q=` (semantic), `GET /api/transcripts/search?q=` (LIKE)
- Brains: `GET/POST /api/brains`, `GET/PUT/DELETE /api/brains/<id>`, `POST /api/brains/<id>/videos`
- Settings: `GET/PUT /api/settings`, `GET /api/stats`

## Database Tables

- **videos**: id, video_id (unique), video_title, channel_id, channel_name, channel_url, video_url, scraped_at, created_at
- **transcripts**: id, video_id, content, summary, faq, provider (assemblyai|gemini), indexed_at
- **jobs**: id (UUID), video_id, job_type, status (pending→downloading→transcribing→summarizing→completed|failed), error_message, created_at, completed_at
- **settings**: key, value, updated_at — defaults: `transcription_provider=assemblyai`, `gemini_model=gemini-2.5-flash`, `profile_name`, `profile_subtitle`
- **transcript_chunks**: id, video_id, chunk_index, content (~2000 chars)
- **vec_chunks**: chunk_id, embedding float[768] — KNN: `WHERE embedding MATCH ? AND k = ?`
- **brains**: id (UUID), name, description, created_at, updated_at
- **brain_videos**: brain_id, video_id, added_at

## Running the Application

### Production (Docker)
```bash
cp .env.example .env  # add API keys
docker compose up --build
```
- App: **http://localhost:5000**, MCP: **http://localhost:8001/sse**

### Development (separate)
- Backend: `cd backend && python run.py` → API at `http://localhost:5000`
- Frontend: `cd frontend && npm run dev` → UI at `http://localhost:5173` (Vite proxies `/api`)

### Chrome Extension
1. `docker compose up --build`
2. Chrome → `chrome://extensions/` → Developer mode → Load unpacked → `chrome-extension/`

### Docker Rebuild
```bash
docker compose up -d --build           # normal rebuild
docker compose down && docker compose build --no-cache && docker compose up -d  # full rebuild
docker compose logs -f app             # view logs
```

## Environment Variables

```bash
ASSEMBLYAI_API_KEY=...   # Required for AssemblyAI transcription
GOOGLE_API_KEY=...       # Required for Gemini chat + summaries + embeddings
GEMINI_MODEL=gemini-2.5-flash  # Optional (options: gemini-2.5-flash, gemini-3-flash-preview, gemini-2.5-flash-lite)
```

## MCP Server

`backend/mcp_server.py` — standalone, no Flask dependency. Direct `sqlite3` + `sqlite_vec.load()`. Transcription proxies to Flask API (`http://localhost:5000`).

**15 tools**: `list_videos`, `get_video`, `add_video`, `delete_video`, `transcribe_video`, `get_job_status`, `get_transcript`, `get_summary`, `search_videos`, `search_transcripts_text`, `list_brains`, `get_brain`, `create_brain`, `add_video_to_brain`, `get_stats`

**Connect from Claude Desktop**:
```json
{ "mcpServers": { "bookmarkmanager": { "url": "http://localhost:8001/sse" } } }
```

## Development Notes

### UI Layout
- CSS Grid: `240px sidebar + 1fr main`. Sidebar **must** use `position: sticky` (not `fixed`) — fixed removes it from grid flow.
- Mobile ≤900px: grid collapses to `1fr`, sidebar slides in/out with hamburger toggle.
- Dark theme: `#0f0f0f` bg, `#1a1a1a` cards, `#3ea6ff` accent blue. All styles in `index.css`.
- 6-column video row: Thumbnail (160x90) | Info | Summary | FAQ | Transcript | Actions
- No router library — `activePage` state switches between `'videos'`, `'brains'`, `'settings'`.

### Transcription
- No Celery/Redis — Python `threading.Thread` (sufficient for single-user).
- **AssemblyAI**: blocking `transcriber.transcribe()` + `get_sentences()` → `[M:SS] text` timestamps.
- **Gemini Audio**: `client.files.upload()` + `generate_content()` → same `[M:SS]` format.
- Lazy import: `from google import genai` inside `transcribe_audio_gemini()` only.
- yt-dlp downloads audio-only MP3 to temp dir; ffmpeg required (in Docker image).

### Gemini SDK
- **google-genai** (new SDK, replaces deprecated `google-generativeai`).
- Client pattern: `genai.Client(api_key=...)` — no global `configure()`.
- Embeddings: `gemini-embedding-001`, 768-dim, `EmbedContentConfig(output_dimensionality=768)`.
- SSE: `client.models.generate_content_stream()` + Flask `stream_with_context` + `text/event-stream`.
- Gunicorn: `--workers 2 --threads 4 --timeout 120` (gthread worker for SSE).

### Brains Auto-Assign
- **Channel-based** (on add): best-fit brain where channel ≥50% of content.
- **Embedding-based** (post-transcription): cosine similarity >0.90 vs brain's mean embedding.
- KNN post-filter: sqlite-vec can't filter during KNN, so filter by brain's video IDs after.

### Misc
- YouTube thumbnail: `https://img.youtube.com/vi/{videoId}/mqdefault.jpg` (320x180)
- Chrome bookmarks: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks`
- `.btn-icon` class + inline SVGs for icon buttons (no icon library).
- `saveToFile.js`: Blob + `createObjectURL` → `{type}_{datetime}.txt` naming.

## Future Tasks

- [ ] Bulk "Process All" button with progress tracking
- [ ] Search filters: by channel, date range, has transcript
- [ ] Search result highlighting within transcript chunks
