import os
import logging
import google.generativeai as genai
from sqlite_vec import serialize_float32
from .database import get_db
from .models import Transcript, Video

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = 'models/gemini-embedding-001'
EMBEDDING_DIM = 768
CHUNK_SIZE = 2000
CHUNK_OVERLAP = 200


def _configure_genai():
    api_key = os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        raise ValueError('GOOGLE_API_KEY not configured')
    genai.configure(api_key=api_key)


def chunk_transcript(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks, breaking on sentence boundaries."""
    if not text or not text.strip():
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size

        if end < len(text):
            # Try to break at a sentence boundary (., !, ?) within last 20% of chunk
            search_start = start + int(chunk_size * 0.8)
            best_break = -1
            for sep in ['. ', '! ', '? ', '.\n', '!\n', '?\n']:
                pos = text.rfind(sep, search_start, end)
                if pos > best_break:
                    best_break = pos + len(sep)

            if best_break > search_start:
                end = best_break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap if end < len(text) else len(text)

    return chunks


def embed_texts(texts):
    """Embed a list of texts using Gemini, returns list of 768-dim vectors."""
    _configure_genai()
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=texts,
        output_dimensionality=EMBEDDING_DIM,
    )
    return result['embedding']


def embed_video(video_id):
    """Chunk a video's transcript and store embeddings. Returns chunk count."""
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript or not transcript.get('content'):
        return 0

    db = get_db()

    # Skip if already embedded
    existing = db.execute(
        'SELECT COUNT(*) as c FROM transcript_chunks WHERE video_id = ?',
        (video_id,)
    ).fetchone()['c']
    if existing > 0:
        return existing

    chunks = chunk_transcript(transcript['content'])
    if not chunks:
        return 0

    # Embed all chunks (batched API call)
    embeddings = embed_texts(chunks)

    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        cursor = db.execute(
            'INSERT INTO transcript_chunks (video_id, chunk_index, content) VALUES (?, ?, ?)',
            (video_id, i, chunk_text)
        )
        chunk_id = cursor.lastrowid
        db.execute(
            'INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)',
            (chunk_id, serialize_float32(embedding))
        )

    db.commit()
    logger.info(f'Embedded {len(chunks)} chunks for video {video_id}')
    return len(chunks)


def embed_all_unembedded():
    """Embed all transcripts that haven't been chunked yet. Returns stats dict."""
    db = get_db()
    rows = db.execute('''
        SELECT t.video_id
        FROM transcripts t
        LEFT JOIN transcript_chunks tc ON t.video_id = tc.video_id
        WHERE t.content IS NOT NULL AND t.content != ''
        GROUP BY t.video_id
        HAVING COUNT(tc.id) = 0
    ''').fetchall()

    embedded = 0
    errors = []
    for row in rows:
        vid = row['video_id']
        try:
            count = embed_video(vid)
            if count > 0:
                embedded += 1
        except Exception as e:
            logger.error(f'Failed to embed video {vid}: {e}')
            errors.append({'videoId': vid, 'error': str(e)})

    return {'embedded': embedded, 'errors': errors, 'total': len(rows)}


def rebuild_all_embeddings():
    """Clear all existing embeddings and re-embed every transcript. Returns stats dict."""
    db = get_db()

    # Clear existing vector and chunk data
    db.execute('DELETE FROM vec_chunks')
    db.execute('DELETE FROM transcript_chunks')
    db.commit()
    logger.info('Cleared all existing embeddings')

    # Fetch all transcripts with content
    rows = db.execute('''
        SELECT video_id FROM transcripts
        WHERE content IS NOT NULL AND content != ''
    ''').fetchall()

    embedded = 0
    errors = []
    for row in rows:
        vid = row['video_id']
        try:
            count = embed_video(vid)
            if count > 0:
                embedded += 1
        except Exception as e:
            logger.error(f'Failed to embed video {vid}: {e}')
            errors.append({'videoId': vid, 'error': str(e)})

    return {'embedded': embedded, 'errors': errors, 'total': len(rows)}


def get_embedding_status():
    """Return embedding statistics."""
    db = get_db()
    total_transcripts = db.execute(
        "SELECT COUNT(*) as c FROM transcripts WHERE content IS NOT NULL AND content != ''"
    ).fetchone()['c']
    embedded_videos = db.execute(
        'SELECT COUNT(DISTINCT video_id) as c FROM transcript_chunks'
    ).fetchone()['c']
    total_chunks = db.execute(
        'SELECT COUNT(*) as c FROM transcript_chunks'
    ).fetchone()['c']
    return {
        'totalTranscripts': total_transcripts,
        'embeddedVideos': embedded_videos,
        'unembeddedVideos': total_transcripts - embedded_videos,
        'totalChunks': total_chunks,
    }


def search_similar(query_text, k=10):
    """Embed a query and return the k most similar transcript chunks with video metadata."""
    db = get_db()

    # Check if any embeddings exist
    has_embeddings = db.execute('SELECT COUNT(*) as c FROM vec_chunks').fetchone()['c']
    if not has_embeddings:
        return []

    query_embedding = embed_texts([query_text])[0]

    rows = db.execute('''
        SELECT tc.video_id, tc.content, tc.chunk_index,
               v.video_title, v.channel_name,
               vc.distance
        FROM vec_chunks vc
        JOIN transcript_chunks tc ON tc.id = vc.chunk_id
        JOIN videos v ON v.video_id = tc.video_id
        WHERE vc.embedding MATCH ? AND k = ?
        ORDER BY vc.distance
    ''', [serialize_float32(query_embedding), k]).fetchall()

    return [dict(row) for row in rows]


def search_similar_grouped(query_text, k=20):
    """Search and group results by video, keeping the best-matching chunk per video."""
    results = search_similar(query_text, k=k)
    seen = {}
    for r in results:
        vid = r['video_id']
        if vid not in seen:
            seen[vid] = r
    return list(seen.values())
