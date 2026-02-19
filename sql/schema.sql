-- BookMarkManager Database Schema
-- SQLite Database

-- Videos table - stores YouTube video bookmarks
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT,
    channel_id_source TEXT,
    channel_name TEXT,
    channel_url TEXT,
    scraped_at TEXT,
    video_id TEXT UNIQUE NOT NULL,
    video_title TEXT NOT NULL,
    video_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups by video_id
CREATE INDEX IF NOT EXISTS idx_videos_video_id ON videos(video_id);

-- Index for sorting by scraped_at (latest first)
CREATE INDEX IF NOT EXISTS idx_videos_scraped_at ON videos(scraped_at DESC);

-- Index for channel lookups
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);


-- Transcripts table (STUB) - stores indexed video transcripts
CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    content TEXT,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES videos (video_id) ON DELETE CASCADE
);

-- Index for transcript lookups by video_id
CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts(video_id);


-- Full-text search virtual table for transcripts (for future implementation)
-- Uncomment when implementing transcript search
-- CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
--     content,
--     video_id UNINDEXED,
--     content='transcripts',
--     content_rowid='id'
-- );

-- Triggers to keep FTS index in sync (for future implementation)
-- CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
--     INSERT INTO transcripts_fts(rowid, content, video_id)
--     VALUES (new.id, new.content, new.video_id);
-- END;

-- CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
--     INSERT INTO transcripts_fts(transcripts_fts, rowid, content, video_id)
--     VALUES ('delete', old.id, old.content, old.video_id);
-- END;

-- CREATE TRIGGER IF NOT EXISTS transcripts_au AFTER UPDATE ON transcripts BEGIN
--     INSERT INTO transcripts_fts(transcripts_fts, rowid, content, video_id)
--     VALUES ('delete', old.id, old.content, old.video_id);
--     INSERT INTO transcripts_fts(rowid, content, video_id)
--     VALUES (new.id, new.content, new.video_id);
-- END;
