# Plan: Wire Up YouTube Transcription (Single-Button, AssemblyAI + Background Jobs)

## Summary

Replace the current stubbed-out "Fetch" transcript button with a single **"Transcribe"** button that kicks off a background job. The job downloads the YouTube audio via `yt-dlp`, uploads it to **AssemblyAI** for transcription, and stores the result in the existing `transcripts` table. The UI polls for status and updates the indicator from "None" → "Transcribing..." → "Available".

No Whisper, no local model, no heavy Docker dependencies — just `yt-dlp` (for audio download) and the `assemblyai` Python SDK (same approach as your existing `AA__YOUTUBE_TRANSCRIPT_ASSEMBLY_AI` project).

---

## Step-by-Step Breakdown

### Step 1: Database — Add a `jobs` table for background job tracking

**File:** `backend/app/database.py`

Add a new `jobs` table to `init_db()`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,           -- UUID
    video_id TEXT NOT NULL,
    job_type TEXT NOT NULL,        -- "transcribe"
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | downloading | transcribing | completed | failed
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (video_id) REFERENCES videos(video_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
```

**Why:** We need to track in-progress transcription jobs so the frontend can poll for status and show progress.

---

### Step 2: Backend Model — Add `Job` model class

**File:** `backend/app/models.py`

Add a `Job` class with:
- `create(video_id, job_type)` — insert new job, return job dict
- `get_by_id(job_id)` — get job by UUID
- `get_by_video_id(video_id, job_type)` — get latest job for a video
- `update_status(job_id, status, error_message=None)` — update status
- `row_to_dict(row)` — serialize to dict

---

### Step 3: Backend Model — Update `Video.get_all()` to include `hasTranscript` flag

**File:** `backend/app/models.py`

Modify the `Video.get_all()` SQL query to LEFT JOIN against `transcripts` and include a boolean `hasTranscript` field in the response. Also add an active job status field so the UI knows if a transcription is in progress.

Updated query concept:
```sql
SELECT v.*,
       (t.id IS NOT NULL) AS has_transcript,
       j.status AS job_status
FROM videos v
LEFT JOIN transcripts t ON v.video_id = t.video_id
LEFT JOIN jobs j ON v.video_id = j.video_id
    AND j.job_type = 'transcribe'
    AND j.status NOT IN ('completed', 'failed')
ORDER BY v.scraped_at DESC, v.created_at DESC
```

Update `row_to_dict()` to include `hasTranscript` and `transcriptJobStatus`.

---

### Step 4: Backend Service — Create `transcription_service.py` (yt-dlp + AssemblyAI)

**New file:** `backend/app/transcription_service.py`

This is the core service. Based on your existing `AA__YOUTUBE_TRANSCRIPT_ASSEMBLY_AI/audio_transcriber.py`, we'll use the **`assemblyai` Python SDK** (the SDK handles upload + polling internally — `transcriber.transcribe()` is a single blocking call that returns the finished transcript).

Three main functions:

1. **`download_audio(video_url, output_dir)`** — Uses `yt-dlp` to download **audio-only** (no video needed — faster, smaller files). Extracts to MP3/M4A format. Returns the file path.

2. **`transcribe_audio(audio_file_path, api_key)`** — Mirrors your existing pattern:
   ```python
   import assemblyai as aai
   aai.settings.api_key = api_key
   transcriber = aai.Transcriber()
   transcript = transcriber.transcribe(audio_file_path)
   return transcript.text
   ```
   The SDK handles upload, polling, and returning text — no manual HTTP needed.

3. **`run_transcription_job(app, job_id, video_id, api_key)`** — The orchestrator that runs in a background thread:
   - Updates job status → `downloading`
   - Downloads audio via yt-dlp
   - Updates job status → `transcribing`
   - Calls `transcribe_audio()` (blocking — SDK polls AssemblyAI internally)
   - On success: stores transcript in DB via `Transcript.create()`, updates job → `completed`
   - On failure: updates job → `failed` with error message
   - Cleans up temp audio files in all cases (finally block)

**Dependencies added:** `yt-dlp`, `assemblyai` (v0.17.0, same as your existing project)

**No Celery/Redis needed** — we'll use Python's `threading.Thread` for background execution. This is sufficient for a single-user Docker app. The thread gets a copy of the Flask app context to access the database.

---

### Step 5: Backend Routes — Add transcription API endpoints

**File:** `backend/app/routes.py`

Replace the existing transcript stubs with real endpoints:

1. **`POST /api/transcribe/<video_id>`** — Start a transcription job
   - Checks video exists
   - Checks if transcript already exists (returns 409)
   - Checks if a job is already running for this video (returns 409)
   - Creates a job record
   - Launches background thread via `run_transcription_job()`
   - Returns `{ jobId, status: "pending" }` immediately

2. **`GET /api/jobs/<job_id>`** — Poll job status
   - Returns current job status, error message if failed

3. **`GET /api/jobs/video/<video_id>`** — Get latest job for a video
   - Returns the most recent job for a given video ID

4. Keep existing `GET /api/transcripts/<video_id>/status` working
5. Keep existing `GET /api/transcripts/search` working

---

### Step 6: Frontend API Service — Add transcription methods

**File:** `frontend/src/services/api.js`

Add methods:
- `startTranscription(videoId)` — POST to `/api/transcribe/<videoId>`
- `getJobStatus(jobId)` — GET from `/api/jobs/<jobId>`
- `getVideoJob(videoId)` — GET from `/api/jobs/video/<videoId>`

---

### Step 7: Frontend UI — Replace "Fetch" button with "Transcribe" button + status

**File:** `frontend/src/components/VideoCard.jsx`

Replace the Transcript column logic:
- **If `hasTranscript` is true** → Show green "Available" indicator (same as now)
- **If `transcriptJobStatus` is active** → Show animated spinner + status text ("Downloading...", "Transcribing...")
- **If no transcript and no active job** → Show single **"Transcribe"** button

Remove the separate "Fetch" concept entirely — one button does everything.

---

### Step 8: Frontend App — Wire up transcription with polling

**File:** `frontend/src/App.jsx`

Replace `handleFetchTranscript` with `handleTranscribe`:
1. Call `apiService.startTranscription(videoId)`
2. Get back `jobId`
3. Start a polling interval (`setInterval` every 3-5 seconds) calling `apiService.getJobStatus(jobId)`
4. Update the video's `transcriptJobStatus` in local state as it progresses
5. When job completes → update `hasTranscript` to true, stop polling
6. When job fails → show error, stop polling

Track active polls in a ref (`useRef`) so they're cleaned up on unmount.

---

### Step 9: Docker — Add yt-dlp + env var for AssemblyAI key

**File:** `backend/requirements.txt` — Add `yt-dlp`, `assemblyai==0.17.0` (matching your existing project)

**File:** `Dockerfile` — Add `ffmpeg` install (`apt-get install -y ffmpeg`) in Stage 2. yt-dlp needs ffmpeg to extract/convert audio streams. This adds ~30MB to the image.

**File:** `docker-compose.yaml` — Add `ASSEMBLYAI_API_KEY` environment variable (reads from host `.env` or passed directly)

**File:** `backend/.env.example` — Create template showing required env vars

---

### Step 10: CSS — Add transcribing animation state

**File:** `frontend/src/index.css`

Add a pulsing/spinner animation for the "Transcribing..." state in the transcript column. Something like a rotating icon or a pulsing dot to indicate work in progress.

---

## Execution Order

| Order | Step | What | Scope |
|-------|------|------|-------|
| 1 | Step 1 | `jobs` table in database.py | Backend DB |
| 2 | Step 2 | `Job` model class | Backend Model |
| 3 | Step 3 | `hasTranscript` + `jobStatus` in Video query | Backend Model |
| 4 | Step 4 | `transcription_service.py` (yt-dlp + AssemblyAI) | Backend Service (new file) |
| 5 | Step 5 | New API routes for transcribe + jobs | Backend Routes |
| 6 | Step 6 | API service methods | Frontend Service |
| 7 | Step 7 | VideoCard "Transcribe" button + states | Frontend Component |
| 8 | Step 8 | App.jsx polling + state management | Frontend App |
| 9 | Step 9 | Docker deps + env var | Infra |
| 10 | Step 10 | Spinner/animation CSS | Frontend Styles |

## What's NOT Included (future work)
- Summary generation (separate feature)
- Bulk "Transcribe All" button
- Full-text search (FTS5) across transcripts
- Transcript viewer UI (clicking "Available" to read the transcript)
