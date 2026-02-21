# BookMarkManager Project

## Overview
A single page application for managing YouTube video bookmarks with a Python Flask backend. The app runs as a single Docker container: Flask serves both the API and the built React frontend.

The repo also includes a Chrome extension (`chrome-extension/`) that scrapes YouTube video metadata and saves it directly to the Docker API — no local Downloads or Chrome storage used.

## Data Flow

### Saving Videos
```
User on YouTube
     ↓ (click "Save Current Video Info" in extension popup)
chrome-extension/background.js
  [scrapes video metadata from YouTube DOM]
     ↓ POST http://localhost:5000/api/videos
backend/app/routes.py → models.py → SQLite (Docker volume: backend/data/)
     ↓
BookMarkManager React UI at http://localhost:5000
  [video appears in the list]
```

### Transcription Flow
```
User clicks "Transcribe" button on a video row
     ↓ POST /api/transcribe/<video_id>
routes.py → transcription_service.py
  [reads provider from settings table, creates job record, launches background thread]
     ↓ returns { jobId, status: "pending" } immediately
Frontend polls GET /api/jobs/<job_id> every 4 seconds
     ↓
Background thread:
  1. yt-dlp downloads audio-only (MP3) to temp dir
  2. Provider-specific transcription:
     - AssemblyAI: SDK uploads audio + transcribes (blocking call)
     - Gemini Audio: uploads via genai.upload_file() + generate_content() for transcription
  3. Stores transcript text in SQLite transcripts table
  4. Updates job status → "completed"
  5. Cleans up temp files
     ↓
Frontend sees "completed" → shows green "View" button
User clicks "View" → TranscriptModal fetches GET /api/transcripts/<video_id>
```

### Summarization Flow
```
User clicks "Summarize" button on a video row (or "Summarize All" in header)
     ↓ POST /api/summaries/<video_id>
routes.py → gemini_service.py
  [reads transcript from DB, sends to Gemini]
     ↓
Gemini generates 2-4 paragraph summary
     ↓
Summary stored in transcripts.summary column
     ↓
Frontend shows expandable summary inline on the video row
```

### Chat Flow
```
User opens chat drawer (blue FAB button, bottom-right)
     ↓ types question, hits Send
Frontend POST /api/chat { message, history }
     ↓
routes.py → gemini_service.py
  1. Searches transcripts with LIKE query for relevant context
  2. Falls back to all summaries if no keyword matches
  3. Builds system prompt with context
  4. Streams response from Gemini via SSE
     ↓
Frontend reads SSE stream, displays tokens in real-time
Conversation history maintained in React state (resets on reload)
```

## Architecture

```
BookMarkManager/
├── chrome-extension/         # Chrome Extension (Manifest v3)
│   ├── manifest.json         # Permissions: activeTab, scripting, tabs + localhost:5000
│   ├── background.js         # Scrapes YouTube DOM; POSTs to Flask API
│   ├── popup.html            # Popup: toolbar + video strip + iframe to localhost:5000
│   ├── popup.js              # Popup logic: save video, API status check
│   ├── resize.js             # Dynamic window sizing for popup
│   └── icons/                # 16/48/128px icons
├── frontend/                 # React SPA (built and copied into container)
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoCard.jsx        # Video row: thumbnail, info, transcript/summary status, actions
│   │   │   ├── AddVideoModal.jsx    # Modal for manually adding videos
│   │   │   ├── TranscriptModal.jsx  # Modal for viewing transcript text
│   │   │   ├── ChatDrawer.jsx       # Bottom drawer chat component (Gemini-powered)
│   │   │   ├── Sidebar.jsx          # Left navigation sidebar (Videos, Settings, Profile)
│   │   │   ├── SettingsPage.jsx     # Settings page (transcription provider, Gemini model, API status)
│   │   │   └── ProfilePage.jsx      # Profile page (collection statistics)
│   │   ├── services/
│   │   │   └── api.js               # API service layer (all fetch calls + SSE streaming)
│   │   └── App.jsx                  # Main app: sidebar layout, page switching, video list, transcription polling
│   └── package.json
├── backend/                  # Python Flask API
│   ├── app/
│   │   ├── __init__.py              # Serves SPA from /app/static when present
│   │   ├── routes.py                # API endpoints (videos, transcripts, jobs, chat, summaries, settings, stats)
│   │   ├── models.py                # SQLite models (Video, Transcript, Job, Setting)
│   │   ├── database.py              # DB connection + schema init + migrations + settings table
│   │   ├── bookmarks.py             # Chrome bookmarks parser
│   │   ├── transcripts.py           # Transcript search + status helpers
│   │   ├── transcription_service.py # yt-dlp download + AssemblyAI/Gemini transcription + background jobs
│   │   └── gemini_service.py        # Google Gemini integration (summaries + chat streaming)
│   ├── run.py
│   └── requirements.txt
├── utils/                    # Utility scripts
│   └── import_json_to_db.py  # JSON file importer
├── sql/                      # SQL scripts
│   ├── schema.sql            # Database schema
│   └── queries.sql           # Common SQL queries
├── .env.example              # Template for environment variables
├── Dockerfile                # Multi-stage: build frontend + install ffmpeg + run backend
├── docker-compose.yaml       # Single service on port 5000
└── CLAUDE.md
```

## API Endpoints

### Video Endpoints

#### GET /api/videos
Returns paginated list of YouTube video bookmarks (latest to oldest).
Each video includes `hasTranscript` (boolean), `hasSummary` (boolean), and `transcriptJobStatus` (string or null) fields via LEFT JOINs.
- Query params: `page` (default: 1), `per_page` (default: 20, max: 100)
- Response:
```json
{
  "success": true,
  "videos": [
    {
      "id": 1,
      "videoId": "dQw4w9WgXcQ",
      "videoTitle": "...",
      "channelName": "...",
      "hasTranscript": true,
      "hasSummary": true,
      "transcriptJobStatus": null
    }
  ],
  "pagination": { "page": 1, "per_page": 20, "total": 150, "total_pages": 8, "has_prev": false, "has_next": true }
}
```

#### POST /api/videos
Add a new video bookmark.
- Body: `{ "videoId", "videoTitle", "channelId?", "channelName?", "channelUrl?", "videoUrl?", "scrapedAt?" }`

#### GET /api/videos/<video_id>
Get a single video by videoId.

#### DELETE /api/videos/<video_id>
Delete a video bookmark by videoId.

### Transcript Endpoints

#### GET /api/transcripts/<video_id>
Get transcript content for a video.
- Response: `{ "success": true, "transcript": { "videoId", "content", "summary", "indexedAt" } }`

#### GET /api/transcripts/<video_id>/status
Check if a video has a transcript.
- Response: `{ "videoId", "indexed": true/false, "indexedAt" }`

#### GET /api/transcripts/search
Search indexed transcripts (basic LIKE search).
- Query params: `q` (search query)

### Transcription Endpoints

#### POST /api/transcribe/<video_id>
Start a background transcription job. Uses the provider configured in the settings table (AssemblyAI or Gemini).
- Returns immediately: `{ "success": true, "job": { "id", "status": "pending" } }`
- Errors: 404 (video not found), 409 (transcript exists or job already running), 500 (API key not configured)

### Summary Endpoints

#### POST /api/summaries/<video_id>
Generate a summary for a video's transcript using Gemini.
- Reads existing transcript from DB, sends to Gemini, stores result in `transcripts.summary` column.
- Response: `{ "success": true, "transcript": { "videoId", "content", "summary", "indexedAt" } }`

#### GET /api/summaries/<video_id>
Get the stored summary for a video.
- Response: `{ "success": true, "summary": "...", "videoId": "..." }`

#### POST /api/summaries/bulk
Generate summaries for all transcripts that don't have one yet.
- Response: `{ "success": true, "generated": 5, "errors": [], "total": 5 }`

### Chat Endpoints

#### POST /api/chat
Stream a chat response using Gemini with transcript context (SSE).
- Body: `{ "message": "...", "history": [{ "role": "user"|"assistant", "content": "..." }] }`
- Response: `text/event-stream` with `data: {"text": "..."}` chunks, ending with `data: {"done": true}`
- Context: searches transcripts via LIKE query, falls back to summaries if no matches

### Job Endpoints

#### GET /api/jobs/<job_id>
Poll job status by ID.
- Response: `{ "success": true, "job": { "id", "videoId", "status", "errorMessage", "createdAt", "completedAt" } }`
- Job statuses: `pending` → `downloading` → `transcribing` → `completed` | `failed`

#### GET /api/jobs/video/<video_id>
Get the active (non-completed, non-failed) transcription job for a video.

### Chrome Bookmarks Endpoints

#### GET /api/bookmarks/chrome
Query Chrome browser bookmarks for YouTube links.

#### POST /api/bookmarks/chrome/import
Import YouTube bookmarks from Chrome into the database.

### Settings Endpoints

#### GET /api/settings
Get all application settings and API key configuration status.
- Response: `{ "success": true, "settings": { "transcription_provider": "assemblyai", "gemini_model": "gemini-2.5-flash" }, "apiKeys": { "assemblyai": true, "google": true } }`

#### PUT /api/settings
Update application settings.
- Body: `{ "transcription_provider": "gemini", "gemini_model": "gemini-2.5-flash" }` (any subset of keys)
- Allowed keys: `transcription_provider` (assemblyai|gemini), `gemini_model` (gemini-2.5-flash|gemini-3-flash-preview|gemini-2.5-flash-lite)
- Response: `{ "success": true, "settings": { ... } }`

### Stats Endpoint

#### GET /api/stats
Get application statistics.
- Response: `{ "success": true, "totalVideos": 150, "totalTranscripts": 42, "totalSummaries": 30 }`

## Database Schema

### videos table
| Column            | Type     | Description                    |
|-------------------|----------|--------------------------------|
| id                | INTEGER  | Primary key, auto-increment    |
| channel_id        | TEXT     | YouTube channel ID             |
| channel_id_source | TEXT     | Source of channel ID           |
| channel_name      | TEXT     | Channel display name           |
| channel_url       | TEXT     | Channel URL                    |
| scraped_at        | TEXT     | ISO8601 timestamp              |
| video_id          | TEXT     | YouTube video ID (unique)      |
| video_title       | TEXT     | Video title                    |
| video_url         | TEXT     | Full video URL                 |
| created_at        | TEXT     | Record creation timestamp      |

### transcripts table
| Column          | Type     | Description                    |
|-----------------|----------|--------------------------------|
| id              | INTEGER  | Primary key                    |
| video_id        | TEXT     | Foreign key to videos          |
| content         | TEXT     | Full transcript text           |
| summary         | TEXT     | Gemini-generated summary       |
| indexed_at      | TEXT     | Indexing timestamp             |

### jobs table
| Column          | Type     | Description                                           |
|-----------------|----------|-------------------------------------------------------|
| id              | TEXT     | Primary key (UUID)                                    |
| video_id        | TEXT     | Foreign key to videos                                 |
| job_type        | TEXT     | Job type (e.g., "transcribe")                         |
| status          | TEXT     | pending / downloading / transcribing / completed / failed |
| error_message   | TEXT     | Error details if failed                               |
| created_at      | TEXT     | Job creation timestamp                                |
| completed_at    | TEXT     | Job completion timestamp                              |

### settings table
| Column          | Type     | Description                                           |
|-----------------|----------|-------------------------------------------------------|
| key             | TEXT     | Primary key (setting name)                            |
| value           | TEXT     | Setting value                                         |
| updated_at      | TEXT     | Last update timestamp                                 |

Default settings seeded on init:
- `transcription_provider` → `'assemblyai'`
- `gemini_model` → from `GEMINI_MODEL` env var or `'gemini-2.5-flash'`

## Running the Application

### Production: Single container (recommended)
```bash
# Create .env with your API keys
cp .env.example .env
# Edit .env and add your keys

# From project root
docker compose up --build
```
- App (UI + API) is at **http://localhost:5000**
- One container builds the React app and serves it from Flask.

### Development: Frontend and backend separately
- **Backend (API):** Run Flask from `backend/` (e.g. `python run.py` or use a venv) → API at `http://localhost:5000`
- **Frontend:** `cd frontend && npm run dev` → UI at `http://localhost:5173` (Vite proxies `/api` to 5000)

### Chrome Extension
1. Start the Docker container first (`docker compose up --build`)
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the `chrome-extension/` folder
5. Navigate to a YouTube video → click the extension icon
6. The popup shows a toolbar (API status dot), the current video info with a **Save to BookMarkManager** button, and the full BookMarkManager React UI in an embedded iframe
7. Click Save → video appears in the iframe list immediately

**Popup layout**:
- **Toolbar**: Title + green/red API status dot
- **Video strip**: Current YouTube video title + channel + Save button
- **Main area**: Embedded iframe loading `http://localhost:5000` (the full BookMarkManager UI)
- If Docker is offline, shows an offline message instead of the iframe

**Permissions**: `activeTab`, `scripting`, `tabs` + host access to `youtube.com` and `localhost:5000`. No `storage`, `downloads`, or `notifications` used.

## Environment Variables

Required in `.env` file at project root (loaded by docker-compose):

```bash
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here   # Required for transcription
GOOGLE_API_KEY=your_google_api_key_here            # Required for chat + summaries
GEMINI_MODEL=gemini-2.5-flash                      # Optional, defaults to gemini-2.5-flash
```

Available Gemini model options:
- `gemini-2.5-flash` — stable, fast, good price/performance (recommended default)
- `gemini-3-flash-preview` — newest, frontier-class, still in preview
- `gemini-2.5-flash-lite` — cheapest, good for high volume

Set automatically in `docker-compose.yaml`:
```yaml
environment:
  - FLASK_ENV=production
  - PYTHONUNBUFFERED=1
  - ASSEMBLYAI_API_KEY=${ASSEMBLYAI_API_KEY}
  - GOOGLE_API_KEY=${GOOGLE_API_KEY}
  - GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}
```

## Task Checklist

### Completed
- [x] Create project structure and claude.md
- [x] Build React SPA with thumbnail grid display
- [x] Create Flask API with GET/POST endpoints
- [x] Set up SQLite database with models
- [x] Implement Chrome bookmarks parser
- [x] Configure Docker and docker-compose
- [x] Add error handling for Docker offline state
- [x] Implement bookmark management (add/delete)
- [x] Create JSON import utility for priming database
- [x] Add pagination to API and frontend
- [x] Convert UI from grid to list view with columns
- [x] Integrate Chrome extension — saves directly to Flask API (no local Downloads/chrome.storage)
- [x] Add `jobs` table for background job tracking
- [x] Add `Job` model with CRUD methods
- [x] Add `hasTranscript` and `transcriptJobStatus` flags to video list API response (LEFT JOIN)
- [x] Create `transcription_service.py` — yt-dlp audio download + AssemblyAI SDK transcription in background thread
- [x] Add transcription API endpoints (POST /api/transcribe, GET /api/jobs)
- [x] Single "Transcribe" button in UI with background polling (pending → downloading → transcribing → completed)
- [x] Transcript viewer modal (View button → fetches and displays transcript text, copy to clipboard)
- [x] Add ffmpeg to Docker image for yt-dlp audio extraction
- [x] Spinner/animation CSS for transcribing-in-progress state
- [x] Add `summary` column to transcripts table
- [x] Create `gemini_service.py` — Gemini integration for summaries and chat
- [x] Add summary API endpoints (POST/GET /api/summaries, POST /api/summaries/bulk)
- [x] Inline expandable summaries on video rows (Summarize / Summary toggle buttons)
- [x] "Summarize All" bulk button in header
- [x] Add `hasSummary` flag to video list API response (LEFT JOIN)
- [x] Chat drawer component (bottom-right FAB → expandable panel)
- [x] SSE streaming chat endpoint (POST /api/chat) with Gemini
- [x] Knowledge base context: LIKE search for relevant transcripts, fallback to summaries
- [x] Conversation history maintained in React state
- [x] Configurable Gemini model via GEMINI_MODEL env var
- [x] Update gunicorn config for SSE threading support
- [x] Add sidebar navigation (Videos, Settings, Profile pages)
- [x] Add `settings` table + `Setting` model for persistent app configuration
- [x] Add Gemini audio transcription as alternative provider (`transcribe_audio_gemini()`)
- [x] Settings page: transcription provider selector, Gemini model dropdown, API key status
- [x] Profile page with collection statistics (total videos, transcripts, summaries)
- [x] Settings/stats API endpoints (GET/PUT /api/settings, GET /api/stats)

### Future Tasks

#### Search & Indexing
- [ ] Implement full-text search (FTS5) across transcripts
- [ ] Add search bar in header
- [ ] Add search results view with highlighting
- [ ] Add filters: by channel, date range, has transcript

#### RAG & Embeddings
- [ ] Generate embeddings for transcripts
- [ ] Store embeddings (ChromaDB, Pinecone, or SQLite-VSS)
- [ ] Implement semantic search endpoint
- [ ] Create RAG query endpoint: `POST /api/rag/query`

#### Bulk Operations
- [ ] Bulk "Transcribe All" button
- [ ] Progress tracking for bulk operations

## Development Notes

### Current UI Layout
Sidebar (240px) + main content area using CSS Grid (`grid-template-columns: 240px 1fr`).

**Sidebar** (`position: sticky`, not `fixed` — must stay in grid flow to avoid overlapping main content):
- Always visible on desktop, hidden on mobile ≤900px (hamburger toggle)
- Top: App brand/title with video icon
- Middle: Videos nav item
- Bottom (pinned via `margin-top: auto`): Settings, Profile
- Active item highlighted with blue text + right border accent

**Videos Page** — List view with 4 columns:
| Thumbnail (160x90) | Video Info | Transcript | Actions |

- **Thumbnail**: 160x90px, links to YouTube
- **Video Info**: Title, Channel name, Saved date
- **Transcript**: Status indicator + action
  - Green "View" button (clickable) → opens TranscriptModal
  - "Summary" / "Hide" toggle button (when summary exists) → expands inline summary
  - "Summarize" button (when transcript exists but no summary) → generates via Gemini
  - Yellow spinner + "Downloading..." / "Transcribing..." (during active job)
  - Gray "None" + "Transcribe" button (no transcript yet)
- **Actions**: Remove button

**Settings Page**:
- Transcription provider selector (AssemblyAI / Gemini Audio cards)
- Gemini model dropdown
- API key status indicators (green/red dots)

**Profile Page**:
- User avatar placeholder
- Collection statistics cards (Videos, Transcripts, Summaries)

**Chat Drawer**: Blue FAB (bottom-right) → expands to 420x500px chat panel with streaming responses

### Transcription Architecture
- **No Celery/Redis** — uses Python `threading.Thread` for background jobs (sufficient for single-user Docker app)
- **Provider selection** — reads `transcription_provider` from `settings` table (default: `assemblyai`), configurable via Settings page
- **AssemblyAI SDK** (`assemblyai==0.17.0`) — `transcriber.transcribe()` is a blocking call that handles upload + polling internally
- **Gemini Audio** — uses `google.generativeai` SDK: `genai.upload_file()` uploads audio to Gemini Files API, then `model.generate_content()` with transcription prompt
- **Lazy imports** — `import google.generativeai as genai` is done inside `transcribe_audio_gemini()` (not at module top-level) to avoid FutureWarning deprecation messages on every gunicorn worker startup
- **yt-dlp** — downloads audio-only (MP3, 192kbps) to temp directory, cleaned up after transcription (shared by both providers)
- **ffmpeg** — installed in Docker image, required by yt-dlp for audio extraction
- **Job status polling** — frontend polls `GET /api/jobs/<id>` every 4 seconds via `setInterval`, cleaned up on component unmount

### Gemini Integration
- **google-generativeai** Python SDK (`>=0.8.0`)
- **Model**: configurable via `GEMINI_MODEL` env var, defaults to `gemini-2.5-flash`
- **Summaries**: reads transcript from DB → sends to Gemini with summarization prompt → stores result in `transcripts.summary` column
- **Chat**: searches transcripts via LIKE query for context → falls back to all summaries → streams response via SSE (`text/event-stream`)
- **System instruction**: passed when constructing `GenerativeModel` instance (not in `generate_content()`)
- **SSE streaming**: Flask `Response` with `stream_with_context` + `text/event-stream` mimetype; frontend reads via `ReadableStream`
- **Gunicorn**: `--workers 2 --threads 4 --timeout 120` (gthread worker for SSE support)

### YouTube Thumbnail URL Pattern
```
https://img.youtube.com/vi/{videoId}/mqdefault.jpg
```
- `mqdefault.jpg` = 320x180
- `hqdefault.jpg` = 480x360
- `maxresdefault.jpg` = 1280x720

### Chrome Bookmarks Location (Windows)
```
%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks
```

### Page Navigation
- **No router library** — uses React state (`activePage`) to switch between pages
- `App.jsx` renders `<Sidebar>` + `<main>` in a CSS Grid; sidebar calls `setActivePage` on click
- Pages: `'videos'` (default), `'settings'`, `'profile'` — conditional rendering in `<main>`
- Videos data stays in state when switching pages (no re-fetch on return)
- Settings and Profile pages each fetch their own data on mount via `useEffect`

### CSS Architecture Notes
- **Sidebar must use `position: sticky`** (not `position: fixed`) — fixed positioning removes the element from CSS Grid flow, causing it to overlap the main content area
- Grid layout: `.app-layout` uses `grid-template-columns: 240px 1fr`
- Mobile (≤900px): Grid collapses to `1fr`, sidebar slides in/out with transform + hamburger toggle
- Dark theme throughout: `#0f0f0f` background, `#1a1a1a` cards, `#3ea6ff` accent blue

### Error Handling
- Frontend gracefully handles Docker being offline
- Transcription failures update job status to "failed" with error message, shown in error banner
- Background threads use Flask app context for database access
- Chat errors shown inline in the chat drawer
- Missing `GOOGLE_API_KEY` returns clear error messages from summary/chat endpoints

## Utility Scripts

### JSON Import Utility (`utils/import_json_to_db.py`)

Imports YouTube video JSON files from a directory structure into the SQLite database.

#### Expected Directory Structure
```
source_directory/
├── UCvBy3qcISSOcrbqPhqmG4Xw/     # Channel ID folder
│   ├── video_title_videoId.json
│   └── ...
├── @channelHandle/               # Channel handle folder
│   └── ...
```

#### JSON File Format
```json
{
  "channelId": "UCvBy3qcISSOcrbqPhqmG4Xw",
  "channelIdSource": "fetched_from_handle",
  "channelName": "Damon Cassidy",
  "channelUrl": "https://www.youtube.com/channel/UCvBy3qcISSOcrbqPhqmG4Xw",
  "scrapedAt": "2025-12-10T16:38:41.404Z",
  "videoId": "BTewrsVrZwM",
  "videoTitle": "(104) Companies Are Making Billions Off FAKE Layoffs",
  "videoUrl": "https://www.youtube.com/watch?v=BTewrsVrZwM"
}
```

#### Usage
```bash
# Test mode - shows what would happen without modifying database
python utils/import_json_to_db.py --test

# Import mode - actually imports data
python utils/import_json_to_db.py --import

# Custom source directory
python utils/import_json_to_db.py --test --source /path/to/json/files

# Custom database path
python utils/import_json_to_db.py --import --db /path/to/bookmarks.db
```

#### Default Paths
- Source: `C:\Users\user\Downloads\you_tube_summaries`
- Database: `backend/data/bookmarks.db`

## Docker Rebuild Commands

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
