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
     ↓ auto_assign_by_channel() checks if any brain has videos from same channel → assigns
     ↓
BookMarkManager React UI at http://localhost:5000
  [video appears in the list, with brain badge if auto-assigned]
```

### Processing Flow (Transcribe + Summarize + FAQ)
```
User clicks "Process" button on a video row
     ↓ POST /api/transcribe/<video_id>
routes.py → transcription_service.py
  [reads provider from settings table, creates job record, launches background thread]
     ↓ returns { jobId, status: "pending" } immediately
Frontend polls GET /api/jobs/<job_id> every 4 seconds
     ↓
Background thread:
  1. yt-dlp downloads audio-only (MP3) to temp dir (status: downloading)
  2. Provider-specific transcription (status: transcribing):
     - AssemblyAI: SDK uploads audio + transcribes → get_sentences() for timestamps
     - Gemini Audio: uploads via genai.upload_file() + generate_content() with timestamp prompt
  3. Prepends video title + YouTube URL, stores transcript text + provider name
  4. Generates short 2-4 sentence narrative summary (status: summarizing)
  5. Generates FAQ (5-10 Q&A pairs) — stored in separate `faq` column
  6. Updates job status → "completed"
  7. Auto-embeds transcript chunks for vector search (non-fatal)
  8. Auto-assigns to matching brains (non-fatal)
  9. Cleans up temp files
     ↓
Frontend sees "completed" → all 3 columns populate:
  - Summary: "View"/"Hide" toggle (inline expand)
  - FAQ: "View"/"Hide" toggle (inline expand)
  - Transcript: "View" button → TranscriptModal with embedded YouTube player + clickable timestamps

Refresh: "Refresh" icon on processed video → POST /api/refresh/<video_id>
  [regenerates summary + FAQ without re-transcribing]

Delete transcript: trash icon on video row → DELETE /api/transcripts/<video_id>
  [deletes transcript + summary + FAQ + embeddings (cascade), Process button reappears]
```

### Chat Flow (RAG with Vector Search)
```
User opens chat drawer (blue FAB button, bottom-right)
     ↓ types question, hits Send
Frontend POST /api/chat { message, history }
     ↓
routes.py → gemini_service.py
  1. Embeds user message via gemini-embedding-001 (768-dim)
  2. KNN search on vec_chunks table via sqlite-vec → top 8 matching transcript chunks
  3. Falls back to all summaries if no embeddings exist
  4. Builds system prompt with retrieved context
  5. Streams response from Gemini via SSE
     ↓
Frontend reads SSE stream, displays tokens in real-time
Conversation history maintained in React state (resets on reload)
Save button exports full conversation to file (chat_{datetime}.txt)
```

### Embedding Flow
```
Transcript created (via transcription or import)
     ↓ (auto-triggered in transcription_service.py background thread)
embedding_service.py
  1. chunk_transcript() — splits text into ~2000-char overlapping chunks
  2. embed_texts() — calls Gemini gemini-embedding-001 (768-dim, batched)
  3. Stores chunks in transcript_chunks table
  4. Stores vectors in vec_chunks virtual table (sqlite-vec)
     ↓
Chunks immediately available for semantic search + chat RAG

Manual bulk: POST /api/embeddings/build → embeds all unembedded transcripts
```

### AI Brains Flow
```
User creates a "Brain" (curated knowledge base) on the Brains page
     ↓ POST /api/brains { name, description }
     ↓ adds videos via POST /api/brains/<brain_id>/videos or /videos/bulk
brain_service.py
  - Brain-scoped RAG: embeds query → KNN over vec_chunks → post-filters to brain's videos
  - Falls back to summaries from brain's videos if no embeddings exist
  - Chat streaming via SSE, same architecture as global chat
     ↓
Frontend Brains page: card grid → detail view with Videos + Chat tabs
Chat tab includes embedded YouTube player with clickable timestamps
Auto-assign: channel-based on video add + embedding-based after transcription (>0.85 similarity)
Summary UI: same Summarize/Summary/Re-summarize/Clear/Save controls as main Videos page
Bulk download: "Download All Content" button exports all transcripts + summaries as separate files
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
│   │   │   ├── Sidebar.jsx          # Left navigation sidebar (Videos, Brains, Settings)
│   │   │   ├── SettingsPage.jsx     # Unified settings page (profile, model config, transcription provider, embeddings, API status)
│   │   │   └── BrainsPage.jsx       # AI Brains — curated knowledge bases with scoped chat
│   │   ├── services/
│   │   │   └── api.js               # API service layer (all fetch calls + SSE streaming)
│   │   ├── utils/
│   │   │   ├── chatUtils.jsx        # Shared timestamp parsing + rendering for chat messages
│   │   │   └── saveToFile.js        # Browser download utility (Blob + createObjectURL)
│   │   └── App.jsx                  # Main app: sidebar layout, page switching, video list, transcription polling
│   └── package.json
├── backend/                  # Python Flask API
│   ├── app/
│   │   ├── __init__.py              # Serves SPA from /app/static when present
│   │   ├── routes.py                # API endpoints (videos, transcripts, jobs, chat, summaries, search, embeddings, brains, settings, stats)
│   │   ├── models.py                # SQLite models (Video, Transcript, Job, Setting, Brain)
│   │   ├── database.py              # DB connection + schema init + migrations + settings table + sqlite-vec
│   │   ├── bookmarks.py             # Chrome bookmarks parser
│   │   ├── transcripts.py           # Transcript search + status helpers
│   │   ├── transcription_service.py # yt-dlp download + AssemblyAI/Gemini transcription + auto-embed
│   │   ├── gemini_service.py        # Google Gemini integration (summaries + RAG chat streaming)
│   │   ├── embedding_service.py     # Gemini embeddings: chunking, embedding, vector search via sqlite-vec
│   │   └── brain_service.py         # Brain-scoped RAG search, chat, auto-assign via embedding similarity
│   ├── run.py
│   └── requirements.txt
├── utils/                    # Utility scripts (empty)
├── sql/                      # SQL scripts
│   ├── schema.sql            # Database schema
│   └── queries.sql           # Common SQL queries
├── .env.example              # Template for environment variables
├── Dockerfile                # Multi-stage: build frontend + install ffmpeg + run backend
├── docker-compose.yaml       # Single service on port 5000
└── CLAUDE.md
```

## API Endpoints

### Health Endpoint

#### GET /api/health
Simple health check to verify the server is running.
- Response: `{ "status": "ok", "message": "Server is running" }`

### Video Endpoints

#### GET /api/videos
Returns paginated list of YouTube video bookmarks (latest to oldest).
Each video includes `hasTranscript` (boolean), `hasSummary` (boolean), `hasFaq` (boolean), `transcriptProvider` (string or null), and `transcriptJobStatus` (string or null) fields via LEFT JOINs.
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
      "hasFaq": true,
      "transcriptProvider": "assemblyai",
      "transcriptJobStatus": null
    }
  ],
  "pagination": { "page": 1, "per_page": 20, "total": 150, "total_pages": 8, "has_prev": false, "has_next": true }
}
```

#### POST /api/videos
Add a new video bookmark. Auto-assigns to brains that contain videos from the same channel.
- Body: `{ "videoId", "videoTitle", "channelId?", "channelName?", "channelUrl?", "videoUrl?", "scrapedAt?" }`
- Response includes `assignedBrains` (list of brain names the video was auto-assigned to)

#### GET /api/videos/<video_id>
Get a single video by videoId.

#### DELETE /api/videos/<video_id>
Delete a video bookmark by videoId.

### Transcript Endpoints

#### GET /api/transcripts/<video_id>
Get transcript content for a video.
- Response: `{ "success": true, "transcript": { "videoId", "content", "summary", "provider", "indexedAt" } }`

#### DELETE /api/transcripts/<video_id>
Delete a transcript and its associated embeddings, chunks, and summary (cascade).
- Response: `{ "success": true, "message": "Transcript deleted for <video_id>" }`

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
Generate a short 2-4 sentence narrative summary for a video's transcript using Gemini. Overwrites existing summary.
- Response: `{ "success": true, "transcript": { "videoId", "content", "summary", "faq", "indexedAt" } }`

#### GET /api/summaries/<video_id>
Get the stored summary for a video.
- Response: `{ "success": true, "summary": "...", "videoId": "..." }`

#### DELETE /api/summaries/<video_id>
Clear both summary and FAQ for a video.
- Response: `{ "success": true, "message": "Summary cleared for <video_id>" }`

#### POST /api/summaries/bulk
Generate summaries and FAQs for all transcripts that don't have them yet.
- Response: `{ "success": true, "generated": 5, "errors": [], "total": 5 }`

#### GET /api/faq/<video_id>
Get the stored FAQ for a video.
- Response: `{ "success": true, "faq": "...", "videoId": "..." }`

#### POST /api/refresh/<video_id>
Regenerate both summary and FAQ without re-transcribing.
- Response: `{ "success": true, "transcript": { "videoId", "content", "summary", "faq", "indexedAt" } }`

### Chat Endpoints

#### POST /api/chat
Stream a chat response using Gemini with transcript context (SSE).
- Body: `{ "message": "...", "history": [{ "role": "user"|"assistant", "content": "..." }] }`
- Response: `text/event-stream` with `data: {"text": "..."}` chunks, ending with `data: {"done": true}`
- Context: vector similarity search over transcript chunks (sqlite-vec KNN), falls back to summaries if no embeddings exist

### Search Endpoints

#### GET /api/search
Semantic vector search across transcript chunks using Gemini embeddings + sqlite-vec.
- Query params: `q` (search query, required), `k` (max results, default: 20, max: 50)
- Response: `{ "success": true, "query": "...", "results": [{ "videoId", "videoTitle", "channelName", "matchingChunk", "distance" }] }`
- Results are grouped by video (best-matching chunk per video)

### Embedding Endpoints

#### POST /api/embeddings/build
Embed all transcripts that haven't been embedded yet. Chunks each transcript (~2000 chars with 200 char overlap), embeds via `gemini-embedding-001` (768-dim), stores in `transcript_chunks` + `vec_chunks` tables.
- Response: `{ "success": true, "embedded": 5, "errors": [], "total": 5 }`

#### POST /api/embeddings/rebuild
Clear all existing embeddings and re-embed every transcript from scratch. Useful after adding new videos or when embeddings need refreshing.
- Deletes all rows from `vec_chunks` and `transcript_chunks`, then re-embeds all transcripts.
- Response: `{ "success": true, "embedded": 5, "errors": [], "total": 5 }`

#### GET /api/embeddings/status
Get embedding statistics.
- Response: `{ "success": true, "totalTranscripts": 42, "embeddedVideos": 30, "unembeddedVideos": 12, "totalChunks": 450 }`

### Brain Endpoints

#### GET /api/brains
Get all brains with video counts and thumbnail video IDs.
- Response: `{ "success": true, "brains": [{ "id", "name", "description", "videoCount", "thumbnailVideoIds": [...] }] }`

#### POST /api/brains
Create a new brain.
- Body: `{ "name": "...", "description?": "..." }`
- Response: `{ "success": true, "brain": { ... } }`

#### GET /api/brains/<brain_id>
Get a brain with its videos.
- Response: `{ "success": true, "brain": { ...brain fields, "videos": [...], "thumbnailVideoIds": [...] } }`

#### PUT /api/brains/<brain_id>
Update brain name and/or description.
- Body: `{ "name?": "...", "description?": "..." }`

#### DELETE /api/brains/<brain_id>
Delete a brain and its video associations. Videos are not deleted.

#### POST /api/brains/<brain_id>/videos
Add a single video to a brain.
- Body: `{ "videoId": "..." }`

#### DELETE /api/brains/<brain_id>/videos/<video_id>
Remove a video from a brain.

#### POST /api/brains/<brain_id>/videos/bulk
Add multiple videos to a brain at once.
- Body: `{ "videoIds": ["...", "..."] }`

#### POST /api/brains/<brain_id>/chat
Stream a chat response scoped to a brain's knowledge base (SSE).
- Body: `{ "message": "...", "history": [...] }`
- Context: vector search post-filtered to brain's videos, falls back to brain's summaries

#### GET /api/brains/suggest/<video_id>
Get suggested brains for a video based on embedding similarity.
- Response: `{ "success": true, "suggestions": [{ "id", "name", "similarity" }] }`

### Job Endpoints

#### GET /api/jobs/<job_id>
Poll job status by ID.
- Response: `{ "success": true, "job": { "id", "videoId", "status", "errorMessage", "createdAt", "completedAt" } }`
- Job statuses: `pending` → `downloading` → `transcribing` → `summarizing` → `completed` | `failed`

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
- Allowed keys: `transcription_provider` (assemblyai|gemini), `gemini_model` (gemini-2.5-flash|gemini-3-flash-preview|gemini-2.5-flash-lite), `profile_name` (free text, max 100 chars), `profile_subtitle` (free text, max 100 chars)
- Response: `{ "success": true, "settings": { ... } }`

### Stats Endpoint

#### GET /api/stats
Get application statistics.
- Response: `{ "success": true, "totalVideos": 150, "totalTranscripts": 42, "totalSummaries": 30, "totalFaqs": 25 }`

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
| summary         | TEXT     | Short 2-4 sentence narrative summary |
| faq             | TEXT     | FAQ (5-10 Q&A pairs)           |
| provider        | TEXT     | Transcription provider used (assemblyai or gemini) |
| indexed_at      | TEXT     | Indexing timestamp             |

### jobs table
| Column          | Type     | Description                                           |
|-----------------|----------|-------------------------------------------------------|
| id              | TEXT     | Primary key (UUID)                                    |
| video_id        | TEXT     | Foreign key to videos                                 |
| job_type        | TEXT     | Job type (e.g., "transcribe")                         |
| status          | TEXT     | pending / downloading / transcribing / summarizing / completed / failed |
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
- `profile_name` → `'BookMarkManager User'`
- `profile_subtitle` → `'YouTube Bookmark Collection'`

### transcript_chunks table
| Column      | Type    | Description                            |
|-------------|---------|----------------------------------------|
| id          | INTEGER | Primary key, auto-increment            |
| video_id    | TEXT    | Foreign key to videos                  |
| chunk_index | INTEGER | Chunk position within the transcript   |
| content     | TEXT    | Chunk text (~2000 chars)               |

### vec_chunks virtual table (sqlite-vec)
| Column    | Type             | Description                          |
|-----------|------------------|--------------------------------------|
| chunk_id  | INTEGER          | Primary key, references transcript_chunks.id |
| embedding | float[768]       | 768-dim Gemini embedding vector      |

KNN query pattern: `WHERE embedding MATCH ? AND k = ?`

### brains table
| Column      | Type    | Description                           |
|-------------|---------|---------------------------------------|
| id          | TEXT    | Primary key (UUID)                    |
| name        | TEXT    | Brain name (max 100 chars)            |
| description | TEXT    | Optional description (max 500 chars)  |
| created_at  | TEXT    | Creation timestamp                    |
| updated_at  | TEXT    | Last update timestamp                 |

### brain_videos table
| Column    | Type    | Description                                    |
|-----------|---------|------------------------------------------------|
| brain_id  | TEXT    | Foreign key to brains (composite PK)           |
| video_id  | TEXT    | Foreign key to videos (composite PK)           |
| added_at  | TEXT    | When video was added to brain                  |

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
- [x] Add sidebar navigation (Videos, Settings)
- [x] Add `settings` table + `Setting` model for persistent app configuration
- [x] Add Gemini audio transcription as alternative provider (`transcribe_audio_gemini()`)
- [x] Settings page: transcription provider selector, Gemini model dropdown, API key status
- [x] Profile section merged into Settings page with editable name/subtitle and collection statistics
- [x] Profile name and subtitle stored in database settings table
- [x] Settings/stats API endpoints (GET/PUT /api/settings, GET /api/stats)
- [x] Add `sqlite-vec` for vector search
- [x] Create `embedding_service.py` — transcript chunking, Gemini embedding (768-dim), sqlite-vec KNN search
- [x] Create `transcript_chunks` + `vec_chunks` tables for vector storage
- [x] Auto-embed transcripts after transcription completes (in background thread)
- [x] Semantic search endpoint (`GET /api/search?q=...`) with vector similarity
- [x] Upgrade chat RAG — replaced LIKE search with vector similarity in `chat_with_knowledge_base()`
- [x] Embedding management endpoints (`POST /api/embeddings/build`, `POST /api/embeddings/rebuild`, `GET /api/embeddings/status`)
- [x] Search bar in videos page header (debounced semantic search with results view)
- [x] Embeddings status section in Settings page (embedded/pending/chunks stats + Build Embeddings button)
- [x] Removed unused ProfilePage.jsx (profile merged into Settings)
- [x] Rebuild all embeddings endpoint (`POST /api/embeddings/rebuild`) + "Rebuild All" button in Settings
- [x] Unified "Process" pipeline — single button chains Transcribe → Summary → FAQ in background thread
- [x] AssemblyAI sentence-level timestamps (`[M:SS]` format) in transcript content
- [x] Embedded YouTube player in TranscriptModal — clickable timestamps seek within player
- [x] Retranscribe endpoint (`POST /api/retranscribe/<video_id>`) — deletes old transcript + re-transcribes
- [x] Transcription provider tracking — `provider` column in transcripts table, stored on create
- [x] Provider badges in UI — "AAI" (blue) / "Gemini" (purple) shown on video rows + TranscriptModal header
- [x] Gemini audio timestamps — prompt updated to produce `[M:SS]` format matching AssemblyAI output
- [x] Delete transcript — trash icon replaces retranscribe, `DELETE /api/transcripts/<video_id>` cascade deletes transcript + embeddings + summary
- [x] Embedding warning in Settings — amber alert banner when unembedded transcripts exist, pending count highlighted
- [x] Removed `utils/import_json_to_db.py` (no longer needed)
- [x] AI Brains — curated knowledge bases with brain-scoped RAG chat, video management, auto-assign
- [x] Brain-scoped chat with embedded YouTube player and clickable timestamps
- [x] Clickable timestamps in global chat drawer (ChatDrawer) with embedded player
- [x] Shared `chatUtils.jsx` for timestamp parsing/rendering across ChatDrawer and BrainsPage
- [x] Auto-assign videos to matching brains after transcription (>0.85 similarity)
- [x] Removed Topics/clustering feature (replaced by Brains)
- [x] Separate `faq` column in transcripts table — FAQ stored independently from summary
- [x] 6-column video row layout — Thumbnail | Info | Summary | FAQ | Transcript | Actions (Videos + Brains pages)
- [x] Refresh endpoint (`POST /api/refresh/<video_id>`) — regenerates summary + FAQ without re-transcribing
- [x] Short narrative summaries (2-4 sentences) — replaced accumulating multi-type system
- [x] Channel-based auto-assign — new videos auto-added to brains that have videos from the same channel
- [x] Brain badges on video rows — purple pills showing brain membership, clickable to navigate to brain
- [x] Brain navigation from video list — clicking brain badge switches to Brains page and auto-selects brain
- [x] Save to file — `saveToFile.js` utility: browser download via Blob + createObjectURL with `{type}_{datetime}.txt` naming
- [x] Save transcript to file — "Save to File" button in TranscriptModal (includes video title + YouTube URL header)
- [x] Save summary to file — download icon button on expanded summary rows (Videos page + Brains page)
- [x] Save chat to file — "Save" button in ChatDrawer header + "Save Chat" button in Brain chat toolbar
- [x] Bulk download brain content — "Download All Content" button in Brain detail Videos toolbar, downloads each video's transcript + summary + FAQ as separate files
- [x] Video URL embedded in stored transcripts — prepended as header line on transcription
- [x] Video URL embedded in stored summaries — each summary section header includes video title + YouTube URL

### Future Tasks

#### Bulk Operations
- [ ] Bulk "Process All" button
- [ ] Progress tracking for bulk operations

#### Search Enhancements
- [ ] Add filters: by channel, date range, has transcript
- [ ] Search result highlighting within transcript chunks

## Development Notes

### Current UI Layout
Sidebar (240px) + main content area using CSS Grid (`grid-template-columns: 240px 1fr`).

**Sidebar** (`position: sticky`, not `fixed` — must stay in grid flow to avoid overlapping main content):
- Always visible on desktop, hidden on mobile ≤900px (hamburger toggle)
- Top: App brand/title with video icon
- Middle: Videos, Brains nav items
- Bottom (pinned via `margin-top: auto`): Settings
- Active item highlighted with blue text + right border accent

**Videos Page** — List view with 6 columns:
| Thumbnail (160x90) | Video Info | Summary | FAQ | Transcript | Actions |

- **Thumbnail**: 160x90px, links to YouTube
- **Video Info**: Title, Channel name, Saved date, Brain badges (purple pills, clickable → navigates to brain)
- **Summary**: "View"/"Hide" toggle (inline expand) or gray "None"
- **FAQ**: "View"/"Hide" toggle (inline expand) or gray "None"
- **Transcript**: "View" button → TranscriptModal, provider badge (AAI/Gemini), trash icon; or spinner during job; or gray "None"
- **Actions**: "Process" button (when no transcript), "Refresh" icon (when transcript exists, regenerates summary + FAQ), "Remove" button

**Settings Page** — scrollable sections (each a `.settings-section` card):
1. **Profile**: Avatar + editable name/subtitle (click-to-edit inline) + stats counters (Videos, Transcripts, Summaries)
2. **Model Configuration**: Gemini model dropdown
3. **Transcription Provider**: AssemblyAI / Gemini Audio radio cards with API key status
4. **Vector Embeddings**: Embedded/Pending/Chunks stats + "Build Embeddings" button + "Rebuild All" button (clears and re-embeds). Amber warning banner when unembedded transcripts exist.
5. **API Key Status**: Read-only status indicators (green/red dots)

**Brains Page** — curated AI knowledge bases:
- Brain list view: card grid with thumbnail mosaics, name, description, video count
- "+ New Brain" button → modal with name + description fields
- Brain detail view: back button, brain name/description, video count, delete button
- Two tabs: **Videos** (add/remove videos, view transcripts/summaries/FAQ) and **Chat** (brain-scoped RAG with embedded YouTube player + clickable timestamps)
- Videos tab: 6-column grid matching Videos page layout (Thumbnail | Info | Summary | FAQ | Transcript | Actions)
- Videos toolbar: "+ Add Videos" button + "Download All Content" button (bulk exports all transcripts + summaries + FAQs as separate files)
- "Add Videos" modal with search filter, checkbox multi-select, bulk add
- Accepts `initialBrainId` prop for navigation from video card brain badges
- Self-contained: manages its own chat state, summary state, YouTube player, TranscriptModal

**Chat Drawer**: Blue FAB (bottom-right) → expands to 420x500px chat panel with streaming responses + embedded YouTube player + clickable timestamps + Save/Clear buttons

### Transcription Architecture
- **No Celery/Redis** — uses Python `threading.Thread` for background jobs (sufficient for single-user Docker app)
- **Provider selection** — reads `transcription_provider` from `settings` table (default: `assemblyai`), configurable via Settings page
- **AssemblyAI SDK** (`assemblyai==0.17.0`) — `transcriber.transcribe()` is a blocking call; `get_sentences()` provides sentence-level timestamps stored as `[M:SS] text` format
- **Gemini Audio** — uses `google.generativeai` SDK: `genai.upload_file()` uploads audio, then `model.generate_content()` with timestamp prompt producing matching `[M:SS]` format
- **Provider tracking** — `provider` column in transcripts table records which service was used; displayed as badge in UI
- **Lazy imports** — `import google.generativeai as genai` is done inside `transcribe_audio_gemini()` (not at module top-level) to avoid FutureWarning deprecation messages on every gunicorn worker startup
- **yt-dlp** — downloads audio-only (MP3, 192kbps) to temp directory, cleaned up after transcription (shared by both providers)
- **ffmpeg** — installed in Docker image, required by yt-dlp for audio extraction
- **Job status polling** — frontend polls `GET /api/jobs/<id>` every 4 seconds via `setInterval`, cleaned up on component unmount

### Gemini Integration
- **google-generativeai** Python SDK (`>=0.8.0`) — note: this SDK is deprecated (EOL Nov 2025); migration to `google-genai` is a future task
- **Model**: configurable via `GEMINI_MODEL` env var, defaults to `gemini-2.5-flash`
- **Summaries**: reads transcript from DB → sends to Gemini → stores short 2-4 sentence narrative in `transcripts.summary` column. No accumulation — overwrites on refresh.
- **FAQ**: reads transcript from DB → sends to Gemini with FAQ prompt → stores 5-10 Q&A pairs in `transcripts.faq` column. Generated automatically during processing pipeline.
- **Chat (RAG)**: embeds user message → KNN search over transcript chunks via sqlite-vec → falls back to summaries → streams response via SSE
- **Embeddings**: `gemini-embedding-001` model, 768-dim output (`output_dimensionality=768`), batched via `genai.embed_content()`
- **System instruction**: passed when constructing `GenerativeModel` instance (not in `generate_content()`)
- **SSE streaming**: Flask `Response` with `stream_with_context` + `text/event-stream` mimetype; frontend reads via `ReadableStream`
- **Gunicorn**: `--workers 2 --threads 4 --timeout 120` (gthread worker for SSE support)

### Vector Search Architecture
- **sqlite-vec** — loaded as SQLite extension on every `get_db()` connection via `sqlite_vec.load(db)`
- **Chunking** — transcripts split into ~2000-char chunks with 200-char overlap, breaking at sentence boundaries
- **Embedding** — each chunk embedded independently via `genai.embed_content()` with `gemini-embedding-001` (768-dim)
- **Storage** — text in `transcript_chunks` table, vectors in `vec_chunks` virtual table (`vec0`)
- **KNN query** — `WHERE embedding MATCH ? AND k = ?` with JOINs to get text + video metadata
- **Auto-embed** — triggered in `transcription_service.py` background thread after transcript is stored (non-fatal if it fails)
- **Bulk embed** — `POST /api/embeddings/build` processes all unembedded transcripts
- **Cost** — Gemini embedding free tier: 1,500 req/day; each request can batch multiple texts

### AI Brains
- **Brain model** — `Brain` class in `models.py` with full CRUD + video management (add/remove/bulk/get)
- **Brain-scoped RAG** — `brain_service.py` does KNN search over vec_chunks, post-filters to brain's video IDs (sqlite-vec can't filter during KNN)
- **Auto-assign (channel)** — on video add, `auto_assign_by_channel()` matches channel name against existing brain videos; immediate, no embeddings needed
- **Auto-assign (embedding)** — after transcription completes, `auto_assign_video()` compares new video's mean embedding to each brain's mean embedding via cosine similarity; assigns if >0.85
- **Brain badges** — main video list shows purple brain badges per video (clickable → navigates to brain detail)
- **Brain membership** — `GET /api/videos` returns `video.brains` array (list of `{id, name}`) via `Brain.get_brains_for_video()`
- **Suggest** — `GET /api/brains/suggest/<video_id>` returns brains with >0.75 similarity for manual assignment
- **Tables** — `brains` (id, name, description) + `brain_videos` (brain_id, video_id, added_at)

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
- Pages: `'videos'` (default), `'brains'`, `'settings'` — conditional rendering in `<main>`
- Videos page includes debounced semantic search bar (400ms) — when active, replaces video list with search results
- Brains page manages its own state (brain list, detail view, chat, YouTube player)
- Videos data stays in state when switching pages (no re-fetch on return)
- Settings page fetches settings, stats, and embedding status on mount via `Promise.all` in `useEffect`

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
