"""
MCP Server for BookMarkManager.

Exposes video management, transcription, search, and brain tools
so AI models can query and interact with the bookmark database.

Run standalone:  python mcp_server.py              (stdio, for Claude Desktop)
Run SSE:         python mcp_server.py --transport sse --port 8001
"""

import os
import sys
import json
import sqlite3
import logging

import sqlite_vec
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Database helpers (standalone — no Flask dependency)
# ---------------------------------------------------------------------------

DB_PATH = os.environ.get(
    'BOOKMARKMANAGER_DB',
    os.path.join(os.path.dirname(__file__), 'data', 'bookmarks.db'),
)

logger = logging.getLogger('mcp_server')


def _get_db() -> sqlite3.Connection:
    """Open a new SQLite connection with sqlite-vec loaded."""
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    return db


# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------

mcp = FastMCP(
    'BookMarkManager',
    instructions=(
        'Manage a library of YouTube video bookmarks. '
        'You can list, search, and add videos, trigger transcription, '
        'read transcripts/summaries/FAQs, manage AI Brains, and perform '
        'semantic search across all indexed content.'
    ),
)


# ── Videos ─────────────────────────────────────────────────────────────────


@mcp.tool()
def list_videos(page: int = 1, per_page: int = 20) -> str:
    """List saved YouTube videos (newest first).

    Args:
        page: Page number (default 1).
        per_page: Videos per page (default 20, max 100).
    """
    per_page = min(per_page, 100)
    offset = (page - 1) * per_page
    db = _get_db()
    try:
        total = db.execute('SELECT COUNT(*) AS c FROM videos').fetchone()['c']
        rows = db.execute(
            '''
            SELECT v.video_id, v.video_title, v.channel_name, v.video_url, v.scraped_at,
                   (t.id IS NOT NULL) AS has_transcript,
                   (t.summary IS NOT NULL AND t.summary != '') AS has_summary,
                   (t.faq IS NOT NULL AND t.faq != '') AS has_faq,
                   t.provider AS transcript_provider
            FROM videos v
            LEFT JOIN transcripts t ON v.video_id = t.video_id
            ORDER BY v.scraped_at DESC, v.created_at DESC
            LIMIT ? OFFSET ?
            ''',
            (per_page, offset),
        ).fetchall()
        videos = [
            {
                'videoId': r['video_id'],
                'videoTitle': r['video_title'],
                'channelName': r['channel_name'],
                'videoUrl': r['video_url'],
                'scrapedAt': r['scraped_at'],
                'hasTranscript': bool(r['has_transcript']),
                'hasSummary': bool(r['has_summary']),
                'hasFaq': bool(r['has_faq']),
                'transcriptProvider': r['transcript_provider'],
            }
            for r in rows
        ]
        return json.dumps({
            'videos': videos,
            'page': page,
            'perPage': per_page,
            'total': total,
            'totalPages': (total + per_page - 1) // per_page,
        })
    finally:
        db.close()


@mcp.tool()
def get_video(video_id: str) -> str:
    """Get details for a single video by its YouTube video ID.

    Args:
        video_id: YouTube video ID (e.g. 'dQw4w9WgXcQ').
    """
    db = _get_db()
    try:
        row = db.execute(
            '''
            SELECT v.*,
                   (t.id IS NOT NULL) AS has_transcript,
                   (t.summary IS NOT NULL AND t.summary != '') AS has_summary,
                   (t.faq IS NOT NULL AND t.faq != '') AS has_faq,
                   t.provider AS transcript_provider
            FROM videos v
            LEFT JOIN transcripts t ON v.video_id = t.video_id
            WHERE v.video_id = ?
            ''',
            (video_id,),
        ).fetchone()
        if not row:
            return json.dumps({'error': 'Video not found'})
        return json.dumps({
            'videoId': row['video_id'],
            'videoTitle': row['video_title'],
            'channelName': row['channel_name'],
            'channelId': row['channel_id'],
            'channelUrl': row['channel_url'],
            'videoUrl': row['video_url'],
            'scrapedAt': row['scraped_at'],
            'hasTranscript': bool(row['has_transcript']),
            'hasSummary': bool(row['has_summary']),
            'hasFaq': bool(row['has_faq']),
            'transcriptProvider': row['transcript_provider'],
        })
    finally:
        db.close()


@mcp.tool()
def add_video(
    video_id: str,
    video_title: str,
    channel_name: str = '',
    channel_id: str = '',
    channel_url: str = '',
    video_url: str = '',
) -> str:
    """Add a new YouTube video bookmark.

    Args:
        video_id: YouTube video ID (e.g. 'dQw4w9WgXcQ').
        video_title: Title of the video.
        channel_name: Name of the YouTube channel.
        channel_id: YouTube channel ID.
        channel_url: URL of the YouTube channel.
        video_url: Full URL of the video. Auto-constructed if empty.
    """
    if not video_url:
        video_url = f'https://www.youtube.com/watch?v={video_id}'
    db = _get_db()
    try:
        # Check for duplicate
        existing = db.execute(
            'SELECT id FROM videos WHERE video_id = ?', (video_id,)
        ).fetchone()
        if existing:
            return json.dumps({'error': f'Video {video_id} already exists'})

        from datetime import datetime

        db.execute(
            '''
            INSERT INTO videos (channel_id, channel_name, channel_url,
                                scraped_at, video_id, video_title, video_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                channel_id,
                channel_name,
                channel_url,
                datetime.utcnow().isoformat(),
                video_id,
                video_title,
                video_url,
            ),
        )
        db.commit()
        return json.dumps({'success': True, 'videoId': video_id, 'videoTitle': video_title})
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        db.close()


@mcp.tool()
def delete_video(video_id: str) -> str:
    """Delete a video bookmark by its YouTube video ID.

    Args:
        video_id: YouTube video ID to delete.
    """
    db = _get_db()
    try:
        cursor = db.execute('DELETE FROM videos WHERE video_id = ?', (video_id,))
        db.commit()
        if cursor.rowcount > 0:
            return json.dumps({'success': True, 'message': f'Deleted video {video_id}'})
        return json.dumps({'error': 'Video not found'})
    finally:
        db.close()


# ── Transcription ──────────────────────────────────────────────────────────


@mcp.tool()
def transcribe_video(video_id: str) -> str:
    """Start transcription of a video. Calls the Flask API to trigger the background job.

    The transcription runs asynchronously — use get_job_status to poll progress.

    Args:
        video_id: YouTube video ID to transcribe.
    """
    import urllib.request
    import urllib.error

    api_base = os.environ.get('BOOKMARKMANAGER_API', 'http://localhost:5000')
    url = f'{api_base}/api/transcribe/{video_id}'

    try:
        req = urllib.request.Request(url, method='POST', data=b'')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read().decode()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return json.dumps({'error': f'HTTP {e.code}', 'detail': body})
    except urllib.error.URLError as e:
        return json.dumps({
            'error': 'Cannot reach BookMarkManager API',
            'detail': str(e.reason),
            'hint': 'Make sure the Docker container is running on port 5000',
        })


@mcp.tool()
def get_job_status(job_id: str) -> str:
    """Check the status of a transcription job.

    Args:
        job_id: Job UUID returned by transcribe_video.
    """
    db = _get_db()
    try:
        row = db.execute('SELECT * FROM jobs WHERE id = ?', (job_id,)).fetchone()
        if not row:
            return json.dumps({'error': 'Job not found'})
        return json.dumps({
            'id': row['id'],
            'videoId': row['video_id'],
            'status': row['status'],
            'errorMessage': row['error_message'],
            'createdAt': row['created_at'],
            'completedAt': row['completed_at'],
        })
    finally:
        db.close()


# ── Transcripts, Summaries, FAQs ──────────────────────────────────────────


@mcp.tool()
def get_transcript(video_id: str) -> str:
    """Get the full transcript text for a video.

    Args:
        video_id: YouTube video ID.
    """
    db = _get_db()
    try:
        row = db.execute(
            'SELECT * FROM transcripts WHERE video_id = ?', (video_id,)
        ).fetchone()
        if not row:
            return json.dumps({'error': 'No transcript found for this video'})
        return json.dumps({
            'videoId': row['video_id'],
            'content': row['content'],
            'provider': row['provider'],
            'indexedAt': row['indexed_at'],
        })
    finally:
        db.close()


@mcp.tool()
def get_summary(video_id: str) -> str:
    """Get the summary and FAQ for a video.

    Args:
        video_id: YouTube video ID.
    """
    db = _get_db()
    try:
        row = db.execute(
            'SELECT video_id, summary, faq FROM transcripts WHERE video_id = ?',
            (video_id,),
        ).fetchone()
        if not row:
            return json.dumps({'error': 'No transcript found for this video'})
        return json.dumps({
            'videoId': row['video_id'],
            'summary': row['summary'],
            'faq': row['faq'],
        })
    finally:
        db.close()


# ── Search ─────────────────────────────────────────────────────────────────


@mcp.tool()
def search_videos(query: str, max_results: int = 20) -> str:
    """Semantic search across all indexed transcript content using vector similarity.

    Args:
        query: Natural language search query.
        max_results: Maximum results to return (default 20, max 50).
    """
    from google import genai
    from google.genai import types
    from sqlite_vec import serialize_float32

    api_key = os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        return json.dumps({'error': 'GOOGLE_API_KEY not configured — semantic search unavailable'})

    max_results = min(max_results, 50)
    db = _get_db()
    try:
        # Check if embeddings exist
        count = db.execute('SELECT COUNT(*) AS c FROM vec_chunks').fetchone()['c']
        if count == 0:
            return json.dumps({'error': 'No embeddings built yet. Build embeddings first.'})

        # Embed the query
        client = genai.Client(api_key=api_key)
        result = client.models.embed_content(
            model='gemini-embedding-001',
            contents=query,
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        query_embedding = list(result.embeddings[0].values)

        # KNN search
        rows = db.execute(
            '''
            SELECT tc.video_id, tc.content AS matching_chunk,
                   v.video_title, v.channel_name, vc.distance
            FROM vec_chunks vc
            JOIN transcript_chunks tc ON tc.id = vc.chunk_id
            JOIN videos v ON v.video_id = tc.video_id
            WHERE vc.embedding MATCH ? AND k = ?
            ORDER BY vc.distance
            ''',
            [serialize_float32(query_embedding), max_results],
        ).fetchall()

        # Group by video (best chunk per video)
        seen = {}
        for r in rows:
            vid = r['video_id']
            if vid not in seen:
                seen[vid] = {
                    'videoId': r['video_id'],
                    'videoTitle': r['video_title'],
                    'channelName': r['channel_name'],
                    'matchingChunk': r['matching_chunk'],
                    'distance': r['distance'],
                }

        return json.dumps({'query': query, 'results': list(seen.values())})
    finally:
        db.close()


@mcp.tool()
def search_transcripts_text(query: str) -> str:
    """Simple text search across transcript content (no embeddings needed).

    Args:
        query: Text to search for in transcripts.
    """
    db = _get_db()
    try:
        rows = db.execute(
            '''
            SELECT t.video_id, v.video_title, v.channel_name
            FROM transcripts t
            JOIN videos v ON t.video_id = v.video_id
            WHERE t.content LIKE ?
            LIMIT 20
            ''',
            (f'%{query}%',),
        ).fetchall()
        results = [
            {
                'videoId': r['video_id'],
                'videoTitle': r['video_title'],
                'channelName': r['channel_name'],
            }
            for r in rows
        ]
        return json.dumps({'query': query, 'results': results})
    finally:
        db.close()


# ── Brains ─────────────────────────────────────────────────────────────────


@mcp.tool()
def list_brains() -> str:
    """List all AI Brains (curated knowledge bases)."""
    db = _get_db()
    try:
        rows = db.execute(
            '''
            SELECT b.*, COUNT(bv.video_id) AS video_count
            FROM brains b
            LEFT JOIN brain_videos bv ON b.id = bv.brain_id
            GROUP BY b.id
            ORDER BY b.updated_at DESC
            '''
        ).fetchall()
        brains = [
            {
                'id': r['id'],
                'name': r['name'],
                'description': r['description'],
                'videoCount': r['video_count'],
                'createdAt': r['created_at'],
            }
            for r in rows
        ]
        return json.dumps({'brains': brains})
    finally:
        db.close()


@mcp.tool()
def get_brain(brain_id: str) -> str:
    """Get a brain and its videos.

    Args:
        brain_id: Brain UUID.
    """
    db = _get_db()
    try:
        brain = db.execute(
            'SELECT * FROM brains WHERE id = ?', (brain_id,)
        ).fetchone()
        if not brain:
            return json.dumps({'error': 'Brain not found'})

        videos = db.execute(
            '''
            SELECT v.video_id, v.video_title, v.channel_name
            FROM brain_videos bv
            JOIN videos v ON v.video_id = bv.video_id
            WHERE bv.brain_id = ?
            ORDER BY bv.added_at DESC
            ''',
            (brain_id,),
        ).fetchall()

        return json.dumps({
            'id': brain['id'],
            'name': brain['name'],
            'description': brain['description'],
            'videos': [
                {
                    'videoId': r['video_id'],
                    'videoTitle': r['video_title'],
                    'channelName': r['channel_name'],
                }
                for r in videos
            ],
        })
    finally:
        db.close()


@mcp.tool()
def create_brain(name: str, description: str = '') -> str:
    """Create a new AI Brain (curated knowledge base).

    Args:
        name: Brain name (max 100 chars).
        description: Optional description (max 500 chars).
    """
    import uuid
    from datetime import datetime

    db = _get_db()
    try:
        brain_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        db.execute(
            'INSERT INTO brains (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            (brain_id, name[:100], description[:500], now, now),
        )
        db.commit()
        return json.dumps({'success': True, 'id': brain_id, 'name': name})
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        db.close()


@mcp.tool()
def add_video_to_brain(brain_id: str, video_id: str) -> str:
    """Add a video to a brain.

    Args:
        brain_id: Brain UUID.
        video_id: YouTube video ID.
    """
    db = _get_db()
    try:
        # Verify both exist
        brain = db.execute('SELECT id FROM brains WHERE id = ?', (brain_id,)).fetchone()
        if not brain:
            return json.dumps({'error': 'Brain not found'})
        video = db.execute('SELECT video_id FROM videos WHERE video_id = ?', (video_id,)).fetchone()
        if not video:
            return json.dumps({'error': 'Video not found'})

        db.execute(
            'INSERT OR IGNORE INTO brain_videos (brain_id, video_id) VALUES (?, ?)',
            (brain_id, video_id),
        )
        from datetime import datetime
        db.execute(
            'UPDATE brains SET updated_at = ? WHERE id = ?',
            (datetime.utcnow().isoformat(), brain_id),
        )
        db.commit()
        return json.dumps({'success': True, 'brainId': brain_id, 'videoId': video_id})
    finally:
        db.close()


# ── Stats ──────────────────────────────────────────────────────────────────


@mcp.tool()
def get_stats() -> str:
    """Get application statistics: total videos, transcripts, summaries, FAQs, embeddings."""
    db = _get_db()
    try:
        videos = db.execute('SELECT COUNT(*) AS c FROM videos').fetchone()['c']
        transcripts = db.execute('SELECT COUNT(*) AS c FROM transcripts').fetchone()['c']
        summaries = db.execute(
            "SELECT COUNT(*) AS c FROM transcripts WHERE summary IS NOT NULL AND summary != ''"
        ).fetchone()['c']
        faqs = db.execute(
            "SELECT COUNT(*) AS c FROM transcripts WHERE faq IS NOT NULL AND faq != ''"
        ).fetchone()['c']
        chunks = db.execute('SELECT COUNT(*) AS c FROM transcript_chunks').fetchone()['c']
        brains = db.execute('SELECT COUNT(*) AS c FROM brains').fetchone()['c']

        return json.dumps({
            'totalVideos': videos,
            'totalTranscripts': transcripts,
            'totalSummaries': summaries,
            'totalFaqs': faqs,
            'totalChunks': chunks,
            'totalBrains': brains,
        })
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description='BookMarkManager MCP Server')
    parser.add_argument(
        '--transport', choices=['stdio', 'sse'], default='stdio',
        help='Transport mode (default: stdio for Claude Desktop)',
    )
    args = parser.parse_args()

    if args.transport == 'sse':
        host = os.environ.get('MCP_HOST', '0.0.0.0')
        port = int(os.environ.get('MCP_PORT', '8001'))
        app = mcp.sse_app()
        uvicorn.run(app, host=host, port=port)
    else:
        mcp.run(transport='stdio')
