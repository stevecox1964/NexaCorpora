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
  [creates job record, launches background thread]
     ↓ returns { jobId, status: "pending" } immediately
Frontend polls GET /api/jobs/<job_id> every 4 seconds
     ↓
Background thread:
  1. yt-dlp downloads audio-only (MP3) to temp dir
  2. AssemblyAI SDK uploads audio + transcribes (blocking call)
  3. Stores transcript text in SQLite transcripts table
  4. Updates job status → "completed"
  5. Cleans up temp files
     ↓
Frontend sees "completed" → shows green "View" button
User clicks "View" → TranscriptModal fetches GET /api/transcripts/<video_id>
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
│   │   │   ├── VideoCard.jsx        # Video row: thumbnail, info, transcript status, actions
│   │   │   ├── AddVideoModal.jsx    # Modal for manually adding videos
│   │   │   └── TranscriptModal.jsx  # Modal for viewing transcript text
│   │   ├── services/
│   │   │   └── api.js               # API service layer (all fetch calls)
│   │   └── App.jsx                  # Main app: video list, pagination, transcription polling
│   └── package.json
├── backend/                  # Python Flask API
│   ├── app/
│   │   ├── __init__.py              # Serves SPA from /app/static when present
│   │   ├── routes.py                # API endpoints (videos, transcripts, jobs)
│   │   ├── models.py                # SQLite models (Video, Transcript, Job)
│   │   ├── database.py              # DB connection + schema init (videos, transcripts, jobs)
│   │   ├── bookmarks.py             # Chrome bookmarks parser
│   │   ├── transcripts.py           # Transcript search + status helpers
│   │   └── transcription_service.py # yt-dlp download + AssemblyAI transcription + background jobs
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
Each video includes `hasTranscript` (boolean) and `transcriptJobStatus` (string or null) fields via LEFT JOINs.
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
- Response: `{ "success": true, "transcript": { "videoId", "content", "indexedAt" } }`

#### GET /api/transcripts/<video_id>/status
Check if a video has a transcript.
- Response: `{ "videoId", "indexed": true/false, "indexedAt" }`

#### GET /api/transcripts/search
Search indexed transcripts (basic LIKE search).
- Query params: `q` (search query)

### Transcription Endpoints

#### POST /api/transcribe/<video_id>
Start a background transcription job (downloads audio via yt-dlp, transcribes via AssemblyAI).
- Returns immediately: `{ "success": true, "job": { "id", "status": "pending" } }`
- Errors: 404 (video not found), 409 (transcript exists or job already running), 500 (API key not configured)

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

## Running the Application

### Production: Single container (recommended)
```bash
# Create .env with your AssemblyAI key
echo "ASSEMBLYAI_API_KEY=your_key_here" > .env

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
```

Set automatically in `docker-compose.yaml`:
```yaml
environment:
  - FLASK_ENV=production
  - PYTHONUNBUFFERED=1
  - ASSEMBLYAI_API_KEY=${ASSEMBLYAI_API_KEY}
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
List view with 4 columns:
| Thumbnail (160x90) | Video Info | Transcript | Actions |

- **Thumbnail**: 160x90px, links to YouTube
- **Video Info**: Title, Channel name, Saved date
- **Transcript**: Status indicator + action
  - Green "View" button (clickable) → opens TranscriptModal
  - Yellow spinner + "Downloading..." / "Transcribing..." (during active job)
  - Gray "None" + "Transcribe" button (no transcript yet)
- **Actions**: Remove button

### Transcription Architecture
- **No Celery/Redis** — uses Python `threading.Thread` for background jobs (sufficient for single-user Docker app)
- **AssemblyAI SDK** (`assemblyai==0.17.0`) — `transcriber.transcribe()` is a blocking call that handles upload + polling internally
- **yt-dlp** — downloads audio-only (MP3, 192kbps) to temp directory, cleaned up after transcription
- **ffmpeg** — installed in Docker image, required by yt-dlp for audio extraction
- **Job status polling** — frontend polls `GET /api/jobs/<id>` every 4 seconds via `setInterval`, cleaned up on component unmount

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

### Error Handling
- Frontend gracefully handles Docker being offline
- Transcription failures update job status to "failed" with error message, shown in error banner
- Background threads use Flask app context for database access

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
