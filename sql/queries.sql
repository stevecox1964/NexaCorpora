-- BookMarkManager Common Queries
-- Useful SQL queries for database management and debugging

-- =============================================================================
-- SELECT QUERIES
-- =============================================================================

-- Get all videos (latest first)
SELECT * FROM videos ORDER BY scraped_at DESC, created_at DESC;

-- Get latest N videos
SELECT * FROM videos ORDER BY scraped_at DESC, created_at DESC LIMIT 10;

-- Get video by video_id
SELECT * FROM videos WHERE video_id = 'BTewrsVrZwM';

-- Get all videos from a specific channel
SELECT * FROM videos WHERE channel_id = 'UCvBy3qcISSOcrbqPhqmG4Xw' ORDER BY scraped_at DESC;

-- Search videos by title (case-insensitive)
SELECT * FROM videos WHERE video_title LIKE '%keyword%' ORDER BY scraped_at DESC;

-- Count videos per channel
SELECT
    channel_name,
    channel_id,
    COUNT(*) as video_count
FROM videos
GROUP BY channel_id
ORDER BY video_count DESC;

-- Get videos added today
SELECT * FROM videos
WHERE DATE(created_at) = DATE('now')
ORDER BY created_at DESC;

-- Get videos scraped in date range
SELECT * FROM videos
WHERE scraped_at BETWEEN '2025-01-01' AND '2025-12-31'
ORDER BY scraped_at DESC;

-- Get total video count
SELECT COUNT(*) as total_videos FROM videos;

-- Get distinct channels
SELECT DISTINCT channel_name, channel_id, channel_url
FROM videos
ORDER BY channel_name;


-- =============================================================================
-- INSERT QUERIES
-- =============================================================================

-- Insert a new video
INSERT INTO videos (
    channel_id,
    channel_id_source,
    channel_name,
    channel_url,
    scraped_at,
    video_id,
    video_title,
    video_url
) VALUES (
    'UCvBy3qcISSOcrbqPhqmG4Xw',
    'fetched_from_handle',
    'Damon Cassidy',
    'https://www.youtube.com/channel/UCvBy3qcISSOcrbqPhqmG4Xw',
    '2025-12-10T16:38:41.404Z',
    'BTewrsVrZwM',
    '(104) Companies Are Making Billions Off FAKE Layoffs',
    'https://www.youtube.com/watch?v=BTewrsVrZwM'
);

-- Insert or ignore duplicate
INSERT OR IGNORE INTO videos (
    channel_id, channel_id_source, channel_name, channel_url,
    scraped_at, video_id, video_title, video_url
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- Insert or replace (upsert)
INSERT OR REPLACE INTO videos (
    channel_id, channel_id_source, channel_name, channel_url,
    scraped_at, video_id, video_title, video_url
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);


-- =============================================================================
-- UPDATE QUERIES
-- =============================================================================

-- Update video title
UPDATE videos SET video_title = 'New Title' WHERE video_id = 'BTewrsVrZwM';

-- Update channel info for all videos from a channel
UPDATE videos
SET channel_name = 'New Channel Name'
WHERE channel_id = 'UCvBy3qcISSOcrbqPhqmG4Xw';


-- =============================================================================
-- DELETE QUERIES
-- =============================================================================

-- Delete a specific video
DELETE FROM videos WHERE video_id = 'BTewrsVrZwM';

-- Delete all videos from a channel
DELETE FROM videos WHERE channel_id = 'UCvBy3qcISSOcrbqPhqmG4Xw';

-- Delete videos older than a date
DELETE FROM videos WHERE scraped_at < '2024-01-01';

-- Delete all videos (truncate)
DELETE FROM videos;

-- Reset auto-increment counter after delete all
DELETE FROM sqlite_sequence WHERE name = 'videos';


-- =============================================================================
-- TRANSCRIPT QUERIES (STUB)
-- =============================================================================

-- Get transcript for a video
SELECT * FROM transcripts WHERE video_id = 'BTewrsVrZwM';

-- Check if video has transcript
SELECT EXISTS(SELECT 1 FROM transcripts WHERE video_id = 'BTewrsVrZwM') as has_transcript;

-- Search transcripts (basic LIKE search)
SELECT t.*, v.video_title, v.video_url
FROM transcripts t
JOIN videos v ON t.video_id = v.video_id
WHERE t.content LIKE '%search term%'
LIMIT 20;

-- Get videos without transcripts
SELECT v.*
FROM videos v
LEFT JOIN transcripts t ON v.video_id = t.video_id
WHERE t.id IS NULL;


-- =============================================================================
-- MAINTENANCE QUERIES
-- =============================================================================

-- Check database integrity
PRAGMA integrity_check;

-- Get database size info
SELECT
    page_count * page_size as size_bytes,
    page_count,
    page_size
FROM pragma_page_count(), pragma_page_size();

-- Vacuum database (reclaim space after deletes)
VACUUM;

-- Analyze tables for query optimization
ANALYZE;

-- List all tables
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;

-- Get table info
PRAGMA table_info(videos);
PRAGMA table_info(transcripts);

-- List all indexes
SELECT name, tbl_name FROM sqlite_master WHERE type='index';
